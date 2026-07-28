"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
} from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowRight,
  Bold,
  Bot,
  CloudUpload,
  Columns3,
  Download,
  LoaderCircle,
  Plus,
  Rows3,
  Trash2,
  Undo2,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
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
  type SheetCell,
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

export const ExcelEditorClient = forwardRef<
  ExcelEditorHandle,
  { documentId: string; title: string }
>(function ExcelEditorClient({ documentId, title }, ref) {
  const t = useTranslations("sheetEditor");
  const tc = useTranslations("common");
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
  const [pending, startTransition] = useTransition();
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<WorkbookModel[]>([]);
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
        fill: prev?.fill,
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

  function toggleBold() {
    if (!active || !sheet) return;
    updateActiveSheet((s) => {
      const key = cellKey(active.r, active.c);
      const prev = s.cells[key] || {
        r: active.r,
        c: active.c,
        value: "",
      };
      s.cells[key] = { ...prev, bold: !prev.bold };
      return s;
    });
  }

  function setActiveFill(color: string) {
    if (!active || !sheet) return;
    updateActiveSheet((s) => {
      const key = cellKey(active.r, active.c);
      const prev = s.cells[key] || {
        r: active.r,
        c: active.c,
        value: "",
      };
      s.cells[key] = {
        ...prev,
        fill: color || undefined,
      };
      return s;
    });
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
    setActive({ r: Math.max(0, active.r - (active.r ? 0 : 0)), c: active.c });
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
      const colWidths = s.colWidths.filter((_, i) => i !== col);
      return {
        ...s,
        cols: Math.max(1, s.cols - 1),
        cells,
        colWidths,
      };
    });
  }

  function onUndo() {
    const prev = historyRef.current.pop();
    if (!prev) return;
    setModel(prev);
    markDirty();
  }

  async function onDownload() {
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
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-1 text-[11px] text-muted">
                {(saveState === "saving" || pending) && (
                  <LoaderCircle className="h-3 w-3 animate-spin text-accent" />
                )}
                {statusLabel}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11"
              onClick={onUndo}
              aria-label={t("undo")}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11"
              onClick={toggleBold}
              aria-label={t("bold")}
            >
              <Bold className="h-4 w-4" />
            </Button>
            <label
              className="relative inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-white/5"
              title={t("fill")}
              aria-label={t("fill")}
            >
              <span
                className="h-4 w-4 rounded-sm border border-white/30"
                style={{
                  backgroundColor:
                    (active &&
                      sheet?.cells[cellKey(active.r, active.c)]?.fill) ||
                    "#2dd4bf",
                }}
              />
              <input
                type="color"
                className="absolute inset-0 cursor-pointer opacity-0"
                value={
                  (active &&
                    sheet?.cells[cellKey(active.r, active.c)]?.fill) ||
                  "#2dd4bf"
                }
                onChange={(e) => setActiveFill(e.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11"
              onClick={addRow}
              aria-label={t("addRow")}
            >
              <Rows3 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11"
              onClick={addCol}
              aria-label={t("addCol")}
            >
              <Columns3 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11"
              onClick={deleteRow}
              aria-label={t("deleteRow")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="hidden min-h-11 min-w-11 sm:inline-flex"
              onClick={() =>
                startTransition(() => {
                  void persist();
                })
              }
            >
              <CloudUpload className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="hidden min-h-11 min-w-11 sm:inline-flex"
              onClick={() => void onDownload()}
            >
              <Download className="h-4 w-4" />
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
          </div>
        </div>
        {model ? (
          <div className="mx-auto mt-0 flex max-w-[1600px] gap-1 overflow-x-auto border-t border-line px-2 py-1 sm:mt-2 sm:rounded-2xl sm:border sm:border-line sm:bg-white/[0.03]">
            {model.sheets.map((s, i) => (
              <button
                key={`${s.name}-${i}`}
                type="button"
                className={`rounded-lg px-3 py-1.5 text-xs ${
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
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-white/5"
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
      </header>

      <div className="min-h-0 flex-1 overflow-hidden sm:px-4 sm:pb-3 sm:pt-2">
        <div className="editor-canvas-frame glass h-full overflow-hidden rounded-none sm:rounded-[1.5rem]">
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
              <div className="border-b border-line px-3 py-2 text-xs text-muted">
                {active
                  ? `${toA1(active.r, active.c)} · ${sheet.name}`
                  : sheet.name}
              </div>
              <ExcelGrid
                sheet={sheet}
                active={active}
                onSelect={(r, c) => setActive({ r, c })}
                onChangeCell={onChangeCell}
                onCommit={() => undefined}
              />
            </>
          )}
        </div>
      </div>

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
