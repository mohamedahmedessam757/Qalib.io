"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRight,
  Bold,
  Bot,
  CloudUpload,
  Columns3,
  Download,
  Frame,
  Italic,
  LoaderCircle,
  Minus,
  MoreVertical,
  Plus,
  Redo2,
  Rows3,
  Trash2,
  Underline,
  Undo2,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { useIsMobile } from "@/hooks/useIsMobile";
import { XLSX_MIME } from "@/lib/documents";
import {
  getCachedDocumentMeta,
  setCachedDocumentMeta,
} from "@/lib/document-cache";
import { workbookFromBuffer, workbookToBuffer } from "@/lib/sheet/io";
import {
  cellKey,
  emptySheet,
  snapshotSheet,
  toA1,
  type CellAlign,
  type SheetCell,
  type SheetModel,
  type WorkbookModel,
} from "@/lib/sheet/model";

const ExcelGrid = dynamic(
  () => import("./ExcelGrid").then((m) => m.ExcelGrid),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
        <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
      </div>
    ),
  },
);

export type ExcelEditorHandle = {
  getWorkbook: () => WorkbookModel | null;
  getActiveSnapshot: () => ReturnType<typeof snapshotSheet> | null;
  applyMutation: (mutator: (wb: WorkbookModel) => WorkbookModel) => void;
  markDirty: () => void;
};

function ensureCell(
  s: SheetModel,
  r: number,
  c: number,
): SheetCell {
  const key = cellKey(r, c);
  return (
    s.cells[key] || {
      r,
      c,
      value: "",
    }
  );
}

export const ExcelEditorClient = forwardRef<
  ExcelEditorHandle,
  { documentId: string; title: string }
>(function ExcelEditorClient({ documentId, title }, ref) {
  const t = useTranslations("sheetEditor");
  const tc = useTranslations("common");
  const isMobile = useIsMobile();
  const [model, setModel] = useState<WorkbookModel | null>(null);
  const [active, setActive] = useState<{ r: number; c: number } | null>({
    r: 0,
    c: 0,
  });
  const [loadProgress, setLoadProgress] = useState(0);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [aiOpen, setAiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pending, startTransition] = useTransition();
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<WorkbookModel[]>([]);
  const redoRef = useRef<WorkbookModel[]>([]);
  const modelRef = useRef(model);
  const sheetHandleRef = useRef<ExcelEditorHandle | null>(null);
  modelRef.current = model;

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist();
    }, 2500);
  }, []);

  const pushHistory = useCallback((wb: WorkbookModel) => {
    historyRef.current = [...historyRef.current.slice(-29), structuredClone(wb)];
    redoRef.current = [];
  }, []);

  const persist = useCallback(async () => {
    const wb = modelRef.current;
    if (!wb || !dirtyRef.current) return;
    setSaveState("saving");
    try {
      const bytes = await workbookToBuffer(wb);
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PUT",
        headers: { "Content-Type": XLSX_MIME },
        body: bytes,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || t("saveError"));
      }
      dirtyRef.current = false;
      setSaveState("saved");
    } catch {
      setSaveState("error");
      toast.error(t("saveError"));
    }
  }, [documentId, t]);

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
        const buf = await fileRes.arrayBuffer();
        if (cancelled) return;
        const wb = await workbookFromBuffer(buf);
        setModel(wb);
        setLoadProgress(100);
      } catch {
        if (!cancelled) toast.error(tc("error"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, t, tc, title]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (dirtyRef.current) void persist();
    }, 60_000);
    return () => {
      window.clearInterval(id);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [persist]);

  const sheet = model?.sheets[model.activeIndex] || null;
  const activeCell =
    active && sheet ? sheet.cells[cellKey(active.r, active.c)] : undefined;

  sheetHandleRef.current = {
    getWorkbook: () => modelRef.current,
    getActiveSnapshot: () => {
      const wb = modelRef.current;
      if (!wb) return null;
      return snapshotSheet(wb.sheets[wb.activeIndex] || wb.sheets[0]);
    },
    applyMutation: (mutator) => {
      const wb = modelRef.current;
      if (!wb) return;
      pushHistory(wb);
      const next = mutator(structuredClone(wb));
      setModel(next);
      dirtyRef.current = true;
      markDirty();
    },
    markDirty,
  };

  useImperativeHandle(ref, () => sheetHandleRef.current!, [
    markDirty,
    pushHistory,
  ]);

  function updateActiveSheet(
    updater: (s: NonNullable<typeof sheet>) => NonNullable<typeof sheet>,
  ) {
    if (!model || !sheet) return;
    pushHistory(model);
    const sheets = model.sheets.map((s, i) =>
      i === model.activeIndex ? updater(structuredClone(s)) : s,
    );
    setModel({ ...model, sheets });
    markDirty();
  }

  function patchActive(patch: Partial<SheetCell>) {
    if (!active || !sheet) return;
    updateActiveSheet((s) => {
      const prev = ensureCell(s, active.r, active.c);
      s.cells[cellKey(active.r, active.c)] = { ...prev, ...patch };
      return s;
    });
  }

  function onChangeCell(r: number, c: number, raw: string) {
    if (!model || !sheet) return;
    const sheets = model.sheets.map((s, i) => {
      if (i !== model.activeIndex) return s;
      const next = structuredClone(s);
      const key = cellKey(r, c);
      const prev = next.cells[key];
      const trimmed = raw;
      if (!trimmed) {
        const { [key]: _, ...rest } = next.cells;
        return { ...next, cells: rest };
      }
      let value: SheetCell["value"] = trimmed;
      let formula: string | undefined;
      if (trimmed.startsWith("=")) {
        formula = trimmed.slice(1);
        value = trimmed;
      } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        value = Number(trimmed);
      }
      next.cells[key] = {
        r,
        c,
        value,
        formula,
        bold: prev?.bold,
        italic: prev?.italic,
        underline: prev?.underline,
        fill: prev?.fill,
        color: prev?.color,
        align: prev?.align,
        fontSize: prev?.fontSize,
        border: prev?.border,
        numberFormat: prev?.numberFormat,
      };
      return next;
    });
    setModel({ ...model, sheets });
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist();
    }, 2500);
    setSaveState("idle");
  }

  function addRow() {
    updateActiveSheet((s) => ({ ...s, rows: s.rows + 1 }));
  }

  function addCol() {
    updateActiveSheet((s) => ({
      ...s,
      cols: s.cols + 1,
      colWidths: [...s.colWidths, 12],
    }));
  }

  function deleteRow() {
    if (!active || !sheet || sheet.rows <= 1) return;
    updateActiveSheet((s) => {
      const row = active.r;
      const cells: typeof s.cells = {};
      for (const cell of Object.values(s.cells)) {
        if (cell.r === row) continue;
        const nr = cell.r > row ? cell.r - 1 : cell.r;
        cells[cellKey(nr, cell.c)] = { ...cell, r: nr };
      }
      return { ...s, rows: Math.max(1, s.rows - 1), cells };
    });
    setActive({ r: Math.max(0, active.r - 1), c: active.c });
  }

  function deleteCol() {
    if (!active || !sheet || sheet.cols <= 1) return;
    updateActiveSheet((s) => {
      const col = active.c;
      const cells: typeof s.cells = {};
      for (const cell of Object.values(s.cells)) {
        if (cell.c === col) continue;
        const nc = cell.c > col ? cell.c - 1 : cell.c;
        cells[cellKey(cell.r, nc)] = { ...cell, c: nc };
      }
      return {
        ...s,
        cols: Math.max(1, s.cols - 1),
        cells,
        colWidths: s.colWidths.filter((_, i) => i !== col),
      };
    });
    setActive({ r: active.r, c: Math.max(0, active.c - 1) });
  }

  function clearCell() {
    if (!active || !sheet) return;
    updateActiveSheet((s) => {
      const { [cellKey(active.r, active.c)]: _, ...rest } = s.cells;
      return { ...s, cells: rest };
    });
  }

  function toggleBorder() {
    if (!active) return;
    const on = !(
      activeCell?.border?.top &&
      activeCell?.border?.right &&
      activeCell?.border?.bottom &&
      activeCell?.border?.left
    );
    patchActive({
      border: on
        ? { top: true, right: true, bottom: true, left: true, color: "#94a3b8" }
        : undefined,
    });
  }

  function cycleFrame() {
    updateActiveSheet((s) => {
      const order = ["none", "single", "double", "thick"] as const;
      const cur = s.frame?.style || "none";
      const next = order[(order.indexOf(cur) + 1) % order.length];
      return {
        ...s,
        frame: { style: next, color: s.frame?.color || "#2dd4bf" },
      };
    });
  }

  function setAlign(align: CellAlign) {
    patchActive({ align });
  }

  function onUndo() {
    const prev = historyRef.current.pop();
    if (!prev || !model) return;
    redoRef.current.push(structuredClone(model));
    setModel(prev);
    markDirty();
  }

  function onRedo() {
    const next = redoRef.current.pop();
    if (!next || !model) return;
    historyRef.current.push(structuredClone(model));
    setModel(next);
    markDirty();
  }

  async function onDownload() {
    setMenuOpen(false);
    if (!model) return;
    const bytes = await workbookToBuffer(model);
    const blob = new Blob([bytes], { type: XLSX_MIME });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("downloadReady"));
  }

  const statusLabel =
    saveState === "saving" || pending
      ? tc("saving")
      : saveState === "saved"
        ? tc("saved")
        : saveState === "error"
          ? tc("error")
          : null;

  const formulaBar =
    active && sheet
      ? activeCell?.formula
        ? `=${activeCell.formula.replace(/^=/, "")}`
        : activeCell?.value == null
          ? ""
          : String(activeCell.value)
      : "";

  function ToolBtn({
    onClick,
    label,
    children,
    active: isOn,
  }: {
    onClick: () => void;
    label: string;
    children: ReactNode;
    active?: boolean;
  }) {
    return (
      <Button
        size="sm"
        variant={isOn ? "solid" : "ghost"}
        className="min-h-11 min-w-11 shrink-0"
        onClick={onClick}
        aria-label={label}
        title={label}
      >
        {children}
      </Button>
    );
  }

  return (
    <div className="editor-mobile-shell flex h-[100dvh] flex-col bg-[#070b14] pt-[env(safe-area-inset-top)]">
      {/* Mobile top bar */}
      <header className="relative z-40 shrink-0 print:hidden sm:hidden">
        <div className="glass editor-chrome flex h-12 items-center justify-between gap-2 px-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link href="/documents">
              <Button variant="ghost" size="sm" className="min-h-11 min-w-11 px-2">
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </Link>
            <p className="truncate text-sm font-medium">{title}</p>
            {statusLabel ? (
              <span className="text-[10px] text-muted">{statusLabel}</span>
            ) : null}
          </div>
          <div className="relative flex items-center gap-1">
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
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t("moreActions")}
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
                  {t("download")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-3 text-start text-sm hover:bg-white/8"
                  onClick={() => {
                    setMenuOpen(false);
                    cycleFrame();
                  }}
                >
                  <Frame className="h-4 w-4" />
                  {t("sheetFrame")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-3 text-start text-sm hover:bg-white/8"
                  onClick={() => {
                    setMenuOpen(false);
                    clearCell();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("clearCell")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* Desktop chrome */}
      <header className="relative z-40 hidden shrink-0 print:hidden sm:block sm:px-4 sm:pt-3">
        <div className="glass editor-chrome mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-2 rounded-2xl px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/documents">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                <span>{t("back")}</span>
              </Button>
            </Link>
            <p className="truncate text-sm font-medium">{title}</p>
            {statusLabel ? (
              <span className="text-xs text-muted">{statusLabel}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-1 overflow-x-auto">
            <ToolBtn onClick={onUndo} label={t("undo")}>
              <Undo2 className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn onClick={onRedo} label={t("redo")}>
              <Redo2 className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              onClick={() => patchActive({ bold: !activeCell?.bold })}
              label={t("bold")}
              active={Boolean(activeCell?.bold)}
            >
              <Bold className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              onClick={() => patchActive({ italic: !activeCell?.italic })}
              label={t("italic")}
              active={Boolean(activeCell?.italic)}
            >
              <Italic className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              onClick={() =>
                patchActive({ underline: !activeCell?.underline })
              }
              label={t("underline")}
              active={Boolean(activeCell?.underline)}
            >
              <Underline className="h-4 w-4" />
            </ToolBtn>
            <label
              className="relative inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-xl border border-line bg-white/5"
              title={t("fill")}
            >
              <span
                className="h-4 w-4 rounded-sm border border-white/30"
                style={{ backgroundColor: activeCell?.fill || "#2dd4bf" }}
              />
              <input
                type="color"
                className="absolute inset-0 cursor-pointer opacity-0"
                value={activeCell?.fill || "#2dd4bf"}
                onChange={(e) => patchActive({ fill: e.target.value })}
              />
            </label>
            <label
              className="relative inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-xl border border-line bg-white/5 text-[10px] font-bold"
              title={t("textColor")}
            >
              A
              <input
                type="color"
                className="absolute inset-0 cursor-pointer opacity-0"
                value={activeCell?.color || "#e2e8f0"}
                onChange={(e) => patchActive({ color: e.target.value })}
              />
            </label>
            <ToolBtn onClick={() => setAlign("left")} label={t("alignLeft")}>
              <AlignLeft className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn onClick={() => setAlign("center")} label={t("alignCenter")}>
              <AlignCenter className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn onClick={() => setAlign("right")} label={t("alignRight")}>
              <AlignRight className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn onClick={toggleBorder} label={t("borders")}>
              <Frame className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn onClick={addRow} label={t("addRow")}>
              <Rows3 className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn onClick={addCol} label={t("addCol")}>
              <Columns3 className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn onClick={deleteRow} label={t("deleteRow")}>
              <Trash2 className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn onClick={deleteCol} label={t("deleteCol")}>
              <Columns3 className="h-4 w-4 text-danger" />
            </ToolBtn>
            <ToolBtn onClick={cycleFrame} label={t("sheetFrame")}>
              <Frame className="h-4 w-4 text-accent" />
            </ToolBtn>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                startTransition(() => {
                  void persist();
                })
              }
            >
              <CloudUpload className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void onDownload()}>
              <Download className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAiOpen(true)}>
              <Bot className="h-4 w-4 text-accent" />
            </Button>
          </div>
        </div>
      </header>

      {model ? (
        <div className="mx-auto flex w-full max-w-[1600px] gap-1 overflow-x-auto border-b border-line px-2 py-1 sm:mt-2 sm:rounded-2xl sm:border sm:border-line sm:bg-white/[0.03]">
          {model.sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              type="button"
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${
                i === model.activeIndex
                  ? "bg-accent/20 text-accent"
                  : "text-muted hover:bg-white/5"
              }`}
              onClick={() => setModel({ ...model, activeIndex: i })}
            >
              {s.name}
            </button>
          ))}
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-white/5"
            onClick={() => {
              pushHistory(model);
              const name = `Sheet${model.sheets.length + 1}`;
              setModel({
                ...model,
                sheets: [...model.sheets, emptySheet(name)],
                activeIndex: model.sheets.length,
              });
              markDirty();
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("addSheet")}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden sm:px-4 sm:pb-3 sm:pt-2">
        <div className="editor-canvas-frame glass flex h-full flex-col overflow-hidden rounded-none sm:rounded-[1.5rem]">
          {!model || !sheet ? (
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
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5 text-xs">
                <span className="min-w-[2.5rem] font-medium text-accent">
                  {active ? toA1(active.r, active.c) : ""}
                </span>
                <input
                  className="min-w-0 flex-1 rounded-lg border border-line bg-white/5 px-2 py-1.5 text-[12px] text-foreground outline-none"
                  value={formulaBar}
                  dir="ltr"
                  placeholder={t("formulaHint")}
                  onChange={(e) => {
                    if (!active) return;
                    onChangeCell(active.r, active.c, e.target.value);
                  }}
                />
              </div>
              <div className="min-h-0 flex-1">
                <ExcelGrid
                  sheet={sheet}
                  active={active}
                  zoom={zoom}
                  onSelect={(r, c) => setActive({ r, c })}
                  onChangeCell={onChangeCell}
                  onCommit={() => undefined}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile bottom dock */}
      {isMobile ? (
        <div className="editor-mobile-dock z-40 shrink-0 border-t border-line bg-[#0a1220] px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 print:hidden">
          <div className="flex items-center gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none]">
            <ToolBtn onClick={onUndo} label={t("undo")}>
              <Undo2 className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              onClick={() => patchActive({ bold: !activeCell?.bold })}
              label={t("bold")}
              active={Boolean(activeCell?.bold)}
            >
              <Bold className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              onClick={() => patchActive({ italic: !activeCell?.italic })}
              label={t("italic")}
              active={Boolean(activeCell?.italic)}
            >
              <Italic className="h-4 w-4" />
            </ToolBtn>
            <label
              className="relative inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line bg-white/5"
              title={t("fill")}
            >
              <span
                className="h-4 w-4 rounded-sm border border-white/30"
                style={{ backgroundColor: activeCell?.fill || "#2dd4bf" }}
              />
              <input
                type="color"
                className="absolute inset-0 cursor-pointer opacity-0"
                value={activeCell?.fill || "#2dd4bf"}
                onChange={(e) => patchActive({ fill: e.target.value })}
              />
            </label>
            <ToolBtn onClick={toggleBorder} label={t("borders")}>
              <Frame className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn onClick={addRow} label={t("addRow")}>
              <Rows3 className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn onClick={addCol} label={t("addCol")}>
              <Columns3 className="h-4 w-4" />
            </ToolBtn>
            <div className="mx-0.5 flex shrink-0 items-center rounded-xl border border-line bg-white/[0.03]">
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 min-w-10"
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))}
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
                className="min-h-11 min-w-10"
                onClick={() => setZoom((z) => Math.min(2, Number((z + 0.1).toFixed(2))))}
                aria-label={t("zoomIn")}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <Button
              size="sm"
              variant={formatOpen ? "solid" : "ghost"}
              className="min-h-11 shrink-0 px-2 text-xs"
              onClick={() => setFormatOpen((v) => !v)}
            >
              {t("format")}
            </Button>
          </div>
          {formatOpen ? (
            <div className="mt-1 flex gap-1 overflow-x-auto pb-1">
              <ToolBtn onClick={() => setAlign("left")} label={t("alignLeft")}>
                <AlignLeft className="h-4 w-4" />
              </ToolBtn>
              <ToolBtn onClick={() => setAlign("center")} label={t("alignCenter")}>
                <AlignCenter className="h-4 w-4" />
              </ToolBtn>
              <ToolBtn onClick={() => setAlign("right")} label={t("alignRight")}>
                <AlignRight className="h-4 w-4" />
              </ToolBtn>
              <ToolBtn
                onClick={() =>
                  patchActive({ underline: !activeCell?.underline })
                }
                label={t("underline")}
              >
                <Underline className="h-4 w-4" />
              </ToolBtn>
              <ToolBtn onClick={deleteRow} label={t("deleteRow")}>
                <Trash2 className="h-4 w-4" />
              </ToolBtn>
              <ToolBtn onClick={deleteCol} label={t("deleteCol")}>
                <Columns3 className="h-4 w-4 text-danger" />
              </ToolBtn>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 shrink-0 px-2 text-xs"
                onClick={() => patchActive({ numberFormat: "currency" })}
              >
                {t("fmtCurrency")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 shrink-0 px-2 text-xs"
                onClick={() => patchActive({ numberFormat: "percent" })}
              >
                {t("fmtPercent")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 shrink-0 px-2 text-xs"
                onClick={() => patchActive({ numberFormat: "number" })}
              >
                {t("fmtNumber")}
              </Button>
              <ToolBtn onClick={cycleFrame} label={t("sheetFrame")}>
                <Frame className="h-4 w-4 text-accent" />
              </ToolBtn>
            </div>
          ) : null}
        </div>
      ) : null}

      <AiChatPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        documentId={documentId}
        editorRef={{ current: null }}
        docKind="xlsx"
        sheetRef={sheetHandleRef}
      />
    </div>
  );
});
