import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  dir = path.join(root, ".dev");
mkdirSync(dir, { recursive: true });
const exe = path.join(
  dir,
  `abworld-api-${process.pid}${process.platform === "win32" ? ".exe" : ""}`,
);
const compiled = spawnSync("go", ["build", "-o", exe, "."], {
  cwd: path.join(root, "backend"),
  stdio: "inherit",
});
if (compiled.status !== 0) process.exit(compiled.status ?? 1);
const env = {
  ...process.env,
  ABWORLD_ROOT: root,
  ABWORLD_FRONT_SECRET: randomBytes(24).toString("hex"),
  ABWORLD_PARENT_STDIN: "1",
  ABWORLD_API_ADDR: process.env.ABWORLD_API_ADDR || "127.0.0.1:0",
};
const api = spawn(exe, [], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: ["pipe", "pipe", "inherit"],
});
let web: ReturnType<typeof spawn> | undefined,
  closing = false;
function stop(code: number) {
  if (closing) return;
  closing = true;
  web?.stdin?.end();
  api.stdin.end();
  process.exitCode = code;
}
createInterface({ input: api.stdout }).on("line", (line) => {
  console.log(line);
  if (!line.startsWith("ABWORLD_API_READY ") || web) return;
  web = spawn(process.execPath, ["tools/build.ts", "--dev"], {
    cwd: root,
    env: { ...env, ABWORLD_API_URL: line.slice(18) },
    stdio: ["pipe", "inherit", "inherit"],
    windowsHide: true,
  });
  web.on("exit", (code) => stop(code ?? 0));
});
api.on("exit", (code) => {
  stop(code ?? 0);
  try {
    rmSync(exe);
  } catch {}
});
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
