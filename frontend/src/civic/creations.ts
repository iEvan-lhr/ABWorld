import {
  layout,
  parseBlueprint,
  type Blueprint,
  type Vec,
} from "../workshop/blueprint.ts";
export const anchors = {
  hallWest: {
    label: "正房 · 西窗下",
    x: -2.6,
    z: -0.7,
    w: 2.4,
    d: 2.5,
    h: 2.1,
  },
  hallEast: { label: "正房 · 东窗下", x: 2.6, z: -0.7, w: 2.4, d: 2.5, h: 2.1 },
  courtWest: {
    label: "庭院 · 西廊前",
    x: -3.2,
    z: 5.4,
    w: 2.5,
    d: 2.2,
    h: 2.4,
  },
  courtEast: { label: "庭院 · 东侧", x: 2.8, z: 10.8, w: 2.8, d: 2, h: 2.4 },
} as const;
export type Anchor = keyof typeof anchors;
export function fitDimensions(bp: Blueprint, size: Vec) {
  const pieces = layout(bp);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const p of pieces)
    for (let i = 0; i < 3; i++) {
      const lo = p.at[i] - (i === 1 ? 0 : p.size[i] / 2);
      min[i] = Math.min(min[i], lo);
      max[i] = Math.max(max[i], lo + p.size[i]);
    }
  const f = size.map((v, i) => v / (max[i] - min[i]));
  return parseBlueprint({
    ...bp,
    parts: pieces.map((p) => ({
      id: p.id,
      type: p.type,
      mesh: p.mesh,
      material: p.material,
      size: p.size.map((v, i) => v * f[i]),
      position: p.at.map(
        (v, i) => (v - (i === 1 ? min[i] : (min[i] + max[i]) / 2)) * f[i],
      ),
    })),
  });
}
export function canonical(bp: Blueprint) {
  const parts = layout(bp);
  const min = [0, 1, 2].map((i) =>
    Math.min(...parts.map((p) => p.at[i] - (i === 1 ? 0 : p.size[i] / 2))),
  );
  return JSON.stringify(
    parts
      .map((p) => [
        p.type,
        p.mesh?.faces
          .map((face) =>
            face
              .map((i) =>
                p.mesh!.vertices[i].map((v) => Math.round(v * 1e6)).join(","),
              )
              .sort()
              .join("|"),
          )
          .sort(),
        p.material ?? (p.type === "clay_jar" ? "red_clay" : "weathered_wood"),
        p.size.map((v) => Math.round(v * 1e6)),
        p.at.map((v, i) => Math.round((v - min[i]) * 1e6)),
      ])
      .map((v) => JSON.stringify(v))
      .sort(),
  );
}
