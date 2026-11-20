import { localOwner, subscriptionKey, goURL, goHeaders } from "./go-subscription.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
export async function goChat(
  req: IncomingMessage,
  res: ServerResponse,
  name?: unknown,
) {
  const reply = (code: number, message: string) =>
    res
      .writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(JSON.stringify({ error: message }));
  try {
    const origin = new URL(req.headers.origin ?? "about:blank");
    if (
      req.method !== "POST" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
      origin.host !== req.headers.host ||
      !["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress ?? "",
      )
    ) {
      reply(403, "仅接受本机页面的请求");
      return;
    }
    const token =
      req.headers.authorization ||
      (localOwner(req, name) ? "Bearer " + subscriptionKey() : undefined);
    if (!token?.startsWith("Bearer ")) {
      reply(401, "缺少 Go API 密钥");
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) {
        reply(413, "请求过大");
        return;
      }
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const r = await fetch(
      goURL,
      {
        method: "POST",
        headers: goHeaders(token.slice(7)),
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(110000),
      },
    );
    res
      .writeHead(r.status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(await r.text());
  } catch {
    reply(502, "无法连接 Go 服务");
  }
}
