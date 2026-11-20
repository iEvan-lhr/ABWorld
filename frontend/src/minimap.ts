import { homeMap, paintHome } from "./civic/home-guide.ts";
import atlas from "./data/minimap.json";
import { inflateSync, strFromU8 } from "fflate";
const cells: Record<string, string> = atlas.cells;
const segments = [
  ...atlas.roads.map((line) => ({ ...line, color: "#eadbb7" })),
  ...atlas.water.map((line) => ({ ...line, color: "#81aba7" })),
];
// Each tile is painted only once while nearby. Pixels and world metres share the same origin.
function paintTile(tx: number, tz: number) {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 256;
  const ctx = tile.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.translate(-tx * 128, -tz * 128);
  ctx.fillStyle = "#bec1a2";
  ctx.fillRect(tx * 128, tz * 128, 128, 128);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const line of segments) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.w;
    ctx.beginPath();
    line.p.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.stroke();
  }
  const packed = cells[`${tx},${tz}`];
  if (packed) {
    const features: number[][] = JSON.parse(
      strFromU8(
        inflateSync(Uint8Array.from(atob(packed), (c) => c.charCodeAt(0))),
      ),
    );
    for (const [kind, x, z, w, d, a] of features) {
      ctx.save();
      ctx.translate(x, z);
      if (kind === 0) {
        ctx.fillStyle = "#8fa180";
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(0.5, w), 0, 2 * Math.PI);
        ctx.fill();
      } else {
        ctx.rotate(-a);
        ctx.fillStyle = ["", "#947f66", "#626f68", "#a48d67"][kind];
        ctx.fillRect(-w / 2, -d / 2, w, d);
        if (kind >= 2 && w > 3 && d > 2) {
          ctx.strokeStyle = "#ffffff3d";
          ctx.lineWidth = 0.45;
          ctx.beginPath();
          ctx.moveTo(-w * 0.35, 0);
          ctx.lineTo(w * 0.35, 0);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
  return tile;
}
export function minimap(player: { x: number; z: number; angle: number }) {
  const canvas = document.querySelector<HTMLCanvasElement>("#miniCanvas")!,
    ctx = canvas.getContext("2d")!,
    scale = document.querySelector("#mapScale")!,
    heading = document.querySelector("#mapHeading")!,
    card = document.querySelector<HTMLElement>("#miniMap")!,
    toggle = document.querySelector<HTMLButtonElement>("#miniToggle")!;
  const zooms = [1, 1.75, 3];
  let zoom = 1,
    last = -Infinity,
    signature = "";
  const cache = new Map<string, HTMLCanvasElement>();
  function change(n: number) {
    zoom = Math.max(0, Math.min(2, zoom + n));
    signature = "";
    (document.querySelector("#zoomIn") as HTMLButtonElement).disabled =
      zoom === 2;
    (document.querySelector("#zoomOut") as HTMLButtonElement).disabled =
      zoom === 0;
  }
  document.querySelector<HTMLButtonElement>("#zoomIn")!.onclick = () =>
    change(1);
  document.querySelector<HTMLButtonElement>("#zoomOut")!.onclick = () =>
    change(-1);
  toggle.onclick = () => {
    const collapsed = card.classList.toggle("collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.textContent = collapsed ? "展开" : "收起";
    signature = "";
  };
  return (now: number) => {
    if (now - last < 90 || card.classList.contains("collapsed")) return;
    last = now;
    const size = canvas.clientWidth,
      dpr = Math.min(2, devicePixelRatio),
      factor = zooms[zoom];
    const key = [
      homeMap.revision,
      Math.round(player.x * 4),
      Math.round(player.z * 4),
      Math.round(player.angle * 120),
      zoom,
      size,
      dpr,
    ].join("/");
    if (signature === key || !size) return;
    signature = key;
    const pixels = Math.round(size * dpr);
    if (canvas.width !== pixels) {
      canvas.width = canvas.height = pixels;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.save();
    ctx.scale(factor, factor);
    ctx.translate(-player.x, -player.z);
    const radius = size / 2 / factor;
    for (
      let i = Math.floor((player.x - radius) / 128);
      i <= Math.floor((player.x + radius) / 128);
      i++
    )
      for (
        let j = Math.floor((player.z - radius) / 128);
        j <= Math.floor((player.z + radius) / 128);
        j++
      ) {
        const k = i + "," + j;
        let tile = cache.get(k);
        if (!tile) {
          tile = paintTile(i, j);
          if (cache.size >= 24) cache.delete(cache.keys().next().value!);
          cache.set(k, tile);
        }
        ctx.drawImage(tile, i * 128, j * 128, 128, 128);
      }
    ctx.restore();
    paintHome(
      ctx,
      (x) => (x - player.x) * factor,
      (z) => (z - player.z) * factor,
    );
    const angle = Math.PI - player.angle;
    ctx.rotate(angle);
    ctx.fillStyle = "#344d5640";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 29, -Math.PI * 0.68, -Math.PI * 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.strokeStyle = "#fff9e8";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#993f32";
    ctx.fill();
    const metres = zoom === 2 ? 10 : 20;
    scale.textContent = metres + " 米";
    (scale as HTMLElement).style.width = metres * factor + "px";
    heading.textContent = [
      "北",
      "东北",
      "东",
      "东南",
      "南",
      "西南",
      "西",
      "西北",
    ][((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
  };
}
