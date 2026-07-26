import type { ChatMessage } from "./openrouter";

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

function asToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  const out: ToolCall[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const id = typeof item.id === "string" ? item.id : "";
    const name =
      typeof item.function?.name === "string" ? item.function.name : "";
    if (!id || !name) continue;
    out.push({
      id,
      type: "function",
      function: {
        name,
        arguments:
          typeof item.function?.arguments === "string"
            ? item.function.arguments
            : "{}",
      },
    });
  }
  return out;
}

/**
 * OpenRouter/OpenAI require every assistant `tool_calls` block to be followed by
 * matching `role:tool` messages before any later user/assistant turn.
 * Incomplete rounds (aborted client, failed SSE, truncated history) break this —
 * sanitize by filling missing tool results or dropping orphan tool rows.
 */
export function sanitizeChatHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];

    if (msg.role === "tool") {
      // Orphan tool rows are skipped; valid ones are consumed with their assistant
      continue;
    }

    if (msg.role !== "assistant") {
      out.push({
        role: msg.role,
        content: msg.content ?? "",
      });
      continue;
    }

    const calls = asToolCalls(msg.tool_calls);
    if (calls.length === 0) {
      out.push({
        role: "assistant",
        content: msg.content ?? "",
      });
      continue;
    }

    const answered = new Map<string, ChatMessage>();
    let j = i + 1;
    while (j < messages.length && messages[j].role === "tool") {
      const toolMsg = messages[j];
      if (toolMsg.tool_call_id) {
        answered.set(toolMsg.tool_call_id, toolMsg);
      }
      j += 1;
    }

    out.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: calls,
    });

    for (const call of calls) {
      const existing = answered.get(call.id);
      const fallback =
        "Tool call was not completed (cancelled or interrupted).";
      const toolContent =
        typeof existing?.content === "string"
          ? existing.content
          : Array.isArray(existing?.content)
            ? existing.content
                .filter(
                  (p): p is { type: "text"; text: string } => p.type === "text",
                )
                .map((p) => p.text)
                .join("\n")
            : fallback;
      out.push({
        role: "tool",
        tool_call_id: call.id,
        name: existing?.name || call.function.name,
        content: toolContent || fallback,
      });
    }

    i = j - 1;
  }

  return out;
}

/** Keep recent turns without cutting inside an assistant→tool chain. */
export function takeRecentChatHistory(
  messages: ChatMessage[],
  maxMessages: number,
): ChatMessage[] {
  if (messages.length <= maxMessages) return messages;

  let start = messages.length - maxMessages;
  while (start > 0 && messages[start].role === "tool") {
    start -= 1;
  }
  // Prefer starting on a user turn
  while (start > 0 && messages[start].role !== "user") {
    start -= 1;
  }
  return messages.slice(start);
}
