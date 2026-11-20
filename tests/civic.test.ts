import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { once } from "node:events";
import { accounts } from "../backend/world/accounts.ts";
import { civicService } from "../backend/world/civic.ts";
import { usage } from "../backend/world/local-designer.ts";
import {
  allowance,
  income,
  currency,
  dayNumber,
  tokensPerPoint,
  type Design,
} from "../frontend/src/civic/rules.ts";
test("civic conversions retain single tokens and carry all currency units", () => {
  assert.equal(allowance(0), 15_000_000);
  assert.equal(tokensPerPoint, 150000);
  assert.equal(income(0), 50);
  assert.equal(currency(1002003004), "1尊 2贤 3信 4工");
  assert.equal(
    usage({ input: 1, output: 1, reasoning: 2, cache: { read: 10, write: 5 } }),
    19,
  );
  assert.equal(
    dayNumber(Date.UTC(2026, 10, 20, 16)) -
      dayNumber(Date.UTC(2026, 10, 20, 15, 59)),
    1,
  );
});
test("housing eligibility, exact task costs, repeated rewards, daily quota and pay across restarts", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "abworld-civic-"));
  const d = new DatabaseSync(path.join(dir, "accounts.sqlite"));
  d.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO users VALUES(41,'Evan');",
  );
  let runs = 0;
  const plan: Design = {
    wood: "warm",
    posts: 2,
    depth: 1.2,
    jars: 1,
    lattice: 4,
    bench: "left",
  };
  const engine = async () => ({ tokens: ++runs, started: true, plan });
  let s = civicService(dir, process.cwd(), engine);
  const server = createServer(
    (req, res) => void s.handle(41, req.url!.slice(1), req, res),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const post = (route: string) =>
    fetch(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/${route}`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
    );
  try {
    assert.equal(s.state(41).no, 1);
    assert.equal((await post("resident")).status, 409);
    assert.equal((await post("yard")).status, 409);
    const r = await Promise.all([post("roof"), post("roof")]);
    assert.deepEqual(r.map((v) => v.status).sort(), [200, 409]);
    assert.equal((await post("yard")).status, 200);
    assert.equal((await post("resident")).status, 200);
    assert.equal((await post("resident")).status, 409);
    assert.equal(s.state(41).spent, 3);
    assert.equal(s.state(41).balance, 130);
    assert.equal(allowance(s.state(41).merit), 18_000_000);
    d.exec("UPDATE citizens SET paid=paid-1;UPDATE civic_log SET day=day-1;");
    s.close();
    s = civicService(dir, process.cwd(), engine);
    assert.equal(s.state(41).balance, 195);
    assert.equal(s.state(41).spent, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    s.close();
    d.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
