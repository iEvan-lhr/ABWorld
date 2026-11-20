import { bounds, type Placement } from "./blueprint.ts";
export function terrainHeight(x: number, z: number) {
  const u = x / (1398 / 246) + 535,
    v = z / (1398 / 246) + 850,
    t = (v - 145) / 264;
  if (t <= 0 || t >= 1) return 0.09;
  const a = Math.min(1, Math.max(0, (4100 - Math.abs(x)) / 350));
  return Math.max(
    0.09,
    a *
      a *
      (3 - 2 * a) *
      Math.sin(Math.PI * t) ** 2 *
      (102 +
        35 * Math.cos(u * 0.016 + v * 0.012) +
        22 * Math.sin(u * 0.035 - v * 0.018)) -
      0.046,
  );
}
export function checkSite(
  p: Placement,
  floor: (x: number, z: number, y: number) => number | null,
) {
  const b = bounds(p);
  if (b.minX < -4050 || b.maxX > 4050 || b.minZ < -3720 || b.maxZ > 4630)
    throw Error("位置超出城市范围");
  const nx = Math.max(1, Math.ceil((b.maxX - b.minX) / 0.4)),
    nz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / 0.4));
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const y = floor(
        b.minX + ((b.maxX - b.minX) * i) / nx,
        b.minZ + ((b.maxZ - b.minZ) * j) / nz,
        p.y,
      );
      if (y === null || Math.abs(p.y - y) > 0.12)
        throw Error("这里有障碍、水面、高差或未加载的街区，请换一处平地");
    }
}
