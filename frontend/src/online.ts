import * as T from "three";
import type { ActorRig } from "./types.ts";
export interface Peer {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  action: "idle" | "walk" | "run";
}
export const onlinePlayers = new Map<number, Peer>();
export function connectPlayers(
  scene: T.Scene,
  player: {
    x: number;
    y: number;
    z: number;
    angle: number;
    face: number;
    first: boolean;
    action: string;
  },
  isReady: () => boolean,
  load: (id: number) => Promise<{ rig: ActorRig; release: () => void }>,
  animate: (rig: ActorRig, action: string, phase: number) => void,
) {
  const online = location.protocol !== "file:",
    hud = document.getElementById("onlineCount")!,
    mapEvent = () => window.dispatchEvent(new Event("online-change"));
  type Avatar = {
    rig?: ActorRig;
    release?: () => void;
    label?: T.Sprite;
    loading: boolean;
    retry: number;
    phase: number;
    target: Peer;
  };
  const avatars = new Map<number, Avatar>();
  let ws: WebSocket | undefined,
    nextRetry = 0,
    retries = 0,
    lastSend = -1e5,
    lastData = "",
    suspended = false,
    duplicate = false;
  function dispose(a: Avatar) {
    if (a.label) {
      (a.label.material as T.SpriteMaterial).map?.dispose();
      a.label.material.dispose();
      a.label.removeFromParent();
    }
    a.release?.();
  }
  function clear() {
    for (const a of avatars.values()) dispose(a);
    avatars.clear();
    onlinePlayers.clear();
    mapEvent();
  }
  function nameplate(name: string) {
    const c = document.createElement("canvas");
    c.width = 384;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#254739dc";
    g.fillRect(0, 0, 384, 64);
    g.fillStyle = "#fff5d9";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "bold 32px Microsoft YaHei,sans-serif";
    g.fillText(name, 192, 32, 365);
    const texture = new T.CanvasTexture(c);
    texture.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(
      new T.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
    sprite.scale.set(1.36, 0.23, 1);
    sprite.position.y = 1.95;
    return sprite;
  }
  function connect(now: number) {
    nextRetry = Infinity;
    const url = new URL("/api/world/online", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = (ws = new WebSocket(url));
    hud.textContent = "联机中";
    socket.onopen = () => {
      lastSend = -1e5;
      lastData = "";
      send(performance.now());
    };
    socket.onmessage = (e) => {
      if (ws !== socket) return;
      let data;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (data.error) {
        duplicate = true;
        hud.textContent = String(data.error);
        socket.close();
        return;
      }
      if (!Array.isArray(data.players)) return;
      retries = 0;
      onlinePlayers.clear();
      for (const p of data.players as Peer[]) onlinePlayers.set(p.id, p);
      hud.textContent = `在线 ${1 + onlinePlayers.size} 人`;
      mapEvent();
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = undefined;
      clear();
      nextRetry =
        performance.now() + Math.min(12000, 750 * 2 ** Math.min(retries++, 4));
      if (!duplicate) hud.textContent = "联机重连中";
    };
  }
  function send(now: number) {
    if (ws?.readyState !== WebSocket.OPEN || !isReady()) return;
    const round = (v: number) => Math.round(v * 1000) / 1000;
    const yaw =
      player.first && player.action === "idle" ? player.angle : player.face;
    const packet = JSON.stringify({
      x: round(player.x),
      y: round(player.y),
      z: round(player.z),
      yaw: round(Math.atan2(Math.sin(yaw), Math.cos(yaw))),
      action: player.action,
    });
    if (
      now - lastSend < (packet === lastData ? 5000 : 125) ||
      ws.bufferedAmount > 2048
    )
      return;
    ws.send(packet);
    lastData = packet;
    lastSend = now;
  }
  window.addEventListener("pagehide", () => {
    suspended = true;
    ws?.close();
  });
  window.addEventListener("pageshow", () => {
    suspended = false;
    nextRetry = 0;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      duplicate = false;
      nextRetry = 0;
    }
  });
  if (!online) hud.hidden = true;
  return (now: number, dt: number) => {
    if (!online || suspended || !isReady()) return;
    if (!ws && !duplicate && now >= nextRetry) connect(now);
    send(now);
    for (const [id, a] of avatars) {
      const p = onlinePlayers.get(id);
      if (!p || Math.hypot(player.x - p.x, player.z - p.z) > 210) {
        avatars.delete(id);
        dispose(a);
      }
    }
    for (const p of onlinePlayers.values()) {
      if (
        Math.hypot(p.x - player.x, p.z - player.z) > 200 &&
        !avatars.has(p.id)
      )
        continue;
      let a = avatars.get(p.id);
      if (!a) {
        a = { loading: false, retry: 0, phase: 0, target: p };
        avatars.set(p.id, a);
      }
      a.target = p;
      const slot = a;
      if (!slot.rig && !slot.loading && now >= slot.retry) {
        slot.loading = true;
        void load(p.id)
          .then((model) => {
            if (avatars.get(p.id) !== slot) {
              model.release();
              return;
            }
            slot.rig = model.rig;
            slot.release = model.release;
            slot.label = nameplate(p.name);
            slot.rig.root.add(slot.label);
            const t = slot.target;
            slot.rig.root.position.set(t.x, t.y, t.z);
            slot.rig.root.rotation.y = t.yaw;
            scene.add(slot.rig.root);
          })
          .catch(() => (slot.retry = performance.now() + 3000))
          .finally(() => (slot.loading = false));
      }
      const rig = slot.rig;
      if (!rig) continue;
      const pos = rig.root.position,
        delta = Math.hypot(p.x - pos.x, p.z - pos.z),
        blend = delta > 8 ? 1 : 1 - Math.exp(-dt * 11);
      pos.x += (p.x - pos.x) * blend;
      pos.y += (p.y - pos.y) * blend;
      pos.z += (p.z - pos.z) * blend;
      rig.root.rotation.y +=
        Math.atan2(
          Math.sin(p.yaw - rig.root.rotation.y),
          Math.cos(p.yaw - rig.root.rotation.y),
        ) * blend;
      slot.phase =
        (slot.phase +
          (p.action === "idle"
            ? dt * 0.5
            : (delta * blend) / (p.action === "run" ? 2.35 : 1.43))) %
        1;
      animate(rig, p.action, slot.phase);
      if (slot.label)
        slot.label.visible = Math.hypot(player.x - p.x, player.z - p.z) < 35;
    }
    hud.dataset.nearby = String(
      [...avatars.values()].filter((a) => a.rig).length,
    );
  };
}
