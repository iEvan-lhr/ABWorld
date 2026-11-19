import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import type { PackedGeometry, TilePacket } from "../src/types.ts";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.join(project, "public", "洛阳漫游资源");
const apply = process.argv.includes("--write");
function read<T>(folder: string, id: string): T {
  const source = readFileSync(path.join(root, folder, id + ".js"), "utf8");
  const match = source.match(
    /^LuoyangChunk\('[^']+','([A-Za-z0-9+/=]+)'\);\s*$/,
  );
  if (!match) throw Error(`Invalid packet ${folder}/${id}`);
  return JSON.parse(
    gunzipSync(Buffer.from(match[1], "base64")).toString("utf8"),
  ) as T;
}
function floats(value: string) {
  const b = Uint8Array.from(Buffer.from(value, "base64"));
  return new Float32Array(b.buffer);
}
interface Extent {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}
const geometry = new Map<number, { bounds: Extent; count: number }>();
for (const name of readdirSync(path.join(root, "geometry"))) {
  const id = path.parse(name).name;
  const p = floats(
    String(read<PackedGeometry>("geometry", id).attrs.POSITION[2]),
  );
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    const d = i % 3;
    lo[d] = Math.min(lo[d], p[i]);
    hi[d] = Math.max(hi[d], p[i]);
  }
  geometry.set(+id, {
    bounds: {
      x: (lo[0] + hi[0]) / 2,
      y: (lo[1] + hi[1]) / 2,
      z: (lo[2] + hi[2]) / 2,
      w: hi[0] - lo[0],
      h: hi[1] - lo[1],
      d: hi[2] - lo[2],
    },
    count: p.length / 3,
  });
}
const materials = JSON.parse(
  readFileSync(path.join(project, "src/data/stream-map.json"), "utf8"),
).materials as { name: string }[];
const records = new Map<string, number[]>(),
  counts: Record<string, number> = {},
  totals: Record<string, number> = {};
const original = new Set<string>();
const signature = (r: ArrayLike<number>, offset = 0) =>
  Array.from({ length: 10 }, (_, k) => Math.round(r[offset + k] * 100)).join(
    ",",
  );
const tiles = readdirSync(path.join(root, "tiles")).map(
  (n) => path.parse(n).name,
);
for (const tile of tiles) {
  const packet = read<TilePacket>("tiles", tile),
    c = floats(String(packet.c));
  for (let i = 0; i < c.length; i += 10) original.add(signature(c, i));
}
const samples: Record<string, number[]> = {};
function emit(row: number[], kind: string) {
  const key = signature(row);
  if (original.has(key)) return;
  original.add(key);
  counts[kind] = (counts[kind] ?? 0) + 1;
  samples[kind] ??= row;
  const [, x, z, c, s, w, d] = row,
    ex = Math.abs(c) * w + Math.abs(s) * d + 0.5,
    ez = Math.abs(s) * w + Math.abs(c) * d + 0.5;
  for (let i = Math.floor((x - ex) / 128); i <= Math.floor((x + ex) / 128); i++)
    for (
      let j = Math.floor((z - ez) / 128);
      j <= Math.floor((z + ez) / 128);
      j++
    ) {
      const key = i + "_" + j;
      const buf = records.get(key) ?? [];
      buf.push(...row);
      records.set(key, buf);
    }
}
function transformed(b: Extent, m: Float32Array, i: number) {
  const e = m.subarray(i, i + 12);
  const angle = Math.atan2(-e[2], e[0]),
    c = Math.cos(angle),
    s = Math.sin(angle);
  const w =
    Math.abs(e[0] * c - e[2] * s) * b.w +
    Math.abs(e[3] * c - e[5] * s) * b.h +
    Math.abs(e[6] * c - e[8] * s) * b.d;
  const d =
    Math.abs(e[0] * s + e[2] * c) * b.w +
    Math.abs(e[3] * s + e[5] * c) * b.h +
    Math.abs(e[6] * s + e[8] * c) * b.d;
  const y = e[10] + e[1] * b.x + e[4] * b.y + e[7] * b.z,
    h =
      (Math.abs(e[1]) * b.w + Math.abs(e[4]) * b.h + Math.abs(e[7]) * b.d) / 2;
  return [
    0,
    e[9] + e[0] * b.x + e[3] * b.y + e[6] * b.z,
    e[11] + e[2] * b.x + e[5] * b.y + e[8] * b.z,
    c,
    s,
    w / 2,
    Math.max(d / 2, 0.05),
    y - h,
    y + h,
    0,
  ];
}
for (const tile of tiles) {
  const packet = read<TilePacket>("tiles", tile);
  for (const [id, mi, text] of packet.b) {
    const g = geometry.get(id)!;
    const mat = materials[mi].name || "木作";
    const a = floats(String(text));
    let kind =
      g.count === 24
        ? "box"
        : id === 1
          ? "column"
          : id === 14 || id === 16
            ? "rounded props and horses"
            : id === 5
              ? "jars"
              : id === 68 || id === 212 || id === 213
                ? "baskets and pottery"
                : id === 69
                  ? "wheels and hoops"
                  : id >= 74 && id <= 112 && g.count === 30
                    ? "well masonry"
                    : id === 4
                      ? "benches"
                      : id === 21
                        ? "firewood"
                        : id === 25
                          ? "ladders"
                          : id === 28 || id === 135 || id === 139 || id === 161
                            ? "fences and repairs"
                            : g.count === 3
                              ? "gable"
                              : id === 13
                                ? "conical structures"
                                : ["tile", "旧瓦", "茅束"].includes(mat) &&
                                    g.bounds.w < 1.2 &&
                                    g.bounds.y > 0
                                  ? "roof"
                                  : mat.startsWith("树叶") || mat === "树皮"
                                    ? "tree (trunk in base)"
                                    : id === 26 || id >= 243
                                      ? "vegetation and fields"
                                      : g.bounds.h < 0.015
                                        ? "ground decoration"
                                        : mat === "织带"
                                          ? "cloth"
                                          : mat.includes("墙")
                                            ? "wall"
                                            : mat === "木作"
                                              ? "joinery"
                                              : "other";
    totals[kind] = (totals[kind] ?? 0) + a.length / 15;
    if (
      [
        "tree (trunk in base)",
        "vegetation and fields",
        "ground decoration",
        "cloth",
      ].includes(kind)
    )
      continue;
    for (let i = 0; i < a.length; i += 15) {
      const r = transformed(g.bounds, a, i);
      if (
        r[8] < 0.24 ||
        r[7] > 6 ||
        r[8] - r[7] < 0.035 ||
        r[5] < 0.025 ||
        r[5] > 1500 ||
        r[6] > 1500
      )
        continue;
      // The garden landing and its planks are walkable across the pond.
      const pondX = ((505 - 535) * 1398) / 246,
        pondZ = ((570 - 850) * 1398) / 246;
      if (
        kind === "box" &&
        mat === "wood" &&
        Math.abs(r[1] - (pondX + 12)) < 5 &&
        r[2] > pondZ + 7 &&
        r[2] < pondZ + 26 &&
        r[8] - r[7] < 0.5 &&
        r[8] > 0.86 &&
        r[8] < 1.44 &&
        r[5] > 0.85 &&
        r[6] > 0.12
      ) {
        const deck = r.slice();
        deck[0] = 1;
        deck[9] = 1;
        emit(deck, "garden walkway");
      }
      if (kind === "roof") {
        // Conservative strips follow the two slopes; their lower edges leave the colonnade open.
        if (r[7] > 3.5) continue;
        for (const side of [-1, 1])
          for (let j = 0; j < 4; j++) {
            const x = (j + 0.5) / 4,
              off = side * r[6] * (1 - x),
              h = r[8] - r[7];
            const part = r.slice();
            part[1] += off * r[4];
            part[2] += off * r[3];
            part[6] = r[6] / 8;
            part[5] *= 1 - 0.3 * x;
            part[7] = r[7] + h * (j / 4) ** 1.5 - 0.08;
            part[8] = r[7] + h * ((j + 1) / 4) ** 1.5 + 0.08;
            emit(part, kind);
          }
        continue;
      }
      if (
        [
          "rounded props and horses",
          "jars",
          "baskets and pottery",
          "conical structures",
        ].includes(kind)
      )
        r[0] = 4;
      // Door/window joinery uses its actual thin panel. Side and head clearances stay open.
      emit(r, kind);
      if (
        kind === "box" &&
        ["paving", "earth"].includes(mat) &&
        r[8] <= 4 &&
        r[5] > 0.35 &&
        r[6] > 0.135
      ) {
        const floor = r.slice();
        floor[0] = 1;
        emit(floor, "walkable tops");
      }
    }
  }
}
// The courtyard pond is a direct mesh. Rasterise its triangles into shoreline strips.
const meter = 1398 / 246,
  pondX = (505 - 535) * meter,
  pondZ = (570 - 850) * meter;
const waterCells = new Map<number, Set<number>>();
for (const tile of tiles) {
  const [tx, tz] = tile.split("_").map(Number);
  if (
    Math.abs((tx + 0.5) * 128 - pondX) > 120 ||
    Math.abs((tz + 0.5) * 128 - pondZ) > 110
  )
    continue;
  for (const mesh of read<TilePacket>("tiles", tile).g) {
    if (materials[mesh.mat].name !== "water") continue;
    const p = floats(String(mesh.p));
    const bytes = Uint8Array.from(Buffer.from(String(mesh.i), "base64"));
    const idx = new Uint32Array(bytes.buffer);
    for (let i = 0; i < idx.length; i += 3) {
      const pts = [idx[i], idx[i + 1], idx[i + 2]].map((k) => [
        p[k * 3],
        p[k * 3 + 2],
      ]);
      if (
        pts.some(
          ([x, z]) => Math.abs(x - pondX) > 44 || Math.abs(z - pondZ) > 31,
        )
      )
        continue;
      const [a, b, c] = pts;
      const edge = (u: number[], v: number[], x: number, z: number) =>
        (v[0] - u[0]) * (z - u[1]) - (v[1] - u[1]) * (x - u[0]);
      for (
        let iz = Math.floor(Math.min(...pts.map((p) => p[1])) * 2);
        iz <= Math.ceil(Math.max(...pts.map((p) => p[1])) * 2);
        iz++
      )
        for (
          let ix = Math.floor(Math.min(...pts.map((p) => p[0])) * 2);
          ix <= Math.ceil(Math.max(...pts.map((p) => p[0])) * 2);
          ix++
        ) {
          const x = (ix + 0.5) / 2,
            z = (iz + 0.5) / 2,
            d = [edge(a, b, x, z), edge(b, c, x, z), edge(c, a, x, z)];
          if (Math.min(...d) < 0 && Math.max(...d) > 0) continue;
          if (!waterCells.has(iz)) waterCells.set(iz, new Set());
          waterCells.get(iz)!.add(ix);
        }
    }
  }
}
for (const [iz, row] of waterCells) {
  const xs = Array.from(row).sort((a, b) => a - b);
  let start = xs[0];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i + 1] === xs[i] + 1) continue;
    emit(
      [
        2,
        (start + xs[i] + 1) / 4,
        (iz + 0.5) / 2,
        1,
        0,
        (xs[i] - start + 1) / 4,
        0.25,
        0,
        0,
        0,
      ],
      "garden pond shoreline",
    );
    start = xs[i + 1];
  }
}
// The last stair tread ends 0.76 m short of the excavated podium in the rendered model.
// Bridge that gap with a visible tread at matching elevation and a walkable top.
const landings = new Map<string, { x: number; z: number }[]>();
for (const sign of [-1, 1]) {
  const x = (478 - 535) * meter + sign * 24,
    z = (770 - 850) * meter + 30.43;
  const key = Math.floor(x / 128) + "_" + Math.floor(z / 128);
  if (!landings.has(key)) landings.set(key, []);
  landings.get(key)!.push({ x, z });
  for (const type of [0, 1])
    emit([type, x, z, 1, 0, 4, 0.54, 2.39, 2.6, 0], "upper stair landings");
}
if (apply)
  for (const tile of tiles) {
    const packet = read<TilePacket>("tiles", tile),
      raw = records.get(tile);
    if (!raw && !packet.extra && !landings.has(tile)) continue;
    const caps = landings.get(tile);
    if (caps?.length) {
      packet.g = packet.g.filter((g) => !("stairLanding" in g));
      for (const { x, z } of caps) {
        const float = (array: number[]) =>
          Buffer.from(Float32Array.from(array).buffer).toString("base64");
        const face = {
          stairLanding: true,
          mat: materials.findIndex((m) => m.name === "paving"),
          p: float([
            x - 4,
            2.6,
            z - 0.54,
            x - 4,
            2.6,
            z + 0.54,
            x + 4,
            2.6,
            z + 0.54,
            x + 4,
            2.6,
            z - 0.54,
          ]),
          n: float([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
          uv: float([0, 0, 0, 1, 4, 1, 4, 0]),
          cc: 0,
          c: "",
          i: Buffer.from(Uint32Array.from([0, 1, 2, 0, 2, 3]).buffer).toString(
            "base64",
          ),
        };
        packet.g.push(face);
      }
    }
    packet.extra = Buffer.from(Float32Array.from(raw ?? []).buffer).toString(
      "base64",
    );
    const file = path.join(root, "tiles", tile + ".js");
    writeFileSync(
      file + ".tmp",
      `LuoyangChunk('tiles/${tile}','${gzipSync(JSON.stringify(packet), { level: 4 }).toString("base64")}');`,
    );
    renameSync(file + ".tmp", file);
  }
const report = {
  geometryAssets: geometry.size,
  tileCount: tiles.length,
  baseAndAdditionalUnique: original.size,
  addedByCategory: counts,
  instancesInspected: totals,
  samples,
};
mkdirSync(path.join(project, "reports"), { recursive: true });
writeFileSync(
  path.join(project, "reports/collisions.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      tiles: tiles.length,
      inspected: Object.values(totals).reduce((a, b) => a + b, 0),
      additions: counts,
    },
    null,
    2,
  ),
);
