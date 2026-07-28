"use client";

import { useMemo, useRef } from "react";
import {
  cellKey,
  colLabel,
  type SheetCell,
  type SheetModel,
} from "@/lib/sheet/model";

const ROW_H = 28;
const HEADER_H = 28;
const GUTTER_W = 44;

export function ExcelGrid({
  sheet,
  active,
  onSelect,
  onChangeCell,
  onCommit,
}: {
  sheet: SheetModel;
  active: { r: number; c: number } | null;
  onSelect: (r: number, c: number) => void;
  onChangeCell: (r: number, c: number, value: string) => void;
  onCommit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rows = useMemo(
    () => Array.from({ length: sheet.rows }, (_, r) => r),
    [sheet.rows],
  );
  const cols = useMemo(
    () => Array.from({ length: sheet.cols }, (_, c) => c),
    [sheet.cols],
  );

  function getCell(r: number, c: number): SheetCell | undefined {
    return sheet.cells[cellKey(r, c)];
  }

  function display(cell: SheetCell | undefined) {
    if (!cell) return "";
    if (cell.formula && (cell.value == null || cell.value === "")) {
      return `=${cell.formula.replace(/^=/, "")}`;
    }
    return cell.value == null ? "" : String(cell.value);
  }

  return (
    <div className="h-full overflow-auto overscroll-contain">
      <div
        className="inline-grid min-w-full"
        style={{
          gridTemplateColumns: `${GUTTER_W}px ${cols
            .map((c) => `${Math.round((sheet.colWidths[c] || 12) * 8)}px`)
            .join(" ")}`,
        }}
      >
        <div
          className="sticky start-0 top-0 z-20 border-b border-e border-line bg-[#0d1524]"
          style={{ height: HEADER_H }}
        />
        {cols.map((c) => (
          <div
            key={`h-${c}`}
            className="sticky top-0 z-10 flex items-center justify-center border-b border-e border-line bg-[#0d1524] text-[11px] text-muted"
            style={{ height: HEADER_H }}
          >
            {colLabel(c)}
          </div>
        ))}

        {rows.map((r) => (
          <div key={`row-${r}`} className="contents">
            <div
              className="sticky start-0 z-[5] flex items-center justify-center border-b border-e border-line bg-[#0d1524] text-[11px] text-muted"
              style={{ height: ROW_H }}
            >
              {r + 1}
            </div>
            {cols.map((c) => {
              const cell = getCell(r, c);
              const selected = active?.r === r && active?.c === c;
              const editing = selected;
              return (
                <div
                  key={cellKey(r, c)}
                  className={`relative border-b border-e border-line ${
                    selected ? "ring-1 ring-inset ring-accent" : ""
                  }`}
                  style={{
                    height: ROW_H,
                    backgroundColor: cell?.fill || "transparent",
                  }}
                  onClick={() => {
                    onSelect(r, c);
                    requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                >
                  {editing ? (
                    <input
                      ref={inputRef}
                      className="absolute inset-0 h-full w-full bg-transparent px-1.5 text-[12px] text-foreground outline-none"
                      value={display(cell)}
                      dir="auto"
                      onChange={(e) => onChangeCell(r, c, e.target.value)}
                      onBlur={onCommit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          onCommit();
                          onSelect(Math.min(sheet.rows - 1, r + 1), c);
                        } else if (e.key === "Tab") {
                          e.preventDefault();
                          onCommit();
                          onSelect(r, Math.min(sheet.cols - 1, c + 1));
                        } else if (e.key === "ArrowDown") {
                          e.preventDefault();
                          onCommit();
                          onSelect(Math.min(sheet.rows - 1, r + 1), c);
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          onCommit();
                          onSelect(Math.max(0, r - 1), c);
                        } else if (e.key === "ArrowLeft" && !e.shiftKey) {
                          const el = e.currentTarget;
                          if (el.selectionStart === 0) {
                            e.preventDefault();
                            onCommit();
                            onSelect(r, Math.max(0, c - 1));
                          }
                        } else if (e.key === "ArrowRight" && !e.shiftKey) {
                          const el = e.currentTarget;
                          if (el.selectionStart === el.value.length) {
                            e.preventDefault();
                            onCommit();
                            onSelect(r, Math.min(sheet.cols - 1, c + 1));
                          }
                        }
                      }}
                    />
                  ) : (
                    <div
                      className={`flex h-full items-center overflow-hidden px-1.5 text-[12px] text-foreground ${
                        cell?.bold ? "font-semibold" : ""
                      }`}
                      dir="auto"
                    >
                      {display(cell)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
