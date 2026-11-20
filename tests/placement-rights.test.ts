import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { placementRights } from "../backend/world/placement-rights.ts";
import {
  parseBlueprint,
  type Placement,
} from "../frontend/src/workshop/blueprint.ts";
test("摆放检查涵盖完整的三维模型、朝向、账号授权与撤销", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2),(3); CREATE TABLE citizens(no INTEGER PRIMARY KEY,uid INTEGER);INSERT INTO citizens VALUES(1,1),(2,2),(3,3);CREATE TABLE world_admins(uid INTEGER PRIMARY KEY);INSERT INTO world_admins VALUES(3)",
    );
    const rights = placementRights(db, [
      { x: 0, z: 0 },
      { x: 100, z: 100 },
      { x: 200, z: 200 },
    ]);
    const blueprint = parseBlueprint({
      version: 1,
      catalogVersion: 1,
      name: "长凳",
      seed: 1,
      parts: [
        { id: "seat", type: "bench", size: [2, 1, 0.5], position: [0, 0, 0] },
      ],
    });
    const pose: Placement = { x: 0, y: 0.14, z: 0, yaw: 0, blueprint };
    rights.check(1, pose);
    assert.throws(() => rights.check(2, pose));
    const bounds = {
      minX: -1.1,
      maxX: 1.1,
      minY: 0.1,
      maxY: 1.2,
      minZ: -0.4,
      maxZ: 0.4,
    };
    const grant = rights.grant(1, { name: "宅内小区", uid: 2, volume: bounds });
    rights.check(2, pose);
    assert.throws(() => rights.check(2, { ...pose, y: 0.5 }));
    assert.throws(() => rights.check(2, { ...pose, yaw: Math.PI / 2 }));
    assert.throws(() => rights.check(2, { ...pose, x: 0.3 }));
    assert.throws(() =>
      rights.grant(2, { name: "转授别人的宅地", uid: 3, volume: bounds }),
    );
    assert.throws(() =>
      rights.grant(1, { name: "宅外", uid: 2, volume: { ...bounds, maxX: 8 } }),
    );
    assert.throws(() => rights.revoke(2, grant));
    rights.revoke(1, grant);
    assert.throws(() => rights.check(2, pose));
    rights.grant(3, {
      name: "公共展区",
      uid: 2,
      volume: { ...bounds, minX: 19, maxX: 22 },
    });
    rights.check(2, { ...pose, x: 20.5 });
    assert.throws(() => rights.check(1, { ...pose, x: 20.5 }));
  } finally {
    db.close();
  }
});
