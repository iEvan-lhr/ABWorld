// Shared parsing keeps credentials out of URLs and keeps the provider's port and base path.
export function modelBase(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw Error("请填写完整的 HTTP 或 HTTPS 模型地址");
  }
  if (
    !["http:", "https:"].includes(u.protocol) ||
    !u.hostname ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw Error("请使用 HTTP 或 HTTPS 基础地址，密钥请填在密钥栏");
  return u;
}
export function localModelHost(host: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(host.toLowerCase());
}
export function generationHeaders(): Record<string, string> {
  const input = (id: string) =>
    (document.getElementById(id) as HTMLInputElement).value.trim();
  const key = input("modelKey");
  const headers: Record<string, string> = key
    ? { Authorization: "Bearer " + key }
    : {};
  if (input("provider") === "custom") {
    const u = modelBase(input("modelUrl")),
      model = input("modelId");
    if (!model) throw Error("请在设置中填写自定义模型名称");
    headers["X-ABWorld-Base"] = encodeURIComponent(u.href);
    headers["X-ABWorld-Model"] = encodeURIComponent(model);
  }
  return headers;
}
