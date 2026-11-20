import { hotbar } from "./hotbar.ts";
import { currentSave, saveProgress } from "../account.ts";
import {
  attributes,
  items,
  loadCharacter,
  tick,
  useItem,
  type ItemId,
} from "./character.ts";
export function characterPanel(release: () => void) {
  const state = loadCharacter(currentSave());
  const byId = (id: string) => document.getElementById(id)!;
  const panel = byId("characterPanel"),
    opener = byId("bagOpen"),
    message = byId("itemMessage");
  function save() {
    saveProgress(state);
  }
  const belt = hotbar(state, (id) => {
    const ok = useItem(state, id);
    if (ok) {
      save();
      render();
    }
    return ok;
  });
  window.addEventListener("save-character", save);
  const stats = ["health", "stamina", "hunger"] as const;
  const labels = { health: "生命", stamina: "体力", hunger: "饥饿" };
  const meters = stats.map((k) => {
    const row = document.createElement("label"),
      label = document.createElement("span"),
      bar = document.createElement("progress"),
      value = document.createElement("output");
    bar.max = 100;
    bar.className = k;
    label.textContent = labels[k];
    bar.setAttribute("aria-label", labels[k]);
    row.append(label, bar, value);
    byId("vitalBars").append(row);
    return { k, bar, value };
  });
  for (const k of Object.keys(attributes) as (keyof typeof attributes)[]) {
    const line = document.createElement("span");
    line.textContent = attributes[k] + " " + state.attributes[k];
    byId("attributeList").append(line);
  }
  const stacks = (Object.keys(items) as ItemId[]).map((id) => {
    const item = items[id],
      row = document.createElement("li"),
      info = document.createElement("span"),
      name = document.createElement("strong"),
      description = document.createElement("small"),
      button = document.createElement("button");
    description.textContent = item.description;
    info.append(name, description);
    button.textContent = "使用";
    button.setAttribute("aria-label", "使用" + item.name);
    button.onclick = () => {
      const used = useItem(state, id);
      message.textContent = used ? `已使用${item.name}` : "当前状态无需使用";
      if (used) save();
      render();
    };
    row.append(info, button);
    byId("inventoryList").append(row);
    return { id, name, button };
  });
  function render() {
    belt.render();
    for (const { k, bar, value } of meters) {
      const n = Math.round(state[k]);
      if (value.textContent !== String(n)) {
        bar.value = n;
        value.textContent = String(n);
      }
    }
    if (!panel.hidden)
      for (const { id, name, button } of stacks) {
        const item = items[id];
        name.textContent = item.name + " × " + state.bag[id];
        button.disabled =
          !state.bag[id] ||
          (item.change > 0 ? state[item.stat] >= 100 : state[item.stat] <= 0);
      }
  }
  function toggle(open: boolean) {
    panel.hidden = !open;
    opener.setAttribute("aria-expanded", String(open));
    if (open) {
      release();
      message.textContent = "";
      byId("bagClose").focus();
    } else opener.focus();
    render();
  }
  opener.onclick = () => toggle(panel.hidden);
  byId("bagClose").onclick = () => toggle(false);
  panel.onkeydown = (e) => {
    if (e.key === "Escape" || e.code === "KeyB") {
      e.preventDefault();
      e.stopPropagation();
      toggle(false);
    }
  };
  render();
  let elapsed = 0,
    refresh = 0;
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) save();
  });
  return {
    belt,
    open: () => !panel.hidden,
    toggle: () => toggle(panel.hidden),
    canRun: () => !state.exhausted,
    advance(dt: number, moving: boolean, running: boolean) {
      tick(state, dt, moving, running);
      elapsed += dt;
      refresh += dt;
      if (refresh >= 0.2) {
        render();
        refresh = 0;
      }
      if (elapsed >= 5) {
        save();
        elapsed = 0;
      }
    },
  };
}
