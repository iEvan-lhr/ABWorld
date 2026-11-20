import test from "node:test";
import assert from "node:assert/strict";
import { modelBase } from "../frontend/src/model-base.ts";
import {
  publicAddress,
  customRequest,
  selectedProvider,
} from "../backend/world/custom-provider.ts";
test("custom model URLs accept public HTTP with port and base path", () => {
  for (const address of [
    "http://43.172.86.134:8080/v1",
    "https://example.com/api/v1",
    "http://127.0.0.1:11434/v1",
  ])
    assert.equal(modelBase(address).href, address);
  for (const address of [
    "file:///v1",
    "http://name:password@example.com/v1",
    "https://example.com/v1?key=secret",
  ])
    assert.throws(() => modelBase(address));
});
test("custom relay checks the actual destination address before network IO", async () => {
  assert(publicAddress("43.172.86.134"));
  for (const ip of [
    "127.0.0.1",
    "169.254.169.254",
    "192.168.1.2",
    "10.0.0.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "fd00::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  const r = await customRequest(
    { url: modelBase("http://127.0.0.1:8080/v1"), key: "", model: "demo" },
    "models",
  );
  assert.equal(r.status, 403);
});
test("per-player providers stay isolated across concurrent model jobs", async () => {
  await Promise.all(
    ["player-one", "player-two"].map((model) =>
      selectedProvider.run(
        { url: modelBase("https://example.com/v1"), model, key: "" },
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          assert.equal(selectedProvider.getStore()?.model, model);
        },
      ),
    ),
  );
  assert.equal(selectedProvider.getStore(), undefined);
});
