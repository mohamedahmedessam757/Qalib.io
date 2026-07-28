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
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRight,
  Bot,
  Circle,
  CloudUpload,
  Download,
  Eraser,
  FilePlus2,
  Frame,
  ImagePlus,
  LoaderCircle,
  Minus,
  MoreVertical,
  MousePointer2,
  PanelTop,
  Plus,
  Slash,
  Square,
  SquareStack,
  Stamp,
  Table2,
  Trash2,
  Type,
  Undo2,
  Wand2,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { useIsMobile } from "@/hooks/useIsMobile";
import { PDF_MIME } from "@/lib/documents";
import {
  getCachedDocumentMeta,
  setCachedDocumentMeta,
} from "@/lib/document-cache";
import {
  createId,
  exportPdfWithOverlays,
  type PdfOverlay,
  type ShapeOverlay,
  type TextOverlay,
} from "@/lib/pdf/export-overlays";
import { hasArabic, organizePdfText } from "@/lib/pdf/arabic-text";
import type { PdfEditorHandle } from "@/lib/ai/apply-pdf-tools";
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

function shapeSize(tool: ShapeOverlay["type"]) {
  if (tool === "fullPageFrame") {
    return { x: 0.04, y: 0.035, w: 0.92, h: 0.93 };
  }
  if (tool === "line") return { w: 0.35, h: 0.02 };
  if (tool === "banner") return { w: 0.7, h: 0.1 };
  if (tool === "border" || tool === "doubleFrame") return { w: 0.72, h: 0.82 };
  if (tool === "stamp") return { w: 0.22, h: 0.22 };
  return { w: 0.32, h: 0.18 };
}

function shapeStrokeWidth(tool: ShapeOverlay["type"]) {
  if (tool === "fullPageFrame") return 3;
  if (tool === "border" || tool === "doubleFrame" || tool === "stamp") return 2.5;
  if (tool === "banner") return 1.25;
  return 1.5;
}

function shapeFillOpacity(tool: ShapeOverlay["type"]) {
  if (tool === "rect" || tool === "oval" || tool === "stamp") return 0.12;
  if (tool === "banner") return 0.18;
  return 0;
}

const SHAPE_TOOLS: ShapeOverlay["type"][] = [
  "rect",
  "border",
  "line",
  "oval",
  "doubleFrame",
  "banner",
  "fullPageFrame",
  "stamp",
];

const DECOR_TOOLS: ShapeOverlay["type"][] = [
  "fullPageFrame",
  "doubleFrame",
  "rect",
  "oval",
  "banner",
  "stamp",
  "line",
];

export function PdfEditorClient({
  documentId,
  title,
}: {
  documentId: string;
  title: string;
}) {
  const t = useTranslations("pdfEditor");
  const tc = useTranslations("common");
  const isMobile = useIsMobile();
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
  const [decorOpen, setDecorOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [deletePageOpen, setDeletePageOpen] = useState(false);
  const [deletingPage, setDeletingPage] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImageRef = useRef<string | null>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const pageCountRef = useRef(1);
  const pdfHandleRef = useRef<PdfEditorHandle | null>(null);
  const dummyEditorRef = useRef(null);

  const setBufferSafe = useCallback((next: ArrayBuffer | null) => {
    bufferRef.current = next;
    setBuffer(next);
  }, []);

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
        if (cancelled) return;
        setBufferSafe(ab);
        setLoadProgress(80);
        try {
          const { PDFDocument } = await import("pdf-lib");
          const pdf = await PDFDocument.load(ab.slice(0));
          if (!cancelled) {
            const count = pdf.getPageCount();
            pageCountRef.current = count;
            setPageCount(count);
          }
        } catch {
          if (!cancelled) {
            pageCountRef.current = 1;
            setPageCount(1);
          }
        }
        if (!cancelled) setLoadProgress(100);
      } catch {
        if (!cancelled) toast.error(tc("error"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, setBufferSafe, tc, title]);

  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  pageCountRef.current = pageCount;

  const pushHistory = useCallback((next: PdfOverlay[]) => {
    setHistory((h) => [...h.slice(-29), overlaysRef.current]);
    setOverlays(next);
  }, []);

  const buildBytes = useCallback(async () => {
    const src = bufferRef.current;
    if (!src) return null;
    return exportPdfWithOverlays(src, overlaysRef.current);
  }, []);

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
    setBufferSafe(new Uint8Array(bytes).slice().buffer);
    setOverlays([]);
    setHistory([]);
    setSelectedId(null);
    return true;
  }, [buildBytes, documentId, setBufferSafe, t]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      startTransition(() => {
        void persist();
      });
    }, 3500);
  }, [persist]);

  useEffect(() => {
    const id = setInterval(() => {
      if (dirtyRef.current) void persist();
    }, 60_000);
    return () => clearInterval(id);
  }, [persist]);

  pdfHandleRef.current = {
    getOverlays: () => overlaysRef.current,
    getPageCount: () => Math.max(1, pageCountRef.current),
    applyOverlays: (next) => {
      pushHistory(next);
      markDirty();
    },
    snapshot: () =>
      JSON.stringify({
        pageCount: pageCountRef.current,
        overlayCount: overlaysRef.current.length,
        overlays: overlaysRef.current.map((o) => ({
          id: o.id,
          type: o.type,
          pageIndex: o.pageIndex,
          ...(o.type === "text" ? { text: o.text, align: o.align, dir: o.dir } : {}),
        })),
      }),
  };

  function onUndo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setOverlays(prev);
      setSelectedId(null);
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

  function makeTextOverlay(
    pageIndex: number,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    coverOriginal?: boolean,
  ): TextOverlay {
    const organized = organizePdfText(text);
    const rtl = hasArabic(organized);
    return {
      id: createId("text"),
      type: "text",
      pageIndex,
      x,
      y,
      w,
      h,
      text: organized,
      fontSize,
      color,
      align: rtl ? "end" : "start",
      dir: rtl ? "rtl" : "ltr",
      coverOriginal,
    };
  }

  function onAddAt(pageIndex: number, x: number, y: number) {
    if (tool === "text") {
      const overlay = makeTextOverlay(
        pageIndex,
        Math.min(x, 0.75),
        Math.min(y, 0.9),
        0.28,
        0.05,
        t("textPlaceholder"),
      );
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
      return;
    }
    if (SHAPE_TOOLS.includes(tool as ShapeOverlay["type"])) {
      const shape = tool as ShapeOverlay["type"];
      const size = shapeSize(shape);
      const overlay: ShapeOverlay = {
        id: createId(shape),
        type: shape,
        pageIndex,
        x:
          shape === "fullPageFrame"
            ? size.x!
            : Math.min(x, 1 - size.w),
        y:
          shape === "fullPageFrame"
            ? size.y!
            : Math.min(y, 1 - size.h),
        w: size.w,
        h: size.h,
        stroke: color,
        strokeWidth: shapeStrokeWidth(shape),
        fill: color,
        fillOpacity: shapeFillOpacity(shape),
      };
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
    const overlay = makeTextOverlay(
      pageIndex,
      box.x,
      box.y,
      Math.max(box.w, 0.1),
      Math.max(box.h, 0.03),
      next,
      true,
    );
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

  function onResizeOverlay(id: string, w: number, h: number) {
    setOverlays((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              w: Math.min(1 - o.x, Math.max(0.04, w)),
              h: Math.min(1 - o.y, Math.max(0.02, h)),
            }
          : o,
      ),
    );
    markDirty();
  }

  function updateSelectedText(
    patch: Partial<Pick<TextOverlay, "text" | "align" | "dir" | "fontSize" | "color">>,
  ) {
    if (!selectedId) return;
    setOverlays((prev) =>
      prev.map((o) => {
        if (o.id !== selectedId || o.type !== "text") return o;
        const text =
          typeof patch.text === "string" ? organizePdfText(patch.text) : o.text;
        const rtl = hasArabic(text);
        return {
          ...o,
          ...patch,
          text,
          fontSize: patch.fontSize ?? fontSize,
          color: patch.color ?? color,
          dir: patch.dir ?? (rtl ? "rtl" : o.dir || "ltr"),
          align:
            patch.align ??
            o.align ??
            (rtl ? "end" : "start"),
        };
      }),
    );
    markDirty();
  }

  function organizeSelectedText() {
    if (!selectedId) return;
    pushHistory(
      overlays.map((o) => {
        if (o.id !== selectedId || o.type !== "text") return o;
        const text = organizePdfText(o.text);
        const rtl = hasArabic(text);
        return {
          ...o,
          text,
          dir: rtl ? "rtl" : "ltr",
          align: rtl ? "end" : o.align || "start",
        };
      }),
    );
    markDirty();
  }

  async function onAddBlankPage() {
    const src = bufferRef.current;
    if (!src) return;
    try {
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.load(src.slice(0));
      const last = pdf.getPage(pdf.getPageCount() - 1);
      const { width, height } = last.getSize();
      pdf.addPage([width, height]);
      const bytes = await pdf.save();
      const next = Uint8Array.from(bytes).buffer;
      setBufferSafe(next);
      setOverlays([]);
      setHistory([]);
      const count = pdf.getPageCount();
      pageCountRef.current = count;
      setPageCount(count);
      setPageIndex(count - 1);
      dirtyRef.current = true;
      markDirty();
      toast.success(t("pageAdd"));
    } catch {
      toast.error(t("saveError"));
    }
  }

  async function onConfirmDeletePage() {
    const src = bufferRef.current;
    if (!src || pageCount <= 1) {
      setDeletePageOpen(false);
      return;
    }
    setDeletingPage(true);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.load(src.slice(0));
      const idx = Math.min(pageIndex, pdf.getPageCount() - 1);
      pdf.removePage(idx);
      const bytes = await pdf.save();
      const next = Uint8Array.from(bytes).buffer;
      setBufferSafe(next);
      setOverlays((prev) =>
        prev
          .filter((o) => o.pageIndex !== idx)
          .map((o) =>
            o.pageIndex > idx ? { ...o, pageIndex: o.pageIndex - 1 } : o,
          ),
      );
      setHistory([]);
      const count = pdf.getPageCount();
      pageCountRef.current = count;
      setPageCount(count);
      setPageIndex(Math.max(0, Math.min(idx, count - 1)));
      dirtyRef.current = true;
      markDirty();
      setDeletePageOpen(false);
    } catch {
      toast.error(t("saveError"));
    } finally {
      setDeletingPage(false);
    }
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
  const selectedTextRtl =
    selected?.type === "text" ? hasArabic(selected.text) : false;

  const statusLabel =
    saveState === "saving" || pending
      ? tc("saving")
      : saveState === "saved"
        ? tc("saved")
        : saveState === "error"
          ? tc("error")
          : null;

  const toolbarLabels = {
    select: t("toolSelect"),
    text: t("toolText"),
    image: t("toolImage"),
    table: t("toolTable"),
    whiteout: t("toolWhiteout"),
    rect: t("toolRect"),
    border: t("toolBorder"),
    line: t("toolLine"),
    oval: t("toolOval"),
    doubleFrame: t("toolDoubleFrame"),
    banner: t("toolBanner"),
    fullPageFrame: t("toolFullPageFrame"),
    stamp: t("toolStamp"),
    fontSize: t("fontSize"),
    fontColor: t("fontColor"),
    zoomIn: t("zoomIn"),
    zoomOut: t("zoomOut"),
  };

  function DockBtn({
    label,
    active,
    disabled,
    onClick,
    children,
  }: {
    label: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) {
    return (
      <Button
        size="sm"
        variant={active ? "solid" : "ghost"}
        className="min-h-11 min-w-11 shrink-0"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={label}
      >
        {children}
      </Button>
    );
  }

  const decorLabel = (id: ShapeOverlay["type"]) => {
    if (id === "fullPageFrame") return t("toolFullPageFrame");
    if (id === "doubleFrame") return t("toolDoubleFrame");
    if (id === "rect") return t("toolRect");
    if (id === "oval") return t("toolOval");
    if (id === "banner") return t("toolBanner");
    if (id === "stamp") return t("toolStamp");
    if (id === "line") return t("toolLine");
    return t("toolBorder");
  };

  const decorIcon = (id: ShapeOverlay["type"]) => {
    if (id === "fullPageFrame") return Frame;
    if (id === "doubleFrame") return SquareStack;
    if (id === "rect") return Square;
    if (id === "oval") return Circle;
    if (id === "banner") return PanelTop;
    if (id === "stamp") return Stamp;
    if (id === "line") return Slash;
    return Frame;
  };

  return (
    <div className="editor-mobile-shell flex h-[100dvh] flex-col bg-[#070b14] pt-[env(safe-area-inset-top)]">
      <header className="relative z-40 shrink-0 print:hidden sm:hidden">
        <div className="glass editor-chrome flex h-12 items-center justify-between gap-2 px-2">
          <div className="flex min-w-0 items-center gap-1.5">
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
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{title}</p>
              {statusLabel ? (
                <p className="truncate text-[10px] text-muted">{statusLabel}</p>
              ) : null}
            </div>
          </div>
          <div className="relative flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11"
              onClick={() => setAiOpen(true)}
              aria-label={t("aiAssistant")}
            >
              <Bot className="h-4 w-4 text-accent" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11"
              disabled={history.length === 0}
              onClick={onUndo}
              aria-label={t("undo")}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11"
              aria-expanded={menuOpen}
              aria-label={t("moreActions")}
              onClick={() => {
                setDecorOpen(false);
                setMenuOpen((v) => !v);
              }}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
            {menuOpen ? (
              <div className="editor-overflow-menu absolute end-0 top-12 z-50 min-w-[12rem] overflow-hidden rounded-xl border border-line bg-[#0d1524] shadow-xl">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-3 text-start text-sm hover:bg-white/8"
                  onClick={() => {
                    setMenuOpen(false);
                    void onAddBlankPage();
                  }}
                >
                  <FilePlus2 className="h-4 w-4" />
                  {t("pageAdd")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-3 text-start text-sm hover:bg-white/8 disabled:opacity-40"
                  disabled={pageCount <= 1}
                  onClick={() => {
                    setMenuOpen(false);
                    setDeletePageOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-danger" />
                  {t("pageDelete")}
                </button>
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
      </header>

      <header className="relative z-40 hidden shrink-0 print:hidden sm:block sm:px-4 sm:pt-3">
        <div className="glass editor-chrome mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-2 rounded-2xl px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/documents">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                <span>{t("back")}</span>
              </Button>
            </Link>
            <p className="truncate text-sm font-medium sm:max-w-[40vw]">
              {title}
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
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onAddBlankPage()}
              aria-label={t("pageAdd")}
              title={t("pageAdd")}
            >
              <FilePlus2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pageCount <= 1}
              onClick={() => setDeletePageOpen(true)}
              aria-label={t("pageDelete")}
              title={t("pageDelete")}
            >
              <Trash2 className="h-4 w-4 text-danger" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={history.length === 0}
              onClick={onUndo}
              aria-label={t("undo")}
              title={t("undo")}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!selectedId}
              onClick={onDeleteSelected}
              aria-label={t("delete")}
              title={t("delete")}
            >
              <Trash2 className="h-4 w-4" />
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
              className="gap-1.5"
              onClick={() => void onDownload()}
            >
              <Download className="h-3.5 w-3.5" />
              {tc("exportPdf")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAiOpen(true)}
              aria-label={t("aiAssistant")}
              title={t("aiAssistant")}
            >
              <Bot className="h-4 w-4 text-accent" />
            </Button>
          </div>
        </div>

        <div className="glass mx-auto mt-2 max-w-[1600px] rounded-2xl">
          <PdfToolbar
            tool={tool}
            fontSize={fontSize}
            color={color}
            zoom={zoom}
            labels={toolbarLabels}
            onTool={setTool}
            onFontSize={setFontSize}
            onColor={setColor}
            onZoomIn={() =>
              setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))
            }
            onZoomOut={() =>
              setZoom((z) => Math.max(0.75, Math.round((z - 0.1) * 10) / 10))
            }
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
        <div className="editor-canvas-frame glass min-h-full overflow-auto rounded-none sm:rounded-[1.5rem]">
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
              <p className="hidden px-4 pt-3 text-center text-xs text-muted sm:block sm:text-start">
                {t("hint")}
              </p>
              <PdfCanvas
                buffer={buffer}
                overlays={overlays}
                selectedId={selectedId}
                tool={tool}
                zoom={zoom}
                onSelectOverlay={(id) => {
                  setSelectedId(id);
                  if (id) {
                    const o = overlays.find((x) => x.id === id);
                    if (o) setPageIndex(o.pageIndex);
                  }
                }}
                onAddAt={(idx, x, y) => {
                  setPageIndex(idx);
                  onAddAt(idx, x, y);
                }}
                onReplaceText={onReplaceText}
                onMoveOverlay={onMoveOverlay}
                onResizeOverlay={onResizeOverlay}
              />
              {selected?.type === "text" ? (
                <div className="sticky bottom-0 border-t border-line bg-[#0a1220]/95 px-3 py-3 backdrop-blur">
                  <div className="mb-2 flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      onClick={organizeSelectedText}
                      title={t("organizeText")}
                    >
                      <Wand2 className="h-4 w-4" />
                      <span className="text-xs">{t("organizeText")}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={selected.align === "start" ? "solid" : "ghost"}
                      onClick={() => updateSelectedText({ align: "start" })}
                      aria-label={t("alignLeft")}
                      title={t("alignLeft")}
                    >
                      <AlignLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant={selected.align === "center" ? "solid" : "ghost"}
                      onClick={() => updateSelectedText({ align: "center" })}
                      aria-label={t("alignCenter")}
                      title={t("alignCenter")}
                    >
                      <AlignCenter className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant={selected.align === "end" ? "solid" : "ghost"}
                      onClick={() => updateSelectedText({ align: "end" })}
                      aria-label={t("alignRight")}
                      title={t("alignRight")}
                    >
                      <AlignRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <textarea
                    className="min-h-20 w-full rounded-xl border border-line bg-white/5 px-3 py-2 text-sm"
                    value={selected.text}
                    dir={selected.dir || (selectedTextRtl ? "rtl" : "ltr")}
                    style={{
                      fontFamily: selectedTextRtl
                        ? '"Noto Sans Arabic", "IBM Plex Sans Arabic", sans-serif'
                        : undefined,
                      textAlign:
                        selected.align === "center"
                          ? "center"
                          : selected.align === "end"
                            ? "right"
                            : "left",
                    }}
                    onChange={(e) => {
                      updateSelectedText({ text: e.target.value });
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
              <ConfirmDialog
                open={deletePageOpen}
                title={t("pageDeleteConfirm")}
                warning={t("pageDeleteWarning")}
                confirmLabel={t("pageDelete")}
                cancelLabel={t("cancel")}
                danger
                submitting={deletingPage}
                onClose={() => setDeletePageOpen(false)}
                onConfirm={() => void onConfirmDeletePage()}
              />
            </>
          )}
        </div>
      </div>

      {isMobile ? (
        <div className="editor-mobile-dock relative z-40 shrink-0 border-t border-line bg-[#0a1220] px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 print:hidden">
          <div className="flex items-center gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none]">
            <DockBtn
              label={t("toolSelect")}
              active={tool === "select"}
              onClick={() => setTool("select")}
            >
              <MousePointer2 className="h-4 w-4" />
            </DockBtn>
            <DockBtn
              label={t("toolText")}
              active={tool === "text"}
              onClick={() => setTool("text")}
            >
              <Type className="h-4 w-4" />
            </DockBtn>
            <DockBtn
              label={t("toolImage")}
              active={tool === "image"}
              onClick={() => {
                setTool("image");
                imageInputRef.current?.click();
              }}
            >
              <ImagePlus className="h-4 w-4" />
            </DockBtn>
            <DockBtn
              label={t("toolTable")}
              active={tool === "table"}
              onClick={() => setTool("table")}
            >
              <Table2 className="h-4 w-4" />
            </DockBtn>
            <DockBtn
              label={t("toolWhiteout")}
              active={tool === "whiteout"}
              onClick={() => setTool("whiteout")}
            >
              <Eraser className="h-4 w-4" />
            </DockBtn>
            <DockBtn
              label={t("toolBorder")}
              active={tool === "border"}
              onClick={() => setTool("border")}
            >
              <Frame className="h-4 w-4" />
            </DockBtn>
            <div className="relative shrink-0">
              <DockBtn
                label={t("decor")}
                active={
                  decorOpen ||
                  DECOR_TOOLS.includes(tool as ShapeOverlay["type"])
                }
                onClick={() => {
                  setMenuOpen(false);
                  setDecorOpen((v) => !v);
                }}
              >
                <SquareStack className="h-4 w-4" />
              </DockBtn>
              {decorOpen ? (
                <div className="absolute bottom-[calc(100%+8px)] start-0 z-50 min-w-[11rem] overflow-hidden rounded-xl border border-line bg-[#0d1524] shadow-xl">
                  <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted">
                    {t("decor")}
                  </p>
                  {DECOR_TOOLS.map((id) => {
                    const Icon = decorIcon(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm hover:bg-white/8 ${
                          tool === id ? "bg-white/10 text-accent" : ""
                        }`}
                        onClick={() => {
                          setTool(id);
                          setDecorOpen(false);
                        }}
                      >
                        <Icon className="h-4 w-4" />
                        {decorLabel(id)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div className="mx-0.5 flex shrink-0 items-center rounded-xl border border-line bg-white/[0.03]">
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 min-w-10 px-1.5"
                onClick={() =>
                  setZoom((z) =>
                    Math.max(0.75, Math.round((z - 0.1) * 10) / 10),
                  )
                }
                aria-label={t("zoomOut")}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="min-w-[2.5rem] text-center text-[11px] tabular-nums text-muted">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 min-w-10 px-1.5"
                onClick={() =>
                  setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))
                }
                aria-label={t("zoomIn")}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <DockBtn
              label={t("delete")}
              disabled={!selectedId}
              onClick={onDeleteSelected}
            >
              <Trash2 className="h-4 w-4 text-danger" />
            </DockBtn>
          </div>
        </div>
      ) : null}

      <AiChatPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        documentId={documentId}
        editorRef={dummyEditorRef}
        docKind="pdf"
        pdfRef={pdfHandleRef}
        onDocMutated={markDirty}
      />
    </div>
  );
}
