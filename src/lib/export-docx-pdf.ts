/**
 * Export Eigenpal DOCX pages as a real PDF blob (no browser print chrome).
 */

import { toPng } from "html-to-image";
import { PDFDocument } from "pdf-lib";
import { isAppleTouchDevice } from "@/lib/device";

/**
 * Sparse pages compress very small (especially at pixelRatio 1 on iOS), so this
 * only flags an obviously broken capture — it never decides the export outcome.
 */
const SUSPICIOUS_PNG_DATA_URL_LENGTH = 1200;
const CAPTURE_ATTEMPTS = 3;

export type ExportDocxPdfOptions = {
  root: ParentNode;
  title: string;
  totalPages?: number;
  scrollToPage?: (page: number) => void;
  setZoom?: (z: number) => void;
  getZoom?: () => number;
  onProgress?: (current: number, total: number) => void;
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

function isPngDataUrl(dataUrl: unknown): dataUrl is string {
  return typeof dataUrl === "string" && dataUrl.startsWith("data:image/png");
}

function looksComplete(dataUrl: string): boolean {
  return dataUrl.length >= SUSPICIOUS_PNG_DATA_URL_LENGTH;
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
 * Safari returns a blank PNG on the first foreignObject capture, so the very
 * first page of an export warms the cache with a throwaway render. Warming
 * every page would double the work and make iOS exports crawl.
 *
 * A suspiciously small PNG is retried, but a decodable PNG is always preferred
 * over failing the whole export.
 */
async function capturePagePng(
  pageEl: HTMLElement,
  warmFirst: boolean,
): Promise<string> {
  const opts = captureOptions(isAppleTouchDevice() ? 1 : 2);

  if (warmFirst) {
    try {
      await toPng(pageEl, opts);
    } catch {
      /* first pass may throw; the real pass can still succeed */
    }
  }

  let fallback: string | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt += 1) {
    try {
      const dataUrl = await toPng(pageEl, opts);
      if (isPngDataUrl(dataUrl)) {
        if (looksComplete(dataUrl)) return dataUrl;
        fallback = dataUrl;
      } else {
        lastError = new Error("Capture did not return a PNG");
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < CAPTURE_ATTEMPTS - 1) {
      await new Promise<void>((r) => setTimeout(r, 100));
    }
  }

  if (fallback) return fallback;

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
    const needsWarmUp = isAppleTouchDevice();

    for (let i = 0; i < pages.length; i += 1) {
      const pageEl = pages[i]!;
      opts.onProgress?.(i + 1, pages.length);

      // CSS box size → PDF page size (points ≈ CSS px for screen-fidelity export).
      const cssW = Math.max(1, pageEl.offsetWidth);
      const cssH = Math.max(1, pageEl.offsetHeight);

      const dataUrl = await capturePagePng(pageEl, needsWarmUp && i === 0);
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

export { sanitizePdfBaseName };

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException || err instanceof Error) &&
    err.name === "AbortError"
  );
}

function downloadViaAnchor(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Delayed revoke — immediate revoke can kill the download on some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type PdfDeliveryResult =
  | { ok: true; mode: "share" | "download" }
  | { ok: false; mode: "needs-share"; blob: Blob; fileName: string }
  | { ok: false; mode: "aborted" };

/** Build a concrete PDF File (call during prepare, not inside the Share tap). */
export async function materializePdfFile(
  blob: Blob,
  fileName: string,
): Promise<File> {
  if (blob instanceof File && blob.type === "application/pdf" && blob.name) {
    return blob;
  }
  return new File([blob], fileName, {
    type: "application/pdf",
    lastModified: Date.now(),
  });
}

/**
 * Share a ready PDF File from a user gesture.
 * Must be invoked directly from a click — avoid awaits before this call.
 */
export function sharePdfFile(
  file: File,
): Promise<"shared" | "aborted" | "failed"> {
  if (!canSharePdfFiles()) return Promise.resolve("failed");

  // iOS rejects combining `url` or `text` with `files`; keep the payload to files.
  // Do not gate on canShare — WebKit false-negatives are common.
  return navigator
    .share({ files: [file] })
    .then(() => "shared" as const)
    .catch((err: unknown) => (isAbortError(err) ? "aborted" : "failed"));
}

/** Whether the platform can hand a PDF file to the OS share sheet at all. */
export function canSharePdfFiles(): boolean {
  if (typeof navigator === "undefined") return false;
  // Web Share with files needs a secure context; navigator.share is absent otherwise.
  return typeof navigator.share === "function";
}

export function createPdfObjectUrl(fileOrBlob: File | Blob): string {
  return URL.createObjectURL(fileOrBlob);
}

/**
 * Revoking while iOS is still handing the blob to its download manager kills the
 * save, so object URLs outlive the dialog that created them.
 */
export function revokePdfObjectUrlSoon(url: string, delayMs = 60_000): void {
  window.setTimeout(() => URL.revokeObjectURL(url), delayMs);
}

export async function writePdfToFileHandle(
  handle: FileSystemFileHandle,
  blob: Blob,
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

/**
 * Deliver a real PDF blob.
 * iOS: never auto-share after long generation — return needs-share for a fresh tap.
 * Desktop: anchor download.
 */
export async function downloadPdfBlob(
  blob: Blob,
  title: string,
): Promise<PdfDeliveryResult> {
  const fileName = `${sanitizePdfBaseName(title)}.pdf`;

  if (isAppleTouchDevice()) {
    // Best practice: prepare first, Share only from the next user tap.
    return { ok: false, mode: "needs-share", blob, fileName };
  }

  downloadViaAnchor(blob, fileName);
  return { ok: true, mode: "download" };
}
