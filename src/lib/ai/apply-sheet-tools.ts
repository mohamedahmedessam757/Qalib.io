import type { ExcelEditorHandle } from "@/components/excel-editor/ExcelEditorClient";
import {
  cellKey,
  emptySheet,
  parseA1,
  toA1,
  type SheetCell,
  type WorkbookModel,
} from "@/lib/sheet/model";
import { isSheetToolName } from "./sheet-tools";

export type SheetToolResult = {
  ok: boolean;
  result: string;
  mutated: boolean;
};

function activeSheet(wb: WorkbookModel) {
  return wb.sheets[wb.activeIndex] || wb.sheets[0];
}

function parseRange(range: string): Array<{ r: number; c: number }> {
  const parts = range.split(":");
  const start = parseA1(parts[0] || "");
  if (!start) return [];
  if (parts.length === 1) return [start];
  const end = parseA1(parts[1] || "");
  if (!end) return [start];
  const out: Array<{ r: number; c: number }> = [];
  const r0 = Math.min(start.r, end.r);
  const r1 = Math.max(start.r, end.r);
  const c0 = Math.min(start.c, end.c);
  const c1 = Math.max(start.c, end.c);
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      out.push({ r, c });
    }
  }
  return out.slice(0, 400);
}

export function applySheetTool(
  handle: ExcelEditorHandle | null,
  name: string,
  args: Record<string, unknown>,
): SheetToolResult {
  if (!handle) {
    return { ok: false, mutated: false, result: "Sheet editor not ready" };
  }
  if (!isSheetToolName(name)) {
    return { ok: false, mutated: false, result: `Unknown tool ${name}` };
  }

  if (name === "read_sheet_range") {
    const range = typeof args.range === "string" ? args.range : "";
    const wb = handle.getWorkbook();
    if (!wb) return { ok: false, mutated: false, result: "No workbook" };
    const sheet = activeSheet(wb);
    const coords = parseRange(range);
    if (!coords.length) {
      return { ok: false, mutated: false, result: "Invalid range" };
    }
    const cells = coords.map(({ r, c }) => {
      const cell = sheet.cells[cellKey(r, c)];
      return {
        a1: toA1(r, c),
        value: cell?.value ?? null,
        formula: cell?.formula,
      };
    });
    return {
      ok: true,
      mutated: false,
      result: JSON.stringify({ sheet: sheet.name, cells }),
    };
  }

  if (name === "write_cells") {
    const list = Array.isArray(args.cells) ? args.cells : [];
    handle.applyMutation((wb) => {
      const sheet = activeSheet(wb);
      for (const item of list.slice(0, 200)) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const a1 = typeof rec.a1 === "string" ? rec.a1 : "";
        const pos = parseA1(a1);
        if (!pos) continue;
        if (pos.r >= sheet.rows) sheet.rows = pos.r + 1;
        if (pos.c >= sheet.cols) {
          sheet.cols = pos.c + 1;
          while (sheet.colWidths.length < sheet.cols) sheet.colWidths.push(12);
        }
        const value = rec.value as SheetCell["value"];
        sheet.cells[cellKey(pos.r, pos.c)] = {
          r: pos.r,
          c: pos.c,
          value,
        };
      }
      return wb;
    });
    return {
      ok: true,
      mutated: true,
      result: `Wrote ${Math.min(list.length, 200)} cell(s)`,
    };
  }

  if (name === "insert_rows") {
    const startRow = Math.max(1, Number(args.startRow) || 1);
    const count = Math.min(50, Math.max(1, Number(args.count) || 1));
    handle.applyMutation((wb) => {
      const sheet = activeSheet(wb);
      const at = startRow - 1;
      const cells: typeof sheet.cells = {};
      for (const cell of Object.values(sheet.cells)) {
        const nr = cell.r >= at ? cell.r + count : cell.r;
        cells[cellKey(nr, cell.c)] = { ...cell, r: nr };
      }
      sheet.cells = cells;
      sheet.rows += count;
      return wb;
    });
    return { ok: true, mutated: true, result: `Inserted ${count} row(s)` };
  }

  if (name === "delete_rows") {
    const startRow = Math.max(1, Number(args.startRow) || 1);
    const count = Math.min(50, Math.max(1, Number(args.count) || 1));
    handle.applyMutation((wb) => {
      const sheet = activeSheet(wb);
      const at = startRow - 1;
      const end = at + count;
      const cells: typeof sheet.cells = {};
      for (const cell of Object.values(sheet.cells)) {
        if (cell.r >= at && cell.r < end) continue;
        const nr = cell.r >= end ? cell.r - count : cell.r;
        cells[cellKey(nr, cell.c)] = { ...cell, r: nr };
      }
      sheet.cells = cells;
      sheet.rows = Math.max(1, sheet.rows - count);
      return wb;
    });
    return { ok: true, mutated: true, result: `Deleted ${count} row(s)` };
  }

  if (name === "set_formula") {
    const a1 = typeof args.a1 === "string" ? args.a1 : "";
    const formula =
      typeof args.formula === "string" ? args.formula.replace(/^=/, "") : "";
    const pos = parseA1(a1);
    if (!pos || !formula) {
      return { ok: false, mutated: false, result: "Invalid a1/formula" };
    }
    handle.applyMutation((wb) => {
      const sheet = activeSheet(wb);
      sheet.cells[cellKey(pos.r, pos.c)] = {
        r: pos.r,
        c: pos.c,
        value: `=${formula}`,
        formula,
      };
      return wb;
    });
    return { ok: true, mutated: true, result: `Set formula at ${a1}` };
  }

  if (name === "create_sheet") {
    const nameArg =
      typeof args.name === "string" && args.name.trim()
        ? args.name.trim().slice(0, 31)
        : "Sheet";
    handle.applyMutation((wb) => {
      wb.sheets.push(emptySheet(nameArg));
      wb.activeIndex = wb.sheets.length - 1;
      return wb;
    });
    return { ok: true, mutated: true, result: `Created sheet ${nameArg}` };
  }

  return { ok: false, mutated: false, result: "Unhandled tool" };
}
