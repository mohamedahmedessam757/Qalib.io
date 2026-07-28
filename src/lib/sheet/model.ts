export type SheetCellValue = string | number | boolean | null;

export type SheetCell = {
  r: number;
  c: number;
  value: SheetCellValue;
  formula?: string;
  bold?: boolean;
  fill?: string;
};

export type SheetModel = {
  name: string;
  rows: number;
  cols: number;
  cells: Record<string, SheetCell>;
  colWidths: number[];
};

export type WorkbookModel = {
  sheets: SheetModel[];
  activeIndex: number;
};

export function cellKey(r: number, c: number) {
  return `${r}:${c}`;
}

export function colLabel(c: number) {
  let n = c + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function parseA1(ref: string): { r: number; c: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!m) return null;
  const letters = m[1].toUpperCase();
  let c = 0;
  for (let i = 0; i < letters.length; i += 1) {
    c = c * 26 + (letters.charCodeAt(i) - 64);
  }
  const r = Number(m[2]);
  if (!r || c < 1) return null;
  return { r: r - 1, c: c - 1 };
}

export function toA1(r: number, c: number) {
  return `${colLabel(c)}${r + 1}`;
}

export function emptySheet(name: string, rows = 40, cols = 12): SheetModel {
  return {
    name: name.slice(0, 31) || "Sheet1",
    rows,
    cols,
    cells: {},
    colWidths: Array.from({ length: cols }, () => 12),
  };
}

export function snapshotSheet(sheet: SheetModel, maxCells = 200) {
  const entries = Object.values(sheet.cells)
    .filter((c) => c.value != null && c.value !== "")
    .slice(0, maxCells)
    .map((c) => ({
      a1: toA1(c.r, c.c),
      value: c.value,
      formula: c.formula,
    }));
  return {
    name: sheet.name,
    rows: sheet.rows,
    cols: sheet.cols,
    filled: entries,
  };
}
