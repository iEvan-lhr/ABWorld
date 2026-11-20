import { walkPose, type WalkPose } from "./pose.ts";
export const attributes = {
  strength: "力量",
  agility: "敏捷",
  intelligence: "智力",
  charisma: "魅力",
} as const;
type Attribute = keyof typeof attributes;
export const items = {
  cake: {
    name: "粟饼",
    description: "饥饿 −30",
    stat: "hunger",
    change: -30,
    initial: 3,
  },
  tea: {
    name: "茶汤",
    description: "体力 +25",
    stat: "stamina",
    change: 25,
    initial: 2,
  },
  medicine: {
    name: "药散",
    description: "生命 +20",
    stat: "health",
    change: 20,
    initial: 2,
  },
} as const;
export type ItemId = keyof typeof items;
export interface Character {
  pose?: WalkPose;
  version: 1;
  health: number;
  stamina: number;
  hunger: number;
  attributes: Record<Attribute, number>;
  bag: Record<ItemId, number>;
  exhausted: boolean;
}
export const initial = (): Character => ({
  version: 1,
  health: 85,
  stamina: 80,
  hunger: 35,
  attributes: { strength: 10, agility: 10, intelligence: 10, charisma: 10 },
  bag: {
    cake: items.cake.initial,
    tea: items.tea.initial,
    medicine: items.medicine.initial,
  },
  exhausted: false,
});
const clamp = (n: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, n));
export function loadCharacter(text: string | null) {
  const c = initial();
  if (!text) return c;
  try {
    const data = JSON.parse(text);
    if (data?.version !== 1) return c;
    c.pose = walkPose(data.pose);
    for (const k of ["health", "stamina", "hunger"] as const)
      if (Number.isFinite(data[k])) c[k] = clamp(data[k]);
    for (const k of Object.keys(items) as ItemId[])
      if (Number.isSafeInteger(data.bag?.[k]))
        c.bag[k] = clamp(data.bag[k], 0, 999);
    for (const k of Object.keys(attributes) as Attribute[])
      if (Number.isSafeInteger(data.attributes?.[k]))
        c.attributes[k] = clamp(data.attributes[k], 1, 99);
    c.exhausted =
      c.stamina === 0 || (data.exhausted === true && c.stamina < 20);
  } catch {}
  return c;
}
export function tick(
  c: Character,
  seconds: number,
  moving: boolean,
  running: boolean,
) {
  const sprint = moving && running;
  c.hunger = clamp(
    c.hunger + seconds * (sprint ? 0.11 : moving ? 0.06 : 0.025),
  );
  c.stamina = clamp(
    c.stamina + seconds * (sprint ? -0.18 : moving ? -0.015 : 1.2),
  );
  if (c.stamina <= 0) c.exhausted = true;
  if (c.stamina >= 20) c.exhausted = false;
  if (c.hunger >= 100) c.health = clamp(c.health - seconds * 0.12, 1);
}
export function useItem(c: Character, id: ItemId) {
  const item = items[id];
  if (!c.bag[id]) return false;
  const next = clamp(c[item.stat] + item.change);
  if (next === c[item.stat]) return false;
  c[item.stat] = next;
  c.bag[id]--;
  if (c.stamina >= 20) c.exhausted = false;
  return true;
}
