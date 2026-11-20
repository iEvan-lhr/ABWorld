import {
  bounds,
  layout,
  type Blueprint,
  type Placement,
} from "../workshop/blueprint.ts";
export const creationTypes = {
  furniture: "家具",
  vessel: "器皿",
  decoration: "摆件",
  tool: "用具",
  custom: "自由创作",
} as const;
export interface Volume {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}
export interface Region {
  id: number;
  name: string;
  volume: Volume;
  uid: number;
  issuer: number;
}
export interface WorldPosition {
  x: number;
  y: number;
  z: number;
  yaw: number;
}
export function homeVolume(plot: { x: number; z: number }): Volume {
  return {
    minX: plot.x - 7,
    maxX: plot.x + 7,
    minZ: plot.z - 3.2,
    maxZ: plot.z + 14,
    minY: 0.09,
    maxY: 6.09,
  };
}
export function contains(outer: Volume, inner: Volume) {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.minZ <= inner.minZ &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY &&
    outer.maxZ >= inner.maxZ
  );
}
export function modelVolume(p: Placement): Volume {
  const parts = layout(p.blueprint);
  return {
    ...bounds(p),
    minY: p.y + Math.min(...parts.map((a) => a.at[1])),
    maxY: p.y + Math.max(...parts.map((a) => a.at[1] + a.size[1])),
  };
}
export function parseVolume(v: unknown): Volume {
  if (!v || typeof v !== "object") throw Error("请填写 XYZ 的最小和最大坐标");
  const b = v as Volume;
  for (const [lo, hi] of [
    [b.minX, b.maxX],
    [b.minY, b.maxY],
    [b.minZ, b.maxZ],
  ])
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi)
      throw Error("各轴最大值必须大于最小值");
  if (
    b.minX < -4050 ||
    b.maxX > 4050 ||
    b.minZ < -3720 ||
    b.maxZ > 4630 ||
    b.minY < -20 ||
    b.maxY > 260
  )
    throw Error("授权范围超出世界边界");
  return {
    minX: b.minX,
    minY: b.minY,
    minZ: b.minZ,
    maxX: b.maxX,
    maxY: b.maxY,
    maxZ: b.maxZ,
  };
}
