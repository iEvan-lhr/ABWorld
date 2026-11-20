import test from "node:test";
import assert from "node:assert/strict";
import { assemble, normalizeSizes } from "../frontend/src/civic/assembly.ts";
import {
  parseBlueprint,
  example,
  layout,
} from "../frontend/src/workshop/blueprint.ts";
import { traces } from "../backend/world/generation-log.ts";
import { DatabaseSync } from "node:sqlite";
test("generated thin details with explicit units survive validation and assembly", () => {
  const raw = {
    ...example,
    parts: Array.from({ length: 14 }, (_, i) => ({
      id: "p" + i,
      type: "plank",
      position: [0, 0.02 * i, 0],
      size: i === 13 ? { w: "40cm", h: "2mm", d: "0.1 m" } : [0.4, 0.02, 0.1],
    })),
  };
  const bp = parseBlueprint(normalizeSizes(raw));
  assert.deepEqual(bp.parts[13].size, [0.4, 0.002, 0.1]);
  const combo = assemble([bp, bp, bp], "stack", "组合件");
  assert.equal(combo.parts.length, 42);
  assert.equal(new Set(combo.parts.map((p) => p.id)).size, 42);
  assert(layout(combo)[28].at[1] > layout(combo)[14].at[1]);
});
test("prompt history pages include failures and stay isolated by account", () => {
  const d = new DatabaseSync(":memory:");
  try {
    const h = traces(d);
    for (let i = 0; i < 35; i++) {
      const id = h.begin(1, "物品设计", "描述" + i, "auto", "unique");
      h.failPending(1, id, Error("构件尺寸错误"));
    }
    h.begin(2, "物品设计", "另一位玩家", "auto", "batch");
    const recent = h.page(1, Number.MAX_SAFE_INTEGER);
    assert.equal(recent.length, 31);
    assert.equal(recent[0].prompt, "描述34");
    assert.equal(recent[0].status, "失败");
    const older = h.page(1, Number(recent[29].id));
    assert.equal(older.length, 5);
    assert.equal(older.at(-1)?.prompt, "描述0");
  } finally {
    d.close();
  }
});
