export const gateFinishes = {
  timber: { label: "素木", wood: "#825a3b", edge: "#6f4a31", metal: "#555044" },
  walnut: {
    label: "乌木铜饰",
    wood: "#53392e",
    edge: "#362a26",
    metal: "#b39760",
  },
  vermilion: {
    label: "暗朱漆",
    wood: "#7c3b32",
    edge: "#542e27",
    metal: "#a68a57",
  },
} as const;
export interface GateStyle {
  finish: keyof typeof gateFinishes;
  panels: "plain" | "framed";
  hardware: "latch" | "ring";
}
export const originalGate: GateStyle = {
  finish: "timber",
  panels: "plain",
  hardware: "latch",
};
export function gateStyle(v: unknown): GateStyle {
  const s = v as GateStyle;
  if (
    !s ||
    !Object.hasOwn(gateFinishes, s.finish) ||
    !["plain", "framed"].includes(s.panels) ||
    !["ring", "latch"].includes(s.hardware)
  )
    throw Error("大门样式参数无效");
  return { finish: s.finish, panels: s.panels, hardware: s.hardware };
}
