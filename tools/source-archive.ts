import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
export async function sourceArchive(root: string) {
  const archive: Record<string, Uint8Array> = {};
  async function include(name: string) {
    const at = path.join(root, name);
    for (const e of await readdir(at, { withFileTypes: true })) {
      const f = name + "/" + e.name;
      if (e.isDirectory()) await include(f);
      else if (e.isFile()) archive[f] = await readFile(path.join(root, f));
    }
  }
  for (const folder of ["frontend", "backend", "tools", "tests"])
    await include(folder);
  for (const file of [
    "LICENSE",
    "NOTICE.md",
    "README.md",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",

    ".gitignore",
  ])
    archive[file] = await readFile(path.join(root, file));
  for (const name of ["three", "fflate"])
    archive["third-party/" + name + "/LICENSE"] = await readFile(
      path.join(root, "node_modules", name, "LICENSE"),
    );
  const dir = path.join(root, "public", "洛阳漫游资源");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "ABWorld-source.zip"),
    zipSync(archive, { level: 2 }),
  );
}
