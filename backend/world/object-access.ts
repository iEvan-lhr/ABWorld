import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { IncomingMessage } from "node:http";
export function objectAccess(db: DatabaseSync, root: string) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS world_admins(uid INTEGER PRIMARY KEY);CREATE TABLE IF NOT EXISTS world_edit_grants(asset TEXT,uid INTEGER,PRIMARY KEY(asset,uid));CREATE TABLE IF NOT EXISTS world_labels(asset TEXT PRIMARY KEY,label TEXT);`,
  );
  const admin = (uid: number) =>
    !!db.prepare("SELECT 1 FROM world_admins WHERE uid=?").get(uid);
  const cache = new Map<string, number[][]>();
  function exists(asset: string) {
    const match = /^city:(-?\d{1,2}_-?\d{1,2}):(b|g):(\d{1,5}):(\d{1,7})$/.exec(
      asset,
    );
    if (!match) return false;
    const [, tile, batch, index, instance] = match;
    try {
      let counts = cache.get(tile);
      if (!counts) {
        const packed = JSON.parse(
          gunzipSync(
            Buffer.from(
              readFileSync(
                path.join(
                  root,
                  "public",
                  "洛阳漫游资源",
                  "tiles",
                  tile + ".js",
                ),
                "utf8",
              ).split("'")[3],
              "base64",
            ),
          ).toString(),
        );
        counts = [
          packed.b.map(
            (a: [number, number, string]) =>
              Buffer.from(a[2], "base64").length / 60,
          ),
          packed.g.map(() => 1),
        ];
        if (cache.size >= 32) cache.delete(cache.keys().next().value!);
        cache.set(tile, counts);
      }
      return (
        Number(instance) < (counts[batch === "b" ? 0 : 1][Number(index)] ?? 0)
      );
    } catch {
      return false;
    }
  }
  function can(uid: number, asset: string) {
    if (/^home:\d+(?::gate)?$/.test(asset))
      return !!db
        .prepare("SELECT 1 FROM citizens WHERE no=? AND uid=?")
        .get(1 + Number(asset.split(":")[1]), uid);
    if (/^work:\d+$/.test(asset))
      return !!db
        .prepare("SELECT 1 FROM creations WHERE id=? AND uid=?")
        .get(Number(asset.split(":")[1]), uid);
    return (
      !!db
        .prepare("SELECT 1 FROM world_edit_grants WHERE asset=? AND uid=?")
        .get(asset, uid) && exists(asset)
    );
  }
  function requireEdit(uid: number, asset: string) {
    if (!can(uid, asset)) throw Error("当前账号没有该物件的编辑权限");
  }
  function setGrant(
    uid: number,
    asset: string,
    target: number,
    grant: boolean,
  ) {
    if (!admin(uid)) throw Error("需要管理员权限");
    if (!exists(asset)) throw Error("默认场景物件 ID 无效");
    if (
      !Number.isSafeInteger(target) ||
      !db.prepare("SELECT id FROM users WHERE id=?").get(target)
    )
      throw Error("账号 ID 不存在");
    if (grant)
      db.prepare("INSERT OR IGNORE INTO world_edit_grants VALUES(?,?)").run(
        asset,
        target,
      );
    else
      db.prepare("DELETE FROM world_edit_grants WHERE asset=? AND uid=?").run(
        asset,
        target,
      );
  }
  return {
    admin,
    can,
    requireEdit,
    setGrant,
    async handle(uid: number, route: string, req: IncomingMessage) {
      if (req.method === "GET" && route === "mine")
        return {
          uid,
          admin: admin(uid),
          home:
            Number(
              db.prepare("SELECT no FROM citizens WHERE uid=?").get(uid)?.no,
            ) - 1,
          works: db
            .prepare("SELECT id FROM creations WHERE uid=?")
            .all(uid)
            .map((r) => `work:${r.id}`),
          grants: db
            .prepare("SELECT asset FROM world_edit_grants WHERE uid=?")
            .all(uid)
            .map((r) => r.asset),
          labels: Object.fromEntries(
            db
              .prepare("SELECT asset,label FROM world_labels")
              .all()
              .map((r) => [r.asset, r.label]),
          ),
        };
      if (
        req.method !== "POST" ||
        req.headers["content-type"] !== "application/json" ||
        (req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host)
      )
        throw Error("请求无效");
      let data = "";
      for await (const chunk of req) {
        data += chunk;
        if (data.length > 2048) throw Error("请求过大");
      }
      const b = JSON.parse(data);
      if (typeof b.asset !== "string" || b.asset.length > 80)
        throw Error("物件 ID 无效");
      if (route === "check") {
        requireEdit(uid, b.asset);
        return { ok: true };
      }
      if (route === "grant" || route === "revoke") {
        setGrant(uid, b.asset, b.uid, route === "grant");
        return { ok: true };
      }
      if (route === "label") {
        requireEdit(uid, b.asset);
        const label = String(b.label ?? "").trim();
        if (!label || label.length > 40) throw Error("名称限 1 至 40 字");
        db.prepare(
          "INSERT INTO world_labels VALUES(?,?) ON CONFLICT(asset) DO UPDATE SET label=excluded.label",
        ).run(b.asset, label);
        return { ok: true };
      }
      throw Error("未知操作");
    },
  };
}
