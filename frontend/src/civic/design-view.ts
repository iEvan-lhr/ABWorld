import * as T from "three";
import { anchors, type Anchor } from "./creations.ts";
import type { Blueprint } from "../workshop/blueprint.ts";
import { buildObject } from "../workshop/geometry.ts";
export function designView() {
  const el = (id: string) => document.getElementById(id)!,
    field = (id: string) => el(id) as HTMLInputElement;
  const map = el("designPlan") as HTMLCanvasElement,
    g = map.getContext("2d")!,
    canvas = el("turntable") as HTMLCanvasElement;
  let renderer: T.WebGLRenderer | undefined,
    obj: ReturnType<typeof buildObject> | undefined,
    angle = 0.75,
    drag: number | undefined,
    occupied = new Set<string>();
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(35, 2, 0.01, 120),
    target = new T.Vector3();
  let radius = 2;
  scene.background = new T.Color("#e9e5d8");
  scene.add(new T.HemisphereLight(0xffffff, 0x8d8b77, 2));
  const sun = new T.DirectionalLight(0xfff1d5, 2.1);
  sun.position.set(4, 8, 3);
  scene.add(sun);
  function draw() {
    if (!obj) return;
    if (!renderer)
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setSize(canvas.clientWidth || 320, 155, false);
    camera.aspect = (canvas.clientWidth || 320) / 155;
    camera.position.set(
      target.x + radius * Math.sin(angle),
      target.y + radius * 0.45,
      target.z + radius * Math.cos(angle),
    );
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  function preview(bp: Blueprint) {
    canvas.hidden = false;
    obj?.dispose();
    obj = buildObject({ blueprint: bp, x: 0, z: 0, y: 0, yaw: 0 });
    scene.add(obj.group);
    const box = new T.Box3().setFromObject(obj.group);
    box.getCenter(target);
    radius = Math.max(0.2, box.getSize(new T.Vector3()).length()) * 1.95;
    el("previewTitle").textContent = bp.name + " · 拖动旋转";
    draw();
  }
  canvas.onpointerdown = (e) => {
    drag = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (drag !== undefined) {
      angle -= (e.clientX - drag) * 0.018;
      drag = e.clientX;
      draw();
    }
  };
  canvas.onlostpointercapture = () => (drag = undefined);
  const X = (v: number) => 130 + v * 10,
    Y = (v: number) => 45 + v * 10;
  function plan() {
    g.fillStyle = "#e2dfc9";
    g.fillRect(0, 0, 260, 202);
    g.fillStyle = "#c1cbaa";
    g.fillRect(X(-7), Y(-3), 140, 170);
    g.strokeStyle = "#83765e";
    g.lineWidth = 2;
    g.strokeRect(X(-7), Y(-3), 140, 170);
    g.fillStyle = "#cbc0a7";
    g.fillRect(X(-4.2), Y(-2.5), 84, 50);
    g.fillStyle = "#374d42";
    g.font = "12px sans-serif";
    g.fillText("正房", 9, 42);
    g.fillText("庭院", 9, 122);
    g.fillText("院门", 144, 194);
    const chosen = field("anchor").value;
    for (const [id, a] of Object.entries(anchors)) {
      const selected = chosen === id;
      g.fillStyle = occupied.has(id)
        ? "#9b9082"
        : selected
          ? "#99503b"
          : "#527b68";
      g.fillRect(X(a.x) - 9, Y(a.z) - 7, 18, 14);
      g.fillStyle = "white";
      g.font = "10px sans-serif";
      g.fillText(id.endsWith("West") ? "西" : "东", X(a.x) - 5, Y(a.z) + 4);
      if (selected) {
        g.strokeStyle = "#f5cf72";
        g.lineWidth = 2;
        g.strokeRect(
          X(a.x) - Number(field("objectL").value) * 5,
          Y(a.z) - Number(field("objectW").value) * 5,
          Number(field("objectL").value) * 10,
          Number(field("objectW").value) * 10,
        );
      }
    }
  }
  map.onclick = (e) => {
    const rect = map.getBoundingClientRect(),
      x = ((e.clientX - rect.left) * 260) / rect.width,
      z = ((e.clientY - rect.top) * 202) / rect.height;
    const pair = Object.entries(anchors).sort(
      ([, a], [, b]) =>
        Math.hypot(x - X(a.x), z - Y(a.z)) - Math.hypot(x - X(b.x), z - Y(b.z)),
    )[0];
    if (
      Math.hypot(x - X(pair[1].x), z - Y(pair[1].z)) < 23 &&
      !occupied.has(pair[0])
    ) {
      field("anchor").value = pair[0];
      plan();
    }
  };
  for (const id of ["objectL", "objectW", "objectH", "anchor"])
    field(id).addEventListener("input", plan);
  plan();
  return {
    preview,
    layout(ids: string[]) {
      occupied = new Set(ids);
      plan();
    },
  };
}
