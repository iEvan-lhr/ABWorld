import {
  layout,
  parseBlueprint,
  type Blueprint,
  type Vec,
} from "../workshop/blueprint.ts";

// Model replies occasionally express lengths as strings with explicit units.
function metres(v: unknown) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(mm|cm|m|毫米|厘米|米)?\s*$/i.exec(v);
  if (!m) return NaN;
  const scale: Record<string, number> = {
    mm: 0.001,
    毫米: 0.001,
    cm: 0.01,
    厘米: 0.01,
  };
  return Number(m[1]) * (scale[(m[2] ?? "").toLowerCase()] ?? 1);
}
export function normalizeSizes(raw: any) {
  if (!Array.isArray(raw?.parts)) return raw;
  return {
    ...raw,
    parts: raw.parts.map((p: any) => {
      if (!p || typeof p !== "object") return p;
      let v = p.size;
      if (v && !Array.isArray(v) && typeof v === "object")
        v = [
          v.width ?? v.w ?? v.x,
          v.height ?? v.h ?? v.y,
          v.depth ?? v.d ?? v.z,
        ];
      if (!Array.isArray(v) || v.length !== 3) return p;
      return {
        ...p,
        size: v.map((n) => {
          const x = metres(n);
          return Number.isFinite(x) && x > 0 && x <= 10.000001
            ? Math.min(10, Math.max(0.001, x))
            : n;
        }),
      };
    }),
  };
}
export function assemble(
  items: Blueprint[],
  arrangement: "row" | "stack",
  name: string,
): Blueprint {
  if (
    items.length < 2 ||
    items.length > 8 ||
    !["row", "stack"].includes(arrangement)
  )
    throw Error("请选择 2 至 8 件作品及组合方式");
  let cursor = 0;
  const parts = items.flatMap((bp, index) => {
    const resolved = layout(bp),
      lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (const p of resolved)
      for (let i = 0; i < 3; i++) {
        const l = p.at[i] - (i === 1 ? 0 : p.size[i] / 2);
        lo[i] = Math.min(lo[i], l);
        hi[i] = Math.max(hi[i], l + p.size[i]);
      }
    const base =
      arrangement === "row"
        ? [lo[0] - cursor, lo[1], (lo[2] + hi[2]) / 2]
        : [(lo[0] + hi[0]) / 2, lo[1] - cursor, (lo[2] + hi[2]) / 2];
    cursor += arrangement === "row" ? hi[0] - lo[0] + 0.04 : hi[1] - lo[1];
    return resolved.map((p, j) => ({
      id: `item${index}_${j}`,
      type: p.type,
      material: p.material,
      size: p.size,
      mesh: p.mesh,
      position: p.at.map((v, i) => v - base[i]) as Vec,
    }));
  });
  if (arrangement === "row")
    for (const p of parts) p.position[0] -= (cursor - 0.04) / 2;
  return parseBlueprint({
    version: 1,
    catalogVersion: 1,
    seed: items[0].seed,
    name,
    parts,
  });
}
