import {
  customConfig,
  selectedProvider,
  modelProbe,
} from "./custom-provider.ts";
import { createServer } from "node:http";
import path from "node:path";
import { civicService } from "./civic.ts";
import { workshopApi } from "./workshop-api.ts";
import { goChat } from "./go-chat.ts";
const root = process.cwd(),
  dir = process.env.ABWORLD_DATA_DIR ?? path.join(root, ".world"),
  secret = process.env.ABWORLD_WORKER_SECRET;
if (!secret) throw Error("请通过 Echo 服务启动世界计算进程");
const world = workshopApi(root, dir),
  civic = civicService(dir, root);
const server = createServer(async (req, res) => {
  try {
    if (req.headers["x-world-internal"] !== secret) {
      res.writeHead(403).end();
      return;
    }
    const uid = Number(req.headers["x-world-uid"]);
    if (!Number.isSafeInteger(uid) || uid < 1) {
      res.writeHead(401).end();
      return;
    }
    const name = new URL(req.url ?? "/", "http://localhost").pathname;
    if (name.startsWith("/api/model/custom/")) {
      await modelProbe(req, res, uid, name.slice("/api/model/custom/".length));
      return;
    }
    if (name.startsWith("/api/civic/")) {
      const custom = customConfig(req);
      if (custom) {
        if (!custom.model) {
          res
            .writeHead(400, { "Content-Type": "application/json" })
            .end(JSON.stringify({ error: "请填写模型名称" }));
          return;
        }
        await selectedProvider.run(custom, () =>
          civic.handle(uid, name.slice(11), req, res),
        );
        return;
      }
      await civic.handle(uid, name.slice(11), req, res);
      return;
    }
    if (name === "/api/model/go/chat") {
      await goChat(req, res, req.headers["x-world-account"]);
      return;
    }
    if (name === "/api/world/objects" && req.method === "GET") {
      await world.handle(req, res);
      return;
    }
    res.writeHead(404).end();
  } catch {
    if (!res.headersSent)
      res
        .writeHead(500, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "世界服务处理失败" }));
  }
});
server.listen(0, "127.0.0.1", () =>
  console.log((server.address() as { port: number }).port),
);
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
