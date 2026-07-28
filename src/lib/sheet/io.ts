import ExcelJS from "exceljs";
import {
  cellKey,
  emptySheet,
  type CellAlign,
  type SheetCell,
  type SheetModel,
  type WorkbookModel,
} from "./model";

function cellDisplay(cell: ExcelJS.Cell): {
  value: SheetCell["value"];
  formula?: string;
} {
  const v = cell.value;
  if (v == null) return { value: null };
  if (typeof v === "object" && v && "formula" in v) {
    const f = v as ExcelJS.CellFormulaValue;
    const result = f.result;
    return {
      formula: String(f.formula || ""),
      value:
        typeof result === "number" ||
        typeof result === "string" ||
        typeof result === "boolean"
          ? result
          : f.formula
            ? `=${f.formula}`
            : null,
    };
  }
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
    return { value: v };
  }
  if (v instanceof Date) return { value: v.toISOString().slice(0, 10) };
  if (typeof v === "object" && "text" in v) {
    return { value: String((v as { text: string }).text || "") };
  }
  return { value: String(v) };
}

function argbToHex(argb?: string): string | undefined {
  if (!argb || argb.length < 6) return undefined;
  return `#${argb.slice(-6)}`;
}

function alignFromExcel(a?: ExcelJS.Alignment["horizontal"]): CellAlign | undefined {
  if (a === "left" || a === "center" || a === "right") return a;
  return undefined;
}

export async function workbookFromBuffer(
  buffer: ArrayBuffer,
): Promise<WorkbookModel> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets: SheetModel[] = [];

  wb.eachSheet((ws) => {
    const rowCount = Math.max(ws.rowCount || 1, 30);
    const colCount = Math.max(ws.columnCount || 1, 10);
    const sheet = emptySheet(ws.name || "Sheet", rowCount, colCount);
    sheet.colWidths = Array.from({ length: sheet.cols }, (_, i) => {
      const col = ws.getColumn(i + 1);
      const w = typeof col.width === "number" ? col.width : 12;
      return Math.min(40, Math.max(6, w));
    });

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const r = rowNumber - 1;
        const c = colNumber - 1;
        if (r >= sheet.rows) sheet.rows = r + 1;
        if (c >= sheet.cols) {
          sheet.cols = c + 1;
          while (sheet.colWidths.length < sheet.cols) sheet.colWidths.push(12);
        }
        const parsed = cellDisplay(cell);
        const fill =
          cell.fill &&
          cell.fill.type === "pattern" &&
          cell.fill.pattern === "solid"
            ? argbToHex(cell.fill.fgColor?.argb)
            : undefined;
        const border: SheetCell["border"] = {};
        if (cell.border?.top?.style) border.top = true;
        if (cell.border?.right?.style) border.right = true;
        if (cell.border?.bottom?.style) border.bottom = true;
        if (cell.border?.left?.style) border.left = true;
        const hasBorder = border.top || border.right || border.bottom || border.left;
        const entry: SheetCell = {
          r,
          c,
          value: parsed.value,
          formula: parsed.formula,
          bold: cell.font?.bold || undefined,
          italic: cell.font?.italic || undefined,
          underline: Boolean(cell.font?.underline) || undefined,
          fill,
          color: argbToHex(cell.font?.color?.argb),
          align: alignFromExcel(cell.alignment?.horizontal),
          fontSize: cell.font?.size,
          border: hasBorder ? border : undefined,
        };
        sheet.cells[cellKey(r, c)] = entry;
      });
    });
    sheets.push(sheet);
  });

  if (!sheets.length) sheets.push(emptySheet("Sheet1"));
  return { sheets, activeIndex: 0 };
}

export async function workbookToBuffer(
  model: WorkbookModel,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Qalib";
  for (const sheet of model.sheets) {
    const ws = wb.addWorksheet(sheet.name || "Sheet");
    for (let c = 0; c < sheet.cols; c += 1) {
      ws.getColumn(c + 1).width = sheet.colWidths[c] ?? 12;
    }
    for (const cell of Object.values(sheet.cells)) {
      const excelCell = ws.getCell(cell.r + 1, cell.c + 1);
      if (cell.formula) {
        excelCell.value = { formula: cell.formula.replace(/^=/, "") };
      } else if (cell.value != null && cell.value !== "") {
        excelCell.value = cell.value;
      }
      excelCell.font = {
        ...(excelCell.font || {}),
        bold: cell.bold || false,
        italic: cell.italic || false,
        underline: cell.underline ? "single" : undefined,
        size: cell.fontSize,
        color: cell.color
          ? { argb: `FF${cell.color.replace("#", "")}` }
          : undefined,
      };
      if (cell.fill) {
        const hex = cell.fill.replace("#", "");
        excelCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${hex}` },
        };
      }
      if (cell.align) {
        excelCell.alignment = {
          ...(excelCell.alignment || {}),
          horizontal: cell.align,
          vertical: "middle",
        };
      }
      if (cell.border) {
        const edge = {
          style: "thin" as const,
          color: { argb: `FF${(cell.border.color || "#334155").replace("#", "")}` },
        };
        excelCell.border = {
          top: cell.border.top ? edge : undefined,
          right: cell.border.right ? edge : undefined,
          bottom: cell.border.bottom ? edge : undefined,
          left: cell.border.left ? edge : undefined,
        };
      }
      if (cell.numberFormat === "percent") excelCell.numFmt = "0.00%";
      if (cell.numberFormat === "currency") excelCell.numFmt = '#,##0.00 "EGP"';
      if (cell.numberFormat === "number") excelCell.numFmt = "#,##0.####";
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  const bytes =
    buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
