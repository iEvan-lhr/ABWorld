import { goGeneration } from "./go-generation.ts";
import { placementRights } from "./placement-rights.ts";
import {
  creationTypes,
  modelVolume,
  type WorldPosition,
} from "../../frontend/src/civic/regions.ts";
import {
  generated,
  jsonResponse,
  traces,
  type Trace,
} from "./generation-log.ts";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  anchors,
  canonical,
  fitDimensions,
  type Anchor,
} from "../../frontend/src/civic/creations.ts";
import {
  instructions,
  parseBlueprint,
  type Vec,
} from "../../frontend/src/workshop/blueprint.ts";
import {
  allowance,
  dayNumber,
  type CivicState,
} from "../../frontend/src/civic/rules.ts";
import {
  goModel,
  goURL,
  goHeaders,
  localOwner,
  subscriptionKey,
} from "./go-subscription.ts";
import { usage, taskBudget } from "./local-designer.ts";
export function creationStore(
  db: DatabaseSync,
  requireEdit: (uid: number, asset: string) => void,
  plots: readonly { x: number; z: number }[] = [],
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS creation_rights(hash TEXT PRIMARY KEY,mode TEXT);CREATE TABLE IF NOT EXISTS creations(id INTEGER PRIMARY KEY,uid INTEGER,home INTEGER,anchor TEXT,mode TEXT,hash TEXT,blueprint TEXT,state TEXT DEFAULT '草案',stock INTEGER DEFAULT 0,price INTEGER DEFAULT 0,stamp TEXT DEFAULT CURRENT_TIMESTAMP);CREATE UNIQUE INDEX IF NOT EXISTS creations_slot ON creations(home,anchor) WHERE state='已摆放';CREATE TABLE IF NOT EXISTS purchases(uid INTEGER,product INTEGER,count INTEGER,PRIMARY KEY(uid,product));`,
  );
  if (
    !db
      .prepare("PRAGMA table_info(creations)")
      .all()
      .some((row) => row.name === "scene_context")
  )
    db.exec("ALTER TABLE creations ADD COLUMN scene_context TEXT");
  const rights = placementRights(db, plots);
  const existing = db.prepare("PRAGMA table_info(creations)").all();
  for (const col of ["position", "category"])
    if (!existing.some((r) => r.name === col))
      db.exec(`ALTER TABLE creations ADD COLUMN ${col} TEXT`);
  const history = traces(db);
  const transaction = <T>(op: () => T) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const v = op();
      db.exec("COMMIT");
      return v;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const rows = (sql: string, ...args: (string | number)[]) =>
    db
      .prepare(sql)
      .all(...args)
      .map((r) => ({ ...r, blueprint: JSON.parse(String(r.blueprint)) }));
  function add(
    uid: number,
    home: number,
    anchor: Anchor | null,
    mode: string,
    bp: ReturnType<typeof parseBlueprint>,
  ) {
    const hash = createHash("sha256").update(canonical(bp)).digest("hex");
    const rights = db
      .prepare("SELECT mode FROM creation_rights WHERE hash=?")
      .get(hash);
    if (rights && (rights.mode === "unique" || mode === "unique"))
      throw Error("该模型数据已登记，请修改结构、材料或尺寸后再设计");
    db.prepare("INSERT OR IGNORE INTO creation_rights VALUES(?,?)").run(
      hash,
      mode,
    );
    return Number(
      db
        .prepare(
          "INSERT INTO creations(uid,home,anchor,mode,hash,blueprint) VALUES(?,?,?,?,?,?)",
        )
        .run(uid, home, anchor, mode, hash, JSON.stringify(bp)).lastInsertRowid,
    );
  }
  async function input(req: IncomingMessage) {
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const b of req) {
      bytes += b.length;
      if (bytes > 10000) throw Error("请求内容太大");
      chunks.push(b);
    }
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  }
  return {
    add,
    async handle(
      uid: number,
      s: CivicState,
      route: string,
      req: IncomingMessage,
    ) {
      if (req.method === "GET") {
        if (route === "regions")
          return {
            home: rights.home(uid),
            granted: rights.list(uid),
            managed: rights.manage(uid),
          };
        if (route === "mine")
          return {
            mine: rows(
              "SELECT * FROM creations WHERE uid=? ORDER BY id DESC",
              uid,
            ),
            market: rows(
              "SELECT c.*,u.name AS author FROM creations c JOIN users u ON u.id=c.uid WHERE c.stock>0 AND c.price>0",
            ),
            bought: rows(
              "SELECT c.*,p.count AS quantity FROM purchases p JOIN creations c ON c.id=p.product WHERE p.uid=?",
              uid,
            ),
          };
        if (route === "world")
          return rows(
            "SELECT id,home,anchor,position,blueprint FROM creations WHERE state='已摆放'",
          );
        throw Error("未知作品请求");
      }
      if (
        req.method !== "POST" ||
        req.headers["content-type"] !== "application/json" ||
        (req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host)
      )
        throw Error("请求格式无效");
      const b = await input(req);
      if (route === "grant-region")
        return transaction(() => ({ id: rights.grant(uid, b) }));
      if (route === "revoke-region")
        return transaction(() => {
          rights.revoke(uid, b.id);
          return { ok: true };
        });
      if (route === "design") {
        const quick = b.flow === "new";
        if (quick) {
          if (!Object.hasOwn(creationTypes, b.category) || b.context)
            throw Error("新建物品需要有效的类型");
          b.mode = b.mode ?? "batch";
        }
        const context = b.context;
        if (context) {
          if (
            typeof context.target?.id !== "string" ||
            !Array.isArray(context.nearby) ||
            context.nearby.length > 8
          )
            throw Error("场景上下文无效");
          requireEdit(uid, context.target.id);
        }
        const size: Vec = [b.length, b.height, b.width];
        if (
          (!quick &&
            !size.every(
              (n) =>
                typeof n === "number" &&
                Number.isFinite(n) &&
                n >= 0.03 &&
                n <= 4,
            )) ||
          typeof b.prompt !== "string" ||
          !b.prompt.trim() ||
          b.prompt.length > 1200 ||
          !["unique", "batch"].includes(b.mode)
        )
          throw Error("请填写描述、长宽高和登记方式");
        const occupied = db
          .prepare(
            "SELECT anchor,blueprint FROM creations WHERE state='已摆放' AND home=?",
          )
          .all(s.home.id);
        const options = (Object.keys(anchors) as Anchor[]).filter((k) => {
          const a = anchors[k];
          return (
            (b.anchor === "auto" || b.anchor === k) &&
            !occupied.some((p) => p.anchor === k) &&
            size[0] <= a.w &&
            size[2] <= a.d &&
            size[1] <= a.h
          );
        });
        if (!quick && !options.length) throw Error("所选位置已占用或尺寸过大");
        const key =
          req.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ??
          (localOwner(
            req,
            db.prepare("SELECT name FROM users WHERE id=?").get(uid)?.name,
          )
            ? subscriptionKey()
            : "");
        if (!key) throw Error("请在模型设置中连接自己的 Go 订阅");
        const day = dayNumber();
        transaction(() => {
          if (
            allowance(s.merit) - s.spent < taskBudget ||
            db.prepare("SELECT uid FROM civic_jobs WHERE uid=?").get(uid)
          )
            throw Error("精力不足或有未结算任务");
          db.prepare(
            "INSERT INTO civic_jobs VALUES(?,'design',?,'running')",
          ).run(uid, day);
        });
        const trace: Trace = { stage: "请求模型", status: "失败" };
        let tokens: number | null = null,
          dispatched = false;
        try {
          dispatched = true;
          const r = await goGeneration(key, allowance(s.merit) - s.spent, {
            reasoning_effort: "low",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  instructions +
                  (quick
                    ? " 按上述示例直接返回蓝图对象（version、catalogVersion、name、seed、parts），合理选择实际尺寸，底部中心位于原点。"
                    : " Return JSON {anchor,blueprint}. Fit the requested dimensions. Select only an available anchor. Keep the central doorway and courtyard path free."),
              },
              {
                role: "user",
                content: JSON.stringify(
                  quick
                    ? {
                        category:
                          creationTypes[
                            b.category as keyof typeof creationTypes
                          ],
                        description: b.prompt,
                      }
                    : {
                        sceneContext: context,
                        description: b.prompt,
                        dimensions: {
                          length: b.length,
                          width: b.width,
                          height: b.height,
                        },
                        house: {
                          hall: [8.4, 5, 2.8],
                          courtyard: [14, 17.2],
                          porch: s.home.roof,
                          furnishings: s.home.yard,
                          door: "middle of south wall",
                          anchors,
                          occupied: occupied.map((o) => ({
                            anchor: o.anchor,
                            name: JSON.parse(String(o.blueprint)).name,
                          })),
                          available: options,
                        },
                      },
                ),
              },
            ],
          });
          trace.http = r.status;
          if (!r.ok) {
            if (r.status < 500) dispatched = false;
            throw Error(`Go 服务返回 HTTP ${r.status}`);
          }
          trace.stage = "读取响应";
          const data = await jsonResponse(r);
          tokens = usage({
            total: data.usage?.total_tokens,
            input: data.usage?.prompt_tokens,
            output: data.usage?.completion_tokens,
          });
          trace.tokens = tokens;
          trace.stage = "校验设计";
          const result = generated(data, trace),
            anchor = quick
              ? null
              : b.anchor === "auto"
                ? result.anchor
                : b.anchor;
          if (!quick && !options.includes(anchor))
            throw Error("AI 选择的位置不符合摆放约束");
          const parsed = parseBlueprint(
            quick ? (result.blueprint ?? result) : result.blueprint,
          );
          const bp = quick ? parsed : fitDimensions(parsed, size);
          return transaction(() => {
            if (context) requireEdit(uid, context.target.id);
            const id = add(uid, s.home.id, anchor, b.mode, bp);
            if (quick)
              db.prepare("UPDATE creations SET category=? WHERE id=?").run(
                b.category,
                id,
              );
            if (context)
              db.prepare("UPDATE creations SET scene_context=? WHERE id=?").run(
                JSON.stringify(context),
                id,
              );
            trace.status = "成功";
            trace.stage = "已保存";
            return { id, tokens };
          });
        } catch (error) {
          trace.message = (error as Error).message.slice(0, 160);
          throw error;
        } finally {
          transaction(() => {
            history.write(uid, "物品设计", trace);
            if (tokens !== null)
              db.prepare(
                "INSERT INTO civic_log(uid,day,event,amount,tokens) VALUES(?,?,'物品设计',0,?)",
              ).run(uid, day, tokens);
            if (tokens !== null || !dispatched)
              db.prepare("DELETE FROM civic_jobs WHERE uid=?").run(uid);
            else
              db.prepare(
                "UPDATE civic_jobs SET status='unmetered' WHERE uid=?",
              ).run(uid);
          });
        }
      }
      return transaction(() => {
        const c = db
          .prepare("SELECT * FROM creations WHERE id=?")
          .get(Number(b.id));
        if (!c) throw Error("作品不存在");
        if (route === "buy") {
          if (
            c.uid === uid ||
            c.mode !== "batch" ||
            Number(c.stock) < 1 ||
            Number(c.price) < 1
          )
            throw Error("商品不可购买");
          if (
            !db
              .prepare(
                "UPDATE citizens SET balance=balance-? WHERE uid=? AND balance>=?",
              )
              .run(c.price, uid, c.price).changes
          )
            throw Error("余额不足");
          db.prepare("UPDATE citizens SET balance=balance+? WHERE uid=?").run(
            c.price,
            c.uid,
          );
          db.prepare("UPDATE creations SET stock=stock-1 WHERE id=?").run(c.id);
          db.prepare(
            "INSERT INTO purchases VALUES(?,?,1) ON CONFLICT(uid,product) DO UPDATE SET count=count+1",
          ).run(uid, c.id);
          for (const [who, amount] of [
            [uid, -Number(c.price)],
            [Number(c.uid), Number(c.price)],
          ])
            db.prepare(
              "INSERT INTO civic_log(uid,day,event,amount,tokens) VALUES(?,?,'市集交易',?,0)",
            ).run(who, dayNumber(), amount);
          return { ok: true };
        }
        if (c.uid !== uid) throw Error("只有作者能操作作品");
        if (route === "place") {
          if (c.scene_context)
            requireEdit(uid, JSON.parse(String(c.scene_context)).target.id);
          if (c.state !== "草案") throw Error("已经摆放");
          const preset = b.anchor ?? c.anchor;
          let pos: WorldPosition;
          if (b.position !== undefined) {
            const v = b.position;
            if (!v || typeof v !== "object") throw Error("坐标无效");
            pos = { x: v.x, y: v.y, z: v.z, yaw: v.yaw ?? 0 };
          } else {
            if (!Object.hasOwn(anchors, preset)) throw Error("请选择摆放位置");
            const a = anchors[preset as Anchor],
              h = plots[s.home.id];
            pos = { x: h.x + a.x, y: 0.14, z: h.z + a.z, yaw: 0 };
          }
          const box = rights.check(uid, {
            ...pos,
            blueprint: parseBlueprint(JSON.parse(String(c.blueprint))),
          });
          for (const row of db
            .prepare(
              "SELECT home,anchor,blueprint,position FROM creations WHERE state='已摆放'",
            )
            .all()) {
            const a = anchors[row.anchor as Anchor],
              h = plots[Number(row.home)];
            const loc = row.position
              ? JSON.parse(String(row.position))
              : a && h
                ? { x: h.x + a.x, y: 0.14, z: h.z + a.z, yaw: 0 }
                : null;
            if (!loc) continue;
            const other = modelVolume({
              ...loc,
              blueprint: JSON.parse(String(row.blueprint)),
            });
            if (
              box.minX < other.maxX &&
              box.maxX > other.minX &&
              box.minY < other.maxY &&
              box.maxY > other.minY &&
              box.minZ < other.maxZ &&
              box.maxZ > other.minZ
            )
              throw Error("该位置与已摆放的物品重叠");
          }
          db.prepare(
            "UPDATE creations SET state='已摆放',anchor=?,position=? WHERE id=?",
          ).run(b.position ? null : preset, JSON.stringify(pos), c.id);
        } else if (route === "stock") {
          if (
            c.mode !== "batch" ||
            !Number.isSafeInteger(b.quantity) ||
            b.quantity < 1 ||
            b.quantity > 999 ||
            !Number.isSafeInteger(b.price) ||
            b.price < 1 ||
            b.price > 1e8
          )
            throw Error("只有量产款可以备货出售，请填写有效数量与价格");
          db.prepare(
            "UPDATE creations SET stock=stock+?,price=? WHERE id=?",
          ).run(b.quantity, b.price, c.id);
        } else throw Error("未知作品操作");
        return { ok: true };
      });
    },
  };
}
