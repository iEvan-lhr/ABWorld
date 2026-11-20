import * as T from "three";
export interface SceneRef {
  id: string;
  name: string;
  at: number[];
  size: number[];
}
export interface SceneContext {
  target: SceneRef;
  nearby: SceneRef[];
}
export function focusMode(
  scene: T.Scene,
  camera: T.PerspectiveCamera,
  player: { x: number; z: number },
  shortPress: () => void,
  newItem: (edit?: () => void, name?: string) => void,
  launch: (c: SceneContext) => void,
  blocked: () => boolean,
) {
  const el = (id: string) => document.getElementById(id)!;
  const bar = el("focusHud"),
    progress = el("holdProgress"),
    readout = el("focusName"),
    cross = el("focusCross"),
    admin = el("manageAccess") as HTMLDialogElement;
  let enabled = false,
    held = false,
    long = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    last = 0,
    selection: SceneRef | null = null,
    permitted = new Set<string>(),
    manager = false,
    labels: Record<string, string> = {},
    picked: string | null = null;
  const ray = new T.Raycaster();
  ray.far = 42;
  const box = new T.Box3(),
    helper = new T.Box3Helper(box, 0xf4cf6c);
  helper.visible = false;
  scene.add(helper);
  const idMatrix = new T.Matrix4(),
    tmp = new T.Box3(),
    center = new T.Vector3(),
    extent = new T.Vector3();
  const rounded = (v: T.Vector3) =>
    v.toArray().map((n) => Math.round(n * 100) / 100);
  async function api(route: string, data?: unknown) {
    const r = await fetch("/api/civic/access/" + route, {
      cache: "no-store",
      method: data ? "POST" : "GET",
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
    });
    const v = await r.json();
    if (!r.ok) throw Error(v.error || "权限校验失败");
    return v;
  }
  async function sync() {
    if (location.protocol === "file:") return;
    try {
      const a = await api("mine");
      permitted = new Set([
        `home:${a.home}`,
        `home:${a.home}:gate`,
        ...a.works,
        ...a.grants,
      ]);
      manager = a.admin;
      labels = a.labels;
      el("adminAccess").hidden = !manager;
      el("accountNumber").textContent = `账号 ID ${a.uid}`;
      el("adminSelf").textContent = `我的账号 ID ${a.uid}`;
    } catch {
      permitted.clear();
      manager = false;
    }
  }
  function meta(obj: T.Mesh, instance: number | undefined) {
    let o: T.Object3D | null = obj;
    while (o && !o.userData.asset) o = o.parent;
    if (!o) return null;
    const id =
      String(o.userData.asset) +
      (o.userData.batch ? ":" + (instance ?? 0) : "");
    return { id, name: labels[id] || String(o.userData.display || "场景构件") };
  }
  function getBounds(obj: T.Mesh, i?: number) {
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    tmp.copy(obj.geometry.boundingBox!);
    if (obj instanceof T.InstancedMesh && i !== undefined) {
      obj.getMatrixAt(i, idMatrix);
      tmp.applyMatrix4(idMatrix);
    }
    tmp.applyMatrix4(obj.matrixWorld);
    return tmp;
  }
  function record(obj: T.Mesh, i: number | undefined, pt?: T.Vector3) {
    const m = meta(obj, i);
    if (!m) return null;
    const bounds = getBounds(obj, i);
    bounds.getSize(extent);
    bounds.getCenter(center);
    return { ...m, at: rounded(pt ?? center), size: rounded(extent) };
  }
  function candidates() {
    const meshes: T.Mesh[] = [];
    for (const obj of scene.children) {
      const tile = obj.userData.tile;
      if (tile) {
        const [x, z] = String(tile).split("_").map(Number);
        if (
          Math.max(
            Math.abs((x + 0.5) * 128 - player.x),
            Math.abs((z + 0.5) * 128 - player.z),
          ) > 116
        )
          continue;
      }
      if (!tile && !obj.userData.asset) continue;
      obj.traverseVisible((m) => {
        if (m instanceof T.Mesh) meshes.push(m);
      });
    }
    return meshes;
  }
  function neighbors(ref: SceneRef) {
    const result = new Map<string, { ref: SceneRef; d: number }>();
    for (const obj of candidates()) {
      const n = obj instanceof T.InstancedMesh ? obj.count : 1;
      for (let j = 0; j < n; j++) {
        const i = obj instanceof T.InstancedMesh ? j : undefined;
        const bounds = getBounds(obj, i);
        bounds.getCenter(center);
        const d = Math.hypot(
          center.x - ref.at[0],
          center.y - ref.at[1],
          center.z - ref.at[2],
        );
        if (d > 8) continue;
        const v = record(obj, i);
        if (
          v &&
          v.id !== ref.id &&
          (!result.has(v.id) || result.get(v.id)!.d > d)
        )
          result.set(v.id, { ref: v, d });
      }
    }
    return [...result.values()]
      .sort((a, b) => a.d - b.d)
      .slice(0, 6)
      .map((v) => v.ref);
  }
  function scan() {
    ray.setFromCamera(new T.Vector2(), camera);
    const hit = ray.intersectObjects(candidates(), false)[0];
    selection = null;
    helper.visible = false;
    if (!hit || !(hit.object instanceof T.Mesh)) {
      readout.textContent = "AI 创作模式";
      return;
    }
    const ref = record(hit.object, hit.instanceId, hit.point);
    if (!ref) return;
    selection = ref;
    const allowed = permitted.has(ref.id);
    readout.textContent = allowed
      ? ref.name
      : manager
        ? `${ref.name} · ${ref.id} · G 授权`
        : `${ref.name} · 只读`;
    if (allowed) {
      if (ref.id.endsWith(":gate")) {
        box.makeEmpty();
        for (const obj of candidates()) {
          if (meta(obj, undefined)?.id === ref.id) box.union(getBounds(obj));
        }
      } else box.copy(getBounds(hit.object, hit.instanceId));
      if (box.getSize(extent).length() > 32)
        box.setFromCenterAndSize(hit.point, new T.Vector3(0.8, 0.3, 0.8));
      box.expandByScalar(0.05);
      helper.visible = true;
    }
    cross.classList.toggle("editable", allowed);
  }
  function cancelHold() {
    if (timer) clearTimeout(timer);
    held = false;
    progress.hidden = true;
  }
  function toggle() {
    enabled = !enabled;
    bar.hidden = cross.hidden = !enabled;
    helper.visible = false;
    selection = null;
    if (enabled) {
      readout.textContent = "AI 创作模式";
      void sync();
      scan();
    }
  }
  function down() {
    if (held || blocked() || location.protocol === "file:") return;
    held = true;
    long = false;
    progress.hidden = false;
    progress.style.animation = "none";
    void progress.offsetWidth;
    progress.style.animation = "";
    timer = setTimeout(() => {
      if (!blocked() && held) {
        long = true;
        toggle();
      }
      progress.hidden = true;
    }, 1500);
  }
  function up() {
    const tap = held && !long && !blocked();
    cancelHold();
    if (tap) shortPress();
  }
  function openStudio() {
    scan();
    const ref = selection;
    newItem(
      ref && permitted.has(ref.id) ? () => void editSelection(ref) : undefined,
      ref?.name,
    );
  }
  async function editSelection(ref: SceneRef) {
    if (!permitted.has(ref.id)) {
      readout.textContent = "请先瞄准有编辑权限的物件";
      return;
    }
    try {
      await api("check", { asset: ref.id });
      launch({ target: ref, nearby: neighbors(ref) });
    } catch (e) {
      readout.textContent = (e as Error).message;
      void sync();
    }
  }
  function openAdmin() {
    if (!manager) return;
    const field = el("grantAsset") as HTMLInputElement;
    field.value = picked ?? selection?.id ?? field.value;
    document.exitPointerLock?.();
    admin.showModal();
  }
  el("adminAccess").onclick = () => {
    picked = null;
    openAdmin();
  };
  el("accessClose").onclick = () => admin.close();
  for (const op of ["grant", "revoke"])
    el(op + "Edit").onclick = async () => {
      try {
        await api(op, {
          asset: (el("grantAsset") as HTMLInputElement).value.trim(),
          uid: Number((el("grantUser") as HTMLInputElement).value),
        });
        await sync();
        el("accessNote").textContent =
          op === "grant" ? "编辑权已授予" : "编辑权已撤销";
      } catch (e) {
        el("accessNote").textContent = (e as Error).message;
      }
    };
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyE" && held) up();
  });
  window.addEventListener("blur", cancelHold);
  document.addEventListener("visibilitychange", cancelHold);
  el("focusExit").onclick = () => {
    if (enabled) toggle();
  };
  el("focusBuild").onclick = () => void openStudio();
  el("focusTouch").onpointerdown = (e) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    down();
  };
  el("focusTouch").onpointerup = up;
  el("focusTouch").onpointercancel = cancelHold;
  void sync();
  setInterval(() => {
    if (enabled) void sync();
  }, 5000);
  return {
    down,
    command(code: string) {
      if (!enabled) return false;
      if (code === "KeyC") {
        void openStudio();
        return true;
      }
      if (code === "KeyG" && manager) {
        picked = selection?.id ?? null;
        openAdmin();
        return true;
      }
      if (code === "Escape") {
        toggle();
        return true;
      }
      return false;
    },
    update(now: number) {
      if (enabled && !blocked() && now - last > 140) {
        last = now;
        scan();
      }
    },
  };
}
