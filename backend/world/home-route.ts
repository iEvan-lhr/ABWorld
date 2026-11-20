import { cityFloor } from "./city-floor.ts";
import { terrainHeight } from "../../frontend/src/workshop/site.ts";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
export type Point = { x: number; z: number; y: number };
type Plot = {
  x: number;
  z: number;
  d: number;
  yaw: number;
  gateX: number;
  gateZ: number;
};
type Node = Point & {
  ix: number;
  iz: number;
  g: number;
  score: number;
  prev?: Node;
};
class Frontier {
  heap: Node[] = [];
  push(p: Node) {
    const h = this.heap;
    h.push(p);
    let i = h.length - 1;
    while (i) {
      const j = (i - 1) >> 1;
      if (h[j].score <= p.score) break;
      h[i] = h[j];
      i = j;
    }
    h[i] = p;
  }
  pop() {
    const h = this.heap,
      first = h[0],
      end = h.pop()!;
    if (h.length) {
      let i = 0;
      while (2 * i + 1 < h.length) {
        let j = 2 * i + 1;
        if (j + 1 < h.length && h[j + 1].score < h[j].score) j++;
        if (h[j].score >= end.score) break;
        h[i] = h[j];
        i = j;
      }
      h[i] = end;
    }
    return first;
  }
}
export function routeHome(root: string, start: Point, home: Plot) {
  const floor = cityFloor(root);
  const probe = (x: number, z: number, y: number) =>
    Math.abs(x) > 4050 ||
    z < -3720 ||
    z > 4630 ||
    (Math.abs(x - home.x) < 7.35 && z > home.z - 3.5 && z < home.gateZ + 0.35)
      ? null
      : floor(x, z, y);
  const sy = probe(start.x, start.z, start.y);
  if (sy === null) throw Error("请走到开阔地面再开始导航");
  start = { ...start, y: sy };
  const targets: Point[] = [];
  for (const depth of [2.1, 2.6, 3])
    for (const side of [0, -0.65, 0.65]) {
      const front = home.d / 2 + depth,
        x = home.gateX + side,
        z = home.gateZ + depth - 0.95,
        y = probe(x, z, terrainHeight(x, z));
      if (y !== null) targets.push({ x, y, z });
    }
  if (!targets.length) throw Error("住宅门前尚未找到可通行的落脚点");
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
  const end = targets[0];
  function edge(a: Point, b: Point) {
    let y = a.y;
    const n = Math.max(1, Math.ceil(dist(a, b) / 0.35));
    for (let i = 1; i <= n; i++) {
      const f = i / n,
        v = probe(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, y);
      if (v === null || Math.abs(v - y) > 0.35) return null;
      y = v;
    }
    return y;
  }
  const distance = dist(start, end);
  for (const step of distance > 160 ? [6, 2] : [1.4, 0.7]) {
    const open = new Frontier(),
      best = new Map<number, number>();
    open.push({ ...start, ix: 0, iz: 0, g: 0, score: distance });
    let count = 0;
    while (open.heap.length && count++ < 50000) {
      const a = open.pop();
      const key = (i: number, j: number) => i * 100000 + j;
      if ((best.get(key(a.ix, a.iz)) ?? 0) < a.g) continue;
      if (dist(a, end) < Math.max(10, step * 2)) {
        const target = targets.find((b) => edge(a, b) !== null);
        if (target) {
          const route: Point[] = [target];
          for (let n: Node | undefined = a; n; n = n.prev)
            route.push({ x: n.x, y: n.y, z: n.z });
          return route.reverse();
        }
      }
      for (const [di, dj] of [
        [0, 1],
        [1, 0],
        [-1, 0],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        const ix = a.ix + di,
          iz = a.iz + dj,
          k = key(ix, iz),
          g = a.g + step * Math.hypot(di, dj);
        if ((best.get(k) ?? Infinity) <= g) continue;
        const b = { x: start.x + ix * step, z: start.z + iz * step, y: a.y };
        if (dist(b, start) + dist(b, end) > distance * 2.5 + 140) continue;
        const y = edge(a, b);
        if (y === null) continue;
        best.set(k, g);
        open.push({
          ...b,
          y,
          ix,
          iz,
          g,
          score: g + 1.35 * dist(b, end),
          prev: a,
        });
      }
    }
  }
  throw Error("这次未找到通行路线，请移到附近街道重试");
}
if (!isMainThread) {
  try {
    parentPort!.postMessage({
      points: routeHome(workerData.root, workerData.start, workerData.home),
    });
  } catch (e) {
    parentPort!.postMessage({ error: (e as Error).message });
  }
}
