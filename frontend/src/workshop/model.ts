import {goBaseURL} from '../go-provider.ts';
import { instructions, parseBlueprint } from "./blueprint.ts";
export interface Connection {
  url: string;
  model: string;
  key: string;
  go?: boolean;
}
function endpoint(base: string, path: string) {
  const u = new URL(base);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
    )
  )
    throw Error("模型地址请使用 HTTPS 或本机 HTTP 地址");
  u.pathname = u.pathname.replace(/\/+$/, "") + "/" + path;
  return u.href;
}
async function request(
  c: Connection,
  path: string,
  signal: AbortSignal,
  body?: object,
) {
  const headers: Record<string, string> = {};
  if (c.key) headers.Authorization = "Bearer " + c.key;
  if (body) headers["Content-Type"] = "application/json";
  const goCatalog = c.go && path === "models";
  if (goCatalog) delete headers.Authorization;
  const localRelay =
    c.go &&
    !goCatalog &&
    typeof location !== "undefined" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) &&
    /^https?:$/.test(location.protocol);
  const url = goCatalog
    ? goBaseURL+"/models"
    : localRelay
      ? "/api/model/go/chat"
      : endpoint(
          c.go ? goBaseURL : c.url,
          path,
        );
  let r: Response;
  try {
    r = await fetch(url, {
      method: body ? "POST" : "GET",
      headers,
      signal,
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw Error(
      "浏览器无法连接模型。请检查服务地址、浏览器跨域许可（CORS）和网络。",
    );
  }
  if (!r.ok)
    throw Error(
      `模型服务返回 HTTP ${r.status}。${r.status === 401 || r.status === 403 ? "请检查密钥和来源权限。" : r.status === 404 ? "请检查 /v1 地址与模型名称。" : "请检查模型服务状态或参数。"}`,
    );
  return r.json();
}
export async function models(
  c: Connection,
  signal: AbortSignal,
): Promise<string[]> {
  const data = await request(c, "models", signal);
  if (!Array.isArray(data.data))
    throw Error("模型服务返回了无法识别的模型列表");
  return data.data
    .filter(
      (m: { api?: Record<string, unknown> }) =>
        !c.go || !!m.api?.["chat-completions"],
    )
    .map((m: { id?: unknown }) => m?.id)
    .filter((id: unknown) => typeof id === "string");
}
export async function generate(
  c: Connection,
  text: string,
  signal: AbortSignal,
) {
  if (!c.model.trim() || !text.trim()) throw Error("请填写模型名称和物件描述");
  const messages = [
    { role: "system", content: instructions },
    { role: "user", content: text.trim().slice(0, 2000) },
  ];
  for (let n = 0; ; n++) {
    const data = await request(c, "chat/completions", signal, {
      model: c.model,
      messages,
      stream: false,
      temperature: 0.25,
    });
    const answer = data.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || answer.length > 64000)
      throw Error("模型没有返回有效的建模内容");
    try {
      return parseBlueprint(
        JSON.parse(
          answer
            .trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, ""),
        ),
      );
    } catch (e) {
      if (n) throw Error("模型蓝图未通过检查：" + (e as Error).message);
      messages.push(
        { role: "assistant", content: answer },
        {
          role: "user",
          content: "请修复并仅输出完整 JSON：" + (e as Error).message,
        },
      );
    }
  }
}

export async function checkChat(c: Connection, signal: AbortSignal) {
  if (!c.model.trim()) throw Error("请填写或选择模型名");

  const result = await request(c, "chat/completions", signal, {
    model: c.model,
    stream: false,
    messages: [{ role: "user", content: "Reply with OK." }],
  });
  if (typeof result.choices?.[0]?.message?.content !== "string")
    throw Error("响应缺少对话内容");
}
