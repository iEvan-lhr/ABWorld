import { AsyncLocalStorage } from "node:async_hooks";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import {
  request as http,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { request as https } from "node:https";
import { networkInterfaces } from "node:os";
import { modelBase } from "../../frontend/src/model-base.ts";
interface Provider {
  url: URL;
  model: string;
  key: string;
}
export const selectedProvider = new AsyncLocalStorage<Provider>();
const excluded = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  excluded.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  excluded.addSubnet(net, bits, "ipv6");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
for (const ip of [
  process.env.ABWORLD_PUBLIC_IP || "111.229.171.148",
  ...Object.values(networkInterfaces())
    .flat()
    .map((n) => n?.address || ""),
]) {
  if (isIP(ip)) excluded.addAddress(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
}
export function publicAddress(ip: string) {
  const f = isIP(ip);
  return f === 4
    ? !excluded.check(ip, "ipv4")
    : f === 6 && global6.check(ip, "ipv6") && !excluded.check(ip, "ipv6");
}
export function customConfig(req: IncomingMessage) {
  const value = req.headers["x-abworld-base"];
  if (value === undefined) return;
  const rawModel = req.headers["x-abworld-model"] ?? "";
  if (
    typeof value !== "string" ||
    value.length > 3072 ||
    typeof rawModel !== "string" ||
    rawModel.length > 1024
  )
    throw Error("模型设置过长");
  const url = modelBase(decodeURIComponent(value));
  const model = decodeURIComponent(rawModel).trim();
  const key = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? "";
  return { url, model, key };
}
// Resolve once, validate every answer, then connect to the exact approved address. Never follow redirects.
export async function customRequest(
  p: Provider,
  operation: "models" | "chat",
  body?: object,
): Promise<Response> {
  const u = p.url,
    host = u.hostname.replace(/^\[|\]$/g, ""),
    records = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true });
  if (!records.length || records.some((r) => !publicAddress(r.address)))
    return Response.json(
      { error: "公服只能连接公网模型地址；本机模型请从本机页面连接。" },
      { status: 403 },
    );
  const ip = records[0].address;
  const path =
    u.pathname.replace(/\/+$/, "") +
    (operation === "models" ? "/models" : "/chat/completions");
  const headers: Record<string, string> = {
    Host: u.host,
    Accept: "application/json",
  };
  if (p.key) headers.Authorization = "Bearer " + p.key;
  if (body) headers["Content-Type"] = "application/json";
  return new Promise((resolve, reject) => {
    const upstream = (u.protocol === "https:" ? https : http)(
      {
        hostname: ip,
        port: u.port || undefined,
        path,
        method: operation === "models" ? "GET" : "POST",
        headers,
        agent: false,
        ...(!isIP(host) && u.protocol === "https:" ? { servername: host } : {}),
      },
      (r) => {
        const status = r.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          r.destroy();
          resolve(
            Response.json(
              { error: "模型服务返回重定向，请直接填写最终 API 地址" },
              { status: 400 },
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        r.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) {
            r.destroy(Error("模型响应过大"));
            return;
          }
          chunks.push(chunk);
        });
        r.on("error", reject);
        r.on("end", () => {
          resolve(
            new Response(
              [204, 205, 304].includes(status)
                ? null
                : Buffer.concat(chunks).toString(),
              {
                status,
                headers: {
                  "Content-Type": "application/json",
                  "X-ABWorld-Model-Upstream": "1",
                },
              },
            ),
          );
        });
      },
    );
    const timer = setTimeout(
      () => upstream.destroy(Error("模型连接超时")),
      120000,
    );
    upstream.on("close", () => clearTimeout(timer));
    upstream.on("error", reject);
    upstream.end(body ? JSON.stringify(body) : undefined);
  });
}
const active = new Set<number>();
export async function modelProbe(
  req: IncomingMessage,
  res: ServerResponse,
  uid: number,
  path: string,
) {
  const send = (code: number, error: string) =>
    res
      .writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(JSON.stringify({ error }));
  if (req.method !== "POST" || !["models", "chat"].includes(path)) {
    send(405, "请求方式无效");
    return;
  }
  if (active.has(uid) || active.size >= 24) {
    send(429, "已有模型请求正在处理");
    return;
  }
  active.add(uid);
  try {
    const config = customConfig(req);
    if (!config) {
      send(400, "缺少模型地址");
      return;
    }
    if (path === "chat" && !config.model) {
      send(400, "请填写模型名");
      return;
    }
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 65536) {
        send(413, "模型请求过大");
        return;
      }
    }
    const input = JSON.parse(text || "{}");
    const messages = input.messages;
    if (
      path === "chat" &&
      (!Array.isArray(messages) ||
        !messages.length ||
        messages.length > 12 ||
        !messages.every(
          (m) =>
            m &&
            ["system", "user", "assistant"].includes(m.role) &&
            typeof m.content === "string",
        ))
    ) {
      send(400, "对话消息无效");
      return;
    }
    const r = await customRequest(
      config,
      path === "models" ? "models" : "chat",
      path === "chat"
        ? { model: config.model, messages, stream: false }
        : undefined,
    );
    res
      .writeHead(r.status, {
        ...Object.fromEntries(r.headers),
        "Cache-Control": "no-store",
      })
      .end(await r.text());
  } catch {
    send(502, "公服连接模型失败，请检查地址、端口和服务状态");
  } finally {
    active.delete(uid);
  }
}
