import * as T from "three";
import { colors, layout, type Placement, type Vec } from "./blueprint.ts";
import { covers } from "../physics/collision.ts";
const box = new T.BoxGeometry();
const jar = new T.LatheGeometry(
  [
    [0.22, 0],
    [0.32, 0.04],
    [0.48, 0.35],
    [0.5, 0.61],
    [0.37, 0.78],
    [0.27, 0.86],
    [0.27, 0.93],
    [0.32, 0.95],
    [0.32, 1],
    [0.24, 1],
    [0.24, 0.91],
    [0.19, 0.86],
    [0, 0.84],
  ].map(([x, y]) => new T.Vector2(x, y)),
  24,
);
export function buildObject(p: Placement) {
  const group = new T.Group(),
    solids: number[] = [];
  let seed = p.blueprint.seed >>> 0;
  const custom: T.BufferGeometry[] = [];
  const c = Math.cos(p.yaw),
    s = Math.sin(p.yaw);
  group.position.set(p.x, p.y, p.z);
  group.rotation.y = p.yaw;
  for (const part of layout(p.blueprint)) {
    const [w, h, d] = part.size,
      [x, y, z] = part.at;
    const mat = (shade: string) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return new T.MeshLambertMaterial({
        color: new T.Color(shade).multiplyScalar(
          0.93 + (0.14 * seed) / 4294967296,
        ),
      });
    };
    const surface = mat(
      colors[
        part.material ??
          (part.type === "clay_jar" ? "red_clay" : "weathered_wood")
      ],
    );
    const piece = (
      dx: number,
      dy: number,
      dz: number,
      width: number,
      height: number,
      depth: number,
      material = surface,
      round = false,
    ) => {
      const obj = new T.Mesh(round ? jar : box, material),
        lx = x + dx,
        lz = z + dz;
      obj.scale.set(width, height, depth);
      obj.position.set(lx, y + dy + (round ? 0 : height / 2), lz);
      group.add(obj);
      solids.push(
        round ? 4 : 0,
        p.x + c * lx + s * lz,
        p.z - s * lx + c * lz,
        c,
        s,
        width / 2,
        depth / 2,
        p.y + y + dy,
        p.y + y + dy + height,
        0,
      );
    };
    if (part.type === "mesh" && part.mesh) {
      const g = new T.BufferGeometry();
      g.setAttribute(
        "position",
        new T.Float32BufferAttribute(part.mesh.vertices.flat(), 3),
      );
      g.setIndex(part.mesh.faces.flat());
      g.computeVertexNormals();
      custom.push(g);
      surface.side = T.DoubleSide;
      const o = new T.Mesh(g, surface);
      o.position.set(x, y, z);
      o.scale.set(w, h, d);
      group.add(o);
      solids.push(
        0,
        p.x + c * x + s * z,
        p.z - s * x + c * z,
        c,
        s,
        w / 2,
        d / 2,
        p.y + y,
        p.y + y + h,
        0,
      );
      continue;
    }
    if (part.type === "clay_jar") {
      piece(0, 0, 0, w, h, d, surface, true);
      continue;
    }
    if (part.type === "timber_canopy" || part.type === "bench") {
      const canopy = part.type === "timber_canopy",
        leg = Math.min(canopy ? 0.13 : 0.075, w * 0.16, d * 0.16),
        top = Math.min(canopy ? 0.11 : 0.075, h * 0.2);
      for (const signX of [-1, 1])
        for (const signZ of [-1, 1])
          piece(
            signX * (w / 2 - leg),
            0,
            signZ * (d / 2 - leg),
            leg,
            h - top,
            leg,
          );
      if (canopy) {
        for (const sign of [-1, 1])
          piece(0, h - top * 2, sign * (d / 2 - leg), w, top, leg);
        piece(0, h - top, 0, w, top, d, mat(colors.linen));
      } else piece(0, h - top, 0, w, top, d);
      continue;
    }
    if (part.type === "wood_counter") {
      const rim = Math.min(0.06, h * 0.15);
      piece(0, 0, 0, w * 0.95, h - rim, d * 0.92);
      piece(0, h - rim, 0, w, rim, d);
      continue;
    }
    piece(0, 0, 0, w, h, d);
  }
  const data = Float32Array.from(solids);
  return {
    group,
    blocks(x: number, z: number, y: number) {
      for (let i = 0; i < data.length; i += 10)
        if (
          data[i + 8] > y + 0.08 &&
          data[i + 7] < y + 1.7 &&
          covers(data, i, x, z, 0.31)
        )
          return true;
      return false;
    },
    dispose() {
      for (const geometry of custom) geometry.dispose();
      group.removeFromParent();
      const materials = new Set<T.Material>();
      group.traverse((o) => {
        if (o instanceof T.Mesh) materials.add(o.material);
      });
      for (const m of materials) m.dispose();
    },
  };
}
