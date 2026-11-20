import * as T from "three";
export type Place = { x: number; z: number; y: number };
export const homeMap: {
  home?: { x: number; z: number };
  route: Place[];
  revision: number;
} = { route: [], revision: 0 };
export function paintHome(
  ctx: CanvasRenderingContext2D,
  projectX: (x: number) => number,
  projectZ: (z: number) => number,
  label = false,
) {
  const { route, home } = homeMap;
  ctx.save();
  ctx.lineJoin = "round";
  if (route.length) {
    ctx.beginPath();
    route.forEach((p, i) =>
      i
        ? ctx.lineTo(projectX(p.x), projectZ(p.z))
        : ctx.moveTo(projectX(p.x), projectZ(p.z)),
    );
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#fff2d2";
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#a54a30";
    ctx.stroke();
  }
  if (home) {
    const x = projectX(home.x),
      z = projectZ(home.z);
    ctx.translate(x, z);
    ctx.fillStyle = "#76432e";
    ctx.strokeStyle = "#fff0d1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(8, -2);
    ctx.lineTo(6, -2);
    ctx.lineTo(6, 6);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-6, -2);
    ctx.lineTo(-8, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (label) {
      ctx.textAlign = "left";
      ctx.font = "bold 12px Microsoft YaHei";
      ctx.strokeText("我的住宅", 10, 0);
      ctx.fillText("我的住宅", 10, 0);
    }
  }
  ctx.restore();
}
export function homeGuide(scene: T.Scene, player: Place & { angle: number }) {
  const info = document.getElementById("navInstruction")!,
    stop = document.getElementById("navStop")!,
    hud = document.getElementById("navHud")!,
    start = document.getElementById("navStart") as HTMLButtonElement;
  let active = false,
    pending = false,
    generation = 0,
    lastPlan = 0,
    index = 1,
    route: Place[] = [],
    sign: T.Sprite | undefined,
    homeId = -1;
  const distance = (a: Place, b: Place) => Math.hypot(a.x - b.x, a.z - b.z);
  function setRoute(points: Place[]) {
    homeMap.route = points;
    homeMap.revision++;
    window.dispatchEvent(new Event("home-route"));
  }
  function cancel() {
    generation++;
    active = false;
    pending = false;
    route = [];
    setRoute([]);
    hud.hidden = true;
  }
  async function plan() {
    if (
      homeMap.home &&
      Math.abs(player.x - homeMap.home.x) < 7 &&
      player.z <= homeMap.home.z &&
      player.z >= homeMap.home.z - 17
    ) {
      cancel();
      hud.hidden = false;
      info.textContent = "已到家 · 我的庭院";
      return;
    }
    const seq = ++generation;
    active = true;
    pending = true;
    hud.hidden = false;
    info.textContent = "正在寻找回家的街巷…";
    lastPlan = performance.now();
    try {
      const r = await fetch(
        `/api/civic/route?x=${player.x}&z=${player.z}&y=${player.y}`,
        { cache: "no-store" },
      );
      const data = await r.json();
      if (seq !== generation) return;
      if (!r.ok || !data.points?.length)
        throw Error(data.error || "无法生成路线");
      route = data.points;
      index = 1;
      setRoute(route);
      update();
    } catch (e) {
      if (seq === generation) {
        active = false;
        route = [];
        setRoute([]);
        info.textContent = (e as Error).message;
      }
    } finally {
      if (seq === generation) pending = false;
    }
  }
  function update() {
    if (sign && homeMap.home)
      sign.visible =
        Math.hypot(player.x - homeMap.home.x, player.z - homeMap.home.z) < 160;
    if (!active || !route.length) return;
    const dest = route.at(-1)!;
    if (distance(player, dest) < 0.8) {
      active = false;
      route = [];
      setRoute([]);
      info.textContent = "已到家 · 我的住宅";
      return;
    }
    while (index < route.length - 1 && distance(player, route[index]) < 1.3)
      index++;
    const a = route[index - 1] ?? player,
      b = route[index] ?? dest,
      dx = b.x - a.x,
      dz = b.z - a.z,
      t = Math.max(
        0,
        Math.min(
          1,
          ((player.x - a.x) * dx + (player.z - a.z) * dz) /
            (dx * dx + dz * dz || 1),
        ),
      );
    const cross = Math.hypot(player.x - a.x - t * dx, player.z - a.z - t * dz);
    if (cross > 3 && !pending && performance.now() - lastPlan > 2000) {
      void plan();
      return;
    }
    let metres = distance(player, b);
    for (let i = index + 1; i < route.length; i++)
      metres += distance(route[i - 1], route[i]);
    const yaw = Math.atan2(b.x - player.x, b.z - player.z),
      delta = Math.atan2(
        Math.sin(player.angle - yaw),
        Math.cos(player.angle - yaw),
      );
    info.textContent = `${Math.abs(delta) < 0.5 ? "直行" : Math.abs(delta) > 2.5 ? "转身" : delta > 0 ? "向右" : "向左"}　·　回家还有 ${Math.ceil(metres)} 米`;
    setRoute([
      { x: player.x, y: player.y, z: player.z },
      ...route.slice(index),
    ]);
  }
  function mark(
    id: number,
    p: {
      x: number;
      z: number;
      eave: number;
      d: number;
      yaw: number;
      gateX: number;
      gateZ: number;
    },
    owner: string,
  ) {
    if (homeId === id) return;
    homeId = id;
    homeMap.home = { x: p.gateX, z: p.gateZ };
    homeMap.revision++;
    start.disabled = false;
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#443b2b";
    g.fillRect(4, 4, 504, 120);
    g.strokeStyle = "#d8bd88";
    g.lineWidth = 4;
    g.strokeRect(9, 9, 494, 110);
    g.textAlign = "center";
    g.fillStyle = "#ffedc7";
    g.font = "600 44px SimSun,serif";
    g.fillText("⌂  " + owner + " 宅", 256, 66, 450);
    g.font = "22px Microsoft YaHei";
    g.fillText("我的住宅", 256, 100);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    sign = new T.Sprite(
      new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    sign.scale.set(2.8, 0.7, 1);
    sign.position.set(p.gateX, 3.35, p.gateZ + 0.25);
    scene.add(sign);
  }
  stop.onclick = cancel;
  start.onclick = () => void plan();
  return { mark, update, plan };
}
