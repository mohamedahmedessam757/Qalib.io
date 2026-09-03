"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { TableCellInfo, TableGrid } from "@/lib/editor/read-table-grid";

const easeOut = [0.23, 1, 0.32, 1] as const;
const ARABIC_RE = /[\u0600-\u06FF]/;

export type TableSelectionDraft = TableGrid;

function buildCellMatrix(grid: TableGrid): string[][] {
  const matrix = Array.from({ length: grid.rows }, () =>
    Array.from({ length: grid.cols }, () => ""),
  );
  for (const cell of grid.cells) {
    if (cell.row < grid.rows && cell.col < grid.cols) {
      matrix[cell.row][cell.col] = cell.text;
    }
  }
  return matrix;
}

function cellDir(value: string): "rtl" | "ltr" | "auto" {
  if (!value.trim()) return "auto";
  return ARABIC_RE.test(value) ? "rtl" : "ltr";
}

export function TableSelectionEditSheet({
  open,
  draft,
  labels,
  onClose,
  onApply,
  onClearCell,
}: {
  open: boolean;
  draft: TableSelectionDraft | null;
  labels: {
    title: string;
    hint: string;
    apply: string;
    cancel: string;
    clearCell: string;
    placeholder: string;
  };
  onClose: () => void;
  onApply: (cells: TableCellInfo[], matrix: string[][]) => void;
  onClearCell: (paraId: string) => void;
}) {
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [focusRow, setFocusRow] = useState(0);
  const [focusCol, setFocusCol] = useState(0);
  const cellRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  useEffect(() => {
    if (open && draft) {
      setMatrix(buildCellMatrix(draft));
      setFocusRow(draft.focusRow);
      setFocusCol(draft.focusCol);
    }
  }, [open, draft]);

  useEffect(() => {
    if (!open || !draft) return;
    const key = `${draft.focusRow}-${draft.focusCol}`;
    window.setTimeout(() => cellRefs.current.get(key)?.focus(), 60);
  }, [open, draft]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const focusCell = useCallback((row: number, col: number) => {
    setFocusRow(row);
    setFocusCol(col);
    const key = `${row}-${col}`;
    window.setTimeout(() => cellRefs.current.get(key)?.focus(), 0);
  }, []);

  const gridRtl = useMemo(() => {
    const sample = matrix.flat().join(" ").slice(0, 400);
    return ARABIC_RE.test(sample);
  }, [matrix]);

  const handleKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLTextAreaElement>,
      row: number,
      col: number,
    ) => {
      if (!draft) return;
      const { rows, cols } = draft;
      if (e.key === "Tab") {
        e.preventDefault();
        const delta = e.shiftKey ? -1 : 1;
        const flat = row * cols + col + delta;
        if (flat < 0 || flat >= rows * cols) return;
        focusCell(Math.floor(flat / cols), flat % cols);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (row < rows - 1) focusCell(row + 1, col);
        else {
          const next = row * cols + col + 1;
          if (next < rows * cols) {
            focusCell(Math.floor(next / cols), next % cols);
          }
        }
        return;
      }
      const el = e.currentTarget;
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const atEnd =
        el.selectionStart === el.value.length &&
        el.selectionEnd === el.value.length;

      if (e.key === "ArrowDown" && atEnd) {
        e.preventDefault();
        if (row < rows - 1) focusCell(row + 1, col);
      }
      if (e.key === "ArrowUp" && atStart) {
        e.preventDefault();
        if (row > 0) focusCell(row - 1, col);
      }
      if (e.key === "ArrowRight" && atEnd) {
        e.preventDefault();
        if (gridRtl) {
          if (col > 0) focusCell(row, col - 1);
        } else if (col < cols - 1) {
          focusCell(row, col + 1);
        }
      }
      if (e.key === "ArrowLeft" && atStart) {
        e.preventDefault();
        if (gridRtl) {
          if (col < cols - 1) focusCell(row, col + 1);
        } else if (col > 0) {
          focusCell(row, col - 1);
        }
      }
    },
    [draft, focusCell, gridRtl],
  );

  if (!draft) return null;

  const focusedCell = draft.cells.find(
    (c) => c.row === focusRow && c.col === focusCol,
  );

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label={labels.cancel}
            className="fixed inset-0 z-[70] bg-black/45 print:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={labels.title}
            className="glass-strong fixed inset-x-0 bottom-0 z-[80] max-h-[82dvh] rounded-t-[1.5rem] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 print:hidden"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.32, ease: easeOut }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{labels.title}</p>
                <p className="text-[11px] text-muted">{labels.hint}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11"
                onClick={onClose}
                aria-label={labels.cancel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div
              className="max-h-[50dvh] overflow-x-auto overflow-y-auto rounded-xl border border-line bg-white/[0.03] p-1.5"
              dir={gridRtl ? "rtl" : "ltr"}
            >
              <div
                className="grid gap-px overflow-hidden rounded-lg border border-line bg-line"
                style={{
                  gridTemplateColumns: `repeat(${draft.cols}, minmax(104px, 1fr))`,
                  minWidth: `${Math.max(draft.cols * 112, 240)}px`,
                }}
              >
                {matrix.map((row, rowIdx) =>
                  row.map((value, colIdx) => {
                    const key = `${rowIdx}-${colIdx}`;
                    const isFocus =
                      rowIdx === focusRow && colIdx === focusCol;
                    return (
                      <textarea
                        key={key}
                        ref={(el) => {
                          if (el) cellRefs.current.set(key, el);
                          else cellRefs.current.delete(key);
                        }}
                        value={value}
                        dir={cellDir(value)}
                        rows={2}
                        placeholder={labels.placeholder}
                        onFocus={() => {
                          setFocusRow(rowIdx);
                          setFocusCol(colIdx);
                        }}
                        onKeyDown={(e) => handleKeyDown(e, rowIdx, colIdx)}
                        onChange={(e) => {
                          const next = matrix.map((r) => [...r]);
                          next[rowIdx][colIdx] = e.target.value;
                          setMatrix(next);
                        }}
                        className={`min-h-[3.5rem] resize-none border-0 px-2 py-2 text-sm outline-none transition-[box-shadow,background-color] ${
                          isFocus
                            ? "bg-accent/15 shadow-[inset_0_0_0_2px_rgba(45,212,191,0.45)]"
                            : "bg-[#0a1220]"
                        }`}
                      />
                    );
                  }),
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                className="min-h-11 flex-1 gap-1.5"
                onClick={() => onApply(draft.cells, matrix)}
              >
                <Check className="h-4 w-4" />
                {labels.apply}
              </Button>
              <Button
                variant="ghost"
                className="min-h-11 flex-1"
                onClick={onClose}
              >
                {labels.cancel}
              </Button>
              {focusedCell ? (
                <Button
                  variant="danger"
                  className="min-h-11 gap-1.5"
                  onClick={() => {
                    onClearCell(focusedCell.paraId);
                    setMatrix((prev) => {
                      const next = prev.map((r) => [...r]);
                      if (next[focusRow]?.[focusCol] !== undefined) {
                        next[focusRow][focusCol] = "";
                      }
                      return next;
                    });
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  {labels.clearCell}
                </Button>
              ) : null}
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
