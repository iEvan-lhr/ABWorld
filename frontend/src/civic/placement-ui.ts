import { anchors, type Anchor } from "./creations.ts";
import {
  contains,
  modelVolume,
  type Volume,
  type Region,
  type WorldPosition,
} from "./regions.ts";
import type { Blueprint } from "../workshop/blueprint.ts";
interface Areas {
  home: Volume;
  granted: Region[];
  managed: Region[];
}
export function placementUI(
  api: (route: string, body?: unknown) => Promise<any>,
  afterPlace: () => Promise<void>,
) {
  const byId = (id: string) => document.getElementById(id)!,
    input = (id: string) => byId(id) as HTMLInputElement;
  const dialog = byId("placeDialog") as HTMLDialogElement,
    access = byId("regionDialog") as HTMLDialogElement;
  let areas: Areas,
    product:
      | { id: number; blueprint: Blueprint; anchor: Anchor | null }
      | undefined;
  function boxText(v: Volume) {
    return `X ${v.minX.toFixed(2)} ～ ${v.maxX.toFixed(2)}　Y ${v.minY.toFixed(2)} ～ ${v.maxY.toFixed(2)}　Z ${v.minZ.toFixed(2)} ～ ${v.maxZ.toFixed(2)}`;
  }
  function readPos(): WorldPosition {
    return {
      x: input("placeX").valueAsNumber,
      y: input("placeY").valueAsNumber,
      z: input("placeZ").valueAsNumber,
      yaw: (input("placeYaw").valueAsNumber * Math.PI) / 180,
    };
  }
  function check() {
    if (!product || !areas) return;
    const pos = readPos();
    const allowed =
      Object.values(pos).every(Number.isFinite) &&
      [areas.home, ...areas.granted.map((a) => a.volume)].some((v) =>
        contains(v, modelVolume({ ...pos, blueprint: product!.blueprint })),
      );
    byId("placeStatus").textContent = allowed
      ? "在已授权范围内"
      : "物品超出已授权的 XYZ 范围";
    (byId("placeConfirm") as HTMLButtonElement).disabled = !allowed;
  }
  function pick() {
    const id = input("placeRegion").value,
      area =
        areas.granted.find((r) => `grant:${r.id}` === id)?.volume ?? areas.home;
    let x = (area.minX + area.maxX) / 2,
      z = (area.minZ + area.maxZ) / 2;
    const anchor = anchors[id as Anchor];
    if (anchor) {
      x = areas.home.minX + 7 + anchor.x;
      z = areas.home.minZ + 3.2 + anchor.z;
    }
    input("placeX").value = x.toFixed(3);
    input("placeY").value = (area.minY + 0.05).toFixed(3);
    input("placeZ").value = z.toFixed(3);
    input("placeYaw").value = "0";
    byId("placeRange").textContent = boxText(area);
    check();
  }
  async function open(p: NonNullable<typeof product>) {
    product = p;
    areas = await api("regions");
    const select = byId("placeRegion") as HTMLSelectElement;
    select.replaceChildren(
      ...Object.entries(anchors).map(
        ([k, a]) => new Option("我的宅地 · " + a.label, k),
      ),
      ...areas.granted.map((r) => new Option(r.name, `grant:${r.id}`)),
    );
    select.value = p.anchor ?? "hallWest";
    byId("placeName").textContent = p.blueprint.name;
    pick();
    dialog.showModal();
  }
  input("placeRegion").onchange = pick;
  for (const k of ["X", "Y", "Z", "Yaw"]) input("place" + k).oninput = check;
  byId("placeClose").onclick = () => dialog.close();
  byId("placeConfirm").onclick = async () => {
    if (!product) return;
    const b = byId("placeConfirm") as HTMLButtonElement;
    b.disabled = true;
    try {
      await api("place", { id: product.id, position: readPos() });
      dialog.close();
      await afterPlace();
    } catch (e) {
      byId("placeStatus").textContent = (e as Error).message;
    } finally {
      b.disabled = false;
    }
  };
  const keys = ["minX", "maxX", "minY", "maxY", "minZ", "maxZ"] as const;
  async function grants(fill: boolean) {
    areas = await api("regions");
    byId("myPlotBounds").textContent = "我的宅地　" + boxText(areas.home);
    if (fill)
      for (const k of keys)
        input("area" + k).value = String(Number(areas.home[k].toFixed(4)));
    const list = byId("areaGrants");
    list.replaceChildren();
    for (const r of areas.managed) {
      const row = document.createElement("p"),
        btn = document.createElement("button");
      row.textContent = `${r.name} · 账号 ${r.uid} · ${boxText(r.volume)} `;
      btn.textContent = "撤销";
      btn.onclick = async () => {
        try {
          await api("revoke-region", { id: r.id });
          await grants(false);
        } catch (e) {
          byId("areaNotice").textContent = (e as Error).message;
        }
      };
      row.append(btn);
      list.append(row);
    }
  }
  byId("manageAreas").onclick = async () => {
    access.showModal();
    try {
      await grants(true);
    } catch (e) {
      byId("areaNotice").textContent = (e as Error).message;
    }
  };
  byId("areaClose").onclick = () => access.close();
  (byId("areaForm") as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("grant-region", {
        name: input("areaName").value,
        uid: input("areaUid").valueAsNumber,
        volume: Object.fromEntries(
          keys.map((k) => [k, input("area" + k).valueAsNumber]),
        ),
      });
      byId("areaNotice").textContent = "摆放授权已保存";
      await grants(false);
    } catch (err) {
      byId("areaNotice").textContent = (err as Error).message;
    }
  };
  return open;
}
