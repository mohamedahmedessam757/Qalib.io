export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_OPENROUTER_MODEL = "google/gemma-4-26b-a4b-it:free";

export function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model =
    process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  return { apiKey: apiKey || null, model };
}

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessageContent = string | ChatContentPart[];

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: ChatMessageContent;
  tool_call_id?: string;
  tool_calls?: unknown;
  name?: string;
};

export function contentToPlainText(content: ChatMessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

export function contentHasImages(content: ChatMessageContent): boolean {
  return (
    Array.isArray(content) &&
    content.some((p) => p.type === "image_url" && Boolean(p.image_url?.url))
  );
}

export type OpenRouterTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** Map upstream failures to short codes the UI can translate. */
export function friendlyOpenRouterError(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (
    status === 429 ||
    lower.includes("rate limit") ||
    lower.includes("free-models-per-day")
  ) {
    return "OPENROUTER_RATE_LIMIT";
  }
  if (status === 401 || status === 403) {
    return "OPENROUTER_AUTH";
  }
  if (
    lower.includes("vision") ||
    lower.includes("image input") ||
    lower.includes("multimodal") ||
    (lower.includes("does not support") && lower.includes("image"))
  ) {
    return "OPENROUTER_VISION";
  }
  if (status >= 500) {
    return "OPENROUTER_UPSTREAM";
  }
  return `OpenRouter error ${status}`;
}

export async function openRouterChat(opts: {
  messages: ChatMessage[];
  tools?: OpenRouterTool[];
  stream?: boolean;
  signal?: AbortSignal;
}) {
  const { apiKey, model } = getOpenRouterConfig();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    stream: opts.stream ?? true,
    // Cap free-model replies; keeps cost/latency predictable
    max_tokens: 2048,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
      "X-Title": "Qalib",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(friendlyOpenRouterError(res.status, text));
  }

  return res;
}
