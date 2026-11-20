import { DatabaseSync } from "node:sqlite";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { loadCharacter } from "../../frontend/src/player/character.ts";
const derive = promisify(scrypt);
export function accounts(dir: string) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "accounts.sqlite"));
  db.exec(
    `PRAGMA busy_timeout=3000;CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,progress TEXT,revision INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires INTEGER NOT NULL);`,
  );
  const token = (req: IncomingMessage) =>
    createHash("sha256")
      .update(
        /(?:^|;\s*)abworld_sid=([0-9a-f]{64})(?:;|$)/.exec(
          req.headers.cookie ?? "",
        )?.[1] ?? "",
      )
      .digest("hex");
  const session = (req: IncomingMessage) =>
    db
      .prepare(
        "SELECT u.id,u.name,u.progress,u.revision FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
      )
      .get(token(req), Date.now());
  const attempts = new Map<string, { count: number; until: number }>();
  return {
    session,
    async handle(route: string, req: IncomingMessage, res: ServerResponse) {
      const send = (status: number, data: unknown) =>
        res
          .writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          })
          .end(JSON.stringify(data));
      const cookie = (value: string, age: number) =>
        res.setHeader(
          "Set-Cookie",
          `abworld_sid=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${"encrypted" in req.socket ? "; Secure" : ""}`,
        );
      try {
        if (route === "session" && req.method === "GET") {
          const u = session(req);
          send(200, u ?? null);
          return;
        }
        if (
          req.method !== "POST" ||
          req.headers["content-type"]?.split(";")[0] !== "application/json" ||
          (req.headers.origin &&
            new URL(req.headers.origin).host !== req.headers.host)
        ) {
          send(403, { error: "请求来源或格式无效" });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8192) {
            send(413, { error: "请求内容过大" });
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString());
        if (route === "logout") {
          db.prepare("DELETE FROM sessions WHERE token=?").run(token(req));
          cookie("", 0);
          send(200, { ok: true });
          return;
        }
        if (route === "save") {
          const u = session(req);
          if (!u) {
            send(401, { error: "登录已过期，请重新登录" });
            return;
          }
          if (
            !Number.isSafeInteger(input.revision) ||
            input.state?.version !== 1
          ) {
            send(400, { error: "存档格式无效" });
            return;
          }
          const progress = JSON.stringify(
            loadCharacter(JSON.stringify(input.state)),
          );
          const result = db
            .prepare(
              "UPDATE users SET progress=?,revision=revision+1 WHERE id=? AND revision=?",
            )
            .run(progress, u.id, input.revision);
          if (!result.changes) {
            send(409, { error: "另一个页面已更新存档，请刷新以读取最新进度" });
            return;
          }
          send(200, { revision: input.revision + 1 });
          return;
        }
        if (route !== "login" && route !== "register") {
          send(404, {});
          return;
        }
        const name =
            typeof input.name === "string"
              ? input.name.trim().normalize("NFC")
              : "",
          password = input.password;
        if (
          !/^[\p{L}\p{N}_-]{2,24}$/u.test(name) ||
          typeof password !== "string" ||
          password.length < 8 ||
          password.length > 128
        ) {
          send(400, {
            error:
              "账号需 2–24 位汉字、字母、数字、下划线或短横线，密码需 8–128 位",
          });
          return;
        }
        const ip = req.socket.remoteAddress ?? "";
        const now = Date.now();
        for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
        const limit = attempts.get(ip) ?? { count: 0, until: now + 60000 };
        if (++limit.count > 25) {
          send(429, { error: "操作频繁，请稍后再试" });
          return;
        }
        attempts.set(ip, limit);
        let u = db.prepare("SELECT * FROM users WHERE name=?").get(name);
        const salt =
          route === "login" && u
            ? String(u.salt)
            : randomBytes(16).toString("hex");
        const hash = (await derive(password, salt, 64)) as Buffer;
        if (route === "register") {
          const result = db
            .prepare(
              "INSERT OR IGNORE INTO users(name,salt,hash) VALUES(?,?,?)",
            )
            .run(name, salt, hash.toString("hex"));
          if (!result.changes) {
            send(409, { error: "此账号名已被使用" });
            return;
          }
          u = db
            .prepare("SELECT * FROM users WHERE id=?")
            .get(result.lastInsertRowid);
        } else if (
          !u ||
          !timingSafeEqual(hash, Buffer.from(String(u.hash), "hex"))
        ) {
          send(401, { error: "账号或密码有误" });
          return;
        }
        const sid = randomBytes(32).toString("hex"),
          age = 7 * 86400;
        db.prepare("DELETE FROM sessions WHERE expires<=? OR token=?").run(
          now,
          token(req),
        );
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
          createHash("sha256").update(sid).digest("hex"),
          u!.id,
          now + age * 1000,
        );
        cookie(sid, age);
        send(200, {
          id: u!.id,
          name: u!.name,
          revision: u!.revision,
          progress: u!.progress,
        });
      } catch {
        if (!res.headersSent) send(400, { error: "请求未完成，请重试" });
      }
    },
  };
}
