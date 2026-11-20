import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { example, layout, parseBlueprint } from "../frontend/src/workshop/blueprint.ts";
import { buildObject } from "../frontend/src/workshop/geometry.ts";
import { workshopApi } from "../backend/world/workshop-api.ts";

test("counter anchor moves the jar and rejects a missing anchor", () => {
  const bp = structuredClone(example);
  bp.parts[1].size[1] = 1;
  assert.equal(layout(parseBlueprint(bp))[2].at[1], 1);
  bp.parts[2].attachTo = "missing.top";
  assert.throws(() => parseBlueprint(bp), /锚点/);
});
test("canopy has walkable space and rotated post collisions", () => {
  const bp = structuredClone(example);
  bp.parts = bp.parts.slice(0, 1);
  const object = buildObject({
    blueprint: bp,
    x: 0,
    y: 0,
    z: 0,
    yaw: Math.PI / 2,
  });
  assert.equal(object.blocks(0, 0, 0), false);
  assert.equal(object.blocks(1.07, -1.47, 0), true);
  object.dispose();
});
test("world accepts one concurrent placement, survives reopening, and enforces range", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url)),
    store = mkdtempSync(path.join(tmpdir(), "abworld-"));
  let api = workshopApi(root, store);
  const server = createServer((req, res) => void api.handle(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/world/objects`;
    const x = -733.49,
      z = 56.84;
    const p = {
      blueprint: {
        ...example,
        parts: [
          {
            id: "jar",
            type: "clay_jar",
            size: [0.3, 0.5, 0.3],
            position: [0, 0, 0],
          },
        ],
      },
      x,
      z,
      y: 0.09,
      yaw: 0,
    };
    const write = () =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
    const pair = await Promise.all([write(), write()]);
    assert.deepEqual(pair.map((r) => r.status).sort(), [201, 409]);
    api.close();
    api = workshopApi(root, store);
    const list = await (await fetch(`${url}?x=${x}&z=${z}`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].blueprint.parts[0].type, "clay_jar");
    assert.deepEqual(await (await fetch(url + "?x=1800&z=1000")).json(), []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    api.close();
    rmSync(store, { recursive: true, force: true });
  }
});
