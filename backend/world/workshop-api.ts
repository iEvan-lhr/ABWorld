import { cityFloor } from "./city-floor.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  parseBlueprint,
  bounds,
  type Placement,
} from "../../frontend/src/workshop/blueprint.ts";
import { terrainHeight, checkSite } from "../../frontend/src/workshop/site.ts";
import { resolveSupport } from "../../frontend/src/physics/collision.ts";
export function workshopApi(root: string, dir = path.join(root, ".world")) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "objects.sqlite"));
  db.exec(
    "PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS objects(id INTEGER PRIMARY KEY, data TEXT, x REAL,z REAL,l REAL,r REAL,b REAL,t REAL); CREATE INDEX IF NOT EXISTS objects_location ON objects(x,z)",
  );
  const floor = cityFloor(root);
  return {
    close: () => db.close(),
    async handle(req: IncomingMessage, res: ServerResponse) {
      const url = new URL(req.url ?? "/", "http://localhost");
      const send = (code: number, data: unknown) => {
        res
          .writeHead(code, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          })
          .end(JSON.stringify(data));
      };
      try {
        if (req.method === "GET") {
          const x = Number(url.searchParams.get("x")),
            z = Number(url.searchParams.get("z"));
          if (!Number.isFinite(x + z)) throw Error("视点无效");
          const rows = db
            .prepare(
              "SELECT id,data FROM objects WHERE x BETWEEN ? AND ? AND z BETWEEN ? AND ? ORDER BY id",
            )
            .all(x - 240, x + 240, z - 240, z + 240);
          send(
            200,
            rows.map((r) => ({ ...JSON.parse(String(r.data)), id: r.id })),
          );
          return;
        }
        if (req.method !== "POST") {
          send(405, { error: "请求方式无效" });
          return;
        }
        if (
          (req.headers.origin &&
            new URL(req.headers.origin).host !== req.headers.host) ||
          req.headers["content-type"]?.split(";")[0] !== "application/json"
        ) {
          send(403, { error: "仅接受同源 JSON 请求" });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) {
            send(413, { error: "蓝图太大" });
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString());
        const { x, y, z, yaw } = input;
        if (
          ![x, y, z, yaw].every(
            (v) => typeof v === "number" && Number.isFinite(v),
          ) ||
          Math.abs(y) > 200
        )
          throw Error("位置无效");
        const p: Placement = {
          x,
          y,
          z,
          yaw,
          blueprint: parseBlueprint(input.blueprint),
        };
        checkSite(p, floor);
        const b = bounds(p);
        db.exec("BEGIN IMMEDIATE");
        try {
          if (
            db
              .prepare(
                "SELECT id FROM objects WHERE l < ? AND r > ? AND b < ? AND t > ? LIMIT 1",
              )
              .get(b.maxX, b.minX, b.maxZ, b.minZ)
          ) {
            db.exec("ROLLBACK");
            send(409, { error: "这个位置已经放置了物件" });
            return;
          }
          const id = Number(
            db
              .prepare(
                "INSERT INTO objects(data,x,z,l,r,b,t) VALUES(?,?,?,?,?,?,?)",
              )
              .run(JSON.stringify(p), x, z, b.minX, b.maxX, b.minZ, b.maxZ)
              .lastInsertRowid,
          );
          db.exec("COMMIT");
          send(201, { ...p, id });
        } catch (e) {
          if (db.isTransaction) db.exec("ROLLBACK");
          throw e;
        }
      } catch (e) {
        send(400, { error: e instanceof Error ? e.message : "请求无效" });
      }
    },
  };
}
