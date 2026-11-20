import { goGeneration } from "./go-generation.ts";
import { goURL, goModel, goHeaders } from "./go-subscription.ts";
import {
  design,
  tasks,
  type Design,
  type Task,
} from "../../frontend/src/civic/rules.ts";
export const taskBudget = 1;
interface Result {
  tokens: number | null;
  started: boolean;
  plan?: Design;
  error?: string;
}
export function usage(t: {
  total?: number;
  input: number;
  output: number;
  reasoning?: number;
  cache?: { read: number; write: number };
}) {
  const sum =
    t.total ??
    t.input +
      t.output +
      (t.reasoning ?? 0) +
      (t.cache?.read ?? 0) +
      (t.cache?.write ?? 0);
  if (!Number.isSafeInteger(sum) || sum <= 0) throw Error("模型用量缺失");
  return sum;
}
export async function runDesigner(
  _root: string,
  _dir: string,
  task: Task,
  key?: string,
  remaining = Infinity,
): Promise<Result> {
  if (!key)
    return { started: false, tokens: null, error: "请先连接 OpenCode Go 订阅" };
  const prompt = `为洛阳城一间宽八米的木构民宅设计${tasks[task].name}。仅输出一个 JSON 对象。wood 是 dark 或 warm；posts 是 2–4 的整数；depth 是 0.9–1.6 米；lattice 是 3–7 的整数；jars 是 1–3 的整数；bench 是 left 或 right。`;
  let used: number | null = null;
  try {
    const r = await goGeneration(key, remaining, {
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    if (!r.ok)
      return {
        started: r.status >= 500,
        tokens: null,
        error: `OpenCode Go 返回 HTTP ${r.status}，请检查订阅权限或额度。`,
      };
    const data = await r.json();
    used = usage({
      total: data.usage?.total_tokens,
      input: data.usage?.prompt_tokens,
      output: data.usage?.completion_tokens,
    });
    const plan = design(JSON.parse(data.choices[0].message.content));
    return { started: true, tokens: used, plan };
  } catch {
    return {
      started: true,
      tokens: used,
      error: used
        ? "模型输出未通过住宅设计验收"
        : "未收到可核对的 Go 用量，请核对任务记录",
    };
  }
}
