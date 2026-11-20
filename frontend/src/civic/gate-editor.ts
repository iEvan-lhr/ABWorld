import { generationHeaders } from "../model-base.ts";
import * as T from "three";
import { gateLeaf } from "./gate-mesh.ts";
import { gateStyle, originalGate, type GateStyle } from "./gate-style.ts";
export async function responseJSON(r: Response) {
  const text = await r.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error(`请求未得到完整响应（HTTP ${r.status}），请刷新后重试。`);
  }
  if (!r.ok) throw Error(value?.error || `请求失败（HTTP ${r.status}）`);
  return value;
}
export function gateEditor(release: () => void) {
  const el = (id: string) => document.getElementById(id)!,
    field = (id: string) => el(id) as HTMLInputElement,
    dlg = el("gateEdit") as HTMLDialogElement,
    canvas = el("gatePreview") as HTMLCanvasElement;
  let home = -1,
    busy = false,
    epoch = 0,
    renderer: T.WebGLRenderer | undefined,
    preview: T.Group | undefined;
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(31, 1, 0.01, 50);
  scene.background = new T.Color("#e6dfcd");
  scene.add(new T.HemisphereLight(0xfff8e7, 0xb2a48f, 2.1));
  const sun = new T.DirectionalLight("#fff3d9", 2.8);
  sun.position.set(-2, 5, 4);
  scene.add(sun);
  camera.position.set(0.55, 1.43, 4.95);
  camera.lookAt(0, 1.03, 0);
  function value() {
    return gateStyle({
      finish: field("gateFinish").value,
      panels: field("gatePanels").value,
      hardware: field("gateHardware").value,
    });
  }
  function draw() {
    if (!dlg.open) return;
    renderer ??= new T.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    if (preview) scene.remove(preview);
    preview = new T.Group();
    for (const side of [-1, 1]) {
      const leaf = gateLeaf(side, value());
      leaf.position.x = side * 1.18;
      preview.add(leaf);
    }
    scene.add(preview);
    renderer.render(scene, camera);
  }
  function display(style: GateStyle) {
    field("gateFinish").value = style.finish;
    field("gatePanels").value = style.panels;
    field("gateHardware").value = style.hardware;
    draw();
  }
  for (const id of ["gateFinish", "gatePanels", "gateHardware"])
    field(id).onchange = draw;
  new ResizeObserver(() => {
    if (dlg.open) draw();
  }).observe(canvas);
  async function call(route: string, data?: unknown) {
    const headers: Record<string, string> = {};
    if (data) headers["Content-Type"] = "application/json";
    if (route === "preview") Object.assign(headers, generationHeaders());
    return responseJSON(
      await fetch(`/api/civic/gate/${home}/${route}`, {
        method: data ? "POST" : "GET",
        body: JSON.stringify(data),
        headers,
        cache: "no-store",
      }),
    );
  }
  function lock(v: boolean) {
    busy = v;
    for (const id of [
      "gateSuggest",
      "gateApply",
      "gatePanels",
      "gateFinish",
      "gateHardware",
    ])
      field(id).disabled = v;
  }
  async function open(id: number) {
    if (busy) return;
    home = id;
    const generation = ++epoch;
    release();
    dlg.showModal();
    lock(true);
    display(originalGate);
    el("gateNote").textContent = "读取当前院门…";
    try {
      const current = await call("current");
      if (generation === epoch) {
        display(gateStyle(current));
        el("gateNote").textContent = "";
      }
    } catch (e) {
      el("gateNote").textContent = (e as Error).message;
      return;
    } finally {
      lock(false);
    }
  }
  el("gateSuggest").onclick = async () => {
    if (busy) return;
    lock(true);
    el("gateNote").textContent = "正在生成院门方案…";
    try {
      const v = await call("preview", { prompt: field("gatePrompt").value });
      display(gateStyle(v.style));
      el("gateNote").textContent = `预览已生成 · ${v.tokens} token`;
    } catch (e) {
      el("gateNote").textContent = (e as Error).message;
    } finally {
      lock(false);
    }
  };
  el("gateApply").onclick = async () => {
    if (busy) return;
    lock(true);
    try {
      await call("apply", { style: value() });
      window.dispatchEvent(new Event("gate-style-saved"));
      dlg.close();
    } catch (e) {
      el("gateNote").textContent = (e as Error).message;
    } finally {
      lock(false);
    }
  };
  el("closeGateEdit").onclick = () => dlg.close();
  window.addEventListener(
    "edit-gate",
    (e) => void open((e as CustomEvent<number>).detail),
  );
  return open;
}
export function generationLog() {
  const dialog = document.querySelector<HTMLDialogElement>("#logDialog")!;
  async function show() {
    dialog.showModal();
    const list = document.getElementById("logList")!;
    list.textContent = "正在读取…";
    try {
      const { logs } = await responseJSON(
        await fetch("/api/civic/logs", { cache: "no-store" }),
      );
      list.replaceChildren();
      if (!logs.length)
        list.textContent = "暂无详细记录。新生成的请求会显示在这里。";
      for (const row of logs) {
        const a = document.createElement("article"),
          h = document.createElement("strong"),
          p = document.createElement("p");
        h.textContent = `${row.kind} · ${row.status}`;
        p.textContent = [
          row.stamp + " UTC",
          row.stage,
          row.http && "HTTP " + row.http,
          row.finish,
          row.tokens != null && row.tokens + " token",
          row.message,
        ]
          .filter(Boolean)
          .join(" · ");
        a.append(h, p);
        list.append(a);
      }
    } catch (e) {
      list.textContent = (e as Error).message;
    }
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>(
    "[data-open-logs]",
  ))
    b.onclick = show;
  document.getElementById("closeLog")!.onclick = () => dialog.close();
}
