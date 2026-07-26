/**
 * Print / Save-as-PDF for Eigenpal paginated pages.
 * Avoids Eigenpal's fallback to window.print() on the whole app chrome.
 */

function collectFontFaceCss(): string[] {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules || [])) {
        if (rule instanceof CSSFontFaceRule) rules.push(rule.cssText);
      }
    } catch {
      /* cross-origin sheets */
    }
  }
  return rules;
}

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

  // Give virtualized pages a moment to paint
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

function buildPrintHtml(pagesEl: HTMLElement, title: string): string {
  const clone = pagesEl.cloneNode(true) as HTMLElement;
  clone.style.cssText =
    "display:block;margin:0;padding:0;background:#fff;transform:none !important;";

  clone.querySelectorAll<HTMLElement>(".layout-page").forEach((page) => {
    page.style.boxShadow = "none";
    page.style.margin = "0 auto";
    page.style.breakAfter = "page";
    page.style.pageBreakAfter = "always";
  });
  const last = clone.querySelector<HTMLElement>(".layout-page:last-child");
  if (last) {
    last.style.breakAfter = "auto";
    last.style.pageBreakAfter = "auto";
  }

  // Strip interactive chrome accidentally cloned
  clone
    .querySelectorAll(
      "button, input, textarea, [role='toolbar'], [contenteditable='true']",
    )
    .forEach((el) => {
      if (el instanceof HTMLElement && el.isContentEditable) {
        el.contentEditable = "false";
      }
    });

  const fonts = collectFontFaceCss().join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title.replace(/[<>&"]/g, "")}</title>
  <style>
    ${fonts}
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .paged-editor__pages, [class*="paged-editor__pages"] {
      display: block !important;
      overflow: visible !important;
      height: auto !important;
      max-height: none !important;
      transform: none !important;
    }
    .layout-page {
      break-after: page;
      page-break-after: always;
      box-shadow: none !important;
      margin: 0 auto !important;
      background: #fff !important;
    }
    .layout-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    @page { margin: 0; size: auto; }
  </style>
</head>
<body></body>
</html>`;
}

export type PrintDocxOptions = {
  root: HTMLElement;
  title?: string;
  totalPages?: number;
  scrollToPage?: (page: number) => void;
  setZoom?: (zoom: number) => void;
  getZoom?: () => number;
};

/**
 * Opens a dedicated print window with all document pages (Save as PDF).
 * Returns false only when no page content could be found at all.
 */
export async function printDocxAsPdf(
  opts: PrintDocxOptions,
): Promise<{ ok: boolean; mode: "window" | "css-fallback" | "failed" }> {
  const title = opts.title || "Document";
  const prevZoom = opts.getZoom?.();

  try {
    // Full-size pages print more reliably than a fitted/zoomed viewport
    opts.setZoom?.(1);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await revealAllPages(opts.root, opts.scrollToPage, opts.totalPages);

    const pagesEl =
      findPagesRoot(opts.root) ||
      findPagesRoot(document) ||
      (() => {
        const pages = opts.root.querySelectorAll(".layout-page");
        if (!pages.length) return null;
        const wrap = document.createElement("div");
        wrap.className = "paged-editor__pages";
        pages.forEach((p) => wrap.appendChild(p.cloneNode(true)));
        return wrap;
      })();

    if (!pagesEl || !pagesEl.querySelector(".layout-page")) {
      document.body.classList.add("qalib-printing");
      window.print();
      window.setTimeout(() => {
        document.body.classList.remove("qalib-printing");
      }, 1500);
      return { ok: false, mode: "failed" };
    }

    // Must NOT use noopener — we need win.document
    const win = window.open("", "_blank");
    if (!win) {
      document.body.classList.add("qalib-printing");
      window.print();
      window.setTimeout(() => {
        document.body.classList.remove("qalib-printing");
      }, 1500);
      return { ok: true, mode: "css-fallback" };
    }

    const html = buildPrintHtml(pagesEl, title);
    win.document.open();
    win.document.write(html);
    const imported = win.document.importNode(pagesEl.cloneNode(true), true);
    if (imported instanceof HTMLElement) {
      imported.style.cssText =
        "display:block;margin:0;padding:0;background:#fff;transform:none!important;overflow:visible!important;height:auto!important;";
      imported.querySelectorAll<HTMLElement>(".layout-page").forEach((page, i, all) => {
        page.style.boxShadow = "none";
        page.style.margin = "0 auto";
        page.style.breakAfter = i === all.length - 1 ? "auto" : "page";
        page.style.pageBreakAfter = i === all.length - 1 ? "auto" : "always";
      });
    }
    win.document.body.appendChild(imported);
    win.document.close();

    const doPrint = () => {
      try {
        win.focus();
        win.print();
      } finally {
        // Keep window open on some browsers until print dialog closes
        window.setTimeout(() => {
          try {
            win.close();
          } catch {
            /* ignore */
          }
        }, 500);
      }
    };

    if (win.document.readyState === "complete") {
      window.setTimeout(doPrint, 250);
    } else {
      win.onload = () => window.setTimeout(doPrint, 250);
      window.setTimeout(doPrint, 800);
    }

    return { ok: true, mode: "window" };
  } finally {
    if (typeof prevZoom === "number") {
      opts.setZoom?.(prevZoom);
    }
  }
}
