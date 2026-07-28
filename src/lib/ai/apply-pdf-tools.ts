import {
  createId,
  type PdfOverlay,
  type ShapeOverlay,
  type TextOverlay,
} from "@/lib/pdf/export-overlays";
import { hasArabic, organizePdfText } from "@/lib/pdf/arabic-text";
import { isPdfToolName } from "./pdf-tools";

export type PdfEditorHandle = {
  getOverlays: () => PdfOverlay[];
  getPageCount: () => number;
  applyOverlays: (next: PdfOverlay[]) => void;
  snapshot: () => string;
};

export type PdfToolResult = {
  ok: boolean;
  result: string;
  mutated: boolean;
};

function num(v: unknown, fallback: number, min = 0, max = 1) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

export function applyPdfTool(
  handle: PdfEditorHandle | null,
  name: string,
  args: Record<string, unknown>,
): PdfToolResult {
  if (!handle) {
    return { ok: false, mutated: false, result: "PDF editor not ready" };
  }
  if (!isPdfToolName(name)) {
    return { ok: false, mutated: false, result: `Unknown tool ${name}` };
  }

  if (name === "read_pdf_state" || name === "list_pdf_overlays") {
    return { ok: true, mutated: false, result: handle.snapshot() };
  }

  const overlays = handle.getOverlays();
  const pageCount = Math.max(1, handle.getPageCount());

  if (name === "add_pdf_text") {
    const text = organizePdfText(str(args.text));
    if (!text) return { ok: false, mutated: false, result: "text required" };
    const pageIndex = Math.min(
      pageCount - 1,
      Math.max(0, Math.floor(num(args.pageIndex, 0, 0, 999))),
    );
    const rtl = hasArabic(text);
    const overlay: TextOverlay = {
      id: createId("text"),
      type: "text",
      pageIndex,
      x: num(args.x, 0.12),
      y: num(args.y, 0.12),
      w: num(args.w, 0.7, 0.05, 1),
      h: num(args.h, Math.min(0.35, 0.04 + text.split("\n").length * 0.035), 0.02, 1),
      text,
      fontSize: num(args.fontSize, 14, 8, 72),
      color: str(args.color, "#111827") || "#111827",
      align:
        args.align === "start" || args.align === "center" || args.align === "end"
          ? args.align
          : rtl
            ? "end"
            : "start",
      dir: rtl ? "rtl" : "ltr",
      coverOriginal: args.coverOriginal === true,
    };
    handle.applyOverlays([...overlays, overlay]);
    return {
      ok: true,
      mutated: true,
      result: JSON.stringify({ id: overlay.id, pageIndex }),
    };
  }

  if (name === "update_pdf_text") {
    const id = str(args.id);
    let found = false;
    const next = overlays.map((o) => {
      if (o.id !== id || o.type !== "text") return o;
      found = true;
      const text =
        typeof args.text === "string" ? organizePdfText(args.text) : o.text;
      const rtl = hasArabic(text);
      return {
        ...o,
        text,
        fontSize:
          typeof args.fontSize === "number"
            ? num(args.fontSize, o.fontSize, 8, 72)
            : o.fontSize,
        color: typeof args.color === "string" ? args.color : o.color,
        align:
          args.align === "start" ||
          args.align === "center" ||
          args.align === "end"
            ? args.align
            : o.align || (rtl ? "end" : "start"),
        dir: rtl ? "rtl" : o.dir,
      } satisfies TextOverlay;
    });
    if (!found) return { ok: false, mutated: false, result: "overlay not found" };
    handle.applyOverlays(next);
    return { ok: true, mutated: true, result: `updated ${id}` };
  }

  if (name === "organize_pdf_text") {
    const id = typeof args.id === "string" ? args.id : null;
    let count = 0;
    const next = overlays.map((o) => {
      if (o.type !== "text") return o;
      if (id && o.id !== id) return o;
      count += 1;
      const text = organizePdfText(o.text);
      const rtl = hasArabic(text);
      return {
        ...o,
        text,
        align:
          args.align === "start" ||
          args.align === "center" ||
          args.align === "end"
            ? args.align
            : o.align || (rtl ? "end" : "start"),
        dir: rtl ? "rtl" : "ltr",
      } satisfies TextOverlay;
    });
    handle.applyOverlays(next);
    return { ok: true, mutated: true, result: `organized ${count} text box(es)` };
  }

  if (name === "add_pdf_shape") {
    const shape = str(args.shape, "border") as ShapeOverlay["type"];
    const allowed: ShapeOverlay["type"][] = [
      "rect",
      "border",
      "doubleFrame",
      "oval",
      "banner",
      "stamp",
      "line",
    ];
    if (!allowed.includes(shape)) {
      return { ok: false, mutated: false, result: "invalid shape" };
    }
    const pageIndex = Math.min(
      pageCount - 1,
      Math.max(0, Math.floor(num(args.pageIndex, 0, 0, 999))),
    );
    const overlay: ShapeOverlay = {
      id: createId(shape),
      type: shape,
      pageIndex,
      x: num(args.x, shape === "line" ? 0.15 : 0.18),
      y: num(args.y, shape === "line" ? 0.4 : 0.2),
      w: num(args.w, shape === "line" ? 0.5 : 0.35, 0.04, 1),
      h: num(args.h, shape === "line" ? 0.02 : 0.22, 0.02, 1),
      stroke: str(args.color, "#0f766e") || "#0f766e",
      strokeWidth: shape === "border" || shape === "stamp" ? 2.5 : 1.5,
      fill: str(args.color, "#0f766e") || "#0f766e",
      fillOpacity:
        shape === "rect" || shape === "oval" || shape === "stamp"
          ? 0.1
          : shape === "banner"
            ? 0.18
            : 0,
    };
    handle.applyOverlays([...overlays, overlay]);
    return {
      ok: true,
      mutated: true,
      result: JSON.stringify({ id: overlay.id, shape }),
    };
  }

  if (name === "add_pdf_full_frame") {
    const pageIndex = Math.min(
      pageCount - 1,
      Math.max(0, Math.floor(num(args.pageIndex, 0, 0, 999))),
    );
    const overlay: ShapeOverlay = {
      id: createId("fullPageFrame"),
      type: "fullPageFrame",
      pageIndex,
      x: 0.04,
      y: 0.035,
      w: 0.92,
      h: 0.93,
      stroke: str(args.color, "#0f172a") || "#0f172a",
      strokeWidth: 3,
      fillOpacity: 0,
    };
    handle.applyOverlays([...overlays, overlay]);
    return {
      ok: true,
      mutated: true,
      result: JSON.stringify({ id: overlay.id, pageIndex }),
    };
  }

  if (name === "add_pdf_table") {
    const rows = Math.max(1, Math.min(12, Math.floor(num(args.rows, 3, 1, 12))));
    const cols = Math.max(1, Math.min(8, Math.floor(num(args.cols, 3, 1, 8))));
    const cells = Array.isArray(args.cells)
      ? args.cells.map((c) => String(c ?? ""))
      : Array.from({ length: rows * cols }, () => "");
    while (cells.length < rows * cols) cells.push("");
    const pageIndex = Math.min(
      pageCount - 1,
      Math.max(0, Math.floor(num(args.pageIndex, 0, 0, 999))),
    );
    const overlay: PdfOverlay = {
      id: createId("table"),
      type: "table",
      pageIndex,
      x: num(args.x, 0.1),
      y: num(args.y, 0.2),
      w: num(args.w, 0.75, 0.1, 1),
      h: num(args.h, 0.28, 0.08, 1),
      rows,
      cols,
      cells: cells.slice(0, rows * cols),
    };
    handle.applyOverlays([...overlays, overlay]);
    return {
      ok: true,
      mutated: true,
      result: JSON.stringify({ id: overlay.id, rows, cols }),
    };
  }

  if (name === "add_pdf_whiteout") {
    const pageIndex = Math.min(
      pageCount - 1,
      Math.max(0, Math.floor(num(args.pageIndex, 0, 0, 999))),
    );
    const overlay: PdfOverlay = {
      id: createId("wo"),
      type: "whiteout",
      pageIndex,
      x: num(args.x, 0.15),
      y: num(args.y, 0.2),
      w: num(args.w, 0.35, 0.04, 1),
      h: num(args.h, 0.08, 0.02, 1),
    };
    handle.applyOverlays([...overlays, overlay]);
    return { ok: true, mutated: true, result: JSON.stringify({ id: overlay.id }) };
  }

  if (name === "delete_pdf_overlay") {
    const id = str(args.id);
    const next = overlays.filter((o) => o.id !== id);
    if (next.length === overlays.length) {
      return { ok: false, mutated: false, result: "overlay not found" };
    }
    handle.applyOverlays(next);
    return { ok: true, mutated: true, result: `deleted ${id}` };
  }

  return { ok: false, mutated: false, result: "Unhandled tool" };
}
