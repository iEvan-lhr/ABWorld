import type { DatabaseSync } from "node:sqlite";
import type { Volume, Region } from "../../frontend/src/civic/regions.ts";
import {
  contains,
  homeVolume,
  modelVolume,
  parseVolume,
} from "../../frontend/src/civic/regions.ts";
import type { Placement } from "../../frontend/src/workshop/blueprint.ts";
export function placementRights(
  db: DatabaseSync,
  plots: readonly { x: number; z: number }[],
) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS placement_grants(id INTEGER PRIMARY KEY,uid INTEGER NOT NULL,issuer INTEGER NOT NULL,name TEXT NOT NULL,volume TEXT NOT NULL);CREATE INDEX IF NOT EXISTS placement_grantee ON placement_grants(uid)",
  );
  function home(uid: number) {
    const row = db.prepare("SELECT no FROM citizens WHERE uid=?").get(uid);
    const plot = row && plots[Number(row.no) - 1];
    if (!plot) throw Error("宅地尚未分配");
    return homeVolume(plot);
  }
  const admin = (uid: number) =>
    !!db.prepare("SELECT uid FROM world_admins WHERE uid=?").get(uid);
  function list(uid: number) {
    return db
      .prepare("SELECT * FROM placement_grants WHERE uid=?")
      .all(uid)
      .map((r) => ({ ...r, volume: JSON.parse(String(r.volume)) })) as Region[];
  }
  return {
    home,
    list,
    manage(uid: number) {
      return db
        .prepare(
          "SELECT * FROM placement_grants WHERE issuer=? OR ?=1 ORDER BY id DESC",
        )
        .all(uid, Number(admin(uid)))
        .map((r) => ({ ...r, volume: JSON.parse(String(r.volume)) }));
    },
    grant(
      issuer: number,
      input: { uid: number; name: string; volume: Volume },
    ) {
      const v = parseVolume(input.volume);
      if (!admin(issuer) && !contains(home(issuer), v))
        throw Error("只能开放自己宅地以内的区域");
      if (
        !Number.isSafeInteger(input.uid) ||
        !db.prepare("SELECT id FROM users WHERE id=?").get(input.uid)
      )
        throw Error("目标账号不存在");
      if (
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.length > 48
      )
        throw Error("请填写区域名（最多 48 字）");
      return Number(
        db
          .prepare(
            "INSERT INTO placement_grants(uid,issuer,name,volume) VALUES(?,?,?,?)",
          )
          .run(input.uid, issuer, input.name.trim(), JSON.stringify(v))
          .lastInsertRowid,
      );
    },
    revoke(uid: number, id: number) {
      const r = db
        .prepare(
          "DELETE FROM placement_grants WHERE id=? AND (issuer=? OR ?=1)",
        )
        .run(id, uid, Number(admin(uid)));
      if (!r.changes) throw Error("没有该区域授权的管理权限");
    },
    check(uid: number, p: Placement) {
      if (![p.x, p.y, p.z, p.yaw].every(Number.isFinite))
        throw Error("摆放坐标无效");
      const v = modelVolume(p);
      if (
        ![home(uid), ...list(uid).map((r) => r.volume)].some((area) =>
          contains(area, v),
        )
      )
        throw Error("物品的完整 XYZ 范围须位于自己的宅地或已授权区域内");
      return v;
    },
  };
}
