"use client";

import { useMemo, useRef } from "react";
import {
  cellKey,
  colLabel,
  formatCellDisplay,
  type SheetCell,
  type SheetCellValue,
  type SheetModel,
} from "@/lib/sheet/model";
import { evaluateSheet } from "@/lib/sheet/formula";

const ROW_H = 28;
const HEADER_H = 28;
const GUTTER_W = 44;

export function ExcelGrid({
  sheet,
  active,
  zoom = 1,
  onSelect,
  onChangeCell,
  onCommit,
}: {
  sheet: SheetModel;
  active: { r: number; c: number } | null;
  zoom?: number;
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
  const computed = useMemo(() => evaluateSheet(sheet), [sheet]);

  function getCell(r: number, c: number): SheetCell | undefined {
    return sheet.cells[cellKey(r, c)];
  }

  function editValue(cell: SheetCell | undefined) {
    if (!cell) return "";
    if (cell.formula) return `=${cell.formula.replace(/^=/, "")}`;
    return cell.value == null ? "" : String(cell.value);
  }

  function shown(cell: SheetCell | undefined, r: number, c: number) {
    if (!cell) return "";
    if (cell.formula) {
      const v = computed.get(cellKey(r, c)) as SheetCellValue;
      return formatCellDisplay(v, cell.numberFormat);
    }
    return formatCellDisplay(cell.value, cell.numberFormat);
  }

  const frame = sheet.frame;
  const frameStyle =
    frame && frame.style !== "none"
      ? {
          boxShadow:
            frame.style === "double"
              ? `inset 0 0 0 2px ${frame.color}, inset 0 0 0 5px transparent, inset 0 0 0 7px ${frame.color}`
              : frame.style === "thick"
                ? `inset 0 0 0 4px ${frame.color}`
                : `inset 0 0 0 2px ${frame.color}`,
        }
      : undefined;

  return (
    <div className="h-full overflow-auto overscroll-contain" dir="ltr">
      <div
        className="origin-top-left"
        style={{
          transform: `scale(${zoom})`,
          width: `${100 / zoom}%`,
          minHeight: `${100 / zoom}%`,
          ...frameStyle,
        }}
      >
        <div
          className="inline-grid min-w-full"
          style={{
            gridTemplateColumns: `${GUTTER_W}px ${cols
              .map((c) => `${Math.round((sheet.colWidths[c] || 12) * 8)}px`)
              .join(" ")}`,
          }}
        >
          <div
            className="sticky left-0 top-0 z-20 border-b border-r border-line bg-[#0d1524]"
            style={{ height: HEADER_H }}
          />
          {cols.map((c) => (
            <div
              key={`h-${c}`}
              className="sticky top-0 z-10 flex items-center justify-center border-b border-r border-line bg-[#0d1524] text-[11px] text-muted"
              style={{ height: HEADER_H }}
            >
              {colLabel(c)}
            </div>
          ))}

          {rows.map((r) => (
            <div key={`row-${r}`} className="contents">
              <div
                className="sticky left-0 z-[5] flex items-center justify-center border-b border-r border-line bg-[#0d1524] text-[11px] text-muted"
                style={{ height: ROW_H }}
              >
                {r + 1}
              </div>
              {cols.map((c) => {
                const cell = getCell(r, c);
                const selected = active?.r === r && active?.c === c;
                const border = cell?.border;
                return (
                  <div
                    key={cellKey(r, c)}
                    className={`relative border-b border-r border-line ${
                      selected ? "ring-1 ring-inset ring-accent" : ""
                    }`}
                    style={{
                      height: ROW_H,
                      backgroundColor: cell?.fill || "transparent",
                      boxShadow: border
                        ? [
                            border.top
                              ? `inset 0 2px 0 0 ${border.color || "#94a3b8"}`
                              : "",
                            border.right
                              ? `inset -2px 0 0 0 ${border.color || "#94a3b8"}`
                              : "",
                            border.bottom
                              ? `inset 0 -2px 0 0 ${border.color || "#94a3b8"}`
                              : "",
                            border.left
                              ? `inset 2px 0 0 0 ${border.color || "#94a3b8"}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(",")
                        : undefined,
                    }}
                    onClick={() => {
                      onSelect(r, c);
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                  >
                    {selected ? (
                      <input
                        ref={inputRef}
                        className="absolute inset-0 h-full w-full bg-transparent px-1.5 text-[12px] text-foreground outline-none"
                        style={{
                          fontWeight: cell?.bold ? 600 : 400,
                          fontStyle: cell?.italic ? "italic" : "normal",
                          textDecoration: cell?.underline ? "underline" : "none",
                          color: cell?.color || undefined,
                          textAlign: cell?.align || "left",
                          fontSize: cell?.fontSize
                            ? `${Math.max(10, cell.fontSize * 0.85)}px`
                            : undefined,
                        }}
                        value={editValue(cell)}
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
                        className="flex h-full items-center overflow-hidden px-1.5 text-[12px] text-foreground"
                        style={{
                          fontWeight: cell?.bold ? 600 : 400,
                          fontStyle: cell?.italic ? "italic" : "normal",
                          textDecoration: cell?.underline ? "underline" : "none",
                          color: cell?.color || undefined,
                          justifyContent:
                            cell?.align === "center"
                              ? "center"
                              : cell?.align === "right"
                                ? "flex-end"
                                : "flex-start",
                          fontSize: cell?.fontSize
                            ? `${Math.max(10, cell.fontSize * 0.85)}px`
                            : undefined,
                        }}
                        dir="auto"
                      >
                        {shown(cell, r, c)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
