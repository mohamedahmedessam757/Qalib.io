/**
 * Export Eigenpal DOCX pages as a real PDF blob (no browser print chrome).
 */

import { toPng } from "html-to-image";
import { PDFDocument } from "pdf-lib";
import { isAppleTouchDevice } from "@/lib/device";

const MIN_PNG_DATA_URL_LENGTH = 8000;
const CAPTURE_ATTEMPTS = 3;

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

function isValidPngDataUrl(dataUrl: string): boolean {
  return (
    typeof dataUrl === "string" &&
    dataUrl.startsWith("data:image/png") &&
    dataUrl.length >= MIN_PNG_DATA_URL_LENGTH
  );
}

function captureOptions(pixelRatio: number) {
  return {
    pixelRatio,
    cacheBust: true,
    backgroundColor: "#ffffff",
    style: {
      boxShadow: "none",
      margin: "0",
    },
  };
}

/**
 * Safari often returns a blank PNG on the first foreignObject capture.
 * Warm once, then capture for real; retry if still empty.
 */
async function capturePagePng(pageEl: HTMLElement): Promise<string> {
  const pixelRatio = isAppleTouchDevice() ? 1 : 2;
  const opts = captureOptions(pixelRatio);

  // Warm Safari SVG/foreignObject image cache (discarded).
  try {
    await toPng(pageEl, opts);
  } catch {
    /* first pass may throw; second pass can still succeed */
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt += 1) {
    try {
      const dataUrl = await toPng(pageEl, opts);
      if (isValidPngDataUrl(dataUrl)) return dataUrl;
      lastError = new Error("Blank or too-small page capture");
    } catch (err) {
      lastError = err;
    }
    await new Promise<void>((r) => setTimeout(r, 100));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to capture document page");
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
      const cssW = Math.max(1, pageEl.offsetWidth);
      const cssH = Math.max(1, pageEl.offsetHeight);

      const dataUrl = await capturePagePng(pageEl);
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

function sanitizePdfBaseName(title: string): string {
  const base = title.replace(/\.pdf$/i, "").trim() || "document";
  return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "document";
}

function openBlobInNewTab(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  }
  // Keep the blob URL alive so iOS Safari can render/save the PDF.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadViaAnchor(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Deliver a PDF blob: Web Share on iOS when possible, else open/download.
 * Never calls window.print().
 */
export async function downloadPdfBlob(
  blob: Blob,
  title: string,
): Promise<void> {
  const safe = sanitizePdfBaseName(title);
  const fileName = `${safe}.pdf`;
  const appleTouch = isAppleTouchDevice();

  if (appleTouch && typeof navigator.share === "function") {
    const file = new File([blob], fileName, { type: "application/pdf" });
    const data: ShareData = { files: [file], title: fileName };
    const canShare =
      typeof navigator.canShare !== "function" || navigator.canShare(data);
    if (canShare) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw err;
        }
        // Fall through to open in a tab.
      }
    }
  }

  if (appleTouch) {
    openBlobInNewTab(blob);
    return;
  }

  downloadViaAnchor(blob, fileName);
}
