/**
 * Export Eigenpal DOCX pages as a real PDF blob (no browser print chrome).
 */

import { toCanvas, toJpeg, toPng } from "html-to-image";
import { PDFDocument } from "pdf-lib";
import { isConstrainedCaptureDevice } from "@/lib/device";

/**
 * Sparse pages compress very small (especially at pixelRatio 1 on phones), so this
 * only flags an obviously broken capture — it never decides the export outcome.
 */
const SUSPICIOUS_PNG_DATA_URL_LENGTH = 1200;
/** 1×1 PNG so a single broken image cannot abort the whole page capture. */
const IMAGE_PLACEHOLDER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

function isJpegDataUrl(dataUrl: unknown): dataUrl is string {
  return (
    typeof dataUrl === "string" &&
    (dataUrl.startsWith("data:image/jpeg") ||
      dataUrl.startsWith("data:image/jpg"))
  );
}

function looksComplete(dataUrl: string): boolean {
  return dataUrl.length >= SUSPICIOUS_PNG_DATA_URL_LENGTH;
}

function pause(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function nextFrame() {
  return new Promise<void>((r) => requestAnimationFrame(() => r()));
}

type CaptureProfile = {
  skipFonts: boolean;
  pixelRatio: number;
  flatten: boolean;
  jpeg: boolean;
};

function captureProfiles(constrained: boolean): CaptureProfile[] {
  if (constrained) {
    return [
      { skipFonts: true, pixelRatio: 1, flatten: true, jpeg: false },
      { skipFonts: true, pixelRatio: 1, flatten: false, jpeg: false },
      { skipFonts: true, pixelRatio: 1, flatten: true, jpeg: true },
    ];
  }
  return [
    { skipFonts: false, pixelRatio: 2, flatten: false, jpeg: false },
    { skipFonts: true, pixelRatio: 1, flatten: true, jpeg: false },
  ];
}

function captureFilter(node: HTMLElement): boolean {
  const tag = node.tagName;
  return tag !== "SCRIPT" && tag !== "IFRAME" && tag !== "VIDEO";
}

const SKIP_STYLE =
  /^(animation|transition|offset|scroll-snap|overscroll|zoom|filter|backdrop-filter|transform|translate|rotate|scale|perspective|cursor|caret-color|resize|user-select)/;

function inlineComputedTree(src: Element, dst: Element) {
  if (src instanceof HTMLElement && dst instanceof HTMLElement) {
    const cs = getComputedStyle(src);
    for (let i = 0; i < cs.length; i += 1) {
      const prop = cs.item(i);
      if (!prop || prop.startsWith("--") || SKIP_STYLE.test(prop)) continue;
      try {
        dst.style.setProperty(
          prop,
          cs.getPropertyValue(prop),
          cs.getPropertyPriority(prop),
        );
      } catch {
        /* some computed props cannot be written */
      }
    }
    dst.removeAttribute("class");
    dst.style.setProperty("transform", "none");
    dst.style.setProperty("filter", "none");
    dst.style.setProperty("box-shadow", "none");
    dst.style.setProperty("background-image", dst.style.backgroundImage);
  }
  const srcKids = src.children;
  const dstKids = dst.children;
  const n = Math.min(srcKids.length, dstKids.length);
  for (let i = 0; i < n; i += 1) {
    inlineComputedTree(srcKids[i]!, dstKids[i]!);
  }
}

function buildCaptureOptions(
  width: number,
  height: number,
  profile: CaptureProfile,
) {
  return {
    pixelRatio: profile.pixelRatio,
    cacheBust: false,
    skipFonts: profile.skipFonts,
    backgroundColor: "#ffffff",
    width,
    height,
    imagePlaceholder: IMAGE_PLACEHOLDER,
    filter: captureFilter,
    style: {
      boxShadow: "none",
      margin: "0",
      transform: "none",
      filter: "none",
    },
  };
}

function isMostlyBlankCanvas(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width < 2 || canvas.height < 2) return true;
  const stepX = Math.max(6, Math.floor(canvas.width / 24));
  const stepY = Math.max(6, Math.floor(canvas.height / 24));
  let samples = 0;
  let ink = 0;
  for (let y = 0; y < canvas.height; y += stepY) {
    for (let x = 0; x < canvas.width; x += stepX) {
      const p = ctx.getImageData(x, y, 1, 1).data;
      samples += 1;
      if (p[0] < 248 || p[1] < 248 || p[2] < 248) ink += 1;
    }
  }
  return samples > 0 && ink / samples < 0.008;
}

function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, img.naturalWidth || img.width);
      canvas.height = Math.max(1, img.naturalHeight || img.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context unavailable"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error("Raster image failed to decode"));
    img.src = dataUrl;
  });
}

async function assertNotBlank(dataUrl: string): Promise<string> {
  const canvas = await dataUrlToCanvas(dataUrl);
  if (isMostlyBlankCanvas(canvas)) {
    throw new Error("Captured page was blank");
  }
  return dataUrl;
}

async function rasterizeNode(
  node: HTMLElement,
  profile: CaptureProfile,
  width: number,
  height: number,
): Promise<string> {
  const opts = buildCaptureOptions(width, height, profile);
  if (profile.jpeg) {
    const dataUrl = await toJpeg(node, { ...opts, quality: 0.92 });
    if (!isJpegDataUrl(dataUrl) || !looksComplete(dataUrl)) {
      throw new Error("JPEG capture was empty");
    }
    return assertNotBlank(dataUrl);
  }
  try {
    const dataUrl = await toPng(node, opts);
    if (isPngDataUrl(dataUrl)) return await assertNotBlank(dataUrl);
  } catch {
    /* fall through to canvas */
  }
  const canvas = await toCanvas(node, opts);
  if (isMostlyBlankCanvas(canvas)) {
    throw new Error("Canvas capture was blank");
  }
  return canvas.toDataURL("image/png");
}

/**
 * Clone the live page with resolved computed styles so CSS variables, oklch,
 * and color-mix from Tailwind / Eigenpal cannot render as transparent text.
 * Capturing a raw clone outside `.ep-root` produced empty white PDFs.
 */
async function withFlattenedClone<T>(
  pageEl: HTMLElement,
  width: number,
  height: number,
  run: (clone: HTMLElement) => Promise<T>,
): Promise<T> {
  const host = document.createElement("div");
  host.setAttribute("data-qalib-capture-host", "");
  host.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "z-index:2147483646",
    `width:${width}px`,
    `height:${height}px`,
    "overflow:visible",
    "background:#ffffff",
    "pointer-events:none",
    "opacity:0.02",
  ].join(";");
  const clone = pageEl.cloneNode(true) as HTMLElement;
  inlineComputedTree(pageEl, clone);
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.backgroundColor = "#ffffff";
  clone.style.color = clone.style.color || "#000000";
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    await nextFrame();
    await nextFrame();
    return await run(clone);
  } finally {
    host.remove();
  }
}

async function waitUntilPainted(pageEl: HTMLElement) {
  for (let i = 0; i < 12; i += 1) {
    if (pageEl.offsetWidth >= 200 && pageEl.offsetHeight >= 200) return;
    try {
      pageEl.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    await nextFrame();
    await pause(40);
  }
}

async function capturePageImage(pageEl: HTMLElement): Promise<string> {
  await waitUntilPainted(pageEl);
  const width = Math.max(1, pageEl.scrollWidth || pageEl.offsetWidth);
  const height = Math.max(1, pageEl.scrollHeight || pageEl.offsetHeight);
  const profiles = captureProfiles(isConstrainedCaptureDevice());

  let lastError: unknown;
  for (const profile of profiles) {
    try {
      if (profile.flatten) {
        return await withFlattenedClone(pageEl, width, height, (clone) =>
          rasterizeNode(clone, profile, width, height),
        );
      }
      return await rasterizeNode(pageEl, profile, width, height);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to capture document page");
}

async function embedRaster(pdf: PDFDocument, dataUrl: string) {
  const bytes = dataUrlToBytes(dataUrl);
  if (isJpegDataUrl(dataUrl)) return pdf.embedJpg(bytes);
  return pdf.embedPng(bytes);
}

/**
 * Capture each .layout-page as a raster image and assemble a PDF via pdf-lib.
 * Does not call window.print().
 */
export async function exportDocxPagesToPdfBlob(
  opts: ExportDocxPdfOptions,
): Promise<Blob> {
  const prevZoom = opts.getZoom?.();
  const constrained = isConstrainedCaptureDevice();

  try {
    opts.setZoom?.(1);
    await nextFrame();
    await nextFrame();
    await pause(constrained ? 280 : 80);
    await revealAllPages(opts.root, opts.scrollToPage, opts.totalPages);

    const pages = collectPageElements(opts.root);
    if (!pages.length) {
      throw new Error("No document pages found to export");
    }

    const pdf = await PDFDocument.create();

    for (let i = 0; i < pages.length; i += 1) {
      const pageEl = pages[i]!;
      opts.onProgress?.(i + 1, pages.length);

      try {
        pageEl.scrollIntoView({ block: "nearest", inline: "nearest" });
      } catch {
        /* ignore */
      }
      await nextFrame();

      const cssW = Math.max(1, pageEl.offsetWidth || pageEl.scrollWidth);
      const cssH = Math.max(1, pageEl.offsetHeight || pageEl.scrollHeight);

      const dataUrl = await capturePageImage(pageEl);
      const img = await embedRaster(pdf, dataUrl);
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
export function downloadPdfBlob(
  blob: Blob,
  title: string,
): Promise<PdfDeliveryResult> {
  const fileName = `${sanitizePdfBaseName(title)}.pdf`;

  // Phones (iOS and Android): a programmatic <a download> after a long generate
  // is not a user gesture, so Chrome/Safari often write an empty file. Always
  // hand the blob back for a real tap on a download/share control.
  if (isConstrainedCaptureDevice()) {
    return Promise.resolve({ ok: false, mode: "needs-share", blob, fileName });
  }

  downloadViaAnchor(blob, fileName);
  return Promise.resolve({ ok: true, mode: "download" });
}
