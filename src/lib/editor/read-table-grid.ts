import { getVanillaNodeText } from "@eigenpal/docx-editor-core/prosemirror/paraText";
import type { Node as PmNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

export type TableCellInfo = {
  row: number;
  col: number;
  paraId: string;
  text: string;
};

export type TableGrid = {
  rows: number;
  cols: number;
  focusRow: number;
  focusCol: number;
  cells: TableCellInfo[];
};

const CELL_TYPES = new Set(["table_cell", "table_header"]);

function findTableFromSelection(
  view: EditorView,
): { table: PmNode; tablePos: number } | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "table") {
      return { table: node, tablePos: $from.before(depth) };
    }
  }
  return null;
}

function paragraphInCell(cell: PmNode): { paraId: string; text: string } | null {
  let hit: { paraId: string; text: string } | null = null;
  cell.descendants((node) => {
    if (hit) return false;
    if (!node.isTextblock) return true;
    const paraId = String(node.attrs?.paraId || "").trim();
    if (!paraId) return true;
    hit = {
      paraId,
      text: getVanillaNodeText(node),
    };
    return false;
  });
  return hit;
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
    if (rowNode.type.name !== "table_row") return;
    let colIndex = 0;
    rowNode.forEach((cellNode) => {
      if (!CELL_TYPES.has(cellNode.type.name)) return;
      const para = paragraphInCell(cellNode);
      if (para) {
        cells.push({
          row: rowIndex,
          col: colIndex,
          paraId: para.paraId,
          text: para.text,
        });
      }
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
    const focusCell = cells.find((c) => c.paraId === focusParaId);
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
