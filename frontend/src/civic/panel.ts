import { courtyard, doorZ, type Door } from "./courtyard.ts";
import { homeGuide } from "./home-guide.ts";
import * as T from "three";
import plots from "../data/civic-homes.json";
import { buildObject } from "../workshop/geometry.ts";
import type { Part, Kind } from "../workshop/blueprint.ts";
import {
  level,
  income,
  allowance,
  tokensPerPoint,
  currency,
  tasks,
  type CivicState,
  type Home,
} from "./rules.ts";
function furnish(home: Home) {
  const p = plots[home.id],
    parts: Part[] = [];
  const wood = home.roof?.wood === "dark" ? "dark_wood" : "weathered_wood";
  const add = (
    id: string,
    type: Kind,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    m: Part["material"] = wood,
  ) =>
    parts.push({ id, type, size: [w, h, d], position: [x, y, z], material: m });
  const r = home.roof;
  if (r) {
    const width = Math.min(5.5, p.w * 0.72),
      top = Math.min(p.eave - 0.45, 2.85);
    for (let i = 0; i < r.posts; i++)
      add(
        "post" + i,
        "timber_post",
        0.15,
        top,
        0.15,
        -width / 2 + 0.16 + ((width - 0.32) * i) / (r.posts - 1),
        0,
        r.depth - 0.12,
      );
    add("beam", "plank", width, 0.19, 0.19, 0, top - 0.17, r.depth - 0.12);
    for (let i = 0; i < 8; i++)
      add(
        "slat" + i,
        "plank",
        width + 0.3,
        0.1,
        r.depth / 7.4,
        0,
        top - 0.035 * i,
        ((i + 0.5) * r.depth) / 8,
      );
  }
  const y = home.yard;
  if (y) {
    const sign = y.bench === "left" ? -1 : 1;
    add("bench", "bench", 1.35, 0.46, 0.45, sign * 1.55, 0, 0.53);
    for (let i = 0; i < y.jars; i++)
      add(
        "jar" + i,
        "clay_jar",
        0.38,
        0.45 + i * 0.045,
        0.38,
        -sign * (1.15 + i * 0.49),
        0,
        0.53,
        i % 2 ? "grey_clay" : "red_clay",
      );
    for (const x of [-1.45, 1.45]) {
      for (let i = 0; i < y.lattice; i++)
        add(
          "lat" + parts.length,
          "plank",
          0.052,
          0.94,
          0.08,
          x - 0.54 + (i * 1.08) / (y.lattice - 1),
          1.02,
          0.025,
        );
      for (const h of [1, 1.44, 1.98])
        add("rail" + parts.length, "plank", 1.22, 0.07, 0.08, x, h, 0.025);
    }
  }
  return buildObject({
    blueprint: {
      version: 1,
      catalogVersion: 1,
      seed: home.id + 17,
      name: "公民住宅",
      parts,
    },
    x: p.x + Math.sin(p.yaw) * (p.d / 2),
    z: p.z + Math.cos(p.yaw) * (p.d / 2),
    y: 0.09,
    yaw: p.yaw,
  });
}
export function civicPanel(
  scene: T.Scene,
  player: { x: number; y: number; z: number; angle: number },
  release: () => void,
  spawnResident: (
    id: number,
    x: number,
    z: number,
    yaw: number,
  ) => Promise<() => void>,
) {
  const el = (id: string) => document.getElementById(id)!,
    dlg = el("civicDialog") as HTMLDialogElement;
  const online = location.protocol !== "file:";
  let state: CivicState | undefined,
    homes: Home[] = [],
    busy = false,
    last = -Infinity;
  const guide = homeGuide(scene, player);
  let nearDoor: Door | null = null,
    doorBusy = false,
    lastFrame = 0;
  const interact = el("doorAction") as HTMLButtonElement;
  interact.onclick = async () => {
    if (!nearDoor || !state || doorBusy) return;
    const door = nearDoor;
    doorBusy = true;
    try {
      const v = (await api(
        `door/${door}/${state.home[door] ? "close" : "open"}`,
        true,
      )) as CivicState;
      state = v;
      homes = homes.map((h) => (h.id === v.home.id ? v.home : h));
      const o = visible.get(v.home.id);
      if (o) o.yard.opened[door] = v.home[door];
    } catch (e) {
      interact.textContent = (e as Error).message;
    } finally {
      doorBusy = false;
    }
  };
  const neighbors = new Map<number, { dispose?: () => void }>();
  const visible = new Map<
    number,
    {
      key: string;
      yard: ReturnType<typeof courtyard>;
      obj: ReturnType<typeof furnish>;
    }
  >();
  async function api(route: string, post = false) {
    const headers: Record<string, string> = {};
    if (post) {
      headers["Content-Type"] = "application/json";
      const provider = el("provider") as HTMLSelectElement,
        key = (el("modelKey") as HTMLInputElement).value.trim();
      if (
        (route === "roof" || route === "yard") &&
        provider.value === "go" &&
        key
      )
        headers.Authorization = "Bearer " + key;
    }
    const r = await fetch("/api/civic/" + route, {
      method: post ? "POST" : "GET",
      headers,
      cache: "no-store",
    });
    const v = await r.json();
    if (!r.ok) throw Error(v.error ?? "公民服务暂不可用");
    return v;
  }
  function render() {
    if (!state) return;
    guide.mark(
      state.home.id,
      plots[state.home.id],
      el("accountName").textContent || "公民",
    );
    const s = state,
      max = allowance(s.merit);
    el("civicTitle").textContent =
      `公民 ${String(s.no).padStart(4, "0")} · 等级 ${level(s.merit)}`;
    el("wallet").textContent =
      `${currency(s.balance)}　·　贡献 ${s.merit}　·　日薪 ${currency(income(s.merit))}`;
    el("tokenRecord").textContent =
      `今日精力 ${((max - s.spent) / tokensPerPoint).toFixed(6)} / ${max / tokensPerPoint} 点　·　已用 ${s.spent.toLocaleString()} token`;
    el("civicEnergy").textContent =
      `精力 ${((max - s.spent) / tokensPerPoint).toFixed(3)}`;
    el("occupancy").textContent =
      `住房 ${s.home.id + 1}　·　${s.home.yard ? "可入住" : "待完善"}　·　新居民 ${s.home.resident} / ${s.home.yard ? 1 : 0}`;
    for (const k of ["roof", "yard"] as const) {
      const b = el("task" + k) as HTMLButtonElement;
      b.textContent = s.home[k]
        ? tasks[k].name + " ✓"
        : `${tasks[k].name}　+${tasks[k].pay}工`;
      b.disabled =
        !!s.home[k] || busy || s.pending || (k === "yard" && !s.home.roof);
    }
    (el("admitResident") as HTMLButtonElement).disabled =
      busy || !s.home.yard || !!s.home.resident;
    el("civicLedger").replaceChildren(
      ...s.ledger.map((l) => {
        const li = document.createElement("li");
        li.textContent = `${l.event}　${l.amount < 0 ? "−" : "+"}${currency(Math.abs(l.amount))}${l.tokens ? "　" + l.tokens + " token" : ""}`;
        return li;
      }),
    );
  }
  async function refresh() {
    if (!online || document.hidden) return;
    try {
      [state, homes] = await Promise.all([api("state"), api("homes")]);
      if (state)
        window.dispatchEvent(
          new CustomEvent("civic-home", { detail: plots[state.home.id] }),
        );
      render();
    } catch (e) {
      el("civicFeedback").textContent = (e as Error).message;
    }
  }
  async function act(route: string) {
    if (busy) return;
    busy = true;
    render();
    el("civicFeedback").textContent =
      route === "resident"
        ? "正在办理入住…"
        : "DeepSeek 4.1 Flash 正在通过 OpenCode Go 设计…";
    try {
      state = await api(route, true);
      el("civicFeedback").textContent =
        route === "resident" ? "新居民已入住" : "已验收并发放报酬";
    } catch (e) {
      el("civicFeedback").textContent = (e as Error).message;
    } finally {
      busy = false;
      await refresh();
    }
  }
  window.addEventListener("gate-style-saved", () => void refresh());
  el("homeGateEdit").onclick = () => {
    if (state) {
      dlg.close();
      window.dispatchEvent(
        new CustomEvent("edit-gate", { detail: state.home.id }),
      );
    }
  };
  el("openCivic").onclick = () => {
    release();
    dlg.showModal();
    void refresh();
  };
  el("closeCivic").onclick = () => dlg.close();
  for (const k of ["roof", "yard"]) el("task" + k).onclick = () => void act(k);
  el("admitResident").onclick = () => void act("resident");
  el("findHouse").onclick = () => {
    if (!state) return;
    void guide.plan();
    dlg.close();
  };
  if (online) {
    void refresh();
    setInterval(() => void refresh(), 15000);
  } else el("openCivic").hidden = true;
  return {
    interact: () => {
      if (nearDoor) interact.click();
    },
    open: () => dlg.open,
    update(now: number) {
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      for (const o of visible.values()) o.yard.update(dt);
      if (state) {
        const p = plots[state.home.id];
        nearDoor =
          (["gate", "hall"] as const).find(
            (k) => Math.hypot(player.x - p.x, player.z - p.z - doorZ[k]) < 2.9,
          ) ?? null;
        interact.hidden = !nearDoor;
        if (nearDoor && !doorBusy)
          interact.textContent = `E · ${state.home[nearDoor] ? "关闭" : "推开"}${nearDoor === "gate" ? "院门" : "正房门"}`;
      }
      if (now - last < 450) return;
      last = now;
      const near = new Set<number>();
      for (const h of homes) {
        const p = plots[h.id];
        if (Math.hypot(player.x - p.x, player.z - p.z) > 205) continue;
        near.add(h.id);
        if (h.resident && !neighbors.has(h.id)) {
          const entry: { dispose?: () => void } = {};
          neighbors.set(h.id, entry);
          const depth = p.d / 2 + 2.2;
          void spawnResident(
            h.id,
            p.x + Math.sin(p.yaw) * depth,
            p.z + Math.cos(p.yaw) * depth,
            p.yaw,
          )
            .then((dispose) => {
              if (neighbors.get(h.id) === entry) entry.dispose = dispose;
              else dispose();
            })
            .catch(() => neighbors.delete(h.id));
        }
        const key = JSON.stringify([h.roof, h.yard, h.gateStyle]),
          prior = visible.get(h.id);
        if (prior?.key === key) {
          prior.yard.opened.gate = h.gate;
          prior.yard.opened.hall = h.hall;
          continue;
        }
        prior?.obj.dispose();
        prior?.yard.dispose();
        const obj = furnish(h);
        obj.group.userData = { asset: `home:${h.id}`, display: "住宅陈设" };
        scene.add(obj.group);
        const yard = courtyard(
          p,
          h.id,
          { gate: h.gate, hall: h.hall },
          h.gateStyle,
        );
        scene.add(yard.group);
        visible.set(h.id, { key, obj, yard });
      }
      for (const [id, o] of visible)
        if (!near.has(id)) {
          o.obj.dispose();
          o.yard.dispose();
          visible.delete(id);
        }
      for (const [id, entry] of neighbors)
        if (!near.has(id)) {
          entry.dispose?.();
          neighbors.delete(id);
        }
      guide.update();
    },
    blocks(x: number, z: number, y: number) {
      return [...visible.values()].some(
        (v) => v.obj.blocks(x, z, y) || v.yard.blocks(x, z, y),
      );
    },
  };
}
