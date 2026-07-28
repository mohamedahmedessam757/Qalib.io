import { getDocumentForOwner, requireUser } from "@/lib/db";
import { aiRateLimit } from "@/lib/ai/rate-limit";
import { buildSystemPrompt, buildSheetSystemPrompt, buildPdfSystemPrompt } from "@/lib/ai/prompts";
import {
  type ChatContentPart,
  type ChatMessage,
  type ChatMessageContent,
  contentHasImages,
  contentToPlainText,
  getOpenRouterConfig,
  openRouterChat,
} from "@/lib/ai/openrouter";
import {
  MAX_CONTEXT_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  toolsForDocKind,
  validateToolCall,
} from "@/lib/ai/tools";
import {
  appendMessage,
  createConversation,
  getConversationForOwner,
  listMessages,
} from "@/lib/ai/conversations";
import {
  sanitizeChatHistory,
  takeRecentChatHistory,
} from "@/lib/ai/message-history";

export const runtime = "nodejs";

const MAX_IMAGE_PARTS = 3;
const MAX_IMAGE_URL_CHARS = 1_200_000;

type IncomingMessage = {
  role: "user" | "assistant" | "tool";
  content: ChatMessageContent;
  tool_call_id?: string;
  name?: string;
};

function sse(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeIncomingContent(
  raw: unknown,
): { ok: true; content: ChatMessageContent } | { ok: false; error: string } {
  if (typeof raw === "string") {
    if (raw.length > MAX_MESSAGE_CHARS) {
      return { ok: false, error: "Invalid message" };
    }
    return { ok: true, content: raw };
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Invalid message" };
  }
  const parts: ChatContentPart[] = [];
  let imageCount = 0;
  let textLen = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Invalid message" };
    }
    const part = item as Record<string, unknown>;
    if (part.type === "text" && typeof part.text === "string") {
      textLen += part.text.length;
      if (textLen > MAX_MESSAGE_CHARS) {
        return { ok: false, error: "Invalid message" };
      }
      parts.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "image_url") {
      const url =
        part.image_url &&
        typeof part.image_url === "object" &&
        typeof (part.image_url as { url?: unknown }).url === "string"
          ? ((part.image_url as { url: string }).url as string)
          : "";
      if (
        !url ||
        url.length > MAX_IMAGE_URL_CHARS ||
        !(url.startsWith("data:image/") || url.startsWith("https://"))
      ) {
        return { ok: false, error: "Invalid image attachment" };
      }
      imageCount += 1;
      if (imageCount > MAX_IMAGE_PARTS) {
        return { ok: false, error: "Too many images" };
      }
      parts.push({ type: "image_url", image_url: { url } });
      continue;
    }
    return { ok: false, error: "Invalid message" };
  }
  return { ok: true, content: parts };
}

export async function POST(request: Request) {
  try {
    return await handleChat(request);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    console.error("[ai/chat]", message);
    return jsonError(
      message.includes("OpenRouter")
        ? message
        : "تعذر معالجة الطلب. حاول مرة أخرى.",
      500,
    );
  }
}

async function handleChat(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return jsonError("Unauthorized", 401);

  if (!aiRateLimit(user.id)) return jsonError("Too many requests", 429);

  const { apiKey, model } = getOpenRouterConfig();
  if (!apiKey) return jsonError("AI is not configured", 503);

  const body = (await request.json().catch(() => null)) as {
    documentId?: string;
    conversationId?: string;
    messages?: IncomingMessage[];
    documentContext?: string;
    locale?: "ar" | "en";
    persistUserMessage?: boolean;
    docKind?: "docx" | "pdf" | "xlsx";
  } | null;

  const documentId = body?.documentId;
  if (!documentId) return jsonError("documentId required", 400);

  const doc = await getDocumentForOwner(documentId, user.id);
  if (!doc) return jsonError("Not found", 404);

  const docKind =
    body?.docKind === "xlsx" || body?.docKind === "pdf" || body?.docKind === "docx"
      ? body.docKind
      : doc.mimeType?.includes("sheet")
        ? "xlsx"
        : doc.mimeType?.includes("pdf")
          ? "pdf"
          : "docx";
  const activeTools = toolsForDocKind(docKind);

  const incomingRaw = Array.isArray(body?.messages) ? body!.messages : [];
  if (incomingRaw.length === 0) return jsonError("messages required", 400);

  const allowedRoles = new Set(["user", "assistant", "tool"]);
  const incoming: IncomingMessage[] = [];
  for (const m of incomingRaw) {
    if (!m || !allowedRoles.has(m.role)) {
      return jsonError("Invalid message", 400);
    }
    const normalized = normalizeIncomingContent(m.content);
    if (!normalized.ok) return jsonError(normalized.error, 400);
    if (
      m.role === "tool" &&
      (!m.tool_call_id || typeof m.tool_call_id !== "string")
    ) {
      return jsonError("Invalid tool message", 400);
    }
    // Tool/assistant rounds stay text-only
    if (m.role !== "user" && typeof normalized.content !== "string") {
      return jsonError("Invalid message", 400);
    }
    incoming.push({
      role: m.role,
      content: normalized.content,
      tool_call_id: m.tool_call_id,
      name: m.name,
    });
  }

  let conversationId = body?.conversationId;
  if (conversationId) {
    const owned = await getConversationForOwner(
      supabase,
      conversationId,
      user.id,
    );
    if (!owned || owned.documentId !== documentId) {
      return jsonError("Conversation not found", 404);
    }
  } else {
    const firstUser = incoming.find((m) => m.role === "user");
    const titleSeed = firstUser
      ? contentToPlainText(firstUser.content) || "Conversation"
      : "Conversation";
    const created = await createConversation(
      supabase,
      user.id,
      documentId,
      truncate(titleSeed, 80),
    );
    conversationId = created.id;
  }

  const locale = body?.locale === "en" ? "en" : "ar";
  const isToolRound = incoming.every((m) => m.role === "tool");
  // Tool rounds already have history — skip huge live snapshot to avoid
  // OpenRouter/payload failures that surface as Internal Server Error.
  const context = isToolRound
    ? ""
    : truncate((body?.documentContext || "").trim(), MAX_CONTEXT_CHARS);

  const persistUser =
    body?.persistUserMessage !== false &&
    incoming.some((m) => m.role === "user");

  if (persistUser) {
    const lastUser = [...incoming].reverse().find((m) => m.role === "user");
    if (lastUser) {
      await appendMessage(supabase, {
        conversationId,
        role: "user",
        content: truncate(contentToPlainText(lastUser.content), MAX_MESSAGE_CHARS),
      });
    }
  }

  const incomingTools = incoming.filter((m) => m.role === "tool").slice(-12);
  for (const toolMsg of incomingTools) {
    await appendMessage(supabase, {
      conversationId,
      role: "tool",
      content: truncate(contentToPlainText(toolMsg.content), 8_000),
      toolCalls: {
        tool_call_id: toolMsg.tool_call_id,
        name: toolMsg.name || null,
      },
    });
  }

  const history = await listMessages(supabase, conversationId);
  const mappedHistory: ChatMessage[] = history.map((m) => {
    const msg: ChatMessage = {
      role: m.role === "system" ? "system" : m.role,
      content: truncate(m.content || "", 8_000),
    };
    if (m.role === "assistant" && Array.isArray(m.toolCalls)) {
      const calls = m.toolCalls as Array<{
        id?: string;
        name?: string;
        args?: unknown;
        rawArguments?: string;
      }>;
      const tool_calls = calls
        .filter((c) => c.id && c.name)
        .map((c) => ({
          id: c.id as string,
          type: "function" as const,
          function: {
            name: c.name as string,
            arguments: truncate(
              typeof c.rawArguments === "string"
                ? c.rawArguments
                : JSON.stringify(c.args ?? {}),
              4_000,
            ),
          },
        }));
      if (tool_calls.length) msg.tool_calls = tool_calls;
    }
    if (m.role === "tool" && m.toolCalls && typeof m.toolCalls === "object") {
      const meta = m.toolCalls as {
        tool_call_id?: string;
        name?: string;
      };
      if (meta.tool_call_id) msg.tool_call_id = meta.tool_call_id;
      if (meta.name) msg.name = meta.name;
    }
    return msg;
  });

  const historyMsgs = sanitizeChatHistory(
    takeRecentChatHistory(mappedHistory, MAX_HISTORY_MESSAGES),
  );

  // Re-attach vision parts onto the latest user turn (DB stores text only)
  const lastIncomingUser = [...incoming]
    .reverse()
    .find((m) => m.role === "user");
  if (
    lastIncomingUser &&
    contentHasImages(lastIncomingUser.content) &&
    !isToolRound
  ) {
    for (let i = historyMsgs.length - 1; i >= 0; i -= 1) {
      if (historyMsgs[i].role === "user") {
        historyMsgs[i] = {
          role: "user",
          content: lastIncomingUser.content,
        };
        break;
      }
    }
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        docKind === "xlsx"
          ? buildSheetSystemPrompt(locale)
          : docKind === "pdf"
            ? buildPdfSystemPrompt(locale)
            : buildSystemPrompt(locale),
    },
    ...(context
      ? [
          {
            role: "system" as const,
            content:
              docKind === "xlsx"
                ? `LIVE SHEET SNAPSHOT:\n${context}`
                : docKind === "pdf"
                  ? `LIVE PDF SNAPSHOT:\n${context}`
                  : `LIVE DOCUMENT SNAPSHOT (real file — never say empty if paragraphs appear; refresh via read_document):\n${context}`,
          },
        ]
      : []),
    ...historyMsgs,
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(payload)));
        } catch {
          /* closed */
        }
      };

      send({ type: "meta", conversationId, model });

      let assistantText = "";
      const toolAcc = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      try {
        const res = await openRouterChat({
          messages,
          tools: activeTools,
          stream: true,
          signal: request.signal,
        });

        if (!res.body) {
          send({ type: "error", error: "Empty upstream stream" });
          controller.close();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() || "";

          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const json = JSON.parse(data) as {
                choices?: Array<{
                  delta?: {
                    content?: string | null;
                    tool_calls?: Array<{
                      index?: number;
                      id?: string;
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                }>;
                error?: { message?: string };
              };
              if (json.error?.message) {
                send({ type: "error", error: json.error.message });
                continue;
              }
              const delta = json.choices?.[0]?.delta;
              if (delta?.content) {
                assistantText += delta.content;
                send({ type: "token", text: delta.content });
              }
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  const prev = toolAcc.get(idx) || {
                    id: tc.id || `call_${idx}`,
                    name: "",
                    arguments: "",
                  };
                  if (tc.id) prev.id = tc.id;
                  if (tc.function?.name) prev.name = tc.function.name;
                  if (tc.function?.arguments) {
                    prev.arguments += tc.function.arguments;
                  }
                  toolAcc.set(idx, prev);
                }
              }
            } catch {
              /* skip bad chunk */
            }
          }
        }

        const toolCalls = [...toolAcc.values()].filter((t) => t.name);
        const validated = [];
        for (const tc of toolCalls) {
          const check = validateToolCall(tc.name, tc.arguments);
          if (check.ok) {
            validated.push({
              id: tc.id,
              name: check.call.name,
              args: check.call.args,
              rawArguments: truncate(tc.arguments, 4_000),
            });
            send({
              type: "tool_call",
              id: tc.id,
              name: check.call.name,
              args: check.call.args,
            });
          } else {
            validated.push({
              id: tc.id,
              name: tc.name,
              args: {},
              rawArguments: truncate(tc.arguments, 4_000),
              error: check.error,
            });
            send({
              type: "tool_call",
              id: tc.id,
              name: tc.name,
              args: {},
              error: check.error,
            });
          }
        }

        if (assistantText.trim() || validated.length) {
          await appendMessage(supabase, {
            conversationId: conversationId!,
            role: "assistant",
            content: truncate(assistantText, 12_000),
            toolCalls: validated.length ? validated : null,
          });
        }

        send({
          type: "done",
          conversationId,
          hasTools: validated.length > 0,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "AI request failed";
        send({
          type: "error",
          error: message.replace(apiKey || "", "[redacted]"),
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
