import test from "node:test";
import assert from "node:assert/strict";
import { covers, CrowdCollisions } from "../frontend/src/physics/collision.ts";

test("rotated thin fence blocks the fence line and leaves adjacent space free", () => {
  const a = new Float32Array([0, 3, 1, 0, 1, 2, 0.05, 0, 1.6, 0]);
  assert.equal(covers(a, 0, 3, 2, 0.31), true);
  assert.equal(covers(a, 0, 3.5, 1, 0.31), false);
});
test("jar proxy excludes the outside corners of its enclosing box", () => {
  const jar = new Float32Array([4, 0, 0, 1, 0, 0.45, 0.45, 0, 1.2, 0]);
  assert.equal(covers(jar, 0, 0, 0.67, 0.31), true);
  assert.equal(covers(jar, 0, 0.73, 0.73, 0.31), false);
});
test("walking into a resident blocks while walking out of existing contact succeeds", () => {
  const crowd = new CrowdCollisions();
  crowd.rebuild([{ x: 0, y: 0, z: 0, radius: 0.24, height: 1.7 }]);
  assert.equal(crowd.blocksMove(0.66, 0, 0.52, 0, 0, 0.31, 1.7), true);
  assert.equal(crowd.blocksMove(0.45, 0, 0.5, 0, 0, 0.31, 1.7), false);
  assert.equal(crowd.overlaps(0, 0, 2.1, 0.31, 1.7), false);
});
test("spatial cells update with the simulation and function across cell boundaries", () => {
  const crowd = new CrowdCollisions();
  crowd.rebuild([{ x: 1.91, y: 0, z: 0, radius: 0.24, height: 1.7 }]);
  assert.ok(crowd.overlaps(2.15, 0, 0, 0.31, 1.7));
  crowd.rebuild([{ x: 5, y: 0, z: 0, radius: 0.24, height: 1.7 }]);
  assert.equal(crowd.overlaps(2.15, 0, 0, 0.31, 1.7), false);
});
