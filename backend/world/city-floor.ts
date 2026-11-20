import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { terrainHeight } from "../../frontend/src/workshop/site.ts";
import { resolveSupport } from "../../frontend/src/physics/collision.ts";
export function cityFloor(root: string) {
  const tiles = new Map<
    string,
    { a: Float32Array; grid: Map<string, number[]> }
  >();
  function floor(x: number, z: number, y: number) {
    const key = `${Math.floor(x / 128)}_${Math.floor(z / 128)}`;
    let tile = tiles.get(key);
    if (!tile) {
      let packet;
      try {
        const script = readFileSync(
          path.join(root, "public", "洛阳漫游资源", "tiles", key + ".js"),
          "utf8",
        );
        packet = JSON.parse(
          gunzipSync(Buffer.from(script.split("'")[3], "base64")).toString(),
        );
      } catch {
        return null;
      }
      const a = new Float32Array(
        Uint8Array.from(
          Buffer.concat([
            Buffer.from(packet.c, "base64"),
            Buffer.from(packet.extra ?? "", "base64"),
          ]),
        ).buffer,
      );
      const grid = new Map<string, number[]>();
      const tx = Math.floor(x / 128) * 8,
        tz = Math.floor(z / 128) * 8;
      for (let i = 0; i < a.length; i += 10) {
        const dx =
            Math.abs(a[i + 3]) * a[i + 5] + Math.abs(a[i + 4]) * a[i + 6] + 0.5,
          dz =
            Math.abs(a[i + 4]) * a[i + 5] + Math.abs(a[i + 3]) * a[i + 6] + 0.5;
        for (
          let u = Math.max(tx, Math.floor((a[i + 1] - dx) / 16));
          u <= Math.min(tx + 7, Math.floor((a[i + 1] + dx) / 16));
          u++
        )
          for (
            let v = Math.max(tz, Math.floor((a[i + 2] - dz) / 16));
            v <= Math.min(tz + 7, Math.floor((a[i + 2] + dz) / 16));
            v++
          ) {
            const k = u + "," + v;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k)!.push(i);
          }
      }
      tile = { a, grid };
      if (tiles.size >= 16) tiles.delete(tiles.keys().next().value!);
      tiles.set(key, tile);
    }
    return resolveSupport(
      tile.a,
      tile.grid.get(Math.floor(x / 16) + "," + Math.floor(z / 16)) ?? [],
      x,
      z,
      y,
      terrainHeight(x, z),
    );
  }
  return floor;
}
