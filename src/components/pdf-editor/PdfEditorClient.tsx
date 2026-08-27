"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import dynamic from "next/dynamic";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRight,
  Bold,
  Bot,
  Italic,
  Underline,
  Circle,
  CloudUpload,
  Download,
  Eraser,
  FilePlus2,
  Frame,
  ImagePlus,
  Layers,
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
  canSharePdfFiles,
  createPdfObjectUrl,
  downloadPdfBlob,
  materializePdfFile,
  revokePdfObjectUrlSoon,
  sanitizePdfBaseName,
  sharePdfFile,
  writePdfToFileHandle,
} from "@/lib/export-docx-pdf";
import { hasSaveFilePicker, isAppleTouchDevice } from "@/lib/device";
import {
  getCachedDocumentMeta,
  setCachedDocumentMeta,
} from "@/lib/document-cache";
import {
  createId,
  exportPdfWithOverlays,
  ArabicRasterizeError,
  type PdfOverlay,
  type ShapeOverlay,
  type TextOverlay,
} from "@/lib/pdf/export-overlays";
import { hasArabic, organizePdfText } from "@/lib/pdf/arabic-text";
import { ensureNotoArabicFont } from "@/lib/pdf/arabic-canvas";
import { findLegacyBlankTitleBox } from "@/lib/pdf/strip-legacy-title";
import type { PdfEditorHandle } from "@/lib/ai/apply-pdf-tools";
import { PdfToolbar, type PdfTool } from "./PdfToolbar";
import {
  EditPdfTextDialog,
  isPdfSeedTextUnreadable,
} from "./EditPdfTextDialog";
import { PdfSidePanel, type PdfSideTab } from "./PdfSidePanel";
import {
  ExportPdfDialog,
  type ExportPdfFormValues,
  type ExportPdfPhase,
} from "@/components/editor/ExportPdfDialog";

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
  const te = useTranslations("editor");
  const locale = useLocale();
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
  const [pdfExportOpen, setPdfExportOpen] = useState(false);
  const [pdfExportPhase, setPdfExportPhase] = useState<ExportPdfPhase>("form");
  const [replaceDialog, setReplaceDialog] = useState<{
    mode: "add" | "replace" | "edit";
    pageIndex: number;
    box: { x: number; y: number; w: number; h: number };
    seedText: string;
    unreadable: boolean;
    editOverlayId?: string;
  } | null>(null);
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  const [textFontFamily, setTextFontFamily] = useState<
    "noto" | "sans" | "serif"
  >("noto");
  const [clipboardVersion, setClipboardVersion] = useState(0);
  const [sidePanelOpen, setSidePanelOpen] = useState(!isMobile);
  const [sideTab, setSideTab] = useState<PdfSideTab>("layers");
  const [mobileSideOpen, setMobileSideOpen] = useState(false);
  const [pdfReadyFile, setPdfReadyFile] = useState<File | null>(null);
  const [pdfReadyUrl, setPdfReadyUrl] = useState<string | null>(null);
  // Read when the dialog opens: these APIs do not exist during SSR.
  const [pdfCaps, setPdfCaps] = useState({
    isApple: false,
    canPickPath: false,
    canShare: false,
  });
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImageRef = useRef<string | null>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const pageCountRef = useRef(1);
  const pdfHandleRef = useRef<PdfEditorHandle | null>(null);
  const dummyEditorRef = useRef(null);
  const pdfExportBusyRef = useRef(false);
  const persistingRef = useRef(false);
  const pdfReadyUrlRef = useRef<string | null>(null);
  const lastExportValuesRef = useRef<ExportPdfFormValues | null>(null);
  const overlayClipboardRef = useRef<PdfOverlay | null>(null);

  const setBufferSafe = useCallback((next: ArrayBuffer | null) => {
    bufferRef.current = next;
    setBuffer(next);
  }, []);

  useEffect(() => {
    return () => {
      if (pdfReadyUrlRef.current) {
        revokePdfObjectUrlSoon(pdfReadyUrlRef.current);
        pdfReadyUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    void ensureNotoArabicFont();
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

        let working = ab;
        let stripped = false;
        // Cover the old non-deletable "مستند PDF جديد" baked into early blanks.
        try {
          const box = await findLegacyBlankTitleBox(working);
          if (box && !cancelled) {
            const covered = await exportPdfWithOverlays(working, [
              {
                id: createId("wo"),
                type: "whiteout",
                pageIndex: 0,
                x: Math.max(0, box.x - 0.01),
                y: Math.max(0, box.y - 0.005),
                w: Math.min(0.95, Math.max(box.w + 0.02, 0.25)),
                h: Math.min(0.12, Math.max(box.h + 0.01, 0.04)),
              },
            ]);
            working = Uint8Array.from(covered).buffer as ArrayBuffer;
            stripped = true;
          }
        } catch {
          /* keep original */
        }

        if (cancelled) return;
        setBufferSafe(working);
        setLoadProgress(80);
        try {
          const { PDFDocument } = await import("pdf-lib");
          const pdf = await PDFDocument.load(working.slice(0));
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
        if (stripped && !cancelled) {
          try {
            await fetch(`/api/documents/${documentId}`, {
              method: "PUT",
              headers: { "Content-Type": PDF_MIME },
              body: new Blob([new Uint8Array(working)], { type: PDF_MIME }),
            });
          } catch {
            /* will retry on next save */
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

  const bakeOverlaysIntoBuffer = useCallback(async () => {
    const src = bufferRef.current;
    if (!src) return null;
    if (overlaysRef.current.length === 0) return src.slice(0);
    const bytes = await exportPdfWithOverlays(src, overlaysRef.current);
    return Uint8Array.from(bytes).buffer as ArrayBuffer;
  }, []);

  const persist = useCallback(async () => {
    if (persistingRef.current) return false;
    persistingRef.current = true;
    try {
      const bytes = await buildBytes();
      if (!bytes) return false;
      setSaveState("saving");
      toast.message(t("savingOverlay"));
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
      toast.success(tc("saved"));
      return true;
    } catch (err) {
      setSaveState("error");
      if (err instanceof ArabicRasterizeError) {
        toast.error(t("arabicExportFailed"));
      } else {
        toast.error(t("saveError"));
      }
      return false;
    } finally {
      persistingRef.current = false;
    }
  }, [buildBytes, documentId, setBufferSafe, t, tc]);

  // Dirty flag only — never auto-bake. Bake on Save / Export / page ops.
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("idle");
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

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
    format?: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      fontSize?: number;
      fontFamily?: "noto" | "sans" | "serif";
      color?: string;
    },
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
      fontSize: format?.fontSize ?? fontSize,
      color: format?.color ?? color,
      bold: format?.bold ?? textBold,
      italic: format?.italic ?? textItalic,
      underline: format?.underline ?? textUnderline,
      fontFamily: format?.fontFamily ?? textFontFamily,
      align: rtl ? "end" : "start",
      dir: rtl ? "rtl" : "ltr",
      coverOriginal,
    };
  }

  function onAddAt(pageIndex: number, x: number, y: number) {
    if (tool === "text") {
      setReplaceDialog({
        mode: "add",
        pageIndex,
        box: {
          x: Math.min(x, 0.75),
          y: Math.min(y, 0.9),
          w: 0.28,
          h: 0.05,
        },
        seedText: "",
        unreadable: false,
      });
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
    setReplaceDialog({
      mode: "replace",
      pageIndex,
      box,
      seedText: text,
      unreadable: isPdfSeedTextUnreadable(text),
    });
  }

  function submitReplaceText(result: {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    fontSize: number;
    fontFamily: "noto" | "sans" | "serif";
    color: string;
  }) {
    if (!replaceDialog) return;
    const trimmed = result.text.trim();
    if (!trimmed && replaceDialog.mode === "add") {
      setReplaceDialog(null);
      setTool("select");
      return;
    }
    setTextBold(result.bold);
    setTextItalic(result.italic);
    setTextUnderline(result.underline);
    setFontSize(result.fontSize);
    setTextFontFamily(result.fontFamily);
    setColor(result.color);
    const format = {
      bold: result.bold,
      italic: result.italic,
      underline: result.underline,
      fontSize: result.fontSize,
      fontFamily: result.fontFamily,
      color: result.color,
    };
    const { pageIndex, box, editOverlayId, mode } = replaceDialog;
    if (editOverlayId || mode === "edit") {
      const id = editOverlayId;
      if (!id) {
        setReplaceDialog(null);
        return;
      }
      setOverlays((prev) =>
        prev.map((o) => {
          if (o.id !== id || o.type !== "text") return o;
          const text = organizePdfText(result.text);
          const rtl = hasArabic(text);
          return {
            ...o,
            ...format,
            text,
            dir: rtl ? "rtl" : "ltr",
            align: rtl ? "end" : o.align || "start",
          };
        }),
      );
      setSelectedId(id);
      markDirty();
      setReplaceDialog(null);
      setTool("select");
      return;
    }
    if (mode === "add") {
      const overlay = makeTextOverlay(
        pageIndex,
        box.x,
        box.y,
        Math.max(box.w, 0.1),
        Math.max(box.h, 0.03),
        result.text,
        false,
        format,
      );
      pushHistory([...overlays, overlay]);
      setSelectedId(overlay.id);
      markDirty();
      setReplaceDialog(null);
      setTool("select");
      return;
    }
    const overlay = makeTextOverlay(
      pageIndex,
      box.x,
      box.y,
      Math.max(box.w, 0.1),
      Math.max(box.h, 0.03),
      result.text,
      true,
      format,
    );
    pushHistory([...overlays, overlay]);
    setSelectedId(overlay.id);
    markDirty();
    setReplaceDialog(null);
    setTool("select");
  }

  function scrollToOverlay(id: string) {
    const safe =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const el = document.querySelector(`[data-overlay-id="${safe}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function syncTextFormatFromOverlay(overlay: TextOverlay) {
    setTextBold(Boolean(overlay.bold));
    setTextItalic(Boolean(overlay.italic));
    setTextUnderline(Boolean(overlay.underline));
    setFontSize(overlay.fontSize);
    setTextFontFamily(overlay.fontFamily || "noto");
    setColor(overlay.color || "#111827");
  }

  function onSelectLayerFromPanel(id: string) {
    setSelectedId(id);
    const o = overlays.find((x) => x.id === id);
    if (o) {
      setPageIndex(o.pageIndex);
      if (o.type === "text") syncTextFormatFromOverlay(o);
      window.setTimeout(() => scrollToOverlay(id), 80);
    }
  }

  function onEditTextFromPanel(overlay: TextOverlay) {
    setSelectedId(overlay.id);
    setPageIndex(overlay.pageIndex);
    syncTextFormatFromOverlay(overlay);
    setReplaceDialog({
      mode: "edit",
      pageIndex: overlay.pageIndex,
      box: { x: overlay.x, y: overlay.y, w: overlay.w, h: overlay.h },
      seedText: overlay.text,
      unreadable: false,
      editOverlayId: overlay.id,
    });
  }

  function onDeleteLayerFromPanel(id: string) {
    pushHistory(overlays.filter((o) => o.id !== id));
    if (selectedId === id) setSelectedId(null);
    markDirty();
  }

  function cloneOverlay(
    source: PdfOverlay,
    opts?: { pageIndex?: number; offset?: boolean },
  ): PdfOverlay {
    const offset = opts?.offset !== false ? 0.03 : 0;
    const page = opts?.pageIndex ?? source.pageIndex;
    const x = Math.min(1 - source.w, Math.max(0, source.x + offset));
    const y = Math.min(1 - source.h, Math.max(0, source.y + offset));
    if (source.type === "table") {
      return {
        ...source,
        id: createId("table"),
        pageIndex: page,
        x,
        y,
        cells: [...source.cells],
      };
    }
    if (source.type === "image") {
      return {
        ...source,
        id: createId("img"),
        pageIndex: page,
        x,
        y,
      };
    }
    if (source.type === "text") {
      return {
        ...source,
        id: createId("text"),
        pageIndex: page,
        x,
        y,
      };
    }
    if (source.type === "whiteout") {
      return {
        ...source,
        id: createId("wo"),
        pageIndex: page,
        x,
        y,
      };
    }
    return {
      ...source,
      id: createId(source.type),
      pageIndex: page,
      x,
      y,
    };
  }

  function onCopyLayer(id: string) {
    const src = overlays.find((o) => o.id === id);
    if (!src) return;
    overlayClipboardRef.current = cloneOverlay(src, { offset: false });
    setClipboardVersion((v) => v + 1);
    toast.message(t("layerCopied"));
  }

  function onDuplicateLayer(id: string) {
    const src = overlays.find((o) => o.id === id);
    if (!src) return;
    const dup = cloneOverlay(src, { offset: true });
    pushHistory([...overlays, dup]);
    setSelectedId(dup.id);
    setPageIndex(dup.pageIndex);
    markDirty();
  }

  function onPasteLayer() {
    const clip = overlayClipboardRef.current;
    if (!clip) return;
    const pasted = cloneOverlay(clip, {
      pageIndex,
      offset: true,
    });
    pushHistory([...overlays, pasted]);
    setSelectedId(pasted.id);
    markDirty();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable
      ) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "c" && selectedId) {
        e.preventDefault();
        onCopyLayer(selectedId);
      } else if (key === "v" && overlayClipboardRef.current) {
        e.preventDefault();
        onPasteLayer();
      } else if (key === "d" && selectedId) {
        e.preventDefault();
        onDuplicateLayer(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers use latest overlays via closure on each render
  }, [selectedId, overlays, pageIndex]);

  function onReorderLayers(
    targetPage: number,
    fromIndex: number,
    toIndex: number,
  ) {
    const globalIndices: number[] = [];
    overlays.forEach((o, i) => {
      if (o.pageIndex === targetPage) globalIndices.push(i);
    });
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= globalIndices.length ||
      toIndex >= globalIndices.length
    ) {
      return;
    }
    const pageItems = globalIndices.map((i) => overlays[i]);
    const [moved] = pageItems.splice(fromIndex, 1);
    pageItems.splice(toIndex, 0, moved);
    const next = [...overlays];
    globalIndices.forEach((globalIdx, localIdx) => {
      next[globalIdx] = pageItems[localIdx];
    });
    pushHistory(next);
    markDirty();
  }

  function onRemoveAllLayersForPage(targetPage: number) {
    pushHistory(overlays.filter((o) => o.pageIndex !== targetPage));
    setSelectedId(null);
    markDirty();
  }

  function onSelectPageFromPanel(idx: number) {
    setPageIndex(idx);
    const pageEl = document.querySelector(`[data-pdf-page="${idx}"]`);
    pageEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (isMobile) setMobileSideOpen(false);
  }

  async function onMovePage(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= pageCount ||
      toIndex >= pageCount
    ) {
      return;
    }
    try {
      let working = bufferRef.current;
      if (!working) return;
      if (overlaysRef.current.length > 0) {
        working = (await bakeOverlaysIntoBuffer()) ?? working;
        setOverlays([]);
        setHistory([]);
      }
      const { PDFDocument } = await import("pdf-lib");
      const srcPdf = await PDFDocument.load(working.slice(0));
      const order = Array.from({ length: srcPdf.getPageCount() }, (_, i) => i);
      const [moved] = order.splice(fromIndex, 1);
      order.splice(toIndex, 0, moved);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(srcPdf, order);
      copied.forEach((p) => out.addPage(p));
      const bytes = await out.save();
      setBufferSafe(Uint8Array.from(bytes).buffer as ArrayBuffer);
      const count = out.getPageCount();
      pageCountRef.current = count;
      setPageCount(count);
      setPageIndex(toIndex);
      dirtyRef.current = true;
      markDirty();
    } catch (err) {
      if (err instanceof ArabicRasterizeError) {
        toast.error(t("arabicExportFailed"));
      } else {
        toast.error(t("saveError"));
      }
    }
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
    patch: Partial<
      Pick<
        TextOverlay,
        | "text"
        | "align"
        | "dir"
        | "fontSize"
        | "color"
        | "bold"
        | "italic"
        | "underline"
        | "fontFamily"
      >
    >,
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
          fontSize: patch.fontSize ?? o.fontSize,
          color: patch.color ?? o.color,
          bold: patch.bold ?? o.bold,
          italic: patch.italic ?? o.italic,
          underline: patch.underline ?? o.underline,
          fontFamily: patch.fontFamily ?? o.fontFamily,
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
      let working = src;
      if (overlaysRef.current.length > 0) {
        working = (await bakeOverlaysIntoBuffer()) ?? src;
      }
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.load(working.slice(0));
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
    } catch (err) {
      if (err instanceof ArabicRasterizeError) {
        toast.error(t("arabicExportFailed"));
      } else {
        toast.error(t("saveError"));
      }
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
      let working = src;
      const hadOverlays = overlaysRef.current.length > 0;
      if (hadOverlays) {
        working = (await bakeOverlaysIntoBuffer()) ?? src;
      }
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.load(working.slice(0));
      const idx = Math.min(pageIndex, pdf.getPageCount() - 1);
      pdf.removePage(idx);
      const bytes = await pdf.save();
      const next = Uint8Array.from(bytes).buffer;
      setBufferSafe(next);
      if (hadOverlays) {
        setOverlays([]);
      } else {
        setOverlays((prev) =>
          prev
            .filter((o) => o.pageIndex !== idx)
            .map((o) =>
              o.pageIndex > idx ? { ...o, pageIndex: o.pageIndex - 1 } : o,
            ),
        );
      }
      setHistory([]);
      setSelectedId(null);
      const count = pdf.getPageCount();
      pageCountRef.current = count;
      setPageCount(count);
      setPageIndex(Math.max(0, Math.min(idx, count - 1)));
      dirtyRef.current = true;
      markDirty();
      setDeletePageOpen(false);
    } catch (err) {
      if (err instanceof ArabicRasterizeError) {
        toast.error(t("arabicExportFailed"));
      } else {
        toast.error(t("saveError"));
      }
    } finally {
      setDeletingPage(false);
    }
  }

  function releasePdfReadyUrl() {
    if (pdfReadyUrlRef.current) {
      revokePdfObjectUrlSoon(pdfReadyUrlRef.current);
      pdfReadyUrlRef.current = null;
    }
    setPdfReadyUrl(null);
    setPdfReadyFile(null);
  }

  function closeExportDialog() {
    releasePdfReadyUrl();
    setPdfExportPhase("form");
    setPdfExportOpen(false);
    pdfExportBusyRef.current = false;
  }

  function onSavePdf() {
    if (!pdfReadyFile) return;
    // The File is already built, so navigator.share runs inside this tap.
    void sharePdfFile(pdfReadyFile).then((shareResult) => {
      if (shareResult === "shared") {
        toast.success(t("downloadReady"));
        closeExportDialog();
      } else if (shareResult === "failed") {
        toast.error(te("exportPdfShareFailed"));
      }
    });
  }

  function onDownloadTap() {
    toast.success(t("downloadReady"));
    window.setTimeout(closeExportDialog, 1200);
  }

  async function onSaveToPath() {
    if (!pdfReadyFile) return;
    const picker = (
      window as Window & {
        showSaveFilePicker?: (options?: {
          suggestedName?: string;
          types?: {
            description: string;
            accept: Record<string, string[]>;
          }[];
        }) => Promise<FileSystemFileHandle>;
      }
    ).showSaveFilePicker;
    if (typeof picker !== "function") return;
    try {
      const handle = await picker({
        suggestedName: pdfReadyFile.name,
        types: [
          { description: "PDF", accept: { "application/pdf": [".pdf"] } },
        ],
      });
      await writePdfToFileHandle(handle, pdfReadyFile);
      toast.success(t("downloadReady"));
      closeExportDialog();
    } catch {
      /* user cancelled */
    }
  }

  function onDownload() {
    setMenuOpen(false);
    if (pdfExportBusyRef.current) return;
    releasePdfReadyUrl();
    setPdfCaps({
      isApple: isAppleTouchDevice(),
      canPickPath: hasSaveFilePicker(),
      canShare: canSharePdfFiles(),
    });
    setPdfExportPhase("form");
    setPdfExportOpen(true);
  }

  async function onExportPdfFormSubmit(values: ExportPdfFormValues) {
    if (pdfExportBusyRef.current) return;
    pdfExportBusyRef.current = true;
    lastExportValuesRef.current = values;
    setPdfExportPhase("generating");

    const base = sanitizePdfBaseName(values.title);
    try {
      const bytes = await buildBytes();
      if (!bytes) throw new Error("export produced no PDF");
      const blob = new Blob([new Uint8Array(bytes)], { type: PDF_MIME });

      const result = await downloadPdfBlob(blob, base);
      if (result.ok) {
        toast.success(t("downloadReady"));
        closeExportDialog();
        return;
      }
      if (result.mode === "aborted") {
        closeExportDialog();
        return;
      }

      const readyFile = await materializePdfFile(result.blob, result.fileName);
      releasePdfReadyUrl();
      const url = createPdfObjectUrl(readyFile);
      pdfReadyUrlRef.current = url;
      setPdfReadyFile(readyFile);
      setPdfReadyUrl(url);
      setPdfExportPhase("ready");
      pdfExportBusyRef.current = false;
    } catch (err) {
      if (err instanceof ArabicRasterizeError) {
        toast.error(t("arabicExportFailed"));
      }
      setPdfExportPhase("error");
      pdfExportBusyRef.current = false;
    }
  }

  function onRetryExport() {
    const values = lastExportValuesRef.current;
    if (!values) {
      setPdfExportPhase("form");
      return;
    }
    void onExportPdfFormSubmit(values);
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
          : overlays.length > 0
            ? t("unsavedChanges")
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

  const sidePanelLabels = {
    toggleLayers: t("toggleLayers"),
    layersTitle: t("layersTitle"),
    layersHint: t("layersHint"),
    layersEmpty: t("layersEmpty"),
    layersRemoveAll: t("layersRemoveAll"),
    layersRemoveAllConfirm: t("layersRemoveAllConfirm"),
    pagesTitle: t("pagesTitle"),
    pagesEmpty: t("pagesEmpty"),
    pageLabel: t("pageLabel"),
    moveUp: t("moveUp"),
    moveDown: t("moveDown"),
    layerText: t("layerText"),
    layerImage: t("layerImage"),
    layerTable: t("layerTable"),
    layerShape: t("layerShape"),
    layerStamp: t("layerStamp"),
    layerWhiteout: t("layerWhiteout"),
    edit: t("editTextSave"),
    delete: t("delete"),
    copy: t("copyLayer"),
    duplicate: t("duplicateLayer"),
    paste: t("pasteLayer"),
    cancel: t("cancel"),
  };

  const canPasteLayer =
    clipboardVersion > 0 && Boolean(overlayClipboardRef.current);

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
              aria-expanded={mobileSideOpen}
              aria-label={t("toggleLayers")}
              onClick={() => setMobileSideOpen(true)}
            >
              <Layers className="h-4 w-4" />
            </Button>
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
              variant={sidePanelOpen ? "solid" : "ghost"}
              onClick={() => setSidePanelOpen((v) => !v)}
              aria-label={t("toggleLayers")}
              title={t("toggleLayers")}
            >
              <Layers className="h-4 w-4" />
            </Button>
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
        <div
          className={`editor-canvas-frame glass mx-auto flex min-h-full max-w-[1600px] overflow-hidden rounded-none sm:rounded-[1.5rem] ${
            locale === "ar" ? "flex-row-reverse" : "flex-row"
          }`}
        >
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
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
                    if (o) {
                      setPageIndex(o.pageIndex);
                      if (o.type === "text") syncTextFormatFromOverlay(o);
                    }
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
                <div className="sticky bottom-0 z-30 border-t border-line bg-[#0a1220]/95 px-3 py-3 backdrop-blur">
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
                      variant={selected.bold ? "solid" : "ghost"}
                      onClick={() =>
                        updateSelectedText({ bold: !selected.bold })
                      }
                      aria-label={t("bold")}
                      title={t("bold")}
                    >
                      <Bold className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant={selected.italic ? "solid" : "ghost"}
                      onClick={() =>
                        updateSelectedText({ italic: !selected.italic })
                      }
                      aria-label={t("italic")}
                      title={t("italic")}
                    >
                      <Italic className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant={selected.underline ? "solid" : "ghost"}
                      onClick={() =>
                        updateSelectedText({
                          underline: !selected.underline,
                        })
                      }
                      aria-label={t("underline")}
                      title={t("underline")}
                    >
                      <Underline className="h-4 w-4" />
                    </Button>
                    <select
                      className="min-h-9 rounded-lg border border-line bg-white/5 px-2 text-xs"
                      value={selected.fontFamily || "noto"}
                      aria-label={t("fontFamily")}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "noto" || v === "sans" || v === "serif") {
                          updateSelectedText({ fontFamily: v });
                          setTextFontFamily(v);
                        }
                      }}
                    >
                      <option value="noto">{t("fontNoto")}</option>
                      <option value="sans">{t("fontSans")}</option>
                      <option value="serif">{t("fontSerif")}</option>
                    </select>
                    <label className="flex min-h-9 items-center gap-1 rounded-lg border border-line bg-white/5 px-2 text-xs">
                      <span className="text-muted">{t("fontSize")}</span>
                      <input
                        type="number"
                        min={8}
                        max={72}
                        className="w-12 bg-transparent outline-none"
                        value={selected.fontSize}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          const size = Math.min(72, Math.max(8, n));
                          setFontSize(size);
                          updateSelectedText({ fontSize: size });
                        }}
                      />
                    </label>
                    <label className="flex min-h-9 items-center gap-1 rounded-lg border border-line bg-white/5 px-2 text-xs">
                      <span className="text-muted">{t("fontColor")}</span>
                      <input
                        type="color"
                        className="h-7 w-8 cursor-pointer bg-transparent"
                        value={selected.color || "#111827"}
                        onChange={(e) => {
                          setColor(e.target.value);
                          updateSelectedText({ color: e.target.value });
                        }}
                      />
                    </label>
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
                      fontWeight: selected.bold ? 700 : 400,
                      fontStyle: selected.italic ? "italic" : "normal",
                      textDecoration: selected.underline
                        ? "underline"
                        : "none",
                      letterSpacing: "0px",
                      fontFamily:
                        selected.fontFamily === "serif"
                          ? 'Georgia, "Times New Roman", serif'
                          : selected.fontFamily === "sans"
                            ? 'system-ui, "Segoe UI", Tahoma, sans-serif'
                            : '"NotoSansArabic", "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif',
                      fontSize: `${Math.max(12, selected.fontSize)}px`,
                      color: selected.color,
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
          <PdfSidePanel
            mode="sidebar"
            open={sidePanelOpen}
            tab={sideTab}
            buffer={buffer}
            overlays={overlays}
            pageIndex={pageIndex}
            pageCount={pageCount}
            selectedId={selectedId}
            canPaste={canPasteLayer}
            labels={sidePanelLabels}
            onTab={setSideTab}
            onClose={() => setSidePanelOpen(false)}
            onSelectLayer={onSelectLayerFromPanel}
            onEditText={onEditTextFromPanel}
            onDeleteLayer={onDeleteLayerFromPanel}
            onCopyLayer={onCopyLayer}
            onDuplicateLayer={onDuplicateLayer}
            onPasteLayer={onPasteLayer}
            onReorderLayers={onReorderLayers}
            onRemoveAllLayers={onRemoveAllLayersForPage}
            onSelectPage={onSelectPageFromPanel}
            onMovePage={(from, to) => {
              void onMovePage(from, to);
            }}
          />
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
              label={t("toggleLayers")}
              active={mobileSideOpen}
              onClick={() => setMobileSideOpen(true)}
            >
              <Layers className="h-4 w-4" />
            </DockBtn>
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

      <PdfSidePanel
        mode="drawer"
        open={mobileSideOpen}
        tab={sideTab}
        buffer={buffer}
        overlays={overlays}
        pageIndex={pageIndex}
        pageCount={pageCount}
        selectedId={selectedId}
        canPaste={canPasteLayer}
        labels={sidePanelLabels}
        onTab={setSideTab}
        onClose={() => setMobileSideOpen(false)}
        onSelectLayer={onSelectLayerFromPanel}
        onEditText={onEditTextFromPanel}
        onDeleteLayer={onDeleteLayerFromPanel}
        onCopyLayer={onCopyLayer}
        onDuplicateLayer={onDuplicateLayer}
        onPasteLayer={onPasteLayer}
        onReorderLayers={onReorderLayers}
        onRemoveAllLayers={onRemoveAllLayersForPage}
        onSelectPage={onSelectPageFromPanel}
        onMovePage={(from, to) => {
          void onMovePage(from, to);
        }}
      />

      <EditPdfTextDialog
        open={Boolean(replaceDialog)}
        initialText={replaceDialog?.seedText ?? ""}
        initialFormat={{
          bold: textBold,
          italic: textItalic,
          underline: textUnderline,
          fontSize,
          fontFamily: textFontFamily,
          color,
        }}
        unreadable={replaceDialog?.unreadable ?? false}
        labels={{
          title:
            replaceDialog?.mode === "add"
              ? t("addText")
              : t("editTextTitle"),
          hint:
            replaceDialog?.mode === "add"
              ? t("editTextHintAdd")
              : t("editTextHint"),
          unreadable: t("editTextUnreadable"),
          placeholder: t("textPlaceholder"),
          save: t("editTextSave"),
          cancel: t("cancel"),
          bold: t("bold"),
          italic: t("italic"),
          underline: t("underline"),
          fontFamily: t("fontFamily"),
          fontNoto: t("fontNoto"),
          fontSans: t("fontSans"),
          fontSerif: t("fontSerif"),
          fontSize: t("fontSize"),
          fontColor: t("fontColor"),
        }}
        onCancel={() => {
          setReplaceDialog(null);
          if (replaceDialog?.mode === "add") setTool("select");
        }}
        onSubmit={submitReplaceText}
      />

      <AiChatPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        documentId={documentId}
        editorRef={dummyEditorRef}
        docKind="pdf"
        pdfRef={pdfHandleRef}
        onDocMutated={markDirty}
      />

      <ExportPdfDialog
        open={pdfExportOpen}
        initialName={title || "document"}
        phase={pdfExportPhase}
        isApple={pdfCaps.isApple}
        canPickPath={pdfCaps.canPickPath}
        canShare={pdfCaps.canShare}
        readyFile={pdfReadyFile}
        readyUrl={pdfReadyUrl}
        labels={{
          title: te("exportPdfFormTitle"),
          nameLabel: te("exportPdfNameLabel"),
          namePlaceholder: te("exportPdfNamePlaceholder"),
          pathLabel: te("exportPdfPathLabel"),
          pathPlaceholder: te("exportPdfPathPlaceholder"),
          pathHintDesktop: te("exportPdfPathHintDesktop"),
          pathHintIos: te("exportPdfPathHintIos"),
          pickPath: te("exportPdfPickPath"),
          submit: te("exportPdfSubmit"),
          cancel: te("exportPdfCancel"),
          nameRequired: te("exportPdfNameRequired"),
          preparing: te("exportPdfPreparing"),
          progress: te("exportPdfProgress"),
          readyTitle: te("exportPdfReadyTitle"),
          save: te("exportPdfSave"),
          download: te("exportPdfDownload"),
          fallbackHint: te("exportPdfFallbackHint"),
          errorTitle: te("exportPdfErrorTitle"),
          errorBody: te("exportPdfErrorBody"),
          retry: te("exportPdfRetry"),
        }}
        onClose={closeExportDialog}
        onSubmitForm={(values) => {
          void onExportPdfFormSubmit(values);
        }}
        onSavePdf={onSavePdf}
        onDownloadTap={onDownloadTap}
        onSaveToPath={() => {
          void onSaveToPath();
        }}
        onRetry={onRetryExport}
      />
    </div>
  );
}
