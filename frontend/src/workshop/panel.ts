import * as T from "three";
import {
  bounds,
  conflicts,
  type Saved,
  type Blueprint,
  type Placement,
} from "./blueprint.ts";
import { generate, models } from "./model.ts";
import { buildObject } from "./geometry.ts";
import { checkSite } from "./site.ts";
export function startWorkshop(
  scene: T.Scene,
  player: { x: number; y: number; z: number; angle: number },
  floor: (x: number, z: number, y: number) => number | null,
  release: () => void,
) {
  const el = <E extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as E;
  const field = (id: string) => el<HTMLInputElement>(id);
  const btn = (id: string) => el<HTMLButtonElement>(id);
  const panel = el("workshop"),
    note = (s: string) => (el("shopStatus").textContent = s);
  const online = location.protocol !== "file:",
    localKey = "abworld.objects.v1";
  let local: Saved[] = [];
  try {
    if (!online) local = JSON.parse(localStorage.getItem(localKey) ?? "[]");
    field("modelUrl").value =
      localStorage.getItem("abworld.model.url") || field("modelUrl").value;
    field("modelId").value = localStorage.getItem("abworld.model.id") || "";
  } catch {}
  const connection = () => ({
    url: field("modelUrl").value.trim(),
    model: field("modelId").value.trim(),
    key: field("modelKey").value.trim(),
  });
  const remember = () => {
    try {
      localStorage.setItem("abworld.model.url", connection().url);
      localStorage.setItem("abworld.model.id", connection().model);
    } catch {}
  };
  const shown = new Map<
    number,
    { model: ReturnType<typeof buildObject>; area: ReturnType<typeof bounds> }
  >();
  function add(p: Saved) {
    if (shown.has(p.id)) return;
    const model = buildObject(p);
    scene.add(model.group);
    shown.set(p.id, { model, area: bounds(p) });
  }
  async function sync() {
    if (document.hidden) return;
    try {
      let rows: Saved[];
      if (online) {
        const res = await fetch(
          `/api/world/objects?x=${Math.round(player.x)}&z=${Math.round(player.z)}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (!res.ok) throw Error();
        rows = await res.json();
      } else
        rows = local.filter(
          (p) =>
            Math.abs(p.x - player.x) <= 240 && Math.abs(p.z - player.z) <= 240,
        );
      const ids = new Set(rows.map((p) => p.id));
      for (const [id, o] of shown)
        if (!ids.has(id)) {
          o.model.dispose();
          shown.delete(id);
        }
      rows.forEach(add);
      el("worldMode").textContent = online
        ? "共享世界 · 附近 " + shown.size + " 件营造物"
        : "本机存档 · 附近 " + shown.size + " 件营造物";
    } catch {
      el("worldMode").textContent = "世界同步暂不可用";
    }
  }
  let syncing = false;
  async function refresh() {
    if (syncing) return;
    syncing = true;
    try {
      await sync();
    } finally {
      syncing = false;
    }
  }
  void refresh();
  setInterval(() => void refresh(), 2500);
  let abort: AbortController | null = null,
    ghost: ReturnType<typeof buildObject> | undefined,
    bp: Blueprint | undefined,
    p: Placement | undefined,
    rotation = 0,
    placing = false;
  function clearPreview() {
    ghost?.dispose();
    ghost = undefined;
    p = undefined;
    bp = undefined;
    el("placement").hidden = true;
  }
  function preview() {
    if (!bp) return;
    ghost?.dispose();
    const forward = Number(field("buildDistance").value),
      side = Number(field("buildSide").value),
      s = Math.sin(player.angle),
      c = Math.cos(player.angle),
      x = player.x + s * forward - c * side,
      z = player.z + c * forward + s * side;
    const y = floor(x, z, player.y);
    p = { blueprint: bp, x, y: y ?? player.y, z, yaw: player.angle + rotation };
    ghost = buildObject(p);
    scene.add(ghost.group);
    let ok = true;
    let message = `${bp.name} · 确认后放入世界`;
    const a = bounds(p);
    try {
      checkSite(p, floor);
      if ([...shown.values()].some((o) => conflicts(a, o.area)))
        throw Error("与已放置物件重叠");
      if (
        player.x >= a.minX - 0.31 &&
        player.x <= a.maxX + 0.31 &&
        player.z >= a.minZ - 0.31 &&
        player.z <= a.maxZ + 0.31
      )
        throw Error("物件离人物太近");
    } catch (e) {
      ok = false;
      message = (e as Error).message;
    }
    ghost.group.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.material.transparent = true;
        o.material.opacity = 0.7;
        if (!ok) o.material.color.set("#bb4c3d");
      }
    });
    btn("place").disabled = !ok;
    note(message);
  }
  function open(value: boolean) {
    if (placing) return;
    panel.hidden = !value;
    btn("openShop").setAttribute("aria-expanded", String(value));
    if (value) {
      release();
      if (bp) preview();
    } else {
      abort?.abort();
      if (ghost) ghost.group.visible = false;
      btn("openShop").focus();
    }
  }
  btn("openShop").onclick = () => open(panel.hidden);
  btn("shopClose").onclick = () => open(false);
  panel.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") open(false);
  });
  field("modelUrl").oninput = () => {
    field("modelKey").value = "";
    el("modelIds").replaceChildren();
  };
  async function job(f: (signal: AbortSignal) => Promise<void>) {
    if (abort || placing) return;
    const active = new AbortController();
    abort = active;
    btn("make").disabled = btn("loadModels").disabled = true;
    btn("stopGen").hidden = false;
    const timeout = setTimeout(
      () => active.abort(new Error("模型响应超时")),
      180000,
    );
    try {
      await f(active.signal);
      remember();
    } catch (e) {
      note(
        active.signal.aborted
          ? active.signal.reason?.name === "AbortError"
            ? "已取消"
            : String(active.signal.reason)
          : (e as Error).message,
      );
    } finally {
      clearTimeout(timeout);
      abort = null;
      btn("make").disabled = btn("loadModels").disabled = false;
      btn("stopGen").hidden = true;
    }
  }
  btn("stopGen").onclick = () => abort?.abort();
  btn("loadModels").onclick = () =>
    void job(async (signal) => {
      note("正在连接模型服务…");
      const list = await models(connection(), signal);
      el("modelIds").replaceChildren(...list.map((id) => new Option(id, id)));
      if (list.length && !list.includes(field("modelId").value))
        field("modelId").value =
          list.find((id) => /minicpm|qwen|llama|gemma/i.test(id)) ?? list[0];
      note(
        list.length
          ? `已连接，读取到 ${list.length} 个模型。`
          : "服务中尚无可用模型",
      );
    });
  btn("make").onclick = () =>
    void job(async (signal) => {
      clearPreview();
      note("模型正在设计物件…");
      bp = await generate(connection(), field("design").value, signal);
      rotation = 0;
      el("placement").hidden = false;
      panel.querySelector("details")!.open = false;
      preview();
    });
  field("buildDistance").oninput = field("buildSide").oninput = preview;
  btn("rotate").onclick = () => {
    rotation += Math.PI / 12;
    preview();
  };
  btn("place").onclick = async () => {
    if (!p || placing || abort) return;
    placing = true;
    btn("place").disabled = true;
    const target = p;
    try {
      let saved: Saved;
      if (online) {
        const r = await fetch("/api/world/objects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(target),
        });
        const data = await r.json();
        if (!r.ok) throw Error(data.error ?? "放置失败");
        saved = data;
      } else {
        saved = { ...target, id: Date.now() };
        const next = [...local, saved];
        localStorage.setItem(localKey, JSON.stringify(next));
        local = next;
      }
      add(saved);
      clearPreview();
      note(`已放置「${saved.blueprint.name}」`);
      void refresh();
    } catch (e) {
      note((e as Error).message);
      btn("place").disabled = false;
    } finally {
      placing = false;
    }
  };
  return {
    blocks(x: number, z: number, y: number) {
      for (const { model, area: a } of shown.values())
        if (
          x >= a.minX - 0.31 &&
          x <= a.maxX + 0.31 &&
          z >= a.minZ - 0.31 &&
          z <= a.maxZ + 0.31 &&
          model.blocks(x, z, y)
        )
          return true;
      return false;
    },
    active: () => !panel.hidden,
  };
}
