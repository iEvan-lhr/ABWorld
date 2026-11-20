import type { Character } from "./player/character.ts";
interface User {
  id: number;
  name: string;
  revision: number;
  progress: string | null;
}
let user: User | null = null,
  pending: string | null = null,
  writing: Promise<void> | null = null,
  conflict = false;
const offline = location.protocol === "file:";
export const currentSave = () => {
  if (user) return user.progress;
  try {
    return localStorage.getItem("abworld.character.v1");
  } catch {
    return null;
  }
};
async function api(route: string, data?: unknown) {
  const r = await fetch("/api/auth/" + route, {
    method: data === undefined ? "GET" : "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    keepalive: route === "save",
  });
  const text = await r.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw Error(`此地址的账号服务返回了无效响应（HTTP ${r.status}）。请打开 pnpm dev 终端显示的地址并刷新页面。`);
  }
  if (!r.ok) {
    if (route === "save" && (r.status === 409 || r.status === 401))
      conflict = true;
    throw Error(result?.error ?? `账号请求失败（HTTP ${r.status}）`);
  }
  return result;
}
export function saveProgress(state: Character) {
  const text = JSON.stringify(state);
  if (!user) {
    try {
      localStorage.setItem("abworld.character.v1", text);
    } catch {}
    return;
  }
  pending = text;
  void flush().catch((e) => {
    document.getElementById("saveStatus")!.textContent = (e as Error).message;
  });
}
function flush(): Promise<void> {
  if (writing) return writing;
  if (!user || conflict || !pending) return Promise.resolve();
  writing = (async () => {
    while (user && pending && !conflict) {
      const value: string = pending;
      if (value === user.progress) {
        pending = null;
        break;
      }
      const result = await api("save", {
        revision: user.revision,
        state: JSON.parse(value),
      });
      user.revision = result.revision;
      user.progress = value;
      if (pending === value) pending = null;
      document.getElementById("saveStatus")!.textContent = "";
    }
  })().finally(() => (writing = null));
  return writing;
}
export async function entry() {
  const form = document.querySelector<HTMLFormElement>("#authForm")!,
    hint = document.getElementById("authHint")!,
    name = document.querySelector<HTMLInputElement>("#loginName")!,
    password = document.querySelector<HTMLInputElement>("#loginPassword")!,
    submit = document.querySelector<HTMLButtonElement>("#authSubmit")!,
    mode = document.querySelector<HTMLButtonElement>("#authMode")!;
  let register = false;
  async function enter(u: User | null) {
    user = u;
    document.getElementById("accountName")!.textContent = u
      ? u.name
      : "离线漫游";
    const logout = document.getElementById("logout") as HTMLButtonElement;
    logout.hidden = !u;
    logout.onclick = async () => {
      logout.disabled = true;
      try {
        window.dispatchEvent(new Event("save-character"));
        await flush();
        await api("logout", {});
        location.reload();
      } catch (e) {
        document.getElementById("saveStatus")!.textContent = (
          e as Error
        ).message;
        logout.disabled = false;
      }
    };
    await import("./main.ts");
    document.body.classList.remove("atGate");
    document.getElementById("gate")!.hidden = true;
  }
  if (offline) {
    form.hidden = mode.hidden = true;
    const guest = document.getElementById("offlineEnter")!;
    guest.hidden = false;
    guest.onclick = () => void enter(null);
    hint.textContent = "离线角色保存在此浏览器。账号登录请从 pnpm dev 打开。";
    return;
  }
  submit.disabled = mode.disabled = true;
  mode.onclick = () => {
    register = !register;
    document.getElementById("gateTitle")!.textContent = register
      ? "注册账号"
      : "登录洛阳城";
    submit.textContent = register ? "注册并进城" : "登录进城";
    mode.textContent = register ? "已有账号，去登录" : "创建账号";
    password.autocomplete = register ? "new-password" : "current-password";
    hint.textContent = "";
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = mode.disabled = true;
    hint.textContent = "正在进城…";
    try {
      const u = await api(register ? "register" : "login", {
        name: name.value,
        password: password.value,
      });
      password.value = "";
      await enter(u);
    } catch (ex) {
      hint.textContent = (ex as Error).message;
    } finally {
      submit.disabled = mode.disabled = false;
    }
  };
  try {
    const current = await api("session");
    if (current) await enter(current);
    else submit.disabled = mode.disabled = false;
  } catch (error) {
    hint.textContent = error instanceof Error ? error.message : "账号服务暂时无法连接，请刷新重试。";
  }
}
