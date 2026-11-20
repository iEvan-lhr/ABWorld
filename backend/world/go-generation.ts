import { selectedProvider, customRequest } from "./custom-provider.ts";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { goURL, goHeaders } from "./go-subscription.ts";
import {
  goModel,
  contextTokens,
  maxOutputTokens,
} from "../../frontend/src/go-provider.ts";

type Message = { role: string; content: string };
type Generation = {
  messages: Message[];
  response_format: { type: string };
  reasoning_effort?: string;
};
// Use a conservative byte-based bound for the small task prompts without a provider tokenizer.
export function outputBudget(messages: Message[], available: number) {
  const inputBound = Buffer.byteLength(JSON.stringify(messages), "utf8") + 1024;
  return Math.max(
    0,
    Math.min(
      maxOutputTokens,
      contextTokens - inputBound,
      Math.floor(available) - inputBound,
    ),
  );
}
export async function goGeneration(
  key: string | undefined,
  available: number,
  params: Generation,
) {
  const limit = outputBudget(params.messages, available);
  if (limit < 1) return new Response(null, { status: 429 });
  const custom = selectedProvider.getStore();
  if (custom) {
    return customRequest(custom, "chat", {
      model: custom.model,
      messages: params.messages,
      stream: false,
      max_tokens: Math.min(8192, limit),
    });
  }
  const response = await fetch(goURL, {
    method: "POST",
    headers: goHeaders(key ?? ""),
    redirect: "error",
    signal: AbortSignal.timeout(8 * 60 * 60 * 1000),
    body: JSON.stringify({
      ...params,
      model: goModel,
      max_tokens: limit,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    return response;
  if (!response.body) throw Error("模型流为空");
  const lines = createInterface({
    input: Readable.fromWeb(
      response.body as Parameters<typeof Readable.fromWeb>[0],
    ),
    crlfDelay: Infinity,
  });
  const parts: string[] = [];
  let usage, finish: string | undefined;
  let event: string[] = [];
  function collect() {
    const payload = event.join("\n");
    event = [];
    if (!payload || payload === "[DONE]") return;
    const chunk = JSON.parse(payload);
    if (chunk.error) throw Error("模型流中断");
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (typeof choice?.delta?.content === "string")
      parts.push(choice.delta.content);
    if (choice?.finish_reason) finish = choice.finish_reason;
  }
  for await (const line of lines) {
    if (!line) collect();
    else if (line.startsWith("data:")) event.push(line.slice(5).trimStart());
  }
  collect();
  if (!finish || !usage) throw Error("模型流未返回完整结束标记或用量");
  return Response.json({
    model: goModel,
    usage,
    choices: [{ finish_reason: finish, message: { content: parts.join("") } }],
  });
}
