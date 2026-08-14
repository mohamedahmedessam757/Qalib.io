/**
 * Export Eigenpal DOCX pages as a real PDF blob (no browser print chrome).
 */

import { toPng } from "html-to-image";
import { PDFDocument } from "pdf-lib";

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
  const pagesEl =
    findPagesRoot(root) ||
    findPagesRoot(document) ||
    null;

  const list = pagesEl
    ? pagesEl.querySelectorAll<HTMLElement>(".layout-page")
    : root instanceof Element
      ? root.querySelectorAll<HTMLElement>(".layout-page")
      : document.querySelectorAll<HTMLElement>(".layout-page");

  return Array.from(list);
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
      const dataUrl = await toPng(pageEl, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#ffffff",
      });
      const pngBytes = await fetch(dataUrl).then((r) => r.arrayBuffer());
      const img = await pdf.embedPng(pngBytes);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
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
