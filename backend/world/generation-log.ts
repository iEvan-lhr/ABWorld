import type { DatabaseSync } from "node:sqlite";
export type Trace = {
  http?: number;
  finish?: string;
  characters?: number;
  tokens?: number;
  stage: string;
  status: "成功" | "失败";
  message?: string;
};
export function traces(db: DatabaseSync) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS generation_log(id INTEGER PRIMARY KEY,uid INTEGER,kind TEXT,model TEXT,status TEXT,stage TEXT,http INTEGER,finish TEXT,characters INTEGER,tokens INTEGER,message TEXT,stamp TEXT DEFAULT CURRENT_TIMESTAMP)`,
  );
  return {
    write(uid: number, kind: string, t: Trace) {
      db.prepare(
        "INSERT INTO generation_log(uid,kind,model,status,stage,http,finish,characters,tokens,message) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        uid,
        kind,
        "deepseek-v4.1-flash",
        t.status,
        t.stage,
        t.http ?? null,
        t.finish ?? null,
        t.characters ?? null,
        t.tokens ?? null,
        t.message ?? null,
      );
    },
    list(uid: number) {
      return db
        .prepare(
          "SELECT kind,status,stage,http,finish,characters,tokens,message,stamp FROM generation_log WHERE uid=? ORDER BY id DESC LIMIT 16",
        )
        .all(uid);
    },
  };
}
export async function jsonResponse(r: Response) {
  const text = await r.text();
  if (!text.trim()) throw Error(`服务返回空响应（HTTP ${r.status}）`);
  try {
    return JSON.parse(text);
  } catch {
    throw Error(`服务响应不是完整 JSON（HTTP ${r.status}）`);
  }
}
export function generated(data: any, t: Trace) {
  const c = data?.choices?.[0];
  t.finish = String(c?.finish_reason ?? "unknown").slice(0, 32);
  const raw =
    typeof c?.message?.content === "string" ? c.message.content.trim() : "";
  t.characters = raw.length;
  if (t.finish === "length")
    throw Error("模型输出达到长度上限，方案未生成完整。请简化描述后重试。");
  if (!raw) throw Error("模型返回了空的设计内容，请重新生成。");
  try {
    return JSON.parse(
      raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
    );
  } catch {
    throw Error("模型返回的设计 JSON 不完整，请重新生成。");
  }
}
