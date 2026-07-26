import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

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

export type PdfOverlay =
  | TextOverlay
  | ImageOverlay
  | WhiteoutOverlay
  | TableOverlay;

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
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
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
      richFont = await pdf.embedFont(arabicBytes, { subset: true });
    } catch {
      richFont = helvetica;
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
      const font = needsRichFont(overlay.text) ? richFont : helvetica;
      const lines = overlay.text.split("\n");
      lines.forEach((line, i) => {
        try {
          page.drawText(line || " ", {
            x: x + 2,
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
              page.drawText(text.slice(0, 40), {
                x: cx + 3,
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
  }

  return pdf.save();
}

export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
