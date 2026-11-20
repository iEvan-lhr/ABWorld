import { paintHome } from "./civic/home-guide.ts";
import atlas from "./data/minimap.json";
import overview from "./data/city-overview.json";
export function cityMap(
  player: { x: number; z: number; angle: number },
  release: () => void,
) {
  const dialog = document.querySelector<HTMLDialogElement>("#atlasDialog")!,
    canvas = document.querySelector<HTMLCanvasElement>("#atlasCanvas")!,
    g = canvas.getContext("2d")!,
    image = new Image();
  let cx = 0,
    cz = 448,
    zoom = 1,
    drag: { x: number; y: number } | null = null;
  let home: { x: number; z: number } | undefined;
  window.addEventListener("civic-home", (event) => {
    home = (event as CustomEvent).detail;
    draw();
  });
  const fit = () =>
    Math.min(canvas.clientWidth / 8192, canvas.clientHeight / 8448) * zoom;
  function draw() {
    if (!dialog.open || !canvas.clientWidth) return;
    const w = canvas.clientWidth,
      h = canvas.clientHeight,
      dpr = Math.min(2, devicePixelRatio);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#e2dfce";
    g.fillRect(0, 0, w, h);
    const scale = fit(),
      x = (world: number) => w / 2 + (world - cx) * scale,
      y = (world: number) => h / 2 + (world - cz) * scale;
    if (image.complete && image.naturalWidth)
      g.drawImage(image, x(-4096), y(-3776), 8192 * scale, 8448 * scale);
    g.font = "600 12px SimSun,serif";
    g.textAlign = "center";
    g.lineWidth = 3;
    for (const r of atlas.roads) {
      const [px, pz] = r.p[Math.floor(r.p.length / 2)];
      g.strokeStyle = "#f5efdc";
      g.strokeText(r.name, x(px), y(pz));
      g.fillStyle = "#344b40";
      g.fillText(r.name, x(px), y(pz));
    }
    paintHome(g, x, y, true);
    g.save();
    g.translate(x(player.x), y(player.z));
    g.rotate(Math.PI - player.angle);
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(7, 7);
    g.lineTo(0, 4);
    g.lineTo(-7, 7);
    g.closePath();
    g.strokeStyle = "#fff";
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = "#a44334";
    g.fill();
    g.restore();
  }
  window.addEventListener("home-route", draw);
  image.onload = draw;
  image.src = overview;
  new ResizeObserver(draw).observe(canvas);
  function adjust(factor: number) {
    zoom = Math.max(1, Math.min(16, zoom * factor));
    draw();
  }
  document.getElementById("atlasMinus")!.onclick = () => adjust(1 / 1.6);
  document.getElementById("atlasPlus")!.onclick = () => adjust(1.6);
  document.getElementById("atlasLocate")!.onclick = () => {
    cx = player.x;
    cz = player.z;
    zoom = 5;
    draw();
  };
  document.getElementById("atlasFit")!.onclick = () => {
    cx = 0;
    cz = 448;
    zoom = 1;
    draw();
  };
  canvas.onwheel = (e) => {
    e.preventDefault();
    adjust(e.deltaY < 0 ? 1.25 : 0.8);
  };
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY };
  };
  canvas.onpointermove = (e) => {
    if (!drag) return;
    cx = Math.min(4096, Math.max(-4096, cx - (e.clientX - drag.x) / fit()));
    cz = Math.min(4672, Math.max(-3776, cz - (e.clientY - drag.y) / fit()));
    drag = { x: e.clientX, y: e.clientY };
    draw();
  };
  canvas.onlostpointercapture = () => (drag = null);
  function toggle() {
    if (dialog.open) {
      dialog.close();
      return;
    }
    release();
    cx = 0;
    cz = 448;
    zoom = 1;
    dialog.showModal();
    draw();
  }
  document.getElementById("atlasOpen")!.onclick = toggle;
  document.getElementById("atlasClose")!.onclick = toggle;
  return { toggle, open: () => dialog.open };
}
