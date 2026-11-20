export const tokensPerPoint = 150_000;
export const level = (contribution: number) =>
  1 + Math.floor(contribution / 25);
export const allowance = (contribution: number) =>
  (100 + 20 * (level(contribution) - 1)) * tokensPerPoint;
export const income = (contribution: number) =>
  50 + 10 * (level(contribution) - 1) + Math.floor(contribution / 5);
export const dayNumber = (ms = Date.now()) =>
  Math.floor((ms + 8 * 3600000) / 86400000);
export const tasks = {
  roof: { name: "修缮檐廊与立柱", pay: 30, merit: 10 },
  yard: { name: "完善窗棂与院落陈设", pay: 50, merit: 15 },
} as const;
export type Task = keyof typeof tasks;
export interface Design {
  wood: "dark" | "warm";
  posts: number;
  depth: number;
  lattice: number;
  jars: number;
  bench: "left" | "right";
}
export function design(input: unknown): Design {
  if (!input || typeof input !== "object") throw Error("设计格式错误");
  const v = input as Design;
  const valid = (n: number, a: number, b: number) =>
    Number.isFinite(n) && n >= a && n <= b;
  if (
    !["dark", "warm"].includes(v.wood) ||
    !Number.isInteger(v.posts) ||
    !valid(v.posts, 2, 4) ||
    !valid(v.depth, 0.9, 1.6) ||
    !Number.isInteger(v.lattice) ||
    !valid(v.lattice, 3, 7) ||
    !Number.isInteger(v.jars) ||
    !valid(v.jars, 1, 3) ||
    !["left", "right"].includes(v.bench)
  )
    throw Error("设计超出住宅的尺寸范围");
  return {
    wood: v.wood,
    posts: v.posts,
    depth: v.depth,
    lattice: v.lattice,
    jars: v.jars,
    bench: v.bench,
  };
}
export function currency(n: number) {
  return (
    [
      ["尊", 1e9],
      ["贤", 1e6],
      ["信", 1e3],
      ["工", 1],
    ]
      .map(([unit, m]) => {
        const value = Math.floor(n / Number(m));
        n %= Number(m);
        return value ? value + String(unit) : "";
      })
      .filter(Boolean)
      .join(" ") || "0工"
  );
}
export interface Home {
  gateStyle?: import("./gate-style.ts").GateStyle;
  gate: boolean;
  hall: boolean;
  id: number;
  roof: Design | null;
  yard: Design | null;
  resident: number;
}
export interface CivicState {
  no: number;
  balance: number;
  merit: number;
  spent: number;
  pending: boolean;
  home: Home;
  ledger: { day: number; event: string; amount: number; tokens: number }[];
}
