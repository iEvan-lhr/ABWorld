import overview from "../data/city-overview.json";
import { tasks, type Task } from "./rules.ts";
interface Candidate {
  id: number;
  x: number;
  z: number;
  district: string;
  quarter: string;
  mine: boolean;
  stage: Task;
}
export function repairPicker(
  player: { x: number; z: number },
  load: () => Promise<Candidate[]>,
  start: (route: string) => Promise<void>,
) {
  const dialog = document.getElementById("repairPicker") as HTMLDialogElement,
    filter = document.getElementById("repairFilter") as HTMLSelectElement,
    select = document.getElementById("repairHouse") as HTMLSelectElement,
    confirm = document.getElementById("repairConfirm") as HTMLButtonElement,
    detail = document.getElementById("repairDetails")!,
    canvas = document.getElementById("repairMap") as HTMLCanvasElement,
    g = canvas.getContext("2d")!,
    image = new Image();
  let candidates: Candidate[] = [],
    filtered: Candidate[] = [],
    selected: Candidate | undefined,
    seq = 0;
  const area = (p: Candidate) => p.district + " · " + p.quarter,
    dist = (p: Candidate) =>
      Math.round(Math.hypot(p.x - player.x, p.z - player.z));
  const pixels = new Map<number, [number, number]>();
  function draw() {
    if (!dialog.open) return;
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.fillStyle = "#d8dac4";
    g.fillRect(0, 0, w, h);
    pixels.clear();
    if (!filtered.length) return;
    const xs = filtered.map((p) => p.x),
      zs = filtered.map((p) => p.z),
      left = Math.min(...xs),
      top = Math.min(...zs),
      right = Math.max(...xs),
      bottom = Math.max(...zs),
      scale = Math.min(
        (w - 32) / Math.max(85, right - left),
        (h - 32) / Math.max(85, bottom - top),
      );
    const X = (x: number) => w / 2 + (x - (left + right) / 2) * scale,
      Y = (z: number) => h / 2 + (z - (top + bottom) / 2) * scale;
    if (image.complete && image.naturalWidth)
      g.drawImage(image, X(-4096), Y(-3776), 8192 * scale, 8448 * scale);
    for (const p of filtered) {
      const x = X(p.x),
        y = Y(p.z);
      pixels.set(p.id, [x, y]);
      g.fillStyle = "#365f51";
      g.fillRect(x - 2, y - 2, 4, 4);
    }
    if (selected) {
      const [x, y] = pixels.get(selected.id)!;
      g.fillStyle = "#aa4c32";
      g.strokeStyle = "#fff5d7";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 6, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
    }
  }
  function choose(id?: number) {
    selected = filtered.find((p) => p.id === id);
    select.value = selected ? String(selected.id) : "";
    confirm.disabled = !selected;
    if (selected) {
      const task = tasks[selected.stage];
      detail.textContent = `${selected.id + 1} 号院　${area(selected)}　距你 ${dist(selected)} 米。${task.name}验收后获得 ${task.pay} 工、${task.merit} 贡献，按 AI 实际用量消耗精力。`;
      confirm.textContent = `确认修缮 ${selected.id + 1} 号院`;
    } else {
      detail.textContent = filtered.length
        ? "请选择要修缮的空宅。"
        : "暂无可接取的住宅。";
      confirm.textContent = "确认修缮";
    }
    draw();
  }
  function populate() {
    filtered = candidates.filter(
      (p) => !filter.value || area(p) === filter.value,
    );
    select.replaceChildren(
      new Option("选择房号", ""),
      ...filtered.map(
        (p) =>
          new Option(
            `${p.id + 1} 号院 · ${area(p)} · ${dist(p)} 米`,
            String(p.id),
          ),
      ),
    );
    choose(filtered.find((p) => p.mine)?.id);
  }
  filter.onchange = populate;
  select.onchange = () =>
    choose(select.value === "" ? undefined : Number(select.value));
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const closest = [...pixels]
      .map(([id, [x, y]]) => ({
        id,
        d: Math.hypot(e.clientX - rect.left - x, e.clientY - rect.top - y),
      }))
      .sort((a, b) => a.d - b.d)[0];
    if (closest && closest.d < 14) choose(closest.id);
  };
  new ResizeObserver(draw).observe(canvas);
  image.onload = draw;
  document.getElementById("repairClose")!.onclick = () => dialog.close();
  confirm.onclick = () => {
    if (!selected || confirm.disabled) return;
    confirm.disabled = true;
    dialog.close();
    void start(`housing/repair/${selected.id}/${selected.stage}`);
  };
  return async () => {
    const current = ++seq;
    dialog.showModal();
    candidates = [];
    filter.replaceChildren(new Option("全部街坊", ""));
    populate();
    detail.textContent = "正在读取待修空宅…";
    if (!image.src) image.src = overview;
    try {
      const rows = await load();
      if (current !== seq || !dialog.open) return;
      candidates = rows.sort((a, b) => dist(a) - dist(b) || a.id - b.id);
      filter.replaceChildren(
        new Option("全部街坊", ""),
        ...[...new Set(candidates.map(area))].map((v) => new Option(v, v)),
      );
      populate();
    } catch (e) {
      detail.textContent = (e as Error).message;
    }
  };
}
