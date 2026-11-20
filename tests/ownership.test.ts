import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { creationStore } from "../backend/world/creations.ts";
import { objectAccess } from "../backend/world/object-access.ts";
import { courtyard } from "../frontend/src/civic/courtyard.ts";
import { canonical, fitDimensions } from "../frontend/src/civic/creations.ts";
import { example, parseBlueprint } from "../frontend/src/workshop/blueprint.ts";
import { routeHome } from "../backend/world/home-route.ts";
import { readFileSync } from "node:fs";
test("unique models cannot be reissued by either the author or another citizen", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = creationStore(db, () => {});
    const bp = fitDimensions(parseBlueprint(example), [2, 2, 2]);
    store.add(1, 0, "hallWest", "unique", bp);
    const copy = {
      ...bp,
      name: "改名",
      seed: 999,
      parts: [...bp.parts].reverse(),
    };
    assert.equal(canonical(bp), canonical(copy));
    for (const uid of [1, 2])
      for (const mode of ["unique", "batch"])
        assert.throws(() => store.add(uid, 0, "hallWest", mode, copy));
    const different = fitDimensions(bp, [1.5, 2, 2]);
    store.add(2, 1, "hallEast", "batch", different);
    assert.throws(() => store.add(2, 1, "hallEast", "unique", different));
  } finally {
    db.close();
  }
});
test("default piece access is granted by account ID and ends immediately at revocation", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE users(id INTEGER);INSERT INTO users VALUES(3),(8),(9);",
    );
    const acl = objectAccess(db, process.cwd()),
      id = "city:-6_0:g:0:0";
    db.exec("INSERT INTO world_admins VALUES(3)");
    assert.throws(() => acl.setGrant(8, id, 8, true));
    acl.setGrant(3, id, 8, true);
    assert.equal(acl.can(8, id), true);
    assert.equal(acl.can(9, id), false);
    acl.setGrant(3, id, 8, false);
    assert.throws(() => acl.requireEdit(8, id));
  } finally {
    db.close();
  }
});
test("navigation ends within interaction range of the gate; both leaves clear the doorway", () => {
  const p = JSON.parse(
    readFileSync("frontend/src/data/civic-homes.json", "utf8"),
  )[0];
  const way = routeHome(process.cwd(), { x: -738.46, z: 57.31, y: 0.09 }, p);
  assert(Math.hypot(way.at(-1)!.x - p.gateX, way.at(-1)!.z - p.gateZ) < 2.9);
  const model = courtyard(p, 0, { gate: false, hall: false });
  assert(model.blocks(p.gateX, p.gateZ, 0.09));
  assert(model.blocks(p.x, p.z + 2.5, 0.09));
  model.opened.gate = true;
  model.opened.hall = true;
  model.update(1);
  assert(!model.blocks(p.gateX, p.gateZ, 0.09));
  assert(!model.blocks(p.x, p.z + 2.5, 0.09));
  model.dispose();
});
