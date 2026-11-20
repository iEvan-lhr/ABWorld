import * as T from "three";
import { buildObject } from "../workshop/geometry.ts";
import type { Blueprint } from "../workshop/blueprint.ts";
import { creationTypes } from "./regions.ts";
interface Work {
  id: number;
  blueprint: Blueprint;
  category?: string;
  mode: string;
  state: string;
  hash: string;
}
interface Turn {
  id: number;
  kind: string;
  status: string;
  stage: string;
  prompt: string | null;
  product: number | null;
  tokens: number | null;
  message: string | null;
  stamp: string;
  category: string | null;
  edition: string | null;
}
export function conversation(
  api: (path: string, body?: unknown) => Promise<any>,
  preview: (b: Blueprint) => void,
  place: (p: any) => Promise<void>,
  release: () => void,
) {
  const get = (id: string) => document.getElementById(id)!,
    input = (id: string) => get(id) as HTMLInputElement,
    button = (id: string) => get(id) as HTMLButtonElement;
  const dialog = get("quickCreate") as HTMLDialogElement,
    thread = get("chatTurns"),
    gallery = get("chatGallery"),
    turntable = get("turntable"),
    home = turntable.parentElement!,
    note = get("quickNote");
  let works: Work[] = [],
    turns: Turn[] = [],
    selected: Work | undefined,
    more = false,
    busy = false,
    choosing = false,
    version = 0;
  const group = new Set<number>();
  const thumbs = new Map<string, string>();
  let renderer: T.WebGLRenderer | undefined;
  const images = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        images.unobserve(e.target);
        const img = e.target as HTMLImageElement,
          w = works.find((w) => w.id === Number(img.dataset.id));
        if (!w) continue;
        try {
          let url = thumbs.get(w.hash);
          if (!url) {
            renderer ??= new T.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setSize(165, 110, false);
            const scene = new T.Scene(),
              camera = new T.PerspectiveCamera(33, 1.5, 0.005, 150),
              model = buildObject({
                blueprint: w.blueprint,
                x: 0,
                y: 0,
                z: 0,
                yaw: 0,
              });
            scene.add(
              model.group,
              new T.HemisphereLight("#fff9e9", "#aab09a", 2.3),
            );
            const sun = new T.DirectionalLight("#fff7dc", 2.3);
            sun.position.set(3, 6, 4);
            scene.add(sun);
            const box = new T.Box3().setFromObject(model.group),
              center = box.getCenter(new T.Vector3()),
              r = Math.max(0.1, box.getSize(new T.Vector3()).length()) * 1.65;
            camera.position
              .copy(center)
              .addScaledVector(new T.Vector3(0.72, 0.45, 0.86).normalize(), r);
            camera.lookAt(center);
            renderer.render(scene, camera);
            url = renderer.domElement.toDataURL("image/png");
            model.dispose();
            if (thumbs.size >= 120) thumbs.delete(thumbs.keys().next().value!);
            thumbs.set(w.hash, url);
          }
          img.src = url;
        } catch {
          img.alt = w.blueprint.name;
        }
      }
    },
    { root: gallery },
  );
  const cat = (v: string | null | undefined) =>
    creationTypes[v as keyof typeof creationTypes] ?? "作品";
  function show(w: Work) {
    selected = w;
    get("chatDetail").hidden = false;
    get("quickPreview").append(turntable);
    preview(w.blueprint);
    get("chosenWork").textContent = w.blueprint.name;
    button("quickPlace").hidden = w.state !== "草案";
  }
  function cards() {
    images.disconnect();
    gallery.replaceChildren();
    get("chatCount").textContent = String(works.length);
    for (const w of works) {
      const b = document.createElement("button"),
        img = document.createElement("img"),
        title = document.createElement("strong"),
        meta = document.createElement("small");
      b.type = "button";
      b.className = "workTile";
      b.dataset.workId = String(w.id);
      b.setAttribute("aria-pressed", String(group.has(w.id)));
      if (choosing)
        b.disabled =
          w.state === "已组合" || (w.mode === "unique" && w.state !== "草案");
      img.alt = w.blueprint.name;
      img.dataset.id = String(w.id);
      title.textContent = w.blueprint.name;
      meta.textContent = `${cat(w.category)} · ${w.mode === "unique" ? "独一件" : w.state}`;
      b.append(img, title, meta);
      if (choosing) {
        const check = document.createElement("i");
        check.textContent = group.has(w.id) ? "✓" : "○";
        b.append(check);
      }
      b.onclick = () => {
        if (!choosing) {
          show(w);
          return;
        }
        if (group.has(w.id)) group.delete(w.id);
        else if (group.size < 8) group.add(w.id);
        cards();
      };
      gallery.append(b);
      images.observe(img);
    }
    if (!works.length) gallery.textContent = "作品生成后会保存在这里。";
    get("assemblyControls").hidden = !choosing;
    button("assembleConfirm").disabled = busy || group.size < 2;
    button("assembleConfirm").textContent = `生成组合（${group.size}）`;
    const hasUnique = works.some((w) => group.has(w.id) && w.mode === "unique");
    get("uniqueConsent").hidden = !hasUnique;
    button("combineSelect").textContent = choosing ? "取消选择" : "组合作品";
  }
  function renderHistory(scroll = true) {
    const old = thread.scrollHeight;
    thread.replaceChildren();
    button("olderTurns").hidden = !more;
    if (!turns.length) {
      const welcome = document.createElement("p");
      welcome.className = "chatEmpty";
      welcome.textContent = "今天想做一件什么物品？";
      thread.append(welcome);
    }
    for (const t of [...turns].reverse()) {
      if (t.prompt) {
        const u = document.createElement("div");
        u.className = "chatUser";
        u.textContent = t.prompt;
        thread.append(u);
      }
      const row = document.createElement("article"),
        stamp = document.createElement("small"),
        msg = document.createElement("p");
      row.className = "chatReply";
      const w = works.find((w) => w.id === t.product);
      stamp.textContent = `${t.kind} · ${new Date(t.stamp.replace(" ", "T") + "Z").toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}${t.tokens != null ? " · " + t.tokens.toLocaleString() + " token" : ""}`;
      msg.textContent =
        t.status === "失败"
          ? t.message || "生成失败"
          : w
            ? t.message || `已保存「${w.blueprint.name}」`
            : t.status + " · " + t.stage;
      row.append(stamp, msg);
      if (w) {
        const b = document.createElement("button");
        b.textContent = "查看作品";
        b.onclick = () => show(w);
        row.append(b);
      }
      if (t.status === "失败" && t.prompt) {
        const b = document.createElement("button");
        b.textContent = "再编辑";
        b.onclick = () => {
          input("quickPrompt").value = t.prompt!;
          input("quickPrompt").focus();
        };
        row.append(b);
      }
      thread.append(row);
    }
    if (scroll) thread.scrollTop = thread.scrollHeight;
    else thread.scrollTop += thread.scrollHeight - old;
  }
  async function refresh(id?: number) {
    const seq = ++version;
    const [saved, h] = await Promise.all([api("mine"), api("history")]);
    if (seq !== version) return;
    works = saved.mine;
    turns = h.entries;
    more = h.more;
    cards();
    renderHistory();
    if (id) {
      const w = works.find((p) => p.id === id);
      if (w && dialog.open) show(w);
    } else if (selected) {
      selected = works.find((w) => w.id === selected?.id);
      if (selected && dialog.open) show(selected);
    }
  }
  async function run(action: () => Promise<any>) {
    if (busy) return;
    busy = true;
    button("quickSubmit").disabled = true;
    button("assembleConfirm").disabled = true;
    let result;
    try {
      result = await action();
      note.textContent = "";
    } catch (e) {
      note.textContent = (e as Error).message;
    } finally {
      try {
        await refresh(result?.id);
      } catch (e) {
        note.textContent = (e as Error).message;
      }
      busy = false;
      button("quickSubmit").disabled = false;
      cards();
    }
  }
  button("olderTurns").onclick = async () => {
    const last = turns.at(-1);
    if (!last) return;
    button("olderTurns").disabled = true;
    try {
      const v = await api("history?before=" + last.id);
      turns.push(
        ...v.entries.filter((r: Turn) => !turns.some((x) => x.id === r.id)),
      );
      more = v.more;
      renderHistory(false);
    } catch (e) {
      note.textContent = (e as Error).message;
    } finally {
      button("olderTurns").disabled = false;
    }
  };
  button("combineSelect").onclick = () => {
    choosing = !choosing;
    group.clear();
    input("consumeUnique").checked = false;
    cards();
  };
  button("assembleConfirm").onclick = () =>
    void run(async () => {
      note.textContent = "正在组合作品…";
      const result = await api("combine", {
        ids: [...group],
        arrangement: input("arrangement").value,
        name: input("assemblyName").value.trim(),
        mode: input("quickUnique").checked ? "unique" : "batch",
        consumeUnique: input("consumeUnique").checked,
      });
      choosing = false;
      group.clear();
      input("consumeUnique").checked = false;
      return result;
    });
  button("closePreview").onclick = () => {
    get("chatDetail").hidden = true;
    selected = undefined;
  };
  button("quickPlace").onclick = () => {
    if (selected)
      void place(selected).catch((e) => (note.textContent = e.message));
  };
  button("quickClose").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    home.insertBefore(turntable, get("myWorks").previousElementSibling);
  });
  const form = get("quickForm") as HTMLFormElement;
  form.onsubmit = (e) => {
    e.preventDefault();
    const prompt = input("quickPrompt").value.trim();
    if (!prompt || busy) return;
    void run(async () => {
      note.textContent = "模型正在设计…";
      const bubble = document.createElement("div");
      bubble.className = "chatUser";
      bubble.textContent = prompt;
      thread.append(bubble);
      thread.scrollTop = thread.scrollHeight;
      const result = await api("design", {
        flow: "new",
        prompt,
        mode: input("quickUnique").checked ? "unique" : "batch",
        category: input("quickType").value,
      });
      if (input("quickPrompt").value.trim() === prompt)
        input("quickPrompt").value = "";
      return result;
    });
  };
  input("quickPrompt").onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  };
  return (edit?: () => void, name?: string) => {
    release();
    dialog.showModal();
    const providerName = get("chatProviderName");
    if (providerName)
      providerName.textContent = input("modelId").value.trim() || "AI 创作";
    const b = button("quickEdit");
    b.hidden = !edit;
    b.textContent = `修改${name ?? "选中物件"}`;
    b.onclick = () => {
      dialog.close();
      edit?.();
    };
    void refresh().catch((e) => (note.textContent = e.message));
    input("quickPrompt").focus();
  };
}
