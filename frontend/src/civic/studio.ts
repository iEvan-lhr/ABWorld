import { conversation } from "./conversation.ts";
import { placementUI } from "./placement-ui.ts";
import { responseJSON } from "./gate-editor.ts";
import { designView } from "./design-view.ts";
import type { SceneContext } from "./focus.ts";
import * as T from "three";
import plots from "../data/civic-homes.json";
import { anchors, type Anchor } from "./creations.ts";
import { buildObject } from "../workshop/geometry.ts";
import type { Blueprint } from "../workshop/blueprint.ts";
import type { CivicState } from "./rules.ts";
interface Product {
  id: number;
  uid: number;
  home: number;
  anchor: Anchor | null;
  position?: string | null;
  mode: string;
  hash: string;
  blueprint: Blueprint;
  state: string;
  stock: number;
  price: number;
  quantity?: number;
  author?: string;
  stamp: string;
}
export function studio(
  scene: T.Scene,
  player: { x: number; z: number },
  release: () => void,
) {
  const $ = (s: string) => document.getElementById(s)!,
    field = (s: string) => $(s) as HTMLInputElement,
    dlg = $("studio") as HTMLDialogElement,
    hint = $("studioNotice"),
    world = new Map<number, ReturnType<typeof buildObject>>();
  const view = designView();
  let context: SceneContext | undefined,
    previewId = 0;
  let clockAt = Date.now(),
    synced = performance.now(),
    collecting = false;
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  function clock() {
    const d = clockAt + performance.now() - synced;
    $("worldTime").textContent = fmt.format(d);
    $("worldTime").setAttribute("datetime", new Date(d).toISOString());
  }
  clock();
  setInterval(clock, 1000);
  const online = location.protocol !== "file:";
  async function timeSync() {
    if (!online) return;
    try {
      const before = performance.now(),
        r = await fetch("/api/world/time", { cache: "no-store" }),
        v = await r.json();
      if (Number.isFinite(v.epoch)) {
        clockAt = v.epoch + (performance.now() - before) / 2;
        synced = performance.now();
        clock();
      }
    } catch {}
  }
  void timeSync();
  setInterval(timeSync, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void timeSync();
  });
  async function api(path: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/json";
    if (
      path === "design" &&
      field("provider").value === "go" &&
      field("modelKey").value.trim()
    )
      headers.Authorization = "Bearer " + field("modelKey").value.trim();
    const r = await fetch("/api/civic/creations/" + path, {
      method: body ? "POST" : "GET",
      headers,
      cache: "no-store",
      body: body ? JSON.stringify(body) : undefined,
    });
    const v = await responseJSON(r);
    if (!r.ok) throw Error(v.error || "保存失败");
    return v;
  }
  const button = (label: string, fn: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = fn;
    return b;
  };
  function exportJSON(data: unknown, name: string) {
    const u = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = name + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  async function perform(fn: () => Promise<void>) {
    if (collecting) return;
    collecting = true;
    dlg.setAttribute("aria-busy", "true");
    try {
      await fn();
      await refresh();
      void loadWorld();
    } catch (e) {
      hint.textContent = (e as Error).message;
    } finally {
      collecting = false;
      dlg.removeAttribute("aria-busy");
    }
  }
  function card(p: Product, kind: "mine" | "market" | "bought") {
    const row = document.createElement("article"),
      title = document.createElement("strong"),
      details = document.createElement("p");
    title.textContent = p.blueprint.name;
    details.textContent = `${p.mode === "unique" ? "独一件" : "量产款"} · ${p.position ? "已选坐标" : p.anchor ? anchors[p.anchor].label : "待摆放"} · ${kind === "market" ? p.price + " 工 / 件，余 " + p.stock + " 件" : kind === "bought" ? "已购 " + p.quantity + " 件" : p.state + " · " + p.stamp + " UTC"}`;
    row.append(
      title,
      details,
      button("查看模型", () => view.preview(p.blueprint)),
    );
    if (kind === "mine") {
      row.append(
        button("导出设计", () =>
          exportJSON(
            {
              version: 1,
              model: p.blueprint,
              home: p.home,
              anchor: p.anchor,
              mode: p.mode,
              hash: p.hash,
            },
            p.blueprint.name,
          ),
        ),
      );
      if (p.state === "草案")
        row.append(
          button(
            "选择位置摆放",
            () =>
              void placement(p).catch((e) => (hint.textContent = e.message)),
          ),
        );
      if (p.mode === "batch") {
        const quantity = document.createElement("input"),
          price = document.createElement("input");
        for (const [el, name] of [
          [quantity, "数量"],
          [price, "单价（工）"],
        ] as const) {
          const label = document.createElement("label");
          label.textContent = name;
          el.type = "number";
          el.min = "1";
          el.value = "1";
          label.append(el);
          row.append(label);
        }
        row.append(
          button(
            "生产并上架",
            () =>
              void perform(async () => {
                await api("stock", {
                  id: p.id,
                  quantity: Number(quantity.value),
                  price: Number(price.value),
                });
                hint.textContent = "已上架";
              }),
          ),
        );
      }
    } else if (kind === "market")
      row.append(
        button(
          "购买一件",
          () =>
            void perform(async () => {
              await api("buy", { id: p.id });
              hint.textContent = "已收入藏品";
            }),
        ),
      );
    return row;
  }
  async function refresh() {
    const [v, s] = await Promise.all([
      api("mine"),
      fetch("/api/civic/state", { cache: "no-store" }).then((r) =>
        r.json(),
      ) as Promise<CivicState>,
    ]);
    const shelf = $("myWorks");
    view.layout(
      v.mine
        .filter((p: Product) => p.state === "已摆放")
        .map((p: Product) => p.anchor)
        .filter((a: Anchor | null) => !!a),
    );
    if (previewId) {
      const newest = v.mine.find((p: Product) => p.id === previewId);
      if (newest) view.preview(newest.blueprint);
      previewId = 0;
    }
    shelf.replaceChildren();
    const home = document.createElement("article");
    const name = document.createElement("strong");
    name.textContent = "我的庭院住宅";
    home.append(
      name,
      button("导出住宅布局", () =>
        exportJSON(
          { version: 1, plot: plots[s.home.id], design: s.home, anchors },
          "我的庭院住宅",
        ),
      ),
    );
    shelf.append(
      home,
      ...v.mine.map((p: Product) => card(p, "mine")),
      ...v.bought.map((p: Product) => card(p, "bought")),
    );
    $("marketWorks").replaceChildren(
      ...v.market.map((p: Product) => card(p, "market")),
    );
    if (!v.market.length) $("marketWorks").textContent = "暂无在售作品";
  }
  async function loadWorld() {
    if (!online || document.hidden) return;
    try {
      const list: Product[] = await api("world");
      const kept = new Set<number>();
      for (const p of list) {
        const h = plots[p.home],
          a = p.anchor ? anchors[p.anchor] : null,
          pos = p.position
            ? JSON.parse(p.position)
            : a && h
              ? { x: h.x + a.x, z: h.z + a.z, y: 0.14, yaw: 0 }
              : null;
        if (!pos || Math.hypot(pos.x - player.x, pos.z - player.z) > 210)
          continue;
        kept.add(p.id);
        if (world.has(p.id)) continue;
        const obj = buildObject({ blueprint: p.blueprint, ...pos });
        obj.group.userData = {
          asset: `work:${p.id}`,
          display: p.blueprint.name,
        };
        world.set(p.id, obj);
        scene.add(obj.group);
      }
      for (const [id, obj] of world)
        if (!kept.has(id)) {
          obj.dispose();
          world.delete(id);
        }
    } catch {}
  }
  if (online) {
    void loadWorld();
    setInterval(loadWorld, 4000);
  } else $("openStudio").hidden = true;
  function show(ctx?: SceneContext) {
    context = ctx;
    const homeEdit = $("studioGateEdit");
    const match = ctx && /^home:(\d+)$/.exec(ctx.target.id);
    homeEdit.hidden = !match;
    homeEdit.onclick = () => {
      if (match) {
        dlg.close();
        window.dispatchEvent(
          new CustomEvent("edit-gate", { detail: Number(match[1]) }),
        );
      }
    };
    $("sceneContext").textContent = ctx
      ? `关联 ${ctx.target.name}（${ctx.target.id}），周围 ${ctx.nearby.length} 个物件`
      : "所属空间 · 我的住宅";
    $("renameAsset").hidden = !ctx;

    release();
    dlg.showModal();
    refresh().catch((e) => (hint.textContent = e.message));
  }
  $("openStudio").onclick = () => show();
  $("renameAsset").onclick = () =>
    void perform(async () => {
      const label = field("assetLabel").value.trim();
      if (!context || !label) return;
      const r = await fetch("/api/civic/access/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset: context.target.id, label }),
      });
      if (!r.ok) throw Error((await r.json()).error);
      hint.textContent = "物件名称已更新";
    });
  $("closeStudio").onclick = () => dlg.close();
  $("designForm").onsubmit = (e) => {
    e.preventDefault();
    void perform(async () => {
      hint.textContent = "DeepSeek 正在根据尺寸和住宅布局设计…";
      const result = await api("design", {
        context,
        length: Number(field("objectL").value),
        width: Number(field("objectW").value),
        height: Number(field("objectH").value),
        anchor: field("anchor").value,
        mode: field("edition").value,
        prompt: field("objectPrompt").value,
      });
      previewId = result.id;
      hint.textContent = `草案已保存 · 本次 ${result.tokens} token`;
    });
  };
  const placement = placementUI(api, async () => {
    hint.textContent = "已摆放并保存";
    await refresh();
    await loadWorld();
  });
  const quick = $("quickCreate") as HTMLDialogElement;
  const launchNew = conversation(api, view.preview, placement, () => {
    release();
    if (dlg.open) dlg.close();
  });
  $("quickOpen").onclick = () => launchNew();
  return {
    newItem: launchNew,
    fromSelection: show,
    open: () => dlg.open || quick.open,
    blocks: (x: number, z: number, y: number) =>
      [...world.values()].some((o) => o.blocks(x, z, y)),
  };
}
