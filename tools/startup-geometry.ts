import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
export async function writeStartupGeometry(root: string) {
  const dir = path.join(root, "public", "洛阳漫游资源");
  const map = JSON.parse(
    await readFile(
      path.join(root, "frontend/src/data/stream-map.json"),
      "utf8",
    ),
  );
  const p = map.spawn;
  const key = `${Math.floor((p.x + Math.cos(p.yaw) * 14.2) / map.tileSize)}_${Math.floor((p.z - Math.sin(p.yaw) * 14.2) / map.tileSize)}`;
  const payload = async (folder: string, id: string | number) =>
    (await readFile(path.join(dir, folder, id + ".js"), "utf8")).split("'")[3];
  const data = JSON.parse(
    gunzipSync(Buffer.from(await payload("tiles", key), "base64")).toString(),
  );
  const ids = new Set<number>(
    data.b.map((b: [number, number, string]) => b[0]),
  );
  const pairs = await Promise.all(
    [...ids].map(async (id) => [id, await payload("geometry", id)]),
  );
  await mkdir(path.join(dir, "startup"), { recursive: true });
  await writeFile(
    path.join(dir, "startup", "geometry-v1.json"),
    JSON.stringify(Object.fromEntries(pairs)),
  );
}
