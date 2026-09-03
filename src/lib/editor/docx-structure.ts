import { getVanillaNodeText } from "@eigenpal/docx-editor-core/prosemirror/paraText";
import type { Node as PmNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import type { DocxCanvasHandle } from "@/components/editor/DocxCanvas";
import {
  insertParagraphAfter,
  insertTableAfter,
  listDocumentParagraphs,
} from "@/lib/ai/direct-doc-edit";
import {
  readTableGridFromView,
  type TableCellInfo,
} from "@/lib/editor/read-table-grid";

export type DocxStructureKind = "paragraph" | "table" | "image";

export type DocxStructureItem = {
  id: string;
  kind: DocxStructureKind;
  page: number;
  label: string;
  paraId?: string;
  /** Table dimensions when kind === "table" */
  rows?: number;
  cols?: number;
  /** Snapshot for copy/duplicate */
  text?: string;
  cells?: TableCellInfo[];
};

export type DocxStructureClipboard =
  | {
      kind: "paragraph";
      text: string;
    }
  | {
      kind: "table";
      rows: number;
      cols: number;
      matrix: string[][];
    }
  | {
      kind: "image";
      /** data URL — capped; may be empty if too large */
      dataUrl: string;
    };

const ROW_TYPES = new Set(["tableRow", "table_row"]);
const CELL_TYPES = new Set([
  "tableCell",
  "table_cell",
  "tableHeader",
  "table_header",
]);
const IMAGE_TYPES = new Set([
  "image",
  "drawing",
  "inlineImage",
  "blockImage",
  "picture",
]);

const MAX_CLIPBOARD_CHARS = 200_000;

function truncateLabel(text: string, max = 48): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "…";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function paragraphInCell(cell: PmNode): { paraId: string; text: string } | null {
  let hit: { paraId: string; text: string } | null = null;
  cell.descendants((node) => {
    if (hit) return false;
    if (!node.isTextblock) return true;
    const paraId = String(node.attrs?.paraId || "").trim();
    if (!paraId) return true;
    hit = { paraId, text: getVanillaNodeText(node) || "" };
    return false;
  });
  return hit;
}

function readTableAtPos(
  table: PmNode,
): { rows: number; cols: number; cells: TableCellInfo[]; label: string } | null {
  const cells: TableCellInfo[] = [];
  let rowIndex = 0;
  let maxCols = 0;
  table.forEach((rowNode) => {
    if (!ROW_TYPES.has(rowNode.type.name)) return;
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
  if (!cells.length || !maxCols) return null;
  const label =
    truncateLabel(cells.map((c) => c.text).filter(Boolean).join(" · ")) ||
    "Table";
  return { rows: rowIndex, cols: maxCols, cells, label };
}

function estimatePageForPos(
  view: EditorView,
  pos: number,
  totalPages: number,
): number {
  if (totalPages <= 1) return 1;
  const size = view.state.doc.content.size || 1;
  const ratio = Math.min(1, Math.max(0, pos / size));
  return Math.min(totalPages, Math.max(1, Math.floor(ratio * totalPages) + 1));
}

/**
 * Live structure outline for the Word side panel (paragraphs, tables, images).
 */
export function collectDocxStructure(
  editor: DocxCanvasHandle,
): DocxStructureItem[] {
  const view = editor.getEditorRef()?.getView();
  const totalPages = Math.max(1, editor.getTotalPages?.() || 1);
  const items: DocxStructureItem[] = [];
  const seenParas = new Set<string>();
  const tableParaIds = new Set<string>();

  if (view) {
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "table") {
        const grid = readTableAtPos(node);
        if (grid) {
          for (const c of grid.cells) tableParaIds.add(c.paraId);
          const anchor = grid.cells[0]?.paraId || `table_${pos}`;
          items.push({
            id: `table:${anchor}`,
            kind: "table",
            page: estimatePageForPos(view, pos, totalPages),
            label: grid.label,
            paraId: anchor,
            rows: grid.rows,
            cols: grid.cols,
            cells: grid.cells,
          });
        }
        return false;
      }
      if (IMAGE_TYPES.has(node.type.name) || node.type.name.includes("image")) {
        items.push({
          id: `image:${pos}`,
          kind: "image",
          page: estimatePageForPos(view, pos, totalPages),
          label: "Image",
          paraId: undefined,
        });
        return false;
      }
      return true;
    });
  }

  const paras = listDocumentParagraphs(editor);
  for (const p of paras) {
    if (seenParas.has(p.paraId) || tableParaIds.has(p.paraId)) continue;
    seenParas.add(p.paraId);
    items.push({
      id: `para:${p.paraId}`,
      kind: "paragraph",
      page: p.page || 1,
      label: truncateLabel(p.text),
      paraId: p.paraId,
      text: p.text,
    });
  }

  // Stable-ish order: by page then kind weight (table/image/para)
  const weight = (k: DocxStructureKind) =>
    k === "table" ? 0 : k === "image" ? 1 : 2;
  items.sort((a, b) => a.page - b.page || weight(a.kind) - weight(b.kind));
  return items;
}

export function snapshotStructureItem(
  item: DocxStructureItem,
  editor?: DocxCanvasHandle,
): DocxStructureClipboard | null {
  if (item.kind === "paragraph") {
    const text = (item.text || "").slice(0, MAX_CLIPBOARD_CHARS);
    return { kind: "paragraph", text };
  }
  if (item.kind === "table") {
    const rows = item.rows || 0;
    const cols = item.cols || 0;
    if (!rows || !cols || !item.cells?.length) {
      // Refresh from live selection if possible
      if (editor) {
        const view = editor.getEditorRef()?.getView();
        if (view && item.paraId) {
          // Best-effort: use current selection table
          const grid = readTableGridFromView(view);
          if (grid) {
            const matrix = Array.from({ length: grid.rows }, () =>
              Array.from({ length: grid.cols }, () => ""),
            );
            for (const c of grid.cells) {
              if (c.row < grid.rows && c.col < grid.cols) {
                matrix[c.row][c.col] = c.text;
              }
            }
            return {
              kind: "table",
              rows: grid.rows,
              cols: grid.cols,
              matrix,
            };
          }
        }
      }
      return null;
    }
    const matrix = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ""),
    );
    for (const c of item.cells) {
      if (c.row < rows && c.col < cols) matrix[c.row][c.col] = c.text;
    }
    return { kind: "table", rows, cols, matrix };
  }
  // Images: clipboard stores empty marker — paste re-prompts or no-ops safely
  return { kind: "image", dataUrl: "" };
}

export function pasteStructureClipboard(
  editor: DocxCanvasHandle,
  clip: DocxStructureClipboard,
  afterParaId: string | null,
): { ok: boolean; detail: string } {
  const paras = listDocumentParagraphs(editor);
  const anchor =
    afterParaId ||
    paras[paras.length - 1]?.paraId ||
    editor.getSelectionInfo?.()?.paraId ||
    null;
  if (!anchor) return { ok: false, detail: "no anchor paragraph" };

  if (clip.kind === "paragraph") {
    return insertParagraphAfter(editor, anchor, clip.text);
  }
  if (clip.kind === "table") {
    return insertTableAfter(
      editor,
      anchor,
      clip.rows,
      clip.cols,
      clip.matrix,
    );
  }
  return { ok: false, detail: "image paste requires re-upload" };
}

export function duplicateStructureItem(
  editor: DocxCanvasHandle,
  item: DocxStructureItem,
): { ok: boolean; detail: string } {
  const snap = snapshotStructureItem(item, editor);
  if (!snap) return { ok: false, detail: "could not snapshot item" };
  const after = item.paraId || editor.getSelectionInfo?.()?.paraId || null;
  return pasteStructureClipboard(editor, snap, after);
}
