export interface DynamicBody {
  x: number;
  z: number;
  y: number;
  radius: number;
  height: number;
}
/** A spatial hash for moving bodies. Rebuilt from simulation poses rather than visible LODs. */
export class CrowdCollisions {
  private readonly cells = new Map<string, DynamicBody[]>();
  rebuild(bodies: Iterable<DynamicBody>) {
    this.cells.clear();
    for (const body of bodies) {
      const key = `${Math.floor(body.x / 2)},${Math.floor(body.z / 2)}`;
      const cell = this.cells.get(key);
      if (cell) cell.push(body);
      else this.cells.set(key, [body]);
    }
  }
  overlaps(x: number, z: number, y: number, radius: number, height: number) {
    for (
      let i = Math.floor((x - radius - 0.45) / 2);
      i <= Math.floor((x + radius + 0.45) / 2);
      i++
    )
      for (
        let j = Math.floor((z - radius - 0.45) / 2);
        j <= Math.floor((z + radius + 0.45) / 2);
        j++
      ) {
        for (const body of this.cells.get(`${i},${j}`) ?? []) {
          if (
            body.y + body.height > y + 0.08 &&
            body.y < y + height &&
            (body.x - x) ** 2 + (body.z - z) ** 2 < (radius + body.radius) ** 2
          )
            return true;
        }
      }
    return false;
  }
  /** Allow an actor to step out if another pedestrian walked into their resting position. */
  blocksMove(
    fromX: number,
    fromZ: number,
    x: number,
    z: number,
    y: number,
    radius: number,
    height: number,
  ) {
    const reach = radius + 0.45;
    for (
      let i = Math.floor((x - reach) / 2);
      i <= Math.floor((x + reach) / 2);
      i++
    )
      for (
        let j = Math.floor((z - reach) / 2);
        j <= Math.floor((z + reach) / 2);
        j++
      )
        for (const b of this.cells.get(`${i},${j}`) ?? []) {
          if (b.y + b.height <= y + 0.08 || b.y >= y + height) continue;
          const next = (x - b.x) ** 2 + (z - b.z) ** 2,
            previous = (fromX - b.x) ** 2 + (fromZ - b.z) ** 2;
          if (next < (radius + b.radius) ** 2 && next <= previous + 1e-9)
            return true;
        }
    return false;
  }
}
export const crowdCollision = new CrowdCollisions();
export function covers(
  a: Float32Array,
  i: number,
  x: number,
  z: number,
  r: number,
) {
  const dx = x - a[i + 1],
    dz = z - a[i + 2],
    c = a[i + 3],
    s = a[i + 4];
  const localX = dx * c - dz * s,
    localZ = dx * s + dz * c;
  if (a[i] === 4)
    return (localX / (a[i + 5] + r)) ** 2 + (localZ / (a[i + 6] + r)) ** 2 <= 1;
  const u = Math.max(0, Math.abs(localX) - a[i + 5]),
    v = Math.max(0, Math.abs(localZ) - a[i + 6]);
  return u * u + v * v <= r * r;
}

export function resolveSupport(
  a: Float32Array,
  ids: Iterable<number>,
  x: number,
  z: number,
  y: number,
  ground: number,
): number | null {
  let floor = ground,
    bridge = false,
    wet = false;
  for (const i of ids) {
    if (a[i] === 1 && covers(a, i, x, z, 0.31)) {
      if (a[i + 9] || a[i + 8] <= y + 0.34) floor = Math.max(floor, a[i + 8]);
      if (a[i + 9]) bridge = true;
    } else if (a[i] === 2 && covers(a, i, x, z, 0.24)) wet = true;
  }
  if (wet && !bridge) return null;
  for (const i of ids)
    if (
      (a[i] === 0 || a[i] === 4) &&
      a[i + 8] > floor + 0.085 &&
      a[i + 7] < floor + 1.7 &&
      covers(a, i, x, z, 0.31)
    )
      return null;
  return floor;
}
