import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { hasArabic, preparePdfTextLine } from "./arabic-text";

export type PdfOverlayBase = {
  id: string;
  pageIndex: number;
  /** Normalized 0–1 relative to page width/height (top-left origin in UI). */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TextOverlay = PdfOverlayBase & {
  type: "text";
  text: string;
  fontSize: number;
  color: string;
  coverOriginal?: boolean;
  /** Logical alignment inside the box */
  align?: "start" | "center" | "end";
  dir?: "rtl" | "ltr" | "auto";
};

export type ImageOverlay = PdfOverlayBase & {
  type: "image";
  dataUrl: string;
};

export type WhiteoutOverlay = PdfOverlayBase & {
  type: "whiteout";
};

export type TableOverlay = PdfOverlayBase & {
  type: "table";
  rows: number;
  cols: number;
  cells: string[];
};

export type ShapeOverlay = PdfOverlayBase & {
  type:
    | "rect"
    | "border"
    | "line"
    | "oval"
    | "doubleFrame"
    | "banner"
    | "fullPageFrame"
    | "stamp";
  stroke: string;
  strokeWidth: number;
  /** 0–1 fill opacity; 0 = none */
  fillOpacity?: number;
  fill?: string;
};

export type PdfOverlay =
  | TextOverlay
  | ImageOverlay
  | WhiteoutOverlay
  | TableOverlay
  | ShapeOverlay;

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const n = Number.parseInt(full, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

async function embedDataUrl(pdf: PDFDocument, dataUrl: string) {
  const [header, data] = dataUrl.split(",");
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  if (header.includes("image/png")) {
    return pdf.embedPng(bytes);
  }
  return pdf.embedJpg(bytes);
}

let cachedArabicFont: ArrayBuffer | null = null;

async function loadArabicFontBytes() {
  if (cachedArabicFont) return cachedArabicFont;
  const urls = [
    "/fonts/NotoSansArabic-Regular.ttf",
    "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansArabic/full/ttf/NotoSansArabic-Regular.ttf",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      cachedArabicFont = await res.arrayBuffer();
      return cachedArabicFont;
    } catch {
      /* try next */
    }
  }
  return null;
}

function needsRichFont(text: string) {
  return hasArabic(text);
}

export async function exportPdfWithOverlays(
  source: ArrayBuffer,
  overlays: PdfOverlay[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source);
  pdf.registerFontkit(fontkit);
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);

  let richFont = helvetica;
  const arabicBytes = await loadArabicFontBytes();
  if (arabicBytes) {
    try {
      // Full embed — subsetting can drop Arabic presentation forms after reshape.
      richFont = await pdf.embedFont(arabicBytes, { subset: false });
    } catch {
      try {
        richFont = await pdf.embedFont(arabicBytes, { subset: true });
      } catch {
        richFont = helvetica;
      }
    }
  }

  const pages = pdf.getPages();

  for (const overlay of overlays) {
    const page = pages[overlay.pageIndex];
    if (!page) continue;
    const { width, height } = page.getSize();
    const x = overlay.x * width;
    const yTop = overlay.y * height;
    const w = Math.max(overlay.w * width, 4);
    const h = Math.max(overlay.h * height, 4);
    const y = height - yTop - h;

    if (
      overlay.type === "whiteout" ||
      (overlay.type === "text" && overlay.coverOriginal)
    ) {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });
    }

    if (overlay.type === "text") {
      const { r, g, b } = hexToRgb(overlay.color || "#111827");
      const size = Math.max(8, Math.min(overlay.fontSize, 72));
      const useArabic = hasArabic(overlay.text);
      const font = useArabic ? richFont : helvetica;
      const lines = overlay.text.split("\n");
      const align = overlay.align || (useArabic ? "end" : "start");
      lines.forEach((line, i) => {
        try {
          const prepared = preparePdfTextLine(line || " ");
          const drawn = prepared.text || " ";
          let textWidth = 0;
          try {
            textWidth = font.widthOfTextAtSize(drawn, size);
          } catch {
            textWidth = Math.min(w - 4, drawn.length * size * 0.5);
          }
          let tx = x + 2;
          if (align === "end") tx = x + w - 2 - textWidth;
          else if (align === "center") tx = x + (w - textWidth) / 2;
          page.drawText(drawn, {
            x: Math.max(x + 1, tx),
            y: y + h - size - i * (size + 2),
            size,
            font,
            color: rgb(r, g, b),
            maxWidth: w - 4,
          });
        } catch {
          /* skip undrawable glyphs */
        }
      });
    }

    if (overlay.type === "image") {
      try {
        const img = await embedDataUrl(pdf, overlay.dataUrl);
        page.drawImage(img, { x, y, width: w, height: h });
      } catch {
        /* skip bad image */
      }
    }

    if (overlay.type === "table") {
      const rows = Math.max(1, overlay.rows);
      const cols = Math.max(1, overlay.cols);
      const cellW = w / cols;
      const cellH = h / rows;
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: rgb(0.2, 0.2, 0.25),
        borderWidth: 1,
        color: rgb(1, 1, 1),
      });
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const cx = x + c * cellW;
          const cy = y + (rows - 1 - r) * cellH;
          page.drawRectangle({
            x: cx,
            y: cy,
            width: cellW,
            height: cellH,
            borderColor: rgb(0.55, 0.55, 0.6),
            borderWidth: 0.5,
          });
          const text = overlay.cells[r * cols + c] || "";
          if (text) {
            const font = needsRichFont(text) ? richFont : helvetica;
            try {
              const prepared = preparePdfTextLine(text.slice(0, 40));
              page.drawText(prepared.text, {
                x: prepared.rtl ? cx + 3 : cx + 3,
                y: cy + cellH / 2 - 4,
                size: 9,
                font,
                color: rgb(0.1, 0.1, 0.12),
                maxWidth: cellW - 6,
              });
            } catch {
              /* skip */
            }
          }
        }
      }
    }

    if (
      overlay.type === "rect" ||
      overlay.type === "border" ||
      overlay.type === "line" ||
      overlay.type === "oval" ||
      overlay.type === "doubleFrame" ||
      overlay.type === "banner" ||
      overlay.type === "fullPageFrame" ||
      overlay.type === "stamp"
    ) {
      const stroke = hexToRgb(overlay.stroke || "#0f766e");
      const sw = Math.max(0.5, Math.min(overlay.strokeWidth || 1.5, 12));
      if (overlay.type === "line") {
        page.drawLine({
          start: { x, y: y + h / 2 },
          end: { x: x + w, y: y + h / 2 },
          thickness: sw,
          color: rgb(stroke.r, stroke.g, stroke.b),
        });
      } else if (overlay.type === "oval" || overlay.type === "stamp") {
        const fillOp =
          overlay.fillOpacity ?? (overlay.type === "stamp" ? 0.06 : 0.08);
        const fill = hexToRgb(overlay.fill || overlay.stroke || "#0f766e");
        page.drawEllipse({
          x: x + w / 2,
          y: y + h / 2,
          xScale: w / 2,
          yScale: h / 2,
          borderColor: rgb(stroke.r, stroke.g, stroke.b),
          borderWidth: Math.max(sw, overlay.type === "stamp" ? 2.5 : 1.5),
          color: fillOp > 0 ? rgb(fill.r, fill.g, fill.b) : undefined,
          opacity: fillOp > 0 ? fillOp : undefined,
          borderOpacity: 1,
        });
      } else if (
        overlay.type === "doubleFrame" ||
        overlay.type === "fullPageFrame"
      ) {
        const outer = Math.max(sw, overlay.type === "fullPageFrame" ? 3 : 2);
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          borderColor: rgb(stroke.r, stroke.g, stroke.b),
          borderWidth: outer,
        });
        const inset = Math.max(6, outer * 2.5);
        page.drawRectangle({
          x: x + inset,
          y: y + inset,
          width: Math.max(4, w - inset * 2),
          height: Math.max(4, h - inset * 2),
          borderColor: rgb(stroke.r, stroke.g, stroke.b),
          borderWidth: Math.max(1, outer * 0.65),
        });
      } else if (overlay.type === "banner") {
        const fill = hexToRgb(overlay.fill || overlay.stroke || "#0f766e");
        const fillOp = overlay.fillOpacity ?? 0.18;
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          color: rgb(fill.r, fill.g, fill.b),
          opacity: fillOp,
          borderColor: rgb(stroke.r, stroke.g, stroke.b),
          borderWidth: sw,
          borderOpacity: 1,
        });
      } else {
        const fillOp = overlay.fillOpacity ?? (overlay.type === "rect" ? 0.12 : 0);
        const fill = hexToRgb(overlay.fill || overlay.stroke || "#0f766e");
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          borderColor: rgb(stroke.r, stroke.g, stroke.b),
          borderWidth: overlay.type === "border" ? Math.max(sw, 2) : sw,
          color: fillOp > 0 ? rgb(fill.r, fill.g, fill.b) : undefined,
          opacity: fillOp > 0 ? fillOp : undefined,
          borderOpacity: 1,
        });
      }
    }
  }

  return pdf.save();
}

export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
