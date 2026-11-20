import {goBaseURL,goModel} from './go-provider.ts';
import { checkChat, models, type Connection } from "./workshop/model.ts";
export function modelSettings(release: () => void) {
  const id = <T extends HTMLElement>(s: string) =>
    document.getElementById(s) as T;
  const panel = id("workshop"),
    provider = id<HTMLSelectElement>("provider"),
    url = id<HTMLInputElement>("modelUrl"),
    model = id<HTMLInputElement>("modelId"),
    key = id<HTMLInputElement>("modelKey"),
    status = id("shopStatus");
  let active: AbortController | null = null;
  function saved(s: string) {
    try {
      return localStorage.getItem("abworld.model." + s) ?? "";
    } catch {
      return "";
    }
  }
  function store(s: string, v: string) {
    try {
      localStorage.setItem("abworld.model." + s, v);
    } catch {}
  }
  function restore() {
    const go = provider.value === "go";
    url.value = go
      ? goBaseURL
      : saved("url") || "http://127.0.0.1:11434/v1";
    url.readOnly = go;
    model.value = go ? goModel : saved("id");
    key.value = "";
    id("modelIds").replaceChildren();
    status.textContent = go ? "Evan 在本机可直接使用已有 Go 订阅。" : "";
  }
  provider.value =
    saved("provider") === "custom" &&
    saved("url") &&
    !saved("url").includes("11434")
      ? "custom"
      : "go";
  restore();
  function remember() {
    store("provider", provider.value);
    if (provider.value !== "go") store("url", url.value.trim());
    store(provider.value === "go" ? "goId" : "id", model.value.trim());
  }
  function toggle(show: boolean) {
    panel.hidden = !show;
    id("openShop").setAttribute("aria-expanded", String(show));
    if (show) {
      release();
      provider.focus();
    } else {
      active?.abort();
      remember();
      id("openShop").focus();
    }
  }
  id("openShop").onclick = () => toggle(panel.hidden);
  id("shopClose").onclick = () => toggle(false);
  panel.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") toggle(false);
  };
  provider.onchange = () => {
    restore();
    remember();
  };
  url.oninput = () => {
    key.value = "";
  };
  model.onchange = url.onchange = remember;
  async function run(list: boolean) {
    if (active) return;
    const ctrl = new AbortController();
    active = ctrl;
    const c: Connection = {
      go: provider.value === "go",
      url: url.value.trim(),
      key: key.value.trim(),
      model: model.value.trim(),
    };
    const controls = [
      provider,
      url,
      key,
      model,
      id<HTMLButtonElement>("loadModels"),
      id<HTMLButtonElement>("checkModel"),
    ];
    controls.forEach((e) => (e.disabled = true));
    const timer = setTimeout(() => ctrl.abort(), 120000);
    status.textContent = "连接中…";
    try {
      if (list) {
        const ids = await models(c, ctrl.signal);
        id("modelIds").replaceChildren(...ids.map((n) => new Option(n, n)));
        if (!model.value && ids.length) model.value = ids[0];
        status.textContent = `读取到 ${ids.length} 个模型，可在模型名称栏选择。`;
      } else {
        await checkChat(c, ctrl.signal);
        status.textContent = "对话连接成功。";
      }
      remember();
    } catch (e) {
      status.textContent = ctrl.signal.aborted
        ? "连接已取消或超时"
        : (e as Error).message;
    } finally {
      clearTimeout(timer);
      controls.forEach((e) => (e.disabled = false));
      active = null;
    }
  }
  id("loadModels").onclick = () => void run(true);
  id("checkModel").onclick = () => void run(false);
  return () => !panel.hidden;
}
