"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { findParaIdRange } from "@eigenpal/docx-editor-core/prosemirror/paraText";
import {
  ArrowRight,
  Bot,
  CloudUpload,
  Download,
  FileDown,
  FilePlus2,
  Frame,
  ListTree,
  LoaderCircle,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Scan,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { DOCX_MIME } from "@/lib/documents";
import { downloadPdfBlob } from "@/lib/export-docx-pdf";
import {
  getCachedDocumentMeta,
  setCachedDocumentMeta,
} from "@/lib/document-cache";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  applyPageFrame,
  applyTextWatermark,
  type PageFrameStyle,
} from "@/lib/docx/decor";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import {
  SelectionEditSheet,
  type SelectionDraft,
} from "./SelectionEditSheet";
import {
  ParagraphJumpSheet,
  type ParagraphJumpItem,
} from "./ParagraphJumpSheet";
import type { DocxCanvasHandle } from "./DocxCanvas";

function EditorChunkLoading() {
  const t = useTranslations("editor");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-sm text-muted">
      <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
      <p>{t("loadingDoc")}</p>
    </div>
  );
}

const DocxCanvas = dynamic(
  () => import("./DocxCanvas").then((m) => m.DocxCanvas),
  { ssr: false, loading: () => <EditorChunkLoading /> },
);

function replaceParagraphText(
  editor: DocxCanvasHandle,
  paraId: string,
  nextText: string,
): boolean {
  const view = editor.getEditorRef()?.getView();
  if (!view) {
    const ok = editor.proposeChange({
      paraId,
      search: "",
      replaceWith: nextText,
      author: "Qalib",
    });
    return ok;
  }

  const range = findParaIdRange(view.state.doc, paraId);
  if (!range) return false;

  const from = range.from + 1;
  const to = range.to - 1;
  if (from > to) return false;

  const tr = view.state.tr.insertText(nextText, from, to);
  view.dispatch(tr);
  return true;
}

export function DocxEditorClient({
  documentId,
  title,
}: {
  documentId: string;
  title: string;
}) {
  const t = useTranslations("editor");
  const tc = useTranslations("common");
  const isMobile = useIsMobile();
  const editorRef = useRef<DocxCanvasHandle | null>(null);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState(`${title}.docx`);
  const [displayTitle, setDisplayTitle] = useState(title);
  const [loadProgress, setLoadProgress] = useState(0);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpItems, setJumpItems] = useState<ParagraphJumpItem[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const [mobileHasSelection, setMobileHasSelection] = useState(false);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadProgress(8);
      try {
        let signedUrl: string | null = null;
        let nextTitle = title;
        const cached = getCachedDocumentMeta(documentId);
        if (cached) {
          signedUrl = cached.signedUrl;
          nextTitle = cached.title || title;
          setLoadProgress(35);
        } else {
          const res = await fetch(`/api/documents/${documentId}`);
          const json = await res.json();
          if (!res.ok) {
            toast.error(json.error || tc("error"));
            return;
          }
          signedUrl = json.signedUrl as string;
          nextTitle = json.document?.title || title;
          setCachedDocumentMeta(documentId, {
            signedUrl,
            title: nextTitle,
          });
          setLoadProgress(35);
        }

        if (!signedUrl || cancelled) return;
        const fileRes = await fetch(signedUrl);
        if (!fileRes.ok) throw new Error("fetch failed");

        const total = Number(fileRes.headers.get("content-length") || 0);
        if (fileRes.body && total > 0) {
          const reader = fileRes.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.length;
              if (!cancelled) {
                setLoadProgress(
                  Math.min(92, 35 + Math.round((received / total) * 55)),
                );
              }
            }
          }
          const merged = new Uint8Array(received);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          if (!cancelled) {
            setBuffer(merged.buffer);
            setFileName(`${nextTitle}.docx`);
            setDisplayTitle(nextTitle);
            setLoadProgress(100);
            if (merged.byteLength > 8 * 1024 * 1024) {
              toast.message(t("largeFile"));
            }
          }
        } else {
          const ab = await fileRes.arrayBuffer();
          if (!cancelled) {
            setBuffer(ab);
            setFileName(`${nextTitle}.docx`);
            setDisplayTitle(nextTitle);
            setLoadProgress(100);
            if (ab.byteLength > 8 * 1024 * 1024) {
              toast.message(t("largeFile"));
            }
          }
        }
      } catch {
        if (!cancelled) toast.error(tc("error"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, t, tc, title]);

  const persist = useCallback(async () => {
    const out = await editorRef.current?.save();
    if (!out) return false;
    setSaveState("saving");

    const res = await fetch(`/api/documents/${documentId}`, {
      method: "PUT",
      headers: { "Content-Type": DOCX_MIME },
      body: out,
    });
    if (!res.ok) {
      setSaveState("error");
      toast.error(t("saveError"));
      return false;
    }
    dirtyRef.current = false;
    setSaveState("saved");
    return true;
  }, [documentId, t]);

  useEffect(() => {
    const onInterval = () => {
      if (!dirtyRef.current) return;
      void persist();
    };
    const id = setInterval(onInterval, 60_000);
    return () => clearInterval(id);
  }, [persist]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist();
    }, 2500);
  }, [persist]);

  const openSelectionSheet = useCallback(() => {
    const info = editorRef.current?.getSelectionInfo();
    if (!info?.paraId) {
      toast.message(t("editSelectionHint"));
      return;
    }
    setDraft({
      paraId: info.paraId,
      paragraphText: info.paragraphText || info.selectedText || "",
      selectedText: info.selectedText || "",
    });
    setSheetOpen(true);
  }, [t]);

  const onSelectionChange = useCallback(() => {
    if (!isMobile) return;
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    selectionTimer.current = setTimeout(() => {
      const info = editorRef.current?.getSelectionInfo();
      if (!info?.paraId) {
        setMobileHasSelection(false);
        return;
      }
      const selected = Boolean(info.selectedText?.trim());
      setMobileHasSelection(selected);
      if (!selected) return;
      // Keep sheet open if already editing; otherwise open for the selection
      if (!sheetOpen) openSelectionSheet();
    }, 280);
  }, [isMobile, openSelectionSheet, sheetOpen]);

  function onZoomOut() {
    const editor = editorRef.current;
    if (!editor?.adjustZoom) return;
    const z = editor.adjustZoom(-0.15);
    setZoomPct(Math.round(z * 100));
  }

  function onZoomIn() {
    const editor = editorRef.current;
    if (!editor?.adjustZoom) return;
    const z = editor.adjustZoom(0.15);
    setZoomPct(Math.round(z * 100));
  }

  function onFit() {
    editorRef.current?.fitToWidth();
    // read after layout settles
    window.setTimeout(() => {
      const z = editorRef.current?.getZoomLevel?.() ?? 1;
      setZoomPct(Math.round(z * 100));
    }, 80);
  }

  function onApplyFrame(style: PageFrameStyle) {
    setMenuOpen(false);
    const editor = editorRef.current;
    const doc = editor?.getDocument?.();
    if (!editor || !doc) {
      toast.error(t("applyError"));
      return;
    }
    try {
      const next = applyPageFrame(doc, style);
      editor.loadDocument(next);
      markDirty();
      toast.success(t("frameApplied"));
    } catch {
      toast.error(t("applyError"));
    }
  }

  function onApplyWatermark() {
    setMenuOpen(false);
    const editor = editorRef.current;
    const doc = editor?.getDocument?.();
    if (!editor || !doc) {
      toast.error(t("applyError"));
      return;
    }
    const text = window.prompt(t("watermark"), "DRAFT");
    if (text === null) return;
    try {
      const next = applyTextWatermark(doc, text.trim() || null);
      editor.loadDocument(next);
      markDirty();
      toast.success(t("watermarkApplied"));
    } catch {
      toast.error(t("applyError"));
    }
  }

  function onAddPage() {
    const editor = editorRef.current;
    if (!editor) {
      toast.error(t("applyError"));
      return;
    }
    const info = editor.getSelectionInfo?.();
    let paraId = info?.paraId || null;
    if (!paraId) {
      const total = Math.max(1, editor.getTotalPages?.() || 1);
      for (let page = total; page >= 1; page -= 1) {
        const content = editor.getPageContent?.(page);
        const paras = content?.paragraphs || [];
        const last = paras[paras.length - 1];
        if (last?.paraId) {
          paraId = last.paraId;
          break;
        }
      }
    }
    if (!paraId) {
      toast.message(t("editSelectionHint"));
      return;
    }
    const ok = editor.insertBreak({ paraId, type: "page" });
    if (!ok) {
      toast.error(t("applyError"));
      return;
    }
    markDirty();
    toast.success(t("pageAdd"));
    window.setTimeout(() => {
      const pages = editor.getTotalPages?.() || 1;
      editor.scrollToPage?.(pages);
    }, 120);
  }

  async function onDownload() {
    setMenuOpen(false);
    const out = await editorRef.current?.save();
    if (!out) return;
    const blob = new Blob([out], { type: DOCX_MIME });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.endsWith(".docx") ? fileName : `${fileName}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("downloadReady"));
  }

  async function onPdf() {
    setMenuOpen(false);
    toast.message(t("pdfHint"));
    try {
      const blob = await editorRef.current?.printDocument?.();
      if (!blob) throw new Error("export failed");
      const base =
        fileName.replace(/\.docx$/i, "") || displayTitle || "document";
      await downloadPdfBlob(blob, base);
      toast.success(t("downloadReady"));
    } catch (err) {
      if (
        (err instanceof DOMException || err instanceof Error) &&
        err.name === "AbortError"
      ) {
        return;
      }
      toast.error(t("pdfExportError"));
    }
  }

  function collectParagraphs(): ParagraphJumpItem[] {
    const editor = editorRef.current;
    if (!editor) return [];
    const total = editor.getTotalPages() || 1;
    const seen = new Set<string>();
    const items: ParagraphJumpItem[] = [];
    for (let page = 1; page <= total; page += 1) {
      const content = editor.getPageContent(page);
      if (!content) continue;
      for (const p of content.paragraphs) {
        if (!p.paraId || seen.has(p.paraId)) continue;
        seen.add(p.paraId);
        const text = (p.text || "").trim();
        items.push({
          paraId: p.paraId,
          text: text || "…",
        });
      }
    }
    return items;
  }

  function onApplyParagraph(nextText: string) {
    if (!draft) return;
    if (!nextText.trim() && draft.paragraphText.trim()) {
      // Emptying a non-empty paragraph requires explicit delete action
      toast.message(t("deleteConfirm"));
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const ok = replaceParagraphText(editor, draft.paraId, nextText);
    if (!ok) {
      toast.error(t("applyError"));
      return;
    }
    editor.scrollToParaId(draft.paraId);
    markDirty();
    setSheetOpen(false);
    setDraft(null);
  }

  function onDeleteParagraph() {
    if (!draft) return;
    const editor = editorRef.current;
    if (!editor) return;
    const ok = replaceParagraphText(editor, draft.paraId, "");
    if (!ok) {
      toast.error(t("applyError"));
      return;
    }
    markDirty();
    setSheetOpen(false);
    setDraft(null);
  }

  const statusLabel =
    saveState === "saving" || pending
      ? tc("saving")
      : saveState === "saved"
        ? tc("saved")
        : saveState === "error"
          ? tc("error")
          : null;

  return (
    <div className="editor-mobile-shell flex h-[100dvh] flex-col bg-[#070b14] pt-[env(safe-area-inset-top)]">
      {/* —— Mobile app chrome —— */}
      <header className="relative z-40 shrink-0 print:hidden sm:hidden">
        <div className="editor-chrome flex h-12 items-center justify-between gap-2 border-b border-line px-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <Link href="/documents">
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11 px-2"
                aria-label={t("back")}
              >
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayTitle}</p>
              {statusLabel ? (
                <p className="truncate text-[10px] text-muted">{statusLabel}</p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11 px-2"
              onClick={() => setAiOpen(true)}
              aria-label={t("aiAssistant")}
            >
              <Bot className="h-5 w-5 text-accent" />
            </Button>
            <div className="relative">
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 min-w-11 px-2"
                aria-expanded={menuOpen}
                aria-label={t("moreActions")}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
              {menuOpen ? (
                <div className="editor-overflow-menu glass-strong absolute end-0 top-[calc(100%+6px)] z-50 min-w-[12rem] overflow-hidden rounded-xl py-1 shadow-[0_16px_40px_rgba(0,0,0,0.55)]">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-3 text-start text-sm hover:bg-white/8"
                    onClick={() => {
                      setMenuOpen(false);
                      startTransition(() => {
                        void persist();
                      });
                    }}
                  >
                    <CloudUpload className="h-4 w-4" />
                    {tc("save")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-3 text-start text-sm hover:bg-white/8"
                    onClick={() => void onDownload()}
                  >
                    <Download className="h-4 w-4" />
                    {tc("download")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-3 text-start text-sm hover:bg-white/8"
                    onClick={onPdf}
                  >
                    <FileDown className="h-4 w-4" />
                    {tc("exportPdf")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-3 text-start text-sm hover:bg-white/8"
                    onClick={() => {
                      setMenuOpen(false);
                      setJumpItems(collectParagraphs());
                      setJumpOpen(true);
                    }}
                  >
                    <ListTree className="h-4 w-4" />
                    {t("paragraphs")}
                  </button>
                  <div className="my-1 border-t border-line" />
                  <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted">
                    {t("decor")}
                  </p>
                  {(
                    [
                      ["single", "pageFrameSingle"],
                      ["double", "pageFrameDouble"],
                      ["thick", "pageFrameThick"],
                      ["dashed", "pageFrameDashed"],
                      ["none", "pageFrameNone"],
                    ] as const
                  ).map(([style, key]) => (
                    <button
                      key={style}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm hover:bg-white/8"
                      onClick={() => onApplyFrame(style)}
                    >
                      <Frame className="h-4 w-4" />
                      {t(key)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-3 text-start text-sm hover:bg-white/8"
                    onClick={onApplyWatermark}
                  >
                    <Scan className="h-4 w-4" />
                    {t("watermark")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {/* —— Desktop chrome —— */}
      <header className="relative z-40 hidden shrink-0 print:hidden sm:block sm:px-4 sm:pt-3">
        <div className="glass editor-chrome relative z-40 mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-2 rounded-2xl px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/documents">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                <span>{t("back")}</span>
              </Button>
            </Link>
            <p className="truncate text-sm font-medium sm:max-w-[40vw]">
              {displayTitle}
            </p>
            {statusLabel ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-1 text-xs text-muted">
                {(saveState === "saving" || pending) && (
                  <LoaderCircle className="h-3 w-3 animate-spin text-accent" />
                )}
                {statusLabel}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 rounded-xl border border-line bg-white/[0.03] px-0.5">
              <Button
                size="sm"
                variant="ghost"
                className="min-h-9 min-w-8 px-1.5"
                onClick={onZoomOut}
                aria-label={t("zoomOut")}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="min-w-[2.75rem] text-center text-[11px] tabular-nums text-muted">
                {zoomPct}%
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-9 min-w-8 px-1.5"
                onClick={onZoomIn}
                aria-label={t("zoomIn")}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <Button size="sm" variant="ghost" onClick={onFit} title={t("fitWidth")}>
              <Scan className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onAddPage} title={t("pageAdd")}>
              <FilePlus2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onApplyFrame("double")}
              title={t("pageFrame")}
            >
              <Frame className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onApplyWatermark}
              title={t("watermark")}
            >
              <Scan className="h-4 w-4 text-accent" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setJumpItems(collectParagraphs());
                setJumpOpen(true);
              }}
              title={t("paragraphs")}
            >
              <ListTree className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openSelectionSheet()}
              title={t("editSelection")}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAiOpen(true)}
              title={t("aiAssistant")}
            >
              <Bot className="h-4 w-4 text-accent" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() =>
                startTransition(() => {
                  void persist();
                })
              }
            >
              <CloudUpload className="h-3.5 w-3.5" />
              {tc("save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => void onDownload()}
            >
              <Download className="h-3.5 w-3.5" />
              {tc("download")}
            </Button>
            <Button size="sm" className="gap-1.5" onClick={onPdf}>
              <FileDown className="h-3.5 w-3.5" />
              {tc("exportPdf")}
            </Button>
          </div>
        </div>
      </header>

      <div className="relative z-0 min-h-0 flex-1 overflow-hidden pb-[calc(3.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:pb-3 sm:pt-3">
        <div className="editor-canvas-frame glass h-full overflow-hidden rounded-none sm:rounded-[1.5rem]">
          {!buffer ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-sm text-muted">
              <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
              <p>{t("loadingDoc")}</p>
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-200"
                  style={{ width: `${Math.max(loadProgress, 6)}%` }}
                />
              </div>
            </div>
          ) : (
            <DocxCanvas
              ref={editorRef}
              documentBuffer={buffer}
              compactChrome={isMobile}
              onChange={markDirty}
              onSelectionChange={onSelectionChange}
              onZoomChange={(z) => setZoomPct(Math.round(z * 100))}
              onReady={() => {
                // DocxCanvas already fits once on view-ready; only sync % label.
                window.setTimeout(() => {
                  const z = editorRef.current?.getZoomLevel?.() ?? 1;
                  setZoomPct(Math.round(z * 100));
                }, 100);
              }}
            />
          )}
        </div>
      </div>

      {/* Mobile bottom dock — like a native app */}
      <nav
        className="editor-mobile-dock fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[#0c1422] pb-[env(safe-area-inset-bottom)] sm:hidden"
        aria-label={t("moreActions")}
      >
        <div className="mx-auto flex h-[3.75rem] max-w-lg items-center justify-around px-1">
          <button
            type="button"
            className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-xl text-muted active:bg-white/8"
            onClick={onZoomOut}
            aria-label={t("zoomOut")}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex min-h-11 min-w-[3.25rem] flex-col items-center justify-center rounded-xl text-[11px] font-medium tabular-nums text-foreground active:bg-white/8"
            onClick={onFit}
            aria-label={t("fitWidth")}
            title={t("fitWidth")}
          >
            {zoomPct}%
          </button>
          <button
            type="button"
            className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-xl text-muted active:bg-white/8"
            onClick={onZoomIn}
            aria-label={t("zoomIn")}
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-xl text-muted active:bg-white/8"
            onClick={onAddPage}
            aria-label={t("pageAdd")}
          >
            <FilePlus2 className="h-4 w-4" />
            <span className="text-[9px]">{t("pageAddShort")}</span>
          </button>
          <button
            type="button"
            className={`flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-xl active:bg-white/8 ${
              mobileHasSelection ? "text-accent" : "text-muted"
            }`}
            onClick={() => openSelectionSheet()}
            aria-label={t("editSelection")}
          >
            <Pencil className="h-4 w-4" />
            <span className="text-[9px]">{t("editShort")}</span>
          </button>
        </div>
      </nav>

      <SelectionEditSheet
        open={sheetOpen}
        draft={draft}
        labels={{
          title: t("editSelection"),
          apply: t("apply"),
          cancel: t("cancel"),
          deleteSelection: t("deleteSelection"),
          deleteConfirm: t("deleteConfirm"),
          placeholder: t("editPlaceholder"),
        }}
        onClose={() => {
          setSheetOpen(false);
          setDraft(null);
          setMobileHasSelection(false);
        }}
        onApply={onApplyParagraph}
        onDelete={onDeleteParagraph}
      />

      <ParagraphJumpSheet
        open={jumpOpen}
        items={jumpItems}
        labels={{
          title: t("paragraphs"),
          empty: t("paragraphsEmpty"),
          close: t("cancel"),
        }}
        onClose={() => setJumpOpen(false)}
        onJump={(paraId) => {
          editorRef.current?.scrollToParaId(paraId, {
            highlight: { color: "rgba(45, 212, 191, 0.45)" },
          });
          setJumpOpen(false);
        }}
      />

      <AiChatPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        documentId={documentId}
        editorRef={editorRef}
        onDocMutated={markDirty}
        onTitleChanged={(next) => {
          setDisplayTitle(next);
          setFileName(`${next}.docx`);
        }}
      />
    </div>
  );
}
