import assert from "node:assert/strict";
import test from "node:test";
import { outputBudget } from "../backend/world/go-generation.ts";
import { contextTokens, maxOutputTokens } from "../frontend/src/go-provider.ts";
test("Go generations use the advertised output maximum within context and remaining citizen tokens", () => {
  const short = [{ role: "user", content: "一把柳木摇椅" }];
  assert.equal(contextTokens, 1_000_000);
  assert.equal(maxOutputTokens, 384_000);
  assert.equal(outputBudget(short, 15_000_000), 384_000);
  assert(outputBudget(short, 20_000) < 20_000);
  assert.equal(outputBudget(short, 100), 0);
  assert(
    outputBudget([{ role: "user", content: "x".repeat(800_000) }], 15_000_000) <
      200_000,
  );
});
