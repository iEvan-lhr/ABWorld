import { gateLeaf } from "./gate-mesh.ts";
import { originalGate, type GateStyle } from "./gate-style.ts";
import * as T from "three";
export type Door = "gate" | "hall";
export const doorZ = { gate: 14, hall: 2.5 };
type Collider = [number, number, number, number, number, number];
const box = new T.BoxGeometry(1, 1, 1),
  cylinder = new T.CylinderGeometry(1, 1, 1, 10);
const cache = new Map<string, T.MeshLambertMaterial>();
const mat = (c: string) => {
  let m = cache.get(c);
  if (!m) {
    m = new T.MeshLambertMaterial({ color: c });
    cache.set(c, m);
  }
  return m;
};
export function courtyard(
  p: { x: number; z: number },
  id: number,
  opened: { gate: boolean; hall: boolean },
  style: GateStyle = originalGate,
) {
  const group = new T.Group();
  group.position.set(p.x, 0.09, p.z);
  group.userData = { asset: `home:${id}`, display: "庭院住宅" };
  const batches = new Map<string, T.Matrix4[]>(),
    collisions: Collider[] = [];
  const earth = "#b4a384",
    base = "#897c68",
    wood = "#6f4a31",
    tiles = "#56615e",
    trim = "#424d4a";
  function piece(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
    solid = false,
    pitch = 0,
    round = false,
  ) {
    const key = color + (round ? "r" : "b");
    const list = batches.get(key) ?? [];
    if (!batches.has(key)) batches.set(key, list);
    const m = new T.Matrix4().compose(
      new T.Vector3(x, y + h / 2, z),
      new T.Quaternion().setFromEuler(new T.Euler(pitch, 0, 0)),
      new T.Vector3(w, h, d),
    );
    list.push(m);
    if (solid) collisions.push([x, z, w / 2, d / 2, y, y + h]);
  }
  function roof(
    x: number,
    z: number,
    w: number,
    d: number,
    height: number,
    rise: number,
  ) {
    const half = d / 2,
      angle = Math.atan2(rise, half),
      len = Math.hypot(half, rise);
    for (const side of [-1, 1]) {
      piece(
        x,
        height + rise * 0.5,
        z + side * half * 0.5,
        w,
        0.14,
        len,
        tiles,
        false,
        side * angle,
      );
      for (let i = 0; i <= Math.floor(w / 0.23); i++)
        piece(
          x - w / 2 + i * 0.23,
          height + rise * 0.5 + 0.088,
          z + side * half * 0.5,
          0.055,
          0.058,
          len,
          trim,
          false,
          side * angle,
        );
    }
    piece(x, height + rise + 0.04, z, w + 0.28, 0.17, 0.21, trim);
  }
  function wall(x: number, z: number, w: number, d: number, h = 1.75) {
    piece(x, 0, z, w, 0.24, d + 0.05, base, true);
    piece(x, 0.24, z, w, h - 0.24, d, earth, true);
    piece(x, h, z, w + 0.09, 0.1, d + 0.12, tiles);
  }
  // Rear residence, clear central threshold, enclosed family courtyard and side utility shed.
  wall(0, -2.5, 8.4, 0.23, 2.8);
  wall(-4.2, 0, 0.24, 5.2, 2.8);
  wall(4.2, 0, 0.24, 5.2, 2.8);
  for (const side of [-1, 1]) {
    wall(side * 2.55, 2.5, 3.3, 0.22, 2.68);
    piece(side * 1.02, 0, 2.57, 0.15, 2.48, 0.21, wood, true);
    piece(side * 2.8, 0.93, 2.64, 1.3, 0.94, 0.06, "#424438");
    for (let i = 0; i < 6; i++)
      piece(side * 2.8 - 0.58 + i * 0.23, 0.93, 2.7, 0.046, 0.94, 0.055, wood);
  }
  piece(0, 2.25, 2.54, 1.93, 0.49, 0.23, wood);
  roof(0, 0, 9.25, 6.25, 2.78, 1.38);
  piece(0, 0.015, 0, 8.1, 0.028, 4.8, "#a59476");
  for (const sign of [-1, 1]) {
    wall(sign * 7, 5.4, 0.32, 17.2);
    wall(sign * 4.12, 14, 5.76, 0.35);
    wall(sign * 3.5, -3.2, 7, 0.35);
    piece(sign * 1.25, 0, 14, 0.28, 2.38, 0.34, wood, true);
  }
  roof(0, 14, 3.45, 2.25, 2.34, 0.55);
  piece(0, 2.12, 14, 2.72, 0.23, 0.29, wood);
  for (let i = 0; i < 12; i++)
    piece(
      ((i % 3) - 1) * 0.065,
      0.025,
      3.1 + i * 0.94,
      1.23,
      0.045,
      0.76,
      i % 3 === 0 ? "#998d76" : "#aaa08b",
    );
  piece(-4.8, 0.03, 8.2, 2.4, 0.11, 3.5, "#8b8164");
  for (let i = 0; i < 12; i++)
    piece(
      -5.6 + (i % 3) * 0.7,
      0.12,
      6.8 + Math.floor(i / 3) * 0.8,
      0.32,
      0.23,
      0.36,
      i % 2 ? "#788459" : "#92935a",
    );
  for (const sign of [-1, 1])
    for (const side of [-1, 1])
      piece(
        4.65 + sign * 0.87,
        0,
        7.6 + side * 1.2,
        0.12,
        1.9,
        0.12,
        wood,
        true,
      );
  roof(4.65, 7.6, 2.5, 3.15, 1.89, 0.55);
  piece(4.65, 0, 7.65, 1.7, 0.38, 0.6, base, true);
  for (const [k, matrices] of batches) {
    const mesh = new T.InstancedMesh(
      k.endsWith("r") ? cylinder : box,
      mat(k.slice(0, -1)),
      matrices.length,
    );
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    group.add(mesh);
  }
  function makeDoor(key: Door) {
    const z = doorZ[key],
      width = key === "gate" ? 1.18 : 0.91,
      height = key === "gate" ? 2.06 : 2.2;
    const leaves = [-1, 1].map((side) => {
      const hinge = new T.Group();
      hinge.position.set(side * width, 0, z);
      const slat = (
        x: number,
        y: number,
        dz: number,
        w: number,
        h: number,
        d: number,
        c: string,
      ) => {
        const o = new T.Mesh(box, mat(c));
        o.position.set(-side * x, y, dz);
        o.scale.set(w, h, d);
        hinge.add(o);
      };
      if (key === "gate") {
        hinge.userData = { asset: `home:${id}:gate`, display: "院落大门" };
        hinge.add(gateLeaf(side, style ?? originalGate));
        group.add(hinge);
        return { hinge, side };
      }
      for (let i = 0; i < 5; i++)
        slat(
          ((i + 0.5) * width) / 5,
          height / 2,
          0,
          width / 5 - 0.012,
          height,
          0.09,
          i % 2 ? "#785239" : "#825a3b",
        );
      for (const y of [0.24, height * 0.76])
        slat(width / 2, y, 0.065, width * 0.95, 0.12, 0.06, wood);
      slat(width * 0.79, height * 0.49, 0.09, 0.07, 0.14, 0.07, "#343b34");
      group.add(hinge);
      return { hinge, side };
    });
    let amount = opened[key] ? 1 : 0;
    function pose() {
      leaves.forEach(
        ({ hinge, side }) => (hinge.rotation.y = -side * amount * 1.53),
      );
    }
    pose();
    return {
      update(dt: number) {
        const target = Number(opened[key]);
        amount +=
          Math.sign(target - amount) *
          Math.min(Math.abs(target - amount), dt * 3.1);
        pose();
      },
      blocks(x: number, zp: number) {
        return leaves.some(({ side, hinge }) => {
          const dx = x - side * width,
            dz = zp - z,
            c = Math.cos(hinge.rotation.y),
            s = Math.sin(hinge.rotation.y),
            along = (dx * c - dz * s) * -side,
            across = dx * s + dz * c;
          return (
            along >= -0.28 && along <= width + 0.28 && Math.abs(across) < 0.34
          );
        });
      },
    };
  }
  const gates = [makeDoor("gate"), makeDoor("hall")];
  return {
    group,
    opened,
    update: (dt: number) => gates.forEach((g) => g.update(dt)),
    blocks(x: number, z: number, y: number) {
      x -= p.x;
      z -= p.z;
      if (Math.abs(x) > 8 || z < -4 || z > 15.5) return false;
      return (
        collisions.some(
          ([a, b, w, d, low, top]) =>
            y + 0.08 < top + 0.09 &&
            y + 1.7 > low + 0.09 &&
            Math.hypot(
              Math.max(0, Math.abs(x - a) - w),
              Math.max(0, Math.abs(z - b) - d),
            ) < 0.31,
        ) || gates.some((g) => g.blocks(x, z))
      );
    },
    dispose() {
      group.removeFromParent();
      group.traverse((o) => {
        if (o instanceof T.InstancedMesh) o.dispose();
      });
    },
  };
}
