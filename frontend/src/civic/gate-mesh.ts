import * as T from "three";
import { gateFinishes, type GateStyle } from "./gate-style.ts";
const box = new T.BoxGeometry(),
  ring = new T.TorusGeometry(1, 0.16, 8, 24),
  stud = new T.SphereGeometry(1, 10, 7),
  materials = new Map<string, T.MeshStandardMaterial>();
function material(color: string, metal: boolean) {
  const k = color + metal;
  let m = materials.get(k);
  if (!m) {
    m = new T.MeshStandardMaterial({
      color,
      metalness: metal ? 0.34 : 0,
      roughness: metal ? 0.44 : 0.88,
    });
    materials.set(k, m);
  }
  return m;
}
// Mesh coordinates are relative to the hinge so hardware moves with the leaf.
export function gateLeaf(side: number, style: GateStyle) {
  const leaf = new T.Group(),
    w = 1.18,
    h = 2.06,
    f = gateFinishes[style.finish];
  function part(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: string,
    geo: T.BufferGeometry = box,
    metal = false,
  ) {
    const mesh = new T.Mesh(geo, material(color, metal));
    mesh.position.set(-side * x, y, z);
    mesh.scale.set(sx, sy, sz);
    leaf.add(mesh);
  }
  for (let i = 0; i < 6; i++)
    part(((i + 0.5) * w) / 6, h / 2, 0, w / 6 - 0.007, h, 0.09, f.wood);
  for (const face of [-1, 1]) {
    if (style.panels === "framed") {
      for (const x of [0.063, w - 0.063])
        part(x, h / 2, face * 0.052, 0.092, h - 0.018, 0.03, f.edge);
      for (const y of [0.11, 0.8, 1.94])
        part(w / 2, y, face * 0.054, w - 0.13, 0.085, 0.04, f.edge);
      for (const [base, top] of [
        [0.2, 0.7],
        [0.91, 1.82],
      ]) {
        for (const x of [0.16, w - 0.16])
          part(
            x,
            (base + top) / 2,
            face * 0.056,
            0.028,
            top - base,
            0.02,
            f.edge,
          );
        for (const y of [base, top])
          part(w / 2, y, face * 0.056, w - 0.29, 0.025, 0.02, f.edge);
      }
      for (const x of [0.095, w - 0.095])
        for (const y of [0.12, 0.79, 1.94])
          part(x, y, face * 0.076, 0.021, 0.021, 0.014, f.metal, stud, true);
    } else {
      for (const y of [0.25, 1.57])
        part(w / 2, y, face * 0.053, w * 0.94, 0.105, 0.04, f.edge);
    }
    const x = w - 0.22;
    if (style.hardware === "ring") {
      part(x, 1.1, face * 0.07, 0.12, 0.17, 0.027, f.metal, box, true);
      part(x, 1.12, face * 0.1, 0.038, 0.038, 0.029, f.metal, stud, true);
      part(x, 1.047, face * 0.115, 0.075, 0.075, 0.072, f.metal, ring, true);
    } else part(x, 1.04, face * 0.082, 0.065, 0.13, 0.06, f.metal, box, true);
  }
  return leaf;
}
