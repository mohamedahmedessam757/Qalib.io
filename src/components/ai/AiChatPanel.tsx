"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import {
  Bot,
  ImagePlus,
  LoaderCircle,
  Plus,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import type { DocxCanvasHandle } from "@/components/editor/DocxCanvas";
import { applyDocTool } from "@/lib/ai/apply-doc-tools";
import {
  buildMultimodalUserContent,
  buildPersistableUserText,
  compressImageFile,
  MAX_CHAT_IMAGES,
  type ChatImageAttachment,
} from "@/lib/ai/chat-attachments";
import { buildDocumentSnapshot } from "@/lib/ai/document-snapshot";
import { formatAiReply } from "@/lib/ai/format-ai-reply";
import {
  listDocumentParagraphs,
  revealParagraph,
} from "@/lib/ai/direct-doc-edit";
import { tryLocalEditFromUserIntent } from "@/lib/ai/local-intent-edit";
import {
  contentToPlainText,
  type ChatMessageContent,
} from "@/lib/ai/openrouter";
import { MAX_TOOL_ROUNDS, validateToolCall } from "@/lib/ai/tools";
import { useRouter } from "@/i18n/navigation";
import { AiMicButton } from "./AiMicButton";

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "status";
  content: string;
  imageUrls?: string[];
};

type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
};

type PanelStatus = "idle" | "thinking" | "editing" | "applying";

const easeOut = [0.23, 1, 0.32, 1] as const;

function collectDocumentContext(editor: DocxCanvasHandle | null) {
  return buildDocumentSnapshot(editor, 12_000);
}

function parseSseBuffer(buffer: string): {
  events: Array<Record<string, unknown>>;
  rest: string;
} {
  const events: Array<Record<string, unknown>> = [];
  let rest = buffer;
  // Support both \n\n framed events and single-line data: payloads
  const parts = rest.split(/\n\n/);
  rest = parts.pop() || "";
  for (const chunk of parts) {
    for (const rawLine of chunk.split("\n")) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
      } catch {
        /* skip */
      }
    }
  }
  return { events, rest };
}

function flushSseRest(rest: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const rawLine of rest.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    try {
      events.push(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
    } catch {
      /* skip */
    }
  }
  return events;
}

function mapAiError(message: string, t: (key: string) => string) {
  if (
    message.includes("OPENROUTER_RATE_LIMIT") ||
    /rate limit|free-models-per-day|429/i.test(message)
  ) {
    return t("errorRateLimit");
  }
  if (message.includes("OPENROUTER_AUTH")) return t("errorAuth");
  if (message.includes("OPENROUTER_UPSTREAM")) return t("errorUpstream");
  if (message.includes("OPENROUTER_VISION")) return t("errorVision");
  return message || t("errorGeneric");
}

export function AiChatPanel({
  open,
  onClose,
  documentId,
  editorRef,
  onDocMutated,
  onTitleChanged,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
  editorRef: React.RefObject<DocxCanvasHandle | null>;
  onDocMutated?: () => void;
  onTitleChanged?: (title: string) => void;
}) {
  const t = useTranslations("aiChat");
  const locale = useLocale();
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [micListening, setMicListening] = useState(false);
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [loadingList, setLoadingList] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const draftScrollRef = useRef<HTMLTextAreaElement | HTMLDivElement | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const busy = status !== "idle";

  const speechLang = locale.startsWith("ar") ? "ar-EG" : "en-US";
  const chatLocale = locale.startsWith("ar") ? "ar" : "en";

  const statusLabel =
    status === "thinking"
      ? t("thinking")
      : status === "editing"
        ? t("editingDoc")
        : status === "applying"
          ? t("applyingTools")
          : null;

  const loadConversations = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch(
        `/api/ai/conversations?documentId=${encodeURIComponent(documentId)}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("errorGeneric"));
      setConversations(json.conversations || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errorGeneric"));
    } finally {
      setLoadingList(false);
    }
  }, [documentId, t]);

  const loadConversation = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/ai/conversations/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("errorGeneric"));
      setConversationId(id);
      setMessages(
        (json.messages || [])
          .filter(
            (m: { role: string; content?: string }) =>
              (m.role === "user" || m.role === "assistant") &&
              Boolean((m.content || "").trim()),
          )
          .map(
            (m: {
              id: string;
              role: "user" | "assistant";
              content: string;
            }) => ({
              id: m.id,
              role: m.role,
              content: m.content,
            }),
          ),
      );
    },
    [t],
  );

  useEffect(() => {
    if (!open) return;
    void loadConversations();
    // Fit + scroll document into view when chat opens (panel overlays the page)
    const timer = window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor) return;
      try {
        editor.fitToWidth?.();
      } catch {
        /* ignore */
      }
      const sel = editor.getSelectionInfo?.();
      if (sel?.paraId) {
        revealParagraph(editor, sel.paraId);
        return;
      }
      const first = listDocumentParagraphs(editor)[0];
      revealParagraph(editor, first?.paraId);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [open, loadConversations, editorRef]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  useEffect(() => {
    const el = draftScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [input, micListening]);

  async function startNewConversation() {
    setConversationId(null);
    setMessages([]);
    setAttachments([]);
  }

  async function removeConversation(id: string) {
    const res = await fetch(`/api/ai/conversations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error || t("errorGeneric"));
      return;
    }
    if (conversationId === id) {
      setConversationId(null);
      setMessages([]);
    }
    void loadConversations();
  }

  const runChat = useCallback(
    async (opts: {
      outgoing: Array<{
        role: "user" | "assistant" | "tool";
        content: ChatMessageContent;
        tool_call_id?: string;
        name?: string;
      }>;
      persistUserMessage: boolean;
      round: number;
      convId: string | null;
      appliedCount: number;
    }) => {
      if (opts.round === 0) {
        const controller = new AbortController();
        abortRef.current = controller;
      }
      setStatus("thinking");
      const controller = abortRef.current;
      if (!controller) return;

      const assistantId = `a_${Date.now()}_${opts.round}`;
      let assistantText = "";
      let sawTokens = false;

      setMessages((prev) => [
        ...prev.filter((m) => m.role !== "status"),
        {
          id: assistantId,
          role: "assistant",
          content: "",
        },
      ]);

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            documentId,
            conversationId: opts.convId,
            messages: opts.outgoing,
            documentContext: collectDocumentContext(editorRef.current),
            locale: locale.startsWith("ar") ? "ar" : "en",
            persistUserMessage: opts.persistUserMessage,
          }),
        });

        if (!res.ok || !res.body) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || t("errorGeneric"));
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let nextConv = opts.convId;
        let streamError: string | null = null;
        const pendingTools: Array<{
          id: string;
          name: string;
          args: unknown;
          error?: string;
        }> = [];

        const handlePayload = (payload: Record<string, unknown>) => {
          const type = payload.type as string;
          if (type === "meta" && typeof payload.conversationId === "string") {
            nextConv = payload.conversationId;
            setConversationId(payload.conversationId);
          }
          if (type === "token" && typeof payload.text === "string") {
            sawTokens = true;
            assistantText += payload.text;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + payload.text }
                  : m,
              ),
            );
          }
          if (
            type === "tool_call" &&
            typeof payload.id === "string" &&
            typeof payload.name === "string"
          ) {
            setStatus("applying");
            pendingTools.push({
              id: payload.id,
              name: payload.name,
              args: payload.args,
              error:
                typeof payload.error === "string" ? payload.error : undefined,
            });
          }
          if (type === "error") {
            streamError =
              typeof payload.error === "string"
                ? payload.error
                : t("errorGeneric");
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseBuffer(buffer);
          buffer = parsed.rest;
          for (const payload of parsed.events) handlePayload(payload);
        }
        for (const payload of flushSseRest(buffer)) handlePayload(payload);

        // If upstream failed but we still got tools, apply them; otherwise surface error
        if (streamError && !pendingTools.length) {
          throw new Error(streamError);
        }

        if (pendingTools.length && opts.round < MAX_TOOL_ROUNDS) {
          setStatus("editing");
          setMessages((prev) => {
            const next = prev.filter(
              (m) => m.id !== assistantId || m.content.trim(),
            );
            return [
              ...next,
              {
                id: `s_${Date.now()}_${opts.round}`,
                role: "status",
                content: t("applyingTools"),
              },
            ];
          });

          const selection = editorRef.current?.getSelectionInfo?.() || null;
          const toolMessages: Array<{
            role: "tool";
            content: string;
            tool_call_id: string;
            name: string;
          }> = [];
          let applied = 0;

          for (const tool of pendingTools) {
            if (tool.error) {
              toolMessages.push({
                role: "tool",
                content: tool.error,
                tool_call_id: tool.id,
                name: tool.name,
              });
              continue;
            }
            const validated = validateToolCall(tool.name, tool.args);
            if (!validated.ok) {
              toolMessages.push({
                role: "tool",
                content: validated.error,
                tool_call_id: tool.id,
                name: tool.name,
              });
              continue;
            }
            const result = await applyDocTool(
              editorRef.current,
              validated.call,
              selection
                ? {
                    paraId: selection.paraId || null,
                    paragraphText: selection.paragraphText || "",
                    selectedText: selection.selectedText || "",
                  }
                : null,
              { currentDocumentId: documentId },
            );
            // Only real document mutations count (not find/search)
            if (result.mutated) {
              applied += 1;
              onDocMutated?.();
              if (result.focusParaId) {
                revealParagraph(editorRef.current, result.focusParaId);
                // Second pass after layout settles
                await new Promise((r) => window.setTimeout(r, 80));
                revealParagraph(editorRef.current, result.focusParaId);
              }
            }
            if (result.navigateTo) {
              router.push(result.navigateTo);
            }
            if (
              validated.call.name === "rename_document" &&
              result.ok &&
              (!validated.call.args.documentId ||
                validated.call.args.documentId === documentId)
            ) {
              try {
                const parsed = JSON.parse(result.result) as { title?: string };
                if (parsed.title) onTitleChanged?.(parsed.title);
              } catch {
                /* ignore */
              }
            }
            toolMessages.push({
              role: "tool",
              content: result.result.slice(0, 8_000),
              tool_call_id: tool.id,
              name: tool.name,
            });
            // Let ProseMirror settle between edits (avoids overlapping mutations)
            await new Promise((r) => window.setTimeout(r, 40));
          }

          setMessages((prev) => [
            ...prev.filter((m) => m.role !== "status"),
            {
              id: `s_done_${Date.now()}`,
              role: "status",
              content:
                applied > 0
                  ? t("editsApplied", { count: applied })
                  : t("editsFailed"),
            },
          ]);

          // If model tools didn't mutate, try clear local delete/replace intent once
          let totalApplied = applied;
          if (
            totalApplied === 0 &&
            opts.round === 0 &&
            opts.persistUserMessage
          ) {
            const userRaw =
              opts.outgoing.find((m) => m.role === "user")?.content || "";
            const local = tryLocalEditFromUserIntent(
              editorRef.current,
              contentToPlainText(userRaw),
            );
            if (local.mutated) {
              totalApplied = 1;
              onDocMutated?.();
              if (local.focusParaId) {
                window.setTimeout(() => {
                  revealParagraph(editorRef.current, local.focusParaId);
                }, 60);
              }
              setMessages((prev) => [
                ...prev.filter((m) => m.role !== "status"),
                {
                  id: `s_local_${Date.now()}`,
                  role: "status",
                  content: t("editsApplied", { count: 1 }),
                },
              ]);
            }
          }

          await runChat({
            outgoing: toolMessages,
            persistUserMessage: false,
            round: opts.round + 1,
            convId: nextConv,
            appliedCount: opts.appliedCount + totalApplied,
          });
          return;
        }

        // Clean empty assistant placeholder; ensure user sees an outcome
        let finalApplied = opts.appliedCount;

        // Free models often reply in text without tools — apply clear intents locally
        if (
          opts.round === 0 &&
          pendingTools.length === 0 &&
          opts.appliedCount === 0 &&
          opts.persistUserMessage
        ) {
          const userRaw =
            opts.outgoing.find((m) => m.role === "user")?.content || "";
          setStatus("editing");
          const local = tryLocalEditFromUserIntent(
            editorRef.current,
            contentToPlainText(userRaw),
          );
          if (local.mutated) {
            finalApplied = 1;
            onDocMutated?.();
            if (local.focusParaId) {
              window.setTimeout(() => {
                revealParagraph(editorRef.current, local.focusParaId);
              }, 60);
            }
            setMessages((prev) => [
              ...prev.filter((m) => m.role !== "status"),
              {
                id: `s_local_${Date.now()}`,
                role: "status",
                content: t("editsApplied", { count: 1 }),
              },
            ]);
          }
        }

        setMessages((prev) => {
          let next = prev.filter(
            (m) => m.id !== assistantId || m.content.trim(),
          );
          if (!sawTokens && !assistantText.trim()) {
            const fallback =
              finalApplied > 0
                ? t("doneWithEdits", { count: finalApplied })
                : pendingTools.length
                  ? t("editsFailed")
                  : t("emptyReply");
            next = [
              ...next.filter((m) => m.role !== "status"),
              {
                id: `a_fallback_${Date.now()}`,
                role: "assistant",
                content: fallback,
              },
            ];
          } else if (finalApplied > 0 && sawTokens) {
            // Keep model text; status chips already show mutation result
          } else if (
            finalApplied === 0 &&
            /حذف|تم حذف|deleted|removed/i.test(assistantText) &&
            opts.persistUserMessage
          ) {
            // Model claimed a delete without mutation — correct the user
            next = [
              ...next,
              {
                id: `s_warn_${Date.now()}`,
                role: "status",
                content: t("editsFailed"),
              },
            ];
          }
          return next;
        });

        void loadConversations();
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setMessages((prev) => [
            ...prev.filter(
              (m) =>
                (m.id !== assistantId || m.content.trim()) &&
                m.role !== "status",
            ),
            {
              id: `a_stop_${Date.now()}`,
              role: "status",
              content: t("stopped"),
            },
          ]);
          return;
        }
        toast.error(
          mapAiError(err instanceof Error ? err.message : "", t),
        );
        setMessages((prev) =>
          prev.filter(
            (m) =>
              (m.id !== assistantId || m.content.trim()) && m.role !== "status",
          ),
        );
      } finally {
        // Always clear busy when the outermost round finishes (including
        // after nested tool rounds awaited inside round 0).
        if (opts.round === 0) {
          setStatus("idle");
          abortRef.current = null;
        }
      }
    },
    [
      documentId,
      editorRef,
      locale,
      loadConversations,
      onDocMutated,
      onTitleChanged,
      router,
      t,
    ],
  );

  async function onPickImages(files: FileList | null) {
    if (!files?.length) return;
    const remaining = MAX_CHAT_IMAGES - attachments.length;
    if (remaining <= 0) {
      toast.error(t("attachmentLimit"));
      return;
    }
    const picked = Array.from(files).slice(0, remaining);
    const next: ChatImageAttachment[] = [];
    for (const file of picked) {
      try {
        next.push(await compressImageFile(file));
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        if (code === "UNSUPPORTED_IMAGE") toast.error(t("attachmentUnsupported"));
        else if (code === "IMAGE_TOO_LARGE") toast.error(t("attachmentTooLarge"));
        else toast.error(t("attachmentUnsupported"));
      }
    }
    if (next.length) setAttachments((prev) => [...prev, ...next].slice(0, MAX_CHAT_IMAGES));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onSend(text?: string) {
    const content = (text ?? input).trim();
    if ((!content && attachments.length === 0) || busy) return;
    const currentAttachments = attachments;
    const displayText = buildPersistableUserText(
      content,
      currentAttachments,
      chatLocale,
    );
    const multimodal = buildMultimodalUserContent(content, currentAttachments);
    setInput("");
    setAttachments([]);
    const userMsg: ChatMsg = {
      id: `u_${Date.now()}`,
      role: "user",
      content: displayText,
      imageUrls: currentAttachments.map((a) => a.dataUrl),
    };
    setMessages((prev) => [...prev.filter((m) => m.role !== "status"), userMsg]);
    await runChat({
      outgoing: [{ role: "user", content: multimodal }],
      persistUserMessage: true,
      round: 0,
      convId: conversationId,
      appliedCount: 0,
    });
  }

  const empty = useMemo(
    () => messages.length === 0 && !busy,
    [messages.length, busy],
  );

  const canSend = Boolean(input.trim() || attachments.length) && !busy;

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label={t("close")}
            className="fixed inset-0 z-[70] bg-black/45 sm:bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label={t("title")}
            aria-busy={busy}
            className="glass-strong fixed inset-x-0 bottom-0 z-[80] flex h-[min(55dvh,34rem)] flex-col rounded-t-[1.5rem] sm:inset-y-3 sm:end-3 sm:start-auto sm:h-auto sm:w-[min(100vw-1.5rem,24rem)] sm:rounded-2xl"
            initial={{ y: "100%", opacity: 0.8 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ duration: 0.28, ease: easeOut }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-soft text-accent">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t("title")}</p>
                  <p className="truncate text-[11px] text-muted">
                    {statusLabel || t("subtitle")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-10 min-w-10"
                  onClick={() => void startNewConversation()}
                  aria-label={t("newChat")}
                  title={t("newChat")}
                  disabled={busy}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-10 min-w-10"
                  onClick={onClose}
                  aria-label={t("close")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto border-b border-line px-2 py-2">
              {loadingList ? (
                <span className="px-2 text-xs text-muted">{t("loading")}</span>
              ) : conversations.length === 0 ? (
                <span className="px-2 text-xs text-muted">{t("noChats")}</span>
              ) : (
                conversations.map((c) => (
                  <div key={c.id} className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 text-xs ${
                        conversationId === c.id
                          ? "bg-accent text-[#042f2e]"
                          : "bg-white/5 text-muted hover:bg-white/10"
                      }`}
                      onClick={() => void loadConversation(c.id)}
                      disabled={busy}
                    >
                      {c.title.slice(0, 24)}
                    </button>
                    <button
                      type="button"
                      className="rounded-full p-1.5 text-muted hover:text-danger"
                      aria-label={t("deleteChat")}
                      onClick={() => void removeConversation(c.id)}
                      disabled={busy}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div
              ref={listRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
              aria-live="polite"
            >
              {empty ? (
                <p className="px-1 py-8 text-center text-sm text-muted">
                  {t("emptyHint")}
                </p>
              ) : (
                messages.map((m) => {
                  if (m.role === "status") {
                    return (
                      <div
                        key={m.id}
                        className="me-auto flex max-w-[92%] items-center gap-2 rounded-2xl border border-accent/25 bg-accent/10 px-3 py-2 text-xs text-accent"
                        dir="auto"
                      >
                        {busy ? (
                          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        ) : null}
                        <span>{m.content}</span>
                      </div>
                    );
                  }
                  const showPlaceholder =
                    m.role === "assistant" && !m.content.trim() && busy;
                  return (
                    <div
                      key={m.id}
                      className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "ms-auto bg-accent/20 text-foreground"
                          : "me-auto bg-white/5 text-foreground"
                      }`}
                      dir="auto"
                    >
                      {m.imageUrls?.length ? (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {m.imageUrls.map((src) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={src.slice(0, 48)}
                              src={src}
                              alt=""
                              className="h-16 w-16 rounded-lg border border-line object-cover"
                            />
                          ))}
                        </div>
                      ) : null}
                      {showPlaceholder ? (
                        <span className="inline-flex items-center gap-2 text-muted">
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          {statusLabel || t("thinking")}
                        </span>
                      ) : m.role === "assistant" ? (
                        formatAiReply(m.content)
                      ) : (
                        m.content
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-line p-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:p-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => void onPickImages(e.target.files)}
              />

              {attachments.length ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {attachments.map((a) => (
                    <div
                      key={a.id}
                      className="relative h-14 w-14 overflow-hidden rounded-xl border border-line"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.dataUrl}
                        alt={a.name}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        className="absolute end-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white"
                        aria-label={t("removeAttachment")}
                        onClick={() =>
                          setAttachments((prev) =>
                            prev.filter((x) => x.id !== a.id),
                          )
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div
                className={
                  micListening
                    ? "flex w-full flex-col gap-2"
                    : "flex items-end gap-2"
                }
              >
                {!micListening ? (
                  <textarea
                    ref={(el) => {
                      draftScrollRef.current = el;
                    }}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={t("placeholder")}
                    rows={2}
                    className="min-h-12 max-h-32 flex-1 resize-none overflow-y-auto rounded-2xl border border-line bg-white/5 px-3.5 py-2.5 text-[15px] leading-snug outline-none transition-[border-color,box-shadow] duration-200 focus:border-accent/60 focus:shadow-[0_0_0_3px_rgba(45,212,191,0.12)] sm:min-h-11 sm:rounded-xl sm:text-sm"
                    dir="auto"
                    disabled={busy}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void onSend();
                      }
                    }}
                  />
                ) : null}

                <div
                  className={
                    micListening
                      ? "w-full"
                      : "flex shrink-0 items-end gap-1.5"
                  }
                >
                  {!micListening ? (
                    <button
                      type="button"
                      disabled={busy || attachments.length >= MAX_CHAT_IMAGES}
                      aria-label={t("attachImage")}
                      title={t("attachImage")}
                      onClick={() => fileInputRef.current?.click()}
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-line bg-white/5 text-foreground transition-[transform,background-color,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-accent/40 hover:bg-accent/10 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-45 sm:h-11 sm:w-11"
                    >
                      <ImagePlus className="h-5 w-5" />
                    </button>
                  ) : null}
                  <AiMicButton
                    lang={speechLang}
                    disabled={busy}
                    draft={input}
                    labels={{
                      start: t("micStart"),
                      stop: t("micStop"),
                      unsupported: t("micUnsupported"),
                      listeningHint: t("micListening"),
                    }}
                    onDraftChange={setInput}
                    onListeningChange={setMicListening}
                  />
                  {!micListening ? (
                    busy ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-12 w-12 shrink-0 rounded-full p-0 sm:h-11 sm:w-11"
                        onClick={() => abortRef.current?.abort()}
                        aria-label={t("stop")}
                      >
                        <Square className="h-5 w-5" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-12 w-12 shrink-0 rounded-full p-0 sm:h-11 sm:w-11"
                        onClick={() => void onSend()}
                        disabled={!canSend}
                        aria-label={t("send")}
                      >
                        <Send className="h-5 w-5" />
                      </Button>
                    )
                  ) : null}
                </div>

                {micListening ? (
                  <div
                    ref={(el) => {
                      draftScrollRef.current = el;
                    }}
                    className="max-h-28 min-h-[2.75rem] overflow-y-auto rounded-2xl border border-line/70 bg-white/5 px-3 py-2 text-sm leading-relaxed text-foreground"
                    dir="auto"
                  >
                    {input.trim() ? (
                      input
                    ) : (
                      <span className="text-muted">{t("micListening")}</span>
                    )}
                  </div>
                ) : null}
              </div>
              {busy ? (
                <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-muted">
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                  {statusLabel || t("thinking")}
                </p>
              ) : null}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
