import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolveSupport } from "../src/physics/collision.ts";
const base = new URL("../public/洛阳漫游资源/tiles/", import.meta.url);
const report = JSON.parse(
  readFileSync(new URL("../reports/collisions.json", import.meta.url), "utf8"),
) as { samples: Record<string, number[]> };
const cache = new Map<string, Float32Array>();
function tile(x: number, z: number) {
  const key = `${Math.floor(x / 128)}_${Math.floor(z / 128)}`;
  let array = cache.get(key);
  if (!array) {
    const data = JSON.parse(
      gunzipSync(
        Buffer.from(
          readFileSync(new URL(key + ".js", base), "utf8").split("'")[3],
          "base64",
        ),
      ).toString(),
    ) as { c: string; extra?: string };
    const buf = Buffer.concat([
      Buffer.from(data.c, "base64"),
      Buffer.from(data.extra ?? "", "base64"),
    ]);
    array = new Float32Array(Uint8Array.from(buf).buffer);
    cache.set(key, array);
  }
  return array;
}
function sample(x: number, z: number, y = 0.09) {
  const a = tile(x, z);
  const ids = Array.from({ length: a.length / 10 }, (_, i) => i * 10);
  return resolveSupport(a, ids, x, z, y, 0.09);
}
const m = 1398 / 246;
test("solid models at their actual streamed coordinates block a person", () => {
  for (const category of [
    "fences and repairs",
    "benches",
    "jars",
    "firewood",
    "wheels and hoops",
    "ladders",
  ]) {
    const [, x, z] = report.samples[category];
    assert.equal(sample(x, z), null, category);
  }
});
test("palace wall blocks, but the central opening of the palace gate is passable", () => {
  assert.equal(sample((448 - 535) * m, (760 - 850) * m), null);
  assert.notEqual(sample((478 - 535) * m, (854.5 - 850) * m), null);
});
test("actual south bridge deck crosses the canal and open water is impassable", () => {
  assert.ok((sample((480 - 535) * m, (1214 - 850) * m) ?? 0) > 0.45);
  assert.equal(sample((530 - 535) * m, (1215 - 850) * m), null);
});
test("the palace steps are climbable from ground level without tunnelling", () => {
  const x = (478 - 535) * m + 24,
    z = (770 - 850) * m;
  let height = 0.09;
  for (let t = 39; t > 29; t -= 0.08) {
    const next = sample(x, z + t, height);
    assert.notEqual(next, null, `blocked at z=${t}`);
    assert.ok(next! <= height + 0.341);
    height = next!;
  }
  assert.ok(height >= 2.58);
});
test("garden pond and wooden pavilion walkway use distinct floor rules", () => {
  const x = (505 - 535) * m,
    z = (570 - 850) * m;
  assert.equal(sample(x, z), null);
  assert.ok((sample(x + 12, z + 16) ?? 0) > 0.8);
});
