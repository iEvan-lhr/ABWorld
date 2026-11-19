import type * as T from "three";
export type Bytes = string | Uint8Array<ArrayBuffer>;
export type ArrayName =
  | "Float32Array"
  | "Uint8Array"
  | "Uint16Array"
  | "Uint32Array";
export type PackedAttribute = [ArrayName, number, Bytes, boolean?];
export interface PackedGeometry {
  attrs: Record<string, PackedAttribute>;
  indices: PackedAttribute | null;
}
export interface ActorSpec {
  p: number;
  h: number;
  s: string;
  r: string;
  t?: string;
  m?: number[];
  seat?: boolean;
  x: number;
  z: number;
  a: string;
  phase: number;
  d: number;
  leg: number;
  turn: number;
  cycles: number;
  yaw: number;
  tx: number;
  tz: number;
  l: number;
}
export interface TilePacket {
  b: [number, number, Bytes][];
  g: {
    p: Bytes;
    n: Bytes;
    uv: Bytes;
    c: Bytes;
    i: Bytes;
    cc: number;
    mat: number;
  }[];
  c: Bytes;
  extra?: Bytes;
  p: ActorSpec[];
}
export interface RigPacket {
  body: PackedGeometry;
  groups: [number, number, number][];
  cycles: Record<string, number[][]>;
}
export interface Owner {
  refs: Set<string>;
}
export interface Tile extends Owner {
  group: T.Group;
  own: T.BufferGeometry[];
  collision: Float32Array;
  people: ActorSpec[];
  key: string;
  grid: Map<string, number[]>;
}
export interface ActorRig {
  model: { geometry: T.BufferGeometry; cycles: Record<string, number[][]> };
  mesh: T.SkinnedMesh<T.BufferGeometry, T.MeshLambertMaterial[]>;
  bones: T.Bone[];
  root: T.Group;
}
export interface PersonSlot extends Owner {
  rig: ActorRig | null;
  lastDemand: number;
  spec: ActorSpec;
}
export interface MotionState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  action: string;
  phase: number;
  detail: number;
}
export interface Population {
  index: ActorSpec[];
  templates: { n: number; slots: Bytes; indices: Bytes; delta: Bytes }[];
  actions: string[];
  frameCounts: number[];
}
export interface MaterialSpec {
  c: number[];
  r: number;
  texture?: number;
  side?: boolean;
  alpha?: string;
  cut?: number;
  unlit?: boolean;
}
export interface MapManifest {
  tileSize: number;
  tileKeys: string[];
  materials: MaterialSpec[];
  spawn: { x: number; y: number; z: number; yaw: number; name: string };
}
export interface StreamPackets {
  tiles: TilePacket;
  geometry: PackedGeometry;
  people: RigPacket;
  "people-low": RigPacket;
  images: { uri: string };
  horizon: [Bytes, Bytes, Bytes][];
}
export type Packet = StreamPackets[keyof StreamPackets];
export function element<E extends Element = HTMLElement>(selector: string): E {
  const el = document.querySelector<E>(selector);
  if (!el) throw new Error(`Missing DOM element ${selector}`);
  return el;
}
