export type Vec = [number, number, number];
export const catalog = {
  mesh: "自由三角网格，mesh.vertices 为 [x,y,z]，x/z 从 -0.5 到 0.5，y 从 0 到 1，各轴覆盖完整范围。mesh.faces 为三点下标数组。",
  timber_canopy: "四柱木棚与布顶",
  wood_counter: "木柜台，可用 top 锚点",
  clay_jar: "有口沿的陶罐",
  bench: "四腿长凳，可用 top 锚点",
  timber_post: "方形木柱，可用 top 锚点",
  plank: "矩形板或梁，可用 top 锚点",
} as const;
export const colors = {
  weathered_wood: "#796049",
  dark_wood: "#533c31",
  red_clay: "#a26146",
  grey_clay: "#736d61",
  linen: "#b5a078",
} as const;
export type Kind = keyof typeof catalog;
export interface Part {
  id: string;
  type: Kind;
  size: Vec;
  mesh?: { vertices: Vec[]; faces: Vec[] };
  position?: Vec;
  attachTo?: string;
  offset?: Vec;
  material?: keyof typeof colors;
}
export interface Blueprint {
  version: 1;
  catalogVersion: 1;
  name: string;
  seed: number;
  parts: Part[];
}
export interface Placement {
  blueprint: Blueprint;
  x: number;
  y: number;
  z: number;
  yaw: number;
}
export interface Saved extends Placement {
  id: number;
}
export const example: Blueprint = {
  version: 1,
  catalogVersion: 1,
  name: "东市陶器摊",
  seed: 217,
  parts: [
    {
      id: "stall",
      type: "timber_canopy",
      size: [3.2, 2.5, 2.4],
      position: [0, 0, 0],
    },
    {
      id: "counter",
      type: "wood_counter",
      size: [1.8, 0.85, 0.65],
      position: [0, 0, 0.65],
    },
    {
      id: "jar",
      type: "clay_jar",
      size: [0.28, 0.36, 0.28],
      attachTo: "counter.top",
      offset: [0, 0, 0],
      material: "red_clay",
    },
  ],
};
export const instructions = `你是洛阳城的建模师。根据用户描述设计物件，只输出一个 JSON 对象。构件 ${JSON.stringify(catalog)}。材料 ${Object.keys(colors).join(", ")}。单位米，size 为宽高深，每轴 0.03 至 10。position 为底部中心[x,y,z]，地面 y=0；挂接用 attachTo:"先前构件ID.top" 和 offset，替代 position。每个部件使用唯一 ASCII ID。最多32件，全部位于原点水平半径各6米内、高10米内。version和catalogVersion必须是1，seed为非负整数。示例 ${JSON.stringify(example)}。不要输出代码或外部资源。`;
function fail(message: string): never {
  throw new Error(message);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("应为对象");
  return value as Record<string, unknown>;
}
function vector(v: unknown, min: number, max: number, label: string): Vec {
  if (
    !Array.isArray(v) ||
    v.length !== 3 ||
    !v.every(
      (n) =>
        typeof n === "number" && Number.isFinite(n) && n >= min && n <= max,
    )
  )
    fail(`${label} 需要三个 ${min} 到 ${max} 之间的数值`);
  return [v[0], v[1], v[2]];
}
export function layout(bp: Blueprint) {
  const tops = new Map<string, Vec>();
  return bp.parts.map((p) => {
    let at = p.position;
    if (p.attachTo) {
      const top = tops.get(p.attachTo);
      if (!top) fail(`${p.id} 引用了不存在或尚未定义的锚点 ${p.attachTo}`);
      const [x, y, z] = p.offset ?? [0, 0, 0];
      at = [top[0] + x, top[1] + y, top[2] + z];
    }
    if (!at) fail(`${p.id} 缺少 position`);
    const [w, h, d] = p.size;
    if (
      Math.abs(at[0]) + w / 2 > 6 ||
      Math.abs(at[2]) + d / 2 > 6 ||
      at[1] < 0 ||
      at[1] + h > 10
    )
      fail(`${p.id} 超出蓝图边界`);
    if (["bench", "wood_counter", "plank", "timber_post"].includes(p.type))
      tops.set(p.id + ".top", [at[0], at[1] + h, at[2]]);
    return { ...p, at };
  });
}
export function parseBlueprint(value: unknown): Blueprint {
  const b = record(value);
  if (b.version !== 1 || b.catalogVersion !== 1)
    fail("需要蓝图版本 1 和构件目录版本 1");
  if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 64)
    fail("名称需为 1–64 个字符");
  if (typeof b.seed !== "number" || !Number.isSafeInteger(b.seed) || b.seed < 0)
    fail("seed 需要非负整数");
  if (!Array.isArray(b.parts) || !b.parts.length || b.parts.length > 32)
    fail("需要 1–32 个构件");
  const ids = new Set<string>();
  const parts = b.parts.map((v, i): Part => {
    const p = record(v),
      label = `第 ${i + 1} 个构件`;
    if (
      typeof p.id !== "string" ||
      !/^[a-zA-Z][\w-]{0,39}$/.test(p.id) ||
      ids.has(p.id)
    )
      fail(`${label} ID 无效或重复`);
    ids.add(p.id);
    if (typeof p.type !== "string" || !Object.hasOwn(catalog, p.type))
      fail(`${label} 类型无效`);
    const out: Part = {
      id: p.id,
      type: p.type as Kind,
      size: vector(p.size, 0.03, 10, label + "尺寸"),
    };
    if (out.type === "mesh") {
      const mesh = record(p.mesh);
      if (
        !Array.isArray(mesh.vertices) ||
        mesh.vertices.length < 3 ||
        mesh.vertices.length > 256 ||
        !Array.isArray(mesh.faces) ||
        !mesh.faces.length ||
        mesh.faces.length > 400
      )
        fail(`${label} 网格数量无效`);
      const vertices = mesh.vertices.map((v) => vector(v, -0.5, 1, "顶点"));
      if (vertices.some((v) => v[1] < 0 || v[0] > 0.5 || v[2] > 0.5))
        fail("网格顶点超界");
      const faces = mesh.faces.map((f) =>
        vector(f, 0, vertices.length - 1, "三角面"),
      );
      if (
        faces.some((v) => !v.every(Number.isInteger) || new Set(v).size !== 3)
      )
        fail("三角面下标无效");
      const used = new Set(faces.flat());
      for (let axis = 0; axis < 3; axis++) {
        const values = [...used].map((i) => vertices[i][axis]);
        if (
          Math.abs(Math.min(...values) - (axis === 1 ? 0 : -0.5)) > 0.0001 ||
          Math.abs(Math.max(...values) - (axis === 1 ? 1 : 0.5)) > 0.0001
        )
          fail("网格需要覆盖标定的尺寸");
      }
      out.mesh = { vertices, faces };
    }
    if (p.material !== undefined) {
      if (typeof p.material !== "string" || !Object.hasOwn(colors, p.material))
        fail(`${label} 材料无效`);
      out.material = p.material as Part["material"];
    }
    if (p.attachTo !== undefined) {
      if (typeof p.attachTo !== "string" || p.position !== undefined)
        fail(`${label} 的锚点与位置设置冲突`);
      out.attachTo = p.attachTo;
      if (p.offset !== undefined)
        out.offset = vector(p.offset, -10, 10, label + "偏移");
    } else out.position = vector(p.position, -10, 10, label + "位置");
    return out;
  });
  const bp: Blueprint = {
    version: 1,
    catalogVersion: 1,
    name: b.name.trim(),
    seed: b.seed,
    parts,
  };
  layout(bp);
  return bp;
}
export function bounds(p: Placement) {
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  const c = Math.cos(p.yaw),
    s = Math.sin(p.yaw);
  for (const {
    at: [x, , z],
    size: [w, , d],
  } of layout(p.blueprint)) {
    const cx = p.x + c * x + s * z,
      cz = p.z - s * x + c * z,
      dx = (Math.abs(c) * w + Math.abs(s) * d) / 2,
      dz = (Math.abs(s) * w + Math.abs(c) * d) / 2;
    minX = Math.min(minX, cx - dx);
    maxX = Math.max(maxX, cx + dx);
    minZ = Math.min(minZ, cz - dz);
    maxZ = Math.max(maxZ, cz + dz);
  }
  return { minX, minZ, maxX, maxZ };
}
export function conflicts(
  a: ReturnType<typeof bounds>,
  b: ReturnType<typeof bounds>,
) {
  return (
    a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
  );
}
