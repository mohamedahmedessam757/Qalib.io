import { getVanillaNodeText } from "@eigenpal/docx-editor-core/prosemirror/paraText";
import type { Node as PmNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

export type TableCellInfo = {
  row: number;
  col: number;
  /** First paragraph in the cell (primary write target). */
  paraId: string;
  /** Every textblock paraId inside the cell (layout tables often pack many). */
  paraIds: string[];
  /** Cell body with paragraphs joined by newlines. */
  text: string;
};

export type TableGrid = {
  rows: number;
  cols: number;
  focusRow: number;
  focusCol: number;
  /** Paragraph the user actually tapped (may be mid-cell). */
  focusParaId?: string;
  cells: TableCellInfo[];
};

/** Eigenpal uses camelCase; some PM schemas use snake_case — accept both. */
const ROW_TYPES = new Set(["tableRow", "table_row"]);
const CELL_TYPES = new Set([
  "tableCell",
  "table_cell",
  "tableHeader",
  "table_header",
]);

function isTableNode(name: string) {
  return name === "table";
}

function findTableFromSelection(
  view: EditorView,
): { table: PmNode; tablePos: number } | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (isTableNode(node.type.name)) {
      return { table: node, tablePos: $from.before(depth) };
    }
  }
  return null;
}

/**
 * Collect every textblock in a cell. Formal Word layouts often put letterhead +
 * body copy in one cell as many paragraphs — indexing only the first made the
 * mobile table sheet appear "stuck" on the letterhead forever.
 */
export function paragraphsInCell(
  cell: PmNode,
): { paraId: string; text: string }[] {
  const hits: { paraId: string; text: string }[] = [];
  cell.descendants((node) => {
    if (!node.isTextblock) return true;
    const paraId = String(node.attrs?.paraId || "").trim();
    if (!paraId) return true;
    hits.push({
      paraId,
      text: getVanillaNodeText(node) || "",
    });
    return true;
  });
  return hits;
}

function cellInfoFromNode(
  cellNode: PmNode,
  row: number,
  col: number,
): TableCellInfo | null {
  const paras = paragraphsInCell(cellNode);
  if (paras.length === 0) return null;
  return {
    row,
    col,
    paraId: paras[0]!.paraId,
    paraIds: paras.map((p) => p.paraId),
    text: paras.map((p) => p.text).join("\n"),
  };
}

export function cellContainsParaId(
  cell: TableCellInfo,
  paraId: string,
): boolean {
  if (cell.paraId === paraId) return true;
  return cell.paraIds.includes(paraId);
}

function focusParaIdFromSelection(view: EditorView): string | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.isTextblock) {
      const paraId = String(node.attrs?.paraId || "").trim();
      if (paraId) return paraId;
    }
  }
  return null;
}

/**
 * Reads the table grid under the current selection. Returns null outside a table.
 */
export function readTableGridFromView(view: EditorView): TableGrid | null {
  const found = findTableFromSelection(view);
  if (!found) return null;

  const cells: TableCellInfo[] = [];
  let rowIndex = 0;
  let maxCols = 0;

  found.table.forEach((rowNode) => {
    if (!ROW_TYPES.has(rowNode.type.name)) return;
    let colIndex = 0;
    rowNode.forEach((cellNode) => {
      if (!CELL_TYPES.has(cellNode.type.name)) return;
      const info = cellInfoFromNode(cellNode, rowIndex, colIndex);
      if (info) cells.push(info);
      colIndex += 1;
    });
    maxCols = Math.max(maxCols, colIndex);
    rowIndex += 1;
  });

  if (cells.length === 0 || maxCols === 0) return null;

  const focusParaId = focusParaIdFromSelection(view);
  let focusRow = 0;
  let focusCol = 0;
  if (focusParaId) {
    const focusCell = cells.find((c) => cellContainsParaId(c, focusParaId));
    if (focusCell) {
      focusRow = focusCell.row;
      focusCol = focusCell.col;
    }
  }

  return {
    rows: rowIndex,
    cols: maxCols,
    focusRow,
    focusCol,
    focusParaId: focusParaId || undefined,
    cells,
  };
}

export function readTableGridFromEditor(
  getView: () => EditorView | null | undefined,
): TableGrid | null {
  const view = getView();
  if (!view) return null;
  return readTableGridFromView(view);
}

/** True when the current selection is inside a table (any schema naming). */
export function isSelectionInTable(
  getView: () => EditorView | null | undefined,
): boolean {
  return Boolean(readTableGridFromEditor(getView));
}
