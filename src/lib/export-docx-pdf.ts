/**
 * Export Eigenpal DOCX pages as a real PDF blob (no browser print chrome).
 */

import { toCanvas, toJpeg, toPng } from "html-to-image";
import { PDFDocument } from "pdf-lib";
import { isConstrainedCaptureDevice } from "@/lib/device";
import { ensureNotoArabicFont } from "@/lib/pdf/arabic-canvas";

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
  const scope: ParentNode =
    pagesEl ||
    (root instanceof Element || root instanceof Document ? root : document);

  const selectors = [
    ".layout-page",
    ".docx-editor-page",
    "[class*='layout-page']",
  ];
  for (const selector of selectors) {
    const list = scope.querySelectorAll<HTMLElement>(selector);
    if (list.length) return Array.from(list);
  }
  return [];
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
      { skipFonts: true, pixelRatio: 2, flatten: false, jpeg: false },
      { skipFonts: true, pixelRatio: 1, flatten: false, jpeg: false },
      { skipFonts: true, pixelRatio: 1, flatten: true, jpeg: false },
      { skipFonts: true, pixelRatio: 1, flatten: true, jpeg: true },
    ];
  }
  return [
    { skipFonts: false, pixelRatio: 2, flatten: false, jpeg: false },
    { skipFonts: true, pixelRatio: 2, flatten: false, jpeg: false },
    { skipFonts: true, pixelRatio: 2, flatten: true, jpeg: false },
  ];
}

function captureFilter(node: HTMLElement): boolean {
  const tag = node.tagName;
  if (tag === "SCRIPT" || tag === "IFRAME" || tag === "VIDEO") return false;
  const cls =
    typeof node.className === "string"
      ? node.className
      : node.className
        ? String(node.className)
        : "";
  return !/overlay|widget|resize-handle|popup|toolbar|caret|yjs-cursor/i.test(
    cls,
  );
}

let colorProbeCtx: CanvasRenderingContext2D | null | undefined;

function cssColorToRgb(value: string, fallback: string): string {
  const raw = value.trim();
  if (!raw || raw === "transparent") return raw || fallback;
  if (
    !/(oklch|oklab|color-mix|color\(|lch\(|lab\(|hwb\(|light-dark)/i.test(raw)
  ) {
    return raw;
  }
  try {
    if (colorProbeCtx === undefined) {
      colorProbeCtx = document.createElement("canvas").getContext("2d");
    }
    if (!colorProbeCtx) return fallback;
    colorProbeCtx.fillStyle = fallback;
    colorProbeCtx.fillStyle = raw;
    return String(colorProbeCtx.fillStyle || fallback);
  } catch {
    return fallback;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("Page capture timed out"));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
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
        let value = cs.getPropertyValue(prop);
        if (/(^|-)color$|^fill$|^stroke$|background$/.test(prop)) {
          value = cssColorToRgb(value, value);
        }
        dst.style.setProperty(prop, value, cs.getPropertyPriority(prop));
      } catch {
        /* some computed props cannot be written */
      }
    }
    dst.removeAttribute("class");
    dst.style.setProperty("transform", "none");
    dst.style.setProperty("filter", "none");
    dst.style.setProperty("box-shadow", "none");
    dst.style.setProperty(
      "color",
      cssColorToRgb(cs.color, "#111111"),
    );
    dst.style.setProperty(
      "background-color",
      isTransparentColor(cs.backgroundColor)
        ? "#ffffff"
        : cssColorToRgb(cs.backgroundColor, "#ffffff"),
    );
  }
  const srcKids = src.children;
  const dstKids = dst.children;
  const n = Math.min(srcKids.length, dstKids.length);
  for (let i = 0; i < n; i += 1) {
    inlineComputedTree(srcKids[i]!, dstKids[i]!);
  }
}

function inlineResolvedColors(root: HTMLElement): () => void {
  const saved: Array<{ el: HTMLElement; css: string }> = [];
  const els = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of els) {
    saved.push({ el, css: el.style.cssText });
    const cs = getComputedStyle(el);
    el.style.color = cssColorToRgb(cs.color, "#111111");
    el.style.backgroundColor = isTransparentColor(cs.backgroundColor)
      ? "transparent"
      : cssColorToRgb(cs.backgroundColor, "#ffffff");
    el.style.borderTopColor = cssColorToRgb(cs.borderTopColor, "#000000");
    el.style.borderRightColor = cssColorToRgb(cs.borderRightColor, "#000000");
    el.style.borderBottomColor = cssColorToRgb(cs.borderBottomColor, "#000000");
    el.style.borderLeftColor = cssColorToRgb(cs.borderLeftColor, "#000000");
    el.style.outlineColor = cssColorToRgb(cs.outlineColor, "transparent");
    el.style.filter = "none";
  }
  return () => {
    for (const item of saved) item.el.style.cssText = item.css;
  };
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
  try {
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
  } catch {
    // Tainted canvas still has pixels; do not treat it as blank.
    return false;
  }
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
  const budget = isConstrainedCaptureDevice() ? 8000 : 20000;
  if (profile.jpeg) {
    const dataUrl = await withTimeout(
      toJpeg(node, { ...opts, quality: 0.92 }),
      budget,
    );
    if (!isJpegDataUrl(dataUrl) || !looksComplete(dataUrl)) {
      throw new Error("JPEG capture was empty");
    }
    return assertNotBlank(dataUrl);
  }
  try {
    const dataUrl = await withTimeout(toPng(node, opts), budget);
    if (isPngDataUrl(dataUrl)) return await assertNotBlank(dataUrl);
  } catch {
    /* fall through to canvas */
  }
  const canvas = await withTimeout(toCanvas(node, opts), budget);
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
    "z-index:2147483645",
    `width:${width}px`,
    `height:${height}px`,
    "overflow:visible",
    "background:#ffffff",
    "pointer-events:none",
    "opacity:1",
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

function isTransparentColor(color: string): boolean {
  const c = color.trim().toLowerCase();
  return (
    !c ||
    c === "transparent" ||
    c === "rgba(0, 0, 0, 0)" ||
    c === "rgba(0,0,0,0)" ||
    c === "rgb(0, 0, 0, 0)"
  );
}

function isNearWhiteFill(color: string): boolean {
  const c = color.trim().toLowerCase();
  if (c === "#fff" || c === "#ffffff" || c === "white") return true;
  const rgb = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!rgb) return false;
  return +rgb[1] > 248 && +rgb[2] > 248 && +rgb[3] > 248;
}

function applyFill(
  ctx: CanvasRenderingContext2D,
  color: string,
  fallback: string,
): boolean {
  if (isTransparentColor(color)) return false;
  try {
    ctx.fillStyle = fallback;
    ctx.fillStyle = color;
    return true;
  } catch {
    ctx.fillStyle = fallback;
    return true;
  }
}

function applyStroke(ctx: CanvasRenderingContext2D, color: string): boolean {
  if (isTransparentColor(color)) return false;
  try {
    ctx.strokeStyle = color;
    return true;
  } catch {
    ctx.strokeStyle = "#000000";
    return true;
  }
}

function elementClassName(el: Element): string {
  if (typeof el.className === "string") return el.className;
  if (el.className && typeof el.className === "object") {
    return String(el.className);
  }
  return "";
}

function shouldSkipPaintEl(el: HTMLElement): boolean {
  return /overlay|widget|resize-handle|popup|toolbar|caret|yjs-cursor|title-bar/i.test(
    elementClassName(el),
  );
}

function collectPaintElements(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [root];
  const visit = (el: Element) => {
    for (const child of el.children) {
      if (child instanceof HTMLElement) {
        out.push(child);
        visit(child);
      }
    }
    if (el.shadowRoot) {
      for (const child of el.shadowRoot.children) {
        if (child instanceof HTMLElement) {
          out.push(child);
          visit(child);
        }
      }
    }
  };
  visit(root);
  return out;
}

function walkTextNodes(root: Node, visit: (node: Text) => void) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) visit(node as Text);
  if (root instanceof Element) {
    if (root.shadowRoot) walkTextNodes(root.shadowRoot, visit);
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walkTextNodes(el.shadowRoot, visit);
    }
  }
}

function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  try {
    const png = canvas.toDataURL("image/png");
    if (png.startsWith("data:image/png") && png.length > 80) return png;
  } catch {
    /* tainted */
  }
  try {
    const jpeg = canvas.toDataURL("image/jpeg", 0.92);
    if (
      (jpeg.startsWith("data:image/jpeg") || jpeg.startsWith("data:image/jpg")) &&
      jpeg.length > 80
    ) {
      return jpeg;
    }
  } catch {
    /* tainted */
  }
  throw new Error("Canvas encode failed");
}

function exportPixelRatio(visualW: number, visualH: number): number {
  const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const maxEdge = 2048;
  return Math.max(
    1,
    Math.min(dpr, maxEdge / Math.max(visualW, 1), maxEdge / Math.max(visualH, 1)),
  );
}

function unionClientRects(rects: Array<DOMRect | { left: number; top: number; right: number; bottom: number }>) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function groupClientRectsByLine(rects: DOMRect[]) {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const avgH =
    sorted.reduce((sum, r) => sum + r.height, 0) / Math.max(1, sorted.length);
  const threshold = Math.max(6, avgH * 0.7);
  const lines: DOMRect[][] = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    if (last) {
      const box = unionClientRects(last);
      if (Math.abs(r.top - box.top) < threshold) {
        last.push(r);
        continue;
      }
    }
    lines.push([r]);
  }
  return lines.map((line) => unionClientRects(line));
}

function lineEndOffset(
  node: Text,
  raw: string,
  start: number,
  line: { top: number; bottom: number },
): number {
  const range = document.createRange();
  let lo = start + 1;
  let hi = raw.length;
  let best = Math.min(raw.length, start + 1);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    try {
      range.setStart(node, start);
      range.setEnd(node, mid);
    } catch {
      break;
    }
    const overflow = Array.from(range.getClientRects()).some(
      (r) => r.top > line.bottom - 1,
    );
    if (overflow) hi = mid - 1;
    else {
      best = mid;
      lo = mid + 1;
    }
  }
  return Math.max(best, start + 1);
}

function styleSignature(cs: CSSStyleDeclaration): string {
  return [
    cs.fontStyle,
    cs.fontWeight,
    cs.fontSize,
    cs.fontFamily,
    cs.color,
    cs.direction,
    cs.textAlign,
    cs.textDecorationLine,
  ].join("|");
}

type MergedTextRun = {
  text: string;
  first: Text;
  last: Text;
  parent: HTMLElement;
  cs: CSSStyleDeclaration;
};

/**
 * Merge adjacent text nodes that share the same style so Arabic is shaped as
 * whole words (canvas fillText of single glyphs uses isolated forms).
 * Confirmed cause of disconnected Arabic: char-by-char paint + letter-spacing.
 */
function collectMergedTextRuns(pageEl: HTMLElement): MergedTextRun[] {
  const nodes: Text[] = [];
  walkTextNodes(pageEl, (n) => nodes.push(n));
  const runs: MergedTextRun[] = [];
  let current: MergedTextRun | null = null;
  let currentKey = "";

  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || shouldSkipPaintEl(parent)) {
      current = null;
      continue;
    }
    const raw = node.nodeValue ?? "";
    if (!raw.replace(/\s+/g, "")) {
      if (current && /^\s*$/.test(raw)) {
        current.text += raw;
        current.last = node;
      }
      continue;
    }
    const cs = getComputedStyle(parent);
    if (cs.display === "none" || cs.visibility === "hidden") {
      current = null;
      continue;
    }
    const key = styleSignature(cs);
    const canMerge =
      current &&
      currentKey === key &&
      (current.last.parentElement === parent ||
        current.last.parentElement?.parentElement === parent.parentElement);

    if (canMerge && current) {
      current.text += raw;
      current.last = node;
    } else {
      current = { text: raw, first: node, last: node, parent, cs };
      currentKey = key;
      runs.push(current);
    }
  }
  return runs;
}

function neutralizeTracking(root: HTMLElement): () => void {
  const saved: Array<{
    el: HTMLElement;
    letterSpacing: string;
    wordSpacing: string;
  }> = [];
  const nodes = root.querySelectorAll<HTMLElement>("*");
  nodes.forEach((el) => {
    const cs = getComputedStyle(el);
    const ls = cs.letterSpacing;
    const ws = cs.wordSpacing;
    const needsLs =
      ls &&
      ls !== "normal" &&
      ls !== "0px" &&
      ls !== "0" &&
      Number.parseFloat(ls) !== 0;
    const needsWs =
      ws &&
      ws !== "normal" &&
      ws !== "0px" &&
      ws !== "0" &&
      Number.parseFloat(ws) !== 0;
    if (!needsLs && !needsWs) return;
    saved.push({
      el,
      letterSpacing: el.style.letterSpacing,
      wordSpacing: el.style.wordSpacing,
    });
    el.style.letterSpacing = "0";
    el.style.wordSpacing = "normal";
  });
  void root.offsetWidth;
  return () => {
    for (const item of saved) {
      item.el.style.letterSpacing = item.letterSpacing;
      item.el.style.wordSpacing = item.wordSpacing;
    }
  };
}

function paintCanvasLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: { left: number; top: number; right: number; bottom: number; height: number },
  cs: CSSStyleDeclaration,
  origin: DOMRect,
  scaleX: number,
  scaleY: number,
) {
  if (!text) return;
  const rtl =
    cs.direction === "rtl" ||
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
      text,
    );
  const align = cs.textAlign;
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textBaseline = "middle";
  try {
    // Never apply letter-spacing — disconnects Arabic and spaces Latin.
    ctx.letterSpacing = "0px";
  } catch {
    /* ignore */
  }
  const isRight =
    align === "right" ||
    (align === "end" && !rtl) ||
    (align === "start" && rtl);
  const isCenter = align === "center";
  ctx.textAlign = isCenter ? "center" : isRight ? "right" : "left";
  const x = isCenter
    ? ((box.left + box.right) / 2 - origin.left) / scaleX
    : isRight
      ? (box.right - origin.left) / scaleX
      : (box.left - origin.left) / scaleX;
  const y = ((box.top + box.bottom) / 2 - origin.top) / scaleY;
  ctx.fillText(text, x, y);
}

/**
 * Paint a live editor page onto a canvas using layout boxes and text ranges.
 * Avoids SVG foreignObject, so Tailwind oklch / color-mix cannot abort export.
 */
function paintPageToCanvas(
  pageEl: HTMLElement,
  pixelRatio: number,
  drawImages: boolean,
): HTMLCanvasElement {
  const visual = pageEl.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(pageEl.offsetWidth || visual.width));
  const cssH = Math.max(1, Math.round(pageEl.offsetHeight || visual.height));
  const scaleX = Math.max(0.01, visual.width / cssW);
  const scaleY = Math.max(0.01, visual.height / cssH);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cssW * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssH * pixelRatio));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  for (const el of collectPaintElements(pageEl)) {
    if (el !== pageEl && shouldSkipPaintEl(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (Number.parseFloat(cs.opacity || "1") < 0.05) continue;
    const r = el.getBoundingClientRect();
    const x = (r.left - visual.left) / scaleX;
    const y = (r.top - visual.top) / scaleY;
    const w = r.width / scaleX;
    const h = r.height / scaleY;
    if (w < 0.5 || h < 0.5) continue;
    if (x + w < 0 || y + h < 0 || x > cssW || y > cssH) continue;

    const borderW = [
      Number.parseFloat(cs.borderTopWidth) || 0,
      Number.parseFloat(cs.borderRightWidth) || 0,
      Number.parseFloat(cs.borderBottomWidth) || 0,
      Number.parseFloat(cs.borderLeftWidth) || 0,
    ];
    const hasBorder = borderW.some((bw) => bw >= 0.4);
    const display = cs.display;
    const paintChrome =
      el === pageEl ||
      hasBorder ||
      display.includes("table") ||
      /layout-page|layout-table|layout-cell|layout-block/.test(
        elementClassName(el),
      );

    if (applyFill(ctx, cs.backgroundColor, "#ffffff")) {
      if (!isNearWhiteFill(String(ctx.fillStyle))) {
        ctx.fillRect(x, y, w, h);
      }
    }

    if (!paintChrome) continue;

    const sides: Array<[number, string, number, number, number, number]> = [
      [borderW[0]!, cs.borderTopColor, x, y + 0.5, x + w, y + 0.5],
      [borderW[1]!, cs.borderRightColor, x + w - 0.5, y, x + w - 0.5, y + h],
      [borderW[2]!, cs.borderBottomColor, x, y + h - 0.5, x + w, y + h - 0.5],
      [borderW[3]!, cs.borderLeftColor, x + 0.5, y, x + 0.5, y + h],
    ];
    for (const [bw, color, x1, y1, x2, y2] of sides) {
      if (bw < 0.4) continue;
      if (!applyStroke(ctx, color)) continue;
      ctx.lineWidth = Math.max(1, bw);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    if (el === pageEl && /double/i.test(cs.borderTopStyle || "")) {
      if (applyStroke(ctx, cs.borderTopColor)) {
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 3, y + 3, Math.max(1, w - 6), Math.max(1, h - 6));
      }
    }
  }

  if (drawImages) {
    for (const img of pageEl.querySelectorAll("img")) {
      if (!(img instanceof HTMLImageElement) || !img.naturalWidth) continue;
      const r = img.getBoundingClientRect();
      try {
        ctx.drawImage(
          img,
          (r.left - visual.left) / scaleX,
          (r.top - visual.top) / scaleY,
          r.width / scaleX,
          r.height / scaleY,
        );
      } catch {
        /* tainted image */
      }
    }
  }

  for (const run of collectMergedTextRuns(pageEl)) {
    const { text: raw, first, last, cs } = run;
    if (!raw.replace(/\s+/g, "")) continue;
    applyFill(ctx, cs.color, "#111111");
    if (isNearWhiteFill(String(ctx.fillStyle))) {
      ctx.fillStyle = "#111111";
    }

    const fontSize = cs.fontSize || "14px";
    const fontFamily =
      cs.fontFamily ||
      '"NotoSansArabic","Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif';
    ctx.font = `${cs.fontStyle || "normal"} ${cs.fontWeight || "400"} ${fontSize} ${fontFamily}`;
    try {
      ctx.letterSpacing = "0px";
    } catch {
      /* ignore */
    }

    const range = document.createRange();
    try {
      range.setStart(first, 0);
      range.setEnd(last, last.length);
    } catch {
      continue;
    }
    const rects = Array.from(range.getClientRects()).filter(
      (r) => r.width >= 0.4 && r.height >= 0.4,
    );
    if (!rects.length) continue;

    const union = unionClientRects(rects);
    const maxH = Math.max(...rects.map((r) => r.height));
    const singleLine = union.height <= maxH * 1.85;

    if (singleLine) {
      paintCanvasLine(
        ctx,
        raw.replace(/\s+$/g, ""),
        union,
        cs,
        visual,
        scaleX,
        scaleY,
      );
      if (cs.textDecorationLine.includes("underline")) {
        if (applyStroke(ctx, cs.color)) {
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(
            (union.left - visual.left) / scaleX,
            (union.bottom - visual.top) / scaleY - 1,
          );
          ctx.lineTo(
            (union.right - visual.left) / scaleX,
            (union.bottom - visual.top) / scaleY - 1,
          );
          ctx.stroke();
        }
      }
      continue;
    }

    const lines = groupClientRectsByLine(rects);
    if (first === last) {
      let offset = 0;
      for (const line of lines) {
        if (offset >= raw.length) break;
        const next = lineEndOffset(first, raw, offset, line);
        paintCanvasLine(
          ctx,
          raw.slice(offset, next).replace(/\s+$/g, ""),
          line,
          cs,
          visual,
          scaleX,
          scaleY,
        );
        offset = next;
      }
    } else {
      // Merged multi-node run: split by measured width so Arabic stays shaped.
      let rest = raw;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        if (!rest) break;
        if (i === lines.length - 1) {
          paintCanvasLine(
            ctx,
            rest.replace(/\s+$/g, ""),
            line,
            cs,
            visual,
            scaleX,
            scaleY,
          );
          break;
        }
        const maxW = Math.max(8, line.width / scaleX);
        let lo = 1;
        let hi = rest.length;
        let best = 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const chunk = rest.slice(0, mid);
          if (ctx.measureText(chunk).width <= maxW) {
            best = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        // Prefer breaking on whitespace when possible.
        const space = rest.lastIndexOf(" ", best);
        const cut = space > 0 ? space + 1 : Math.max(1, best);
        paintCanvasLine(
          ctx,
          rest.slice(0, cut).replace(/\s+$/g, ""),
          line,
          cs,
          visual,
          scaleX,
          scaleY,
        );
        rest = rest.slice(cut);
      }
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

function wrapFallbackLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = words[0]!;
    for (let i = 1; i < words.length; i += 1) {
      const next = `${line} ${words[i]}`;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
      } else {
        out.push(line);
        line = words[i]!;
      }
    }
    out.push(line);
  }
  return out;
}

function fallbackTextPng(pageEl: HTMLElement): string {
  const root = pageEl.getBoundingClientRect();
  const width = Math.max(320, Math.round(root.width || pageEl.offsetWidth || 816));
  const height = Math.max(400, Math.round(root.height || pageEl.offsetHeight || 1056));
  const canvas = document.createElement("canvas");
  const pr = exportPixelRatio(width, height);
  canvas.width = Math.round(width * pr);
  canvas.height = Math.round(height * pr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111111";
  ctx.font =
    '15px "NotoSansArabic","Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif';
  ctx.textBaseline = "top";
  const rtl =
    getComputedStyle(pageEl).direction === "rtl" ||
    pageEl.closest("[dir='rtl']") !== null;
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  const pad = 36;
  const text = (pageEl.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  const lines = wrapFallbackLines(ctx, text || " ", width - pad * 2);
  let y = pad;
  const x = rtl ? width - pad : pad;
  for (const line of lines) {
    if (y > height - pad) break;
    ctx.fillText(line, x, y, width - pad * 2);
    y += 22;
  }
  return canvasToDataUrl(canvas);
}

function hideCaptureNoise(root: HTMLElement): () => void {
  const saved: Array<{ el: HTMLElement; visibility: string }> = [];
  const nodes = root.querySelectorAll<HTMLElement>(
    ".paged-editor__decoration-overlay, .docx-selection-overlay-rect, .ProseMirror-yjs-cursor, .layout-sdt-widget, .layout-sdt-repeat-controls, [class*='overlay-rect']",
  );
  nodes.forEach((el) => {
    saved.push({ el, visibility: el.style.visibility });
    el.style.visibility = "hidden";
  });
  return () => {
    for (const item of saved) item.el.style.visibility = item.visibility;
  };
}

function pageCssSize(pageEl: HTMLElement): { width: number; height: number } {
  const visual = pageEl.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(pageEl.offsetWidth || visual.width)),
    height: Math.max(1, Math.round(pageEl.offsetHeight || visual.height)),
  };
}

function paintPageToPng(pageEl: HTMLElement): {
  dataUrl: string;
  width: number;
  height: number;
} {
  const { width, height } = pageCssSize(pageEl);
  const pr = exportPixelRatio(width, height);
  try {
    const withImages = paintPageToCanvas(pageEl, pr, true);
    return { dataUrl: canvasToDataUrl(withImages), width, height };
  } catch {
    const noImages = paintPageToCanvas(pageEl, pr, false);
    return { dataUrl: canvasToDataUrl(noImages), width, height };
  }
}

async function capturePageImage(pageEl: HTMLElement): Promise<{
  dataUrl: string;
  width: number;
  height: number;
}> {
  await waitUntilPainted(pageEl);
  const restoreNoise = hideCaptureNoise(pageEl);
  const restoreTracking = neutralizeTracking(pageEl);
  try {
    await nextFrame();
    return paintPageToPng(pageEl);
  } finally {
    restoreTracking();
    restoreNoise();
  }
}

async function embedRaster(pdf: PDFDocument, dataUrl: string) {
  const bytes = dataUrlToBytes(dataUrl);
  if (isJpegDataUrl(dataUrl)) return pdf.embedJpg(bytes);
  return pdf.embedPng(bytes);
}

function pdfPageSize(pageEl: HTMLElement): { w: number; h: number } {
  const visual = pageEl.getBoundingClientRect();
  const w = Math.max(1, pageEl.offsetWidth || visual.width);
  const h = Math.max(1, pageEl.offsetHeight || visual.height);
  if (w < 600) {
    const scale = 816 / w;
    return { w: 816, h: Math.max(1, Math.round(h * scale)) };
  }
  return { w, h };
}

function collectExportTargets(root: ParentNode): HTMLElement[] {
  const pages = collectPageElements(root);
  if (pages.length) return pages;
  const pagesRoot = findPagesRoot(root) || findPagesRoot(document);
  if (pagesRoot && (pagesRoot.offsetWidth > 40 || pagesRoot.scrollHeight > 40)) {
    return [pagesRoot];
  }
  if (root instanceof HTMLElement && root.innerText.trim()) return [root];
  const ep = document.querySelector<HTMLElement>(".ep-root .ProseMirror");
  if (ep) return [ep];
  return [];
}

/**
 * Capture each document page as a raster image and assemble a PDF via pdf-lib.
 * Does not call window.print().
 */
export async function exportDocxPagesToPdfBlob(
  opts: ExportDocxPdfOptions,
): Promise<Blob> {
  const prevZoom = opts.getZoom?.();
  const constrained = isConstrainedCaptureDevice();

  try {
    try {
      await ensureNotoArabicFont();

      try {
        opts.setZoom?.(1);
      } catch {
        /* zoom restore is best-effort */
      }
      await nextFrame();
      await nextFrame();
      await pause(constrained ? 420 : 80);
      await revealAllPages(opts.root, opts.scrollToPage, opts.totalPages);

      const pages = collectExportTargets(opts.root);
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

        const shot = await capturePageImage(pageEl);
        const img = await embedRaster(pdf, shot.dataUrl);
        const page = pdf.addPage([shot.width, shot.height]);
        page.drawImage(img, {
          x: 0,
          y: 0,
          width: shot.width,
          height: shot.height,
        });
      }

      const bytes = await pdf.save();
      return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
    } catch {
      const host =
        opts.root instanceof HTMLElement
          ? opts.root
          : document.querySelector<HTMLElement>(".docx-shell") || document.body;
      const pdf = await PDFDocument.create();
      const shot = paintPageToPng(host);
      const img = await embedRaster(pdf, shot.dataUrl);
      const page = pdf.addPage([shot.width, shot.height]);
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: shot.width,
        height: shot.height,
      });
      const bytes = await pdf.save();
      return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
    }
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
