import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage } from "node:http";
import {
  gateStyle,
  originalGate,
} from "../../frontend/src/civic/gate-style.ts";
import {
  allowance,
  dayNumber,
  type CivicState,
} from "../../frontend/src/civic/rules.ts";
import { usage, taskBudget } from "./local-designer.ts";
import {
  goURL,
  goModel,
  goHeaders,
  localOwner,
  subscriptionKey,
} from "./go-subscription.ts";
import {
  traces,
  jsonResponse,
  generated,
  type Trace,
} from "./generation-log.ts";
export function gateEditing(db: DatabaseSync) {
  const history = traces(db);
  return async function (
    uid: number,
    route: string,
    req: IncomingMessage,
    state: CivicState,
  ) {
    if (route === "logs" && req.method === "GET")
      return { logs: history.list(uid) };
    const id = /^gate\/(\d+)\/(current|preview|apply)$/.exec(route);
    if (!id || Number(id[1]) !== state.home.id)
      throw Error("只能修改自己的院门");
    const current = state.home.gateStyle ?? originalGate;
    if (id[2] === "current" && req.method === "GET") return current;
    if (
      req.method !== "POST" ||
      req.headers["content-type"] !== "application/json" ||
      (req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host)
    )
      throw Error("请求来源或格式无效");
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 4096) throw Error("描述过长");
    }
    const b = JSON.parse(text || "{}");
    if (id[2] === "apply") {
      const next = gateStyle(b.style);
      db.prepare("UPDATE citizens SET gate_style=? WHERE uid=? AND no=?").run(
        JSON.stringify(next),
        uid,
        state.home.id + 1,
      );
      return { style: next };
    }
    if (
      typeof b.prompt !== "string" ||
      !b.prompt.trim() ||
      b.prompt.length > 600
    )
      throw Error("请用 1 至 600 字描述院门");
    let key = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (
      !key &&
      localOwner(
        req,
        db.prepare("SELECT name FROM users WHERE id=?").get(uid)?.name,
      )
    )
      key = subscriptionKey();
    if (!key) throw Error("请连接 OpenCode Go 订阅");
    const day = dayNumber();
    if (
      allowance(state.merit) - state.spent < taskBudget ||
      !db
        .prepare(
          "INSERT OR IGNORE INTO civic_jobs VALUES(?,'gate-preview',?,'running')",
        )
        .run(uid, day).changes
    )
      throw Error("精力不足或有进行中的生成任务");
    let dispatched = true;
    const t: Trace = { status: "失败", stage: "请求模型" };
    try {
      const res = await fetch(goURL, {
        method: "POST",
        headers: goHeaders(key),
        redirect: "error",
        signal: AbortSignal.timeout(110000),
        body: JSON.stringify({
          model: goModel,
          stream: false,
          reasoning_effort: "low",
          max_tokens: 750,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Design the finish of an existing Wei-Jin wooden courtyard gate. Keep dimensions, placement and operation. Return only JSON {finish:timber|walnut|vermilion,panels:plain|framed,hardware:latch|ring}. For a stately gate consider walnut, framed panels and bronze rings.",
            },
            {
              role: "user",
              content: JSON.stringify({ existing: current, request: b.prompt }),
            },
          ],
        }),
      });
      t.http = res.status;
      if (!res.ok) {
        if (res.status < 500) dispatched = false;
        throw Error(`模型服务返回 HTTP ${res.status}`);
      }
      t.stage = "读取响应";
      const data = await jsonResponse(res);
      t.tokens = usage({
        total: data.usage?.total_tokens,
        input: data.usage?.prompt_tokens,
        output: data.usage?.completion_tokens,
      });
      t.stage = "校验门样";
      const style = gateStyle(generated(data, t));
      t.status = "成功";
      t.stage = "预览就绪";
      return { style, tokens: t.tokens };
    } catch (e) {
      t.message = (e as Error).message;
      throw e;
    } finally {
      db.exec("BEGIN IMMEDIATE");
      try {
        history.write(uid, "院门改样", t);
        if (t.tokens)
          db.prepare(
            "INSERT INTO civic_log(uid,day,event,amount,tokens) VALUES(?,?,'院门改样',0,?)",
          ).run(uid, day, t.tokens);
        if (t.tokens || !dispatched)
          db.prepare("DELETE FROM civic_jobs WHERE uid=?").run(uid);
        else
          db.prepare(
            "UPDATE civic_jobs SET status='unmetered' WHERE uid=?",
          ).run(uid);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  };
}
