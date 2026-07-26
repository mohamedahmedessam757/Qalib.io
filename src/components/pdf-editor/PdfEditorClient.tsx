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
import {
  ArrowRight,
  CloudUpload,
  Download,
  LoaderCircle,
  MoreVertical,
  Trash2,
  Undo2,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { PDF_MIME } from "@/lib/documents";
import {
  getCachedDocumentMeta,
  setCachedDocumentMeta,
} from "@/lib/document-cache";
import {
  createId,
  exportPdfWithOverlays,
  type PdfOverlay,
  type TextOverlay,
} from "@/lib/pdf/export-overlays";
import { PdfToolbar, type PdfTool } from "./PdfToolbar";

const PdfCanvas = dynamic(
  () => import("./PdfCanvas").then((m) => m.PdfCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
        <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
      </div>
    ),
  },
);

export function PdfEditorClient({
  documentId,
  title,
}: {
  documentId: string;
  title: string;
}) {
  const t = useTranslations("pdfEditor");
  const tc = useTranslations("common");
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [overlays, setOverlays] = useState<PdfOverlay[]>([]);
  const [history, setHistory] = useState<PdfOverlay[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<PdfTool>("select");
  const [fontSize, setFontSize] = useState(14);
  const [color, setColor] = useState("#111827");
  const [loadProgress, setLoadProgress] = useState(0);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImageRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadProgress(8);
      try {
        let signedUrl: string | null = null;
        const cached = getCachedDocumentMeta(documentId);
        if (cached) {
          signedUrl = cached.signedUrl;
          setLoadProgress(35);
        } else {
          const res = await fetch(`/api/documents/${documentId}`);
          const json = await res.json();
          if (!res.ok) {
            toast.error(json.error || tc("error"));
            return;
          }
          signedUrl = json.signedUrl as string;
          setCachedDocumentMeta(documentId, {
            signedUrl,
            title: json.document?.title || title,
          });
          setLoadProgress(35);
        }
        if (!signedUrl || cancelled) return;
        const fileRes = await fetch(signedUrl);
        if (!fileRes.ok) throw new Error("fetch failed");
        const ab = await fileRes.arrayBuffer();
        if (!cancelled) {
          setBuffer(ab);
          setLoadProgress(100);
        }
      } catch {
        if (!cancelled) toast.error(tc("error"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, tc, title]);

  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;

  const pushHistory = useCallback((next: PdfOverlay[]) => {
    setHistory((h) => [...h.slice(-29), overlaysRef.current]);
    setOverlays(next);
  }, []);

  const buildBytes = useCallback(async () => {
    if (!buffer) return null;
    return exportPdfWithOverlays(buffer, overlaysRef.current);
  }, [buffer]);

  const persist = useCallback(async () => {
    const bytes = await buildBytes();
    if (!bytes) return false;
    setSaveState("saving");
    const res = await fetch(`/api/documents/${documentId}`, {
      method: "PUT",
      headers: { "Content-Type": PDF_MIME },
      body: new Blob([new Uint8Array(bytes)], { type: PDF_MIME }),
    });
    if (!res.ok) {
      setSaveState("error");
      toast.error(t("saveError"));
      return false;
    }
    dirtyRef.current = false;
    setSaveState("saved");
    setBuffer(new Uint8Array(bytes).slice().buffer);
    setOverlays([]);
    setHistory([]);
    setSelectedId(null);
    return true;
  }, [buildBytes, documentId, t]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      startTransition(() => {
        void persist();
      });
    }, 2500);
  }, [persist]);

  useEffect(() => {
    const id = setInterval(() => {
      if (dirtyRef.current) void persist();
    }, 60_000);
    return () => clearInterval(id);
  }, [persist]);

  function onUndo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setOverlays(prev);
      markDirty();
      return h.slice(0, -1);
    });
  }

  function onDeleteSelected() {
    if (!selectedId) return;
    pushHistory(overlays.filter((o) => o.id !== selectedId));
    setSelectedId(null);
    markDirty();
  }

  function onAddAt(pageIndex: number, x: number, y: number) {
    if (tool === "text") {
      const overlay: TextOverlay = {
        id: createId("text"),
        type: "text",
        pageIndex,
        x: Math.min(x, 0.75),
        y: Math.min(y, 0.9),
        w: 0.28,
        h: 0.05,
        text: t("textPlaceholder"),
        fontSize,
        color,
      };
      pushHistory([...overlays, overlay]);
      setSelectedId(overlay.id);
      setTool("select");
      markDirty();
      return;
    }
    if (tool === "whiteout") {
      const overlay: PdfOverlay = {
        id: createId("wo"),
        type: "whiteout",
        pageIndex,
        x: Math.min(x, 0.7),
        y: Math.min(y, 0.85),
        w: 0.25,
        h: 0.06,
      };
      pushHistory([...overlays, overlay]);
      setSelectedId(overlay.id);
      setTool("select");
      markDirty();
      return;
    }
    if (tool === "table") {
      const rows = 3;
      const cols = 3;
      const overlay: PdfOverlay = {
        id: createId("table"),
        type: "table",
        pageIndex,
        x: Math.min(x, 0.55),
        y: Math.min(y, 0.7),
        w: 0.4,
        h: 0.22,
        rows,
        cols,
        cells: Array.from({ length: rows * cols }, () => ""),
      };
      pushHistory([...overlays, overlay]);
      setSelectedId(overlay.id);
      setTool("select");
      markDirty();
      return;
    }
    if (tool === "image" && pendingImageRef.current) {
      const overlay: PdfOverlay = {
        id: createId("img"),
        type: "image",
        pageIndex,
        x: Math.min(x, 0.6),
        y: Math.min(y, 0.7),
        w: 0.3,
        h: 0.2,
        dataUrl: pendingImageRef.current,
      };
      pendingImageRef.current = null;
      pushHistory([...overlays, overlay]);
      setSelectedId(overlay.id);
      setTool("select");
      markDirty();
    }
  }

  function onReplaceText(
    pageIndex: number,
    box: { x: number; y: number; w: number; h: number },
    text: string,
  ) {
    const next = window.prompt(t("textPlaceholder"), text);
    if (next === null) return;
    const overlay: TextOverlay = {
      id: createId("text"),
      type: "text",
      pageIndex,
      x: box.x,
      y: box.y,
      w: Math.max(box.w, 0.1),
      h: Math.max(box.h, 0.03),
      text: next,
      fontSize,
      color,
      coverOriginal: true,
    };
    pushHistory([...overlays, overlay]);
    setSelectedId(overlay.id);
    markDirty();
  }

  function onMoveOverlay(id: string, x: number, y: number) {
    setOverlays((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              x: Math.min(1 - o.w, Math.max(0, x)),
              y: Math.min(1 - o.h, Math.max(0, y)),
            }
          : o,
      ),
    );
    markDirty();
  }

  async function onDownload() {
    setMenuOpen(false);
    const bytes = await buildBytes();
    if (!bytes) return;
    const blob = new Blob([new Uint8Array(bytes)], { type: PDF_MIME });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("downloadReady"));
  }

  const selected = overlays.find((o) => o.id === selectedId) || null;

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
      <header className="shrink-0 print:hidden sm:px-4 sm:pt-3">
        <div className="glass editor-chrome mx-auto flex h-12 max-w-[1600px] items-center justify-between gap-2 rounded-none px-2 sm:h-14 sm:rounded-2xl sm:px-3">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <Link href="/documents">
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11 gap-1.5 px-2 sm:min-h-0 sm:min-w-0"
              >
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                <span className="hidden sm:inline">{t("back")}</span>
              </Button>
            </Link>
            <p className="truncate text-sm font-medium sm:max-w-[40vw]">
              {title}
            </p>
            {statusLabel ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-1 text-[11px] text-muted sm:text-xs">
                {(saveState === "saving" || pending) && (
                  <LoaderCircle className="h-3 w-3 animate-spin text-accent" />
                )}
                {statusLabel}
              </span>
            ) : null}
          </div>

          <div className="relative flex items-center gap-1 sm:gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
              onClick={onUndo}
              aria-label={t("undo")}
              title={t("undo")}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
              disabled={!selectedId}
              onClick={onDeleteSelected}
              aria-label={t("delete")}
              title={t("delete")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>

            <div className="hidden items-center gap-1.5 sm:flex">
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
                className="gap-1.5"
                onClick={() => void onDownload()}
              >
                <Download className="h-3.5 w-3.5" />
                {tc("exportPdf")}
              </Button>
            </div>

            <div className="relative sm:hidden">
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
                <div className="glass-strong absolute end-0 top-[calc(100%+6px)] z-30 min-w-[11rem] overflow-hidden rounded-xl py-1">
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
                    {tc("exportPdf")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="glass mx-auto mt-0 max-w-[1600px] border-t-0 sm:mt-2 sm:rounded-2xl">
          <PdfToolbar
            tool={tool}
            fontSize={fontSize}
            color={color}
            labels={{
              select: t("toolSelect"),
              text: t("toolText"),
              image: t("toolImage"),
              table: t("toolTable"),
              whiteout: t("toolWhiteout"),
              fontSize: t("fontSize"),
              fontColor: t("fontColor"),
            }}
            onTool={setTool}
            onFontSize={setFontSize}
            onColor={setColor}
            onPickImage={() => {
              setTool("image");
              imageInputRef.current?.click();
            }}
          />
        </div>
      </header>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            pendingImageRef.current = String(reader.result || "");
            setTool("image");
            toast.message(t("hint"));
          };
          reader.readAsDataURL(file);
          e.target.value = "";
        }}
      />

      <div className="min-h-0 flex-1 overflow-auto sm:px-4 sm:pb-3 sm:pt-2">
        <div className="editor-canvas-frame glass min-h-full overflow-hidden rounded-none sm:rounded-[1.5rem]">
          {!buffer ? (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-3 px-6 text-sm text-muted">
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
            <>
              <p className="px-4 pt-3 text-center text-xs text-muted sm:text-start">
                {t("hint")}
              </p>
              <PdfCanvas
                buffer={buffer}
                overlays={overlays}
                selectedId={selectedId}
                tool={tool}
                onSelectOverlay={setSelectedId}
                onAddAt={onAddAt}
                onReplaceText={onReplaceText}
                onMoveOverlay={onMoveOverlay}
              />
              {selected?.type === "text" ? (
                <div className="sticky bottom-0 border-t border-line bg-[#0a1220]/95 px-3 py-3 backdrop-blur">
                  <textarea
                    className="min-h-20 w-full rounded-xl border border-line bg-white/5 px-3 py-2 text-sm"
                    value={selected.text}
                    dir="auto"
                    onChange={(e) => {
                      const value = e.target.value;
                      setOverlays((prev) =>
                        prev.map((o) =>
                          o.id === selected.id && o.type === "text"
                            ? { ...o, text: value, fontSize, color }
                            : o,
                        ),
                      );
                      markDirty();
                    }}
                  />
                </div>
              ) : null}
              {selected?.type === "table" ? (
                <div className="sticky bottom-0 max-h-48 overflow-auto border-t border-line bg-[#0a1220]/95 px-3 py-3 backdrop-blur">
                  <div
                    className="grid gap-1"
                    style={{
                      gridTemplateColumns: `repeat(${selected.cols}, minmax(0, 1fr))`,
                    }}
                  >
                    {selected.cells.map((cell, i) => (
                      <input
                        key={i}
                        className="rounded-lg border border-line bg-white/5 px-2 py-1.5 text-xs"
                        value={cell}
                        dir="auto"
                        onChange={(e) => {
                          const value = e.target.value;
                          setOverlays((prev) =>
                            prev.map((o) => {
                              if (o.id !== selected.id || o.type !== "table")
                                return o;
                              const cells = [...o.cells];
                              cells[i] = value;
                              return { ...o, cells };
                            }),
                          );
                          markDirty();
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
