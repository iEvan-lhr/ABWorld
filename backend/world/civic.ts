import { gateEditing } from "./gate-editing.ts";
import { gateStyle } from "../../frontend/src/civic/gate-style.ts";
import { objectAccess } from "./object-access.ts";
import { creationStore } from "./creations.ts";
import { Worker } from "node:worker_threads";
import { localOwner, subscriptionKey } from "./go-subscription.ts";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  allowance,
  income,
  dayNumber,
  tasks,
  design,
  type Task,
  type Home,
  type CivicState,
} from "../../frontend/src/civic/rules.ts";
import { runDesigner, taskBudget } from "./local-designer.ts";
export function civicService(
  dir: string,
  root: string,
  designer = runDesigner,
) {
  const db = new DatabaseSync(path.join(dir, "accounts.sqlite"));
  const plots = JSON.parse(
    readFileSync(path.join(root, "frontend/src/data/civic-homes.json"), "utf8"),
  ) as { x: number; z: number }[];
  db.exec(
    `PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS citizens(no INTEGER PRIMARY KEY, uid INTEGER UNIQUE, balance INTEGER NOT NULL DEFAULT 0,merit INTEGER NOT NULL DEFAULT 0,paid INTEGER NOT NULL,roof TEXT,yard TEXT,resident INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS civic_log(id INTEGER PRIMARY KEY,uid INTEGER,day INTEGER,event TEXT,amount INTEGER,tokens INTEGER);CREATE INDEX IF NOT EXISTS civic_log_by_day ON civic_log(uid,day);CREATE TABLE IF NOT EXISTS civic_jobs(uid INTEGER PRIMARY KEY,task TEXT,day INTEGER,status TEXT);`,
  );
  const columns = db.prepare("PRAGMA table_info(citizens)").all();
  for (const k of ["gate", "hall"])
    if (!columns.some((c) => c.name === k))
      db.exec(
        `ALTER TABLE citizens ADD COLUMN ${k} INTEGER NOT NULL DEFAULT 0`,
      );
  if (!columns.some((c) => c.name === "gate_style"))
    db.exec("ALTER TABLE citizens ADD COLUMN gate_style TEXT");
  const editGate = gateEditing(db);
  const access = objectAccess(db, root);
  const creations = creationStore(db, access.requireEdit, plots);
  function tx<T>(fn: () => T) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const val = fn();
      db.exec("COMMIT");
      return val;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  const log = (
    uid: number,
    day: number,
    event: string,
    amount: number,
    tokens: number,
  ) =>
    db
      .prepare(
        "INSERT INTO civic_log(uid,day,event,amount,tokens) VALUES(?,?,?,?,?)",
      )
      .run(uid, day, event, amount, tokens);
  function issue(uid: number) {
    const row = db.prepare("SELECT * FROM citizens WHERE uid=?").get(uid);
    if (!row) return;
    const today = dayNumber(),
      days = today - Number(row.paid);
    if (days <= 0) return;
    const coins = days * income(Number(row.merit));
    db.prepare("UPDATE citizens SET paid=?,balance=balance+? WHERE uid=?").run(
      today,
      coins,
      uid,
    );
    log(uid, today, days === 1 ? "公民日薪" : `${days} 天公民日薪`, coins, 0);
  }
  function enroll(uid: number, founder = false) {
    if (!db.prepare("SELECT no FROM citizens WHERE uid=?").get(uid)) {
      const n =
        founder ||
        !!db
          .prepare("SELECT id FROM users WHERE id=? AND name=\x27Evan\x27")
          .get(uid)
          ? 1
          : Number(
              db
                .prepare(
                  "SELECT MAX(1,COALESCE(MAX(no),1))+1 AS n FROM citizens",
                )
                .get()!.n,
            );
      if (n > plots.length) throw Error("住宅已分配完毕");
      db.prepare("INSERT INTO citizens(no,uid,paid) VALUES(?,?,?)").run(
        n,
        uid,
        dayNumber() - 1,
      );
    }
    issue(uid);
  }
  const founder = db.prepare("SELECT id FROM users WHERE name='Evan'").get();
  if (founder) tx(() => enroll(Number(founder.id), true));
  const routing = new Set<number>();
  function sweep() {
    tx(() => {
      for (const row of db
        .prepare("SELECT uid FROM citizens WHERE paid<?")
        .all(dayNumber()))
        issue(Number(row.uid));
    });
  }
  const timer = setInterval(sweep, 60000);
  timer.unref();
  const house = (r: Record<string, unknown>): Home => ({
    id: Number(r.no) - 1,
    gateStyle: r.gate_style
      ? gateStyle(JSON.parse(String(r.gate_style)))
      : undefined,
    gate: !!r.gate,
    hall: !!r.hall,
    roof: r.roof ? design(JSON.parse(String(r.roof))) : null,
    yard: r.yard ? design(JSON.parse(String(r.yard))) : null,
    resident: Number(r.resident),
  });
  function state(uid: number): CivicState {
    const r = db.prepare("SELECT * FROM citizens WHERE uid=?").get(uid)!;
    return {
      no: Number(r.no),
      balance: Number(r.balance),
      merit: Number(r.merit),
      spent: Number(
        db
          .prepare(
            "SELECT COALESCE(SUM(tokens),0) AS n FROM civic_log WHERE uid=? AND day=?",
          )
          .get(uid, dayNumber())!.n,
      ),
      pending: !!db.prepare("SELECT uid FROM civic_jobs WHERE uid=?").get(uid),
      home: house(r),
      ledger: db
        .prepare(
          "SELECT day,event,amount,tokens FROM civic_log WHERE uid=? ORDER BY id DESC LIMIT 20",
        )
        .all(uid) as unknown as CivicState["ledger"],
    };
  }
  async function repair(uid: number, task: Task, key?: string) {
    const day = dayNumber();
    let remaining = 0;
    tx(() => {
      enroll(uid);
      const s = state(uid);
      if (s.home[task] || s.pending || (task === "yard" && !s.home.roof))
        throw Error("任务已完成、正在处理，或尚未解锁");
      remaining = allowance(s.merit) - s.spent;
      if (remaining < taskBudget)
        throw Error("今日剩余精力不足以预留单次任务预算");
      db.prepare("INSERT INTO civic_jobs VALUES(?,?,?,?)").run(
        uid,
        task,
        day,
        "running",
      );
    });
    const result = await designer(root, dir, task, key, remaining);
    return tx(() => {
      issue(uid);
      if (result.tokens === null) {
        if (result.started) {
          db.prepare(
            "UPDATE civic_jobs SET status='unmetered' WHERE uid=?",
          ).run(uid);
        } else db.prepare("DELETE FROM civic_jobs WHERE uid=?").run(uid);
        return { error: result.error || "模型未提供用量，待核对" };
      }
      const plan = result.plan;
      let pay = 0;
      if (plan) {
        const t = tasks[task];
        pay = t.pay;
        db.prepare(
          `UPDATE citizens SET ${task}=?,balance=balance+?,merit=merit+? WHERE uid=?`,
        ).run(JSON.stringify(plan), pay, t.merit, uid);
      }
      log(
        uid,
        day,
        tasks[task].name + (plan ? "" : "（未通过）"),
        pay,
        result.tokens,
      );
      db.prepare("DELETE FROM civic_jobs WHERE uid=?").run(uid);
      return plan
        ? { ok: true }
        : { error: result.error || "模型设计未通过验收" };
    });
  }
  return {
    close() {
      clearInterval(timer);
      db.close();
    },
    state,
    repair,
    async handle(
      uid: number,
      route: string,
      req: IncomingMessage,
      res: ServerResponse,
    ) {
      const send = (n: number, v: unknown) =>
        res
          .writeHead(n, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          })
          .end(JSON.stringify(v));
      try {
        tx(() => enroll(uid));
        if (route === "logs" || route.startsWith("gate/")) {
          send(200, await editGate(uid, route, req, state(uid)));
          return;
        }
        if (route.startsWith("access/")) {
          try {
            send(200, await access.handle(uid, route.slice(7), req));
          } catch (e) {
            send(403, { error: (e as Error).message });
          }
          return;
        }
        if (route.startsWith("creations/")) {
          send(
            200,
            await creations.handle(uid, state(uid), route.slice(10), req),
          );
          return;
        }
        if (route === "route" && req.method === "GET") {
          const url = new URL(req.url!, "http://localhost");
          const start = {
            x: Number(url.searchParams.get("x")),
            z: Number(url.searchParams.get("z")),
            y: Number(url.searchParams.get("y")),
          };
          if (
            !Object.values(start).every(Number.isFinite) ||
            Math.abs(start.x) > 4050 ||
            Math.abs(start.z) > 4630 ||
            Math.abs(start.y) > 260
          )
            throw Error("起点无效");
          if (routing.has(uid) || routing.size >= 4)
            throw Error("正在计算路线，请稍后重试");
          routing.add(uid);
          try {
            const worker = new Worker(
              new URL("./home-route.ts", import.meta.url),
              { workerData: { root, start, home: plots[state(uid).home.id] } },
            );
            try {
              const result = await new Promise<{
                points?: unknown;
                error?: string;
              }>((resolve, reject) => {
                const timer = setTimeout(
                  () => reject(Error("路线计算超时，请在街道上重试")),
                  16000,
                );
                worker.once("message", (v) => {
                  clearTimeout(timer);
                  resolve(v);
                });
                worker.once("error", (e) => {
                  clearTimeout(timer);
                  reject(e);
                });
              });
              send(result.error ? 422 : 200, result);
            } finally {
              await worker.terminate();
            }
          } finally {
            routing.delete(uid);
          }
          return;
        }
        if (route === "state" && req.method === "GET") {
          send(200, state(uid));
          return;
        }
        if (route === "homes" && req.method === "GET") {
          send(
            200,
            db
              .prepare(
                "SELECT no,roof,yard,resident,gate,hall,gate_style FROM citizens",
              )
              .all()
              .map(house),
          );
          return;
        }
        if (
          req.method !== "POST" ||
          (req.headers.origin &&
            new URL(req.headers.origin).host !== req.headers.host) ||
          req.headers["content-type"] !== "application/json"
        ) {
          send(403, { error: "请求无效" });
          return;
        }
        if (/^door\/(gate|hall)\/(open|close)$/.test(route)) {
          const [, which, action] = route.split("/");
          db.prepare(`UPDATE citizens SET ${which}=? WHERE uid=?`).run(
            Number(action === "open"),
            uid,
          );
          send(200, state(uid));
          return;
        }
        if (route === "resident") {
          const changed = db
            .prepare(
              "UPDATE citizens SET resident=1 WHERE uid=? AND roof IS NOT NULL AND yard IS NOT NULL AND resident=0",
            )
            .run(uid);
          if (!changed.changes) throw Error("完成两项任务后可接纳一位居民");
        } else if (route === "roof" || route === "yard") {
          let key = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
          const owner = db
            .prepare("SELECT name FROM users WHERE id=?")
            .get(uid);
          if (!key && designer === runDesigner && localOwner(req, owner?.name))
            key = subscriptionKey();
          const result = await repair(uid, route, key);
          if (result.error) throw Error(result.error);
        } else {
          send(404, {});
          return;
        }
        send(200, state(uid));
      } catch (e) {
        send(409, { error: (e as Error).message });
      }
    },
  };
}
