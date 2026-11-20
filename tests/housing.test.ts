import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { civicService } from "../backend/world/civic.ts";
import type { Design } from "../frontend/src/civic/rules.ts";
test("only a fully restored vacant home admits one waiting player and grants the first salary once", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "abworld-housing-")),
    db = new DatabaseSync(path.join(dir, "accounts.sqlite"));
  db.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO users VALUES(1,'Evan'),(2,'甲'),(3,'乙');",
  );
  const plan: Design = {
    wood: "warm",
    posts: 2,
    depth: 1.3,
    lattice: 5,
    jars: 2,
    bench: "right",
  };
  const service = civicService(dir, process.cwd(), async () => ({
    started: true,
    tokens: 17,
    plan,
  }));
  const srv = createServer(
    (req, res) =>
      void service.handle(
        Number(req.headers["x-id"]),
        req.url!.slice(1),
        req,
        res,
      ),
  );
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;
  const call = (uid: number, route: string, post = false) =>
    fetch(base + route, {
      method: post ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "x-id": String(uid) },
    });
  try {
    assert.equal((await call(2, "state")).status, 409);
    assert.deepEqual((await (await call(2, "housing")).json()).homes, []);
    const candidates = await (await call(1, "housing/candidates")).json();
    const plot = candidates[5].id;
    assert.equal((await call(1, "housing/roof", true)).status, 404);
    assert.equal((await call(1, "housing/repair/0/roof", true)).status, 409);
    assert.equal(
      (await call(1, `housing/repair/${plot}/roof`, true)).status,
      200,
    );
    assert.equal(
      (await call(1, `housing/repair/${candidates[2].id}/yard`, true)).status,
      409,
    );
    assert.equal((await call(2, `housing/claim/${plot}`, true)).status, 409);
    assert.equal(
      (await call(1, `housing/repair/${plot}/yard`, true)).status,
      200,
    );
    const [h] = (await (await call(2, "housing")).json()).homes;
    assert.equal(h.id, plot);
    assert.equal(h.sponsor, "Evan");
    assert.equal(service.state(1).spent, 34);
    assert.equal(service.state(1).balance, 130);
    const outcomes = await Promise.all(
      [2, 3].map((uid) => call(uid, "housing/claim/" + h.id, true)),
    );
    assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
    const winner = outcomes[0].ok ? 2 : 3;
    assert.equal(
      (await call(winner, "housing/claim/" + h.id, true)).status,
      200,
    );
    assert.equal(service.state(winner).balance, 50);
    assert.equal(service.state(winner).home.id, h.id);
    assert.deepEqual((await (await call(winner, "housing")).json()).homes, []);
    const next = candidates.find((p: { id: number }) => p.id !== plot).id;
    const reservations = await Promise.all(
      [1, winner].map((uid) => call(uid, `housing/repair/${next}/roof`, true)),
    );
    assert.deepEqual(reservations.map((r) => r.status).sort(), [200, 409]);
    const repairer = reservations[0].ok ? 1 : winner,
      other = repairer === 1 ? winner : 1;
    assert.equal(
      (await call(other, `housing/repair/${next}/yard`, true)).status,
      409,
    );
    assert.equal(
      (await call(repairer, `housing/repair/${next}/yard`, true)).status,
      200,
    );
  } finally {
    srv.closeAllConnections();
    await new Promise<void>((r) => srv.close(() => r()));
    service.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
