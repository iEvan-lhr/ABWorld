import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import {goBaseURL} from '../../frontend/src/go-provider.ts';
export {goModel} from '../../frontend/src/go-provider.ts';
export const goURL=goBaseURL+'/chat/completions';
export function subscriptionKey() {
  try {
    const credentials = JSON.parse(
      readFileSync(
        path.join(
          process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share"),
          "opencode",
          "auth.json",
        ),
        "utf8",
      ),
    );
    const go = credentials["opencode-go"];
    if (go?.type === "api" && typeof go.key === "string" && go.key.trim())
      return go.key.trim();
  } catch {}
  throw Error("未读取到 OpenCode Go 订阅，请在 OpenCode 中连接 Go 后重试。");
}
export function localOwner(req: IncomingMessage, name: unknown) {
  return (
    name === "Evan" && req.headers["x-world-local"] === "1" &&
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress ?? "",
    ) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL("http://" + req.headers.host).hostname,
    )
  );
}

export function goHeaders(key: string, session = crypto.randomUUID()) {
  return {
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
    "User-Agent": "ABWorld/1.0",
    "x-opencode-session": session,
  };
}
