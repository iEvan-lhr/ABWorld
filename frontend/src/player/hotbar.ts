import { items, type ItemId, type Character } from "./character.ts";
export function hotbar(state: Character, use: (id: ItemId) => boolean) {
  const container = document.getElementById("slots")!,
    hint = document.getElementById("slotHint")!;
  const ids: (ItemId | null)[] = [
    "cake",
    "tea",
    "medicine",
    null,
    null,
    null,
    null,
    null,
    null,
  ];
  let selected = 0;
  const buttons = ids.map((id, i) => {
    const b = document.createElement("button");
    const key = document.createElement("kbd"),
      name = document.createElement("span"),
      count = document.createElement("b");
    key.textContent = String(i + 1);
    name.textContent = id ? items[id].name : "";
    b.setAttribute("aria-label", `${i + 1} ${id ? items[id].name : "空格"}`);
    b.append(key, name, count);
    b.onclick = () => {
      if (selected === i) activate();
      else select(i);
    };
    container.append(b);
    return { b, count };
  });
  function render() {
    buttons.forEach(({ b, count }, i) => {
      const id = ids[i];
      b.setAttribute("aria-pressed", String(i === selected));
      const qty = id ? String(state.bag[id]) : "";
      if (count.textContent !== qty) count.textContent = qty;
    });
  }
  function select(i: number) {
    selected = (i + 9) % 9;
    const id = ids[selected];
    hint.textContent = id
      ? `${items[id].name} · ${items[id].description}`
      : "空栏位";
    render();
  }
  function activate() {
    const id = ids[selected];
    if (!id) {
      hint.textContent = "空栏位";
      return;
    }
    hint.textContent = !state.bag[id]
      ? "道具已用完"
      : use(id)
        ? `已使用${items[id].name}`
        : "当前状态无需使用";
    render();
  }
  render();
  return {
    render,
    select,
    activate,
    scroll: (n: number) => select(selected + n),
  };
}
