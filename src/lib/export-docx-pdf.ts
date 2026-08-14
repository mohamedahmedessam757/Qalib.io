/**
 * Export Eigenpal DOCX pages as a real PDF blob (no browser print chrome).
 */

import { toPng } from "html-to-image";
import { PDFDocument } from "pdf-lib";

const CAPTURE_PIXEL_RATIO = 2;

export type ExportDocxPdfOptions = {
  root: ParentNode;
  title: string;
  totalPages?: number;
  scrollToPage?: (page: number) => void;
  setZoom?: (z: number) => void;
  getZoom?: () => number;
};

async function revealAllPages(
  root: ParentNode,
  scrollToPage?: (page: number) => void,
  totalPages?: number,
) {
  const total = Math.max(1, totalPages || 1);
  if (scrollToPage) {
    for (let page = 1; page <= total; page += 1) {
      try {
        scrollToPage(page);
      } catch {
        /* ignore */
      }
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => setTimeout(r, 16));
    }
  }

  const scroller =
    (root instanceof Element
      ? root.querySelector<HTMLElement>(".paged-editor__pages")
      : null) ||
    (root instanceof HTMLElement ? root : null);

  if (scroller) {
    const max = scroller.scrollHeight;
    for (let y = 0; y <= max; y += Math.max(240, scroller.clientHeight || 480)) {
      scroller.scrollTop = y;
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    scroller.scrollTop = 0;
  }

  await new Promise<void>((r) => setTimeout(r, 80));
}

function findPagesRoot(root: ParentNode): HTMLElement | null {
  if (!(root instanceof Element) && !(root instanceof Document)) return null;
  const scope: ParentNode = root;
  return (
    scope.querySelector<HTMLElement>(".paged-editor__pages") ||
    scope.querySelector<HTMLElement>("[class*='paged-editor__pages']") ||
    null
  );
}

function collectPageElements(root: ParentNode): HTMLElement[] {
  const pagesEl = findPagesRoot(root) || findPagesRoot(document) || null;

  const list = pagesEl
    ? pagesEl.querySelectorAll<HTMLElement>(".layout-page")
    : root instanceof Element
      ? root.querySelectorAll<HTMLElement>(".layout-page")
      : document.querySelectorAll<HTMLElement>(".layout-page");

  return Array.from(list);
}

/** Decode a data: URL to bytes without fetch (works offline / CSP-safe). */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Capture each .layout-page as PNG and assemble a PDF via pdf-lib.
 * Does not call window.print().
 */
export async function exportDocxPagesToPdfBlob(
  opts: ExportDocxPdfOptions,
): Promise<Blob> {
  const prevZoom = opts.getZoom?.();

  try {
    opts.setZoom?.(1);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await revealAllPages(opts.root, opts.scrollToPage, opts.totalPages);

    const pages = collectPageElements(opts.root);
    if (!pages.length) {
      throw new Error("No document pages found to export");
    }

    const pdf = await PDFDocument.create();

    for (const pageEl of pages) {
      // CSS box size → PDF page size (points ≈ CSS px for screen-fidelity export).
      // Do NOT use raw PNG pixel dims — pixelRatio would inflate the page ~2×.
      const cssW = Math.max(1, pageEl.offsetWidth);
      const cssH = Math.max(1, pageEl.offsetHeight);

      const dataUrl = await toPng(pageEl, {
        pixelRatio: CAPTURE_PIXEL_RATIO,
        cacheBust: true,
        backgroundColor: "#ffffff",
        // Soft page chrome in the editor should not appear in the PDF
        style: {
          boxShadow: "none",
          margin: "0",
        },
      });

      const pngBytes = dataUrlToBytes(dataUrl);
      const img = await pdf.embedPng(pngBytes);
      const page = pdf.addPage([cssW, cssH]);
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: cssW,
        height: cssH,
      });
    }

    const bytes = await pdf.save();
    return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  } finally {
    if (typeof prevZoom === "number") {
      opts.setZoom?.(prevZoom);
    }
  }
}

/** Trigger a browser download for a PDF blob with a sanitized filename. */
export function downloadPdfBlob(blob: Blob, title: string) {
  const base = title.replace(/\.pdf$/i, "").trim() || "document";
  const safe =
    base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "document";
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}.pdf`;
    a.rel = "noopener";
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
