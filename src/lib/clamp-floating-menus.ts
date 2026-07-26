/** Keep Eigenpal toolbar/menus inside the viewport — never touch document content. */

const PAD = 8;

const MENU_SELECTOR = [
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[data-radix-popper-content-wrapper]',
  '[data-radix-menu-content]',
].join(",");

const CONTENT_GUARD_SELECTOR = [
  ".ProseMirror",
  "[contenteditable='true']",
  ".docx-page",
  "[class*='PageView']",
  "[class*='page-view']",
  "[class*='DocumentPage']",
  "[data-page]",
].join(",");

function isInsideDocumentContent(el: Element): boolean {
  if (el.closest(CONTENT_GUARD_SELECTOR)) return true;
  if (el.closest("img, picture, svg, canvas, video")) return true;
  return false;
}

function isMenuCandidate(el: HTMLElement, style: CSSStyleDeclaration): boolean {
  if (el.dataset.qalibSkipClamp === "true") return false;
  if (isInsideDocumentContent(el)) return false;
  if (el.tagName === "IMG" || el.tagName === "SVG" || el.tagName === "CANVAS") {
    return false;
  }
  if (style.position !== "fixed" && style.position !== "absolute") return false;
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (style.opacity === "0") return false;

  const role = el.getAttribute("role");
  if (role === "menu" || role === "listbox" || role === "dialog") return true;
  if (el.getAttribute("data-state") === "open" && role === "menu") return true;
  if (el.dataset.qalibClamped === "true" && el.dataset.qalibClampKind === "menu") {
    return true;
  }
  return false;
}

function clampElement(el: HTMLElement) {
  const style = window.getComputedStyle(el);
  if (!isMenuCandidate(el, style)) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 24) return false;
  if (rect.width > window.innerWidth * 0.98) return false;
  if (rect.height > window.innerHeight * 0.95) return false;

  const maxW = window.innerWidth - PAD * 2;
  const maxH = window.innerHeight - PAD * 2;
  const width = Math.min(Math.max(rect.width, 40), maxW);

  let left = rect.left;
  let top = rect.top;

  if (rect.right > window.innerWidth - PAD) {
    left = window.innerWidth - PAD - width;
  }
  if (left < PAD) left = PAD;
  if (rect.bottom > window.innerHeight - PAD) {
    top = window.innerHeight - PAD - Math.min(rect.height, maxH);
  }
  if (top < PAD) top = PAD;

  const needsMove =
    Math.abs(left - rect.left) > 0.5 ||
    Math.abs(top - rect.top) > 0.5 ||
    rect.width > maxW + 1 ||
    rect.height > maxH + 1;

  if (!needsMove) return false;

  if (style.position === "absolute") {
    el.style.setProperty("position", "fixed", "important");
  }
  el.style.setProperty("left", `${Math.round(left)}px`, "important");
  el.style.setProperty("top", `${Math.round(top)}px`, "important");
  el.style.setProperty("right", "auto", "important");
  el.style.setProperty("bottom", "auto", "important");
  el.style.setProperty("max-width", `${Math.round(maxW)}px`, "important");
  el.style.setProperty("max-height", `${Math.round(maxH)}px`, "important");
  if (rect.width > maxW) {
    el.style.setProperty("width", `${Math.round(width)}px`, "important");
  }
  el.style.setProperty("z-index", "90", "important");
  el.dataset.qalibClamped = "true";
  el.dataset.qalibClampKind = "menu";
  return true;
}

/** Undo accidental clamps on document floating images from older builds. */
export function clearBadDocumentClamps(root: ParentNode = document) {
  const scope =
    root instanceof Document
      ? root.body
      : root instanceof Element
        ? root
        : document.body;
  if (!scope) return;

  const nodes = scope.querySelectorAll<HTMLElement>("[data-qalib-clamped='true']");
  for (const el of nodes) {
    const keep =
      el.dataset.qalibClampKind === "menu" && !isInsideDocumentContent(el);
    if (keep) continue;

    el.style.removeProperty("position");
    el.style.removeProperty("left");
    el.style.removeProperty("top");
    el.style.removeProperty("right");
    el.style.removeProperty("bottom");
    el.style.removeProperty("transform");
    el.style.removeProperty("translate");
    el.style.removeProperty("inset");
    el.style.removeProperty("inset-inline-start");
    el.style.removeProperty("inset-inline-end");
    el.style.removeProperty("max-width");
    el.style.removeProperty("max-height");
    el.style.removeProperty("width");
    el.style.removeProperty("overflow");
    el.style.removeProperty("z-index");
    delete el.dataset.qalibClamped;
    delete el.dataset.qalibClampKind;
  }
}

export function clampFloatingMenus(root: ParentNode = document) {
  const scope =
    root instanceof Document
      ? root.body
      : root instanceof Element
        ? root
        : document.body;
  if (!scope) return false;

  clearBadDocumentClamps(scope);

  const nodes = new Set<HTMLElement>();
  scope.querySelectorAll<HTMLElement>(MENU_SELECTOR).forEach((el) => nodes.add(el));
  document
    .querySelectorAll<HTMLElement>(MENU_SELECTOR)
    .forEach((el) => nodes.add(el));

  let changed = false;
  for (const el of nodes) {
    try {
      if (clampElement(el)) changed = true;
    } catch {
      /* ignore detached nodes */
    }
  }
  return changed;
}

export function startMenuClampWatcher(root: HTMLElement) {
  let raf = 0;
  let burstUntil = 0;

  const run = () => {
    clampFloatingMenus(document);
    if (performance.now() < burstUntil) {
      raf = requestAnimationFrame(run);
    } else {
      raf = 0;
    }
  };

  const burst = (ms = 400) => {
    burstUntil = Math.max(burstUntil, performance.now() + ms);
    if (!raf) raf = requestAnimationFrame(run);
  };

  clearBadDocumentClamps(document);
  clearBadDocumentClamps(root);

  const onChromeInteract = (e: Event) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        ".docx-editor-toolbar, [class*='Toolbar'], [class*='toolbar'], [class*='TitleBar'], [role='menubar'], header, .editor-chrome",
      )
    ) {
      burst(600);
    }
  };

  const onViewport = () => burst(400);

  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const node =
        m.target instanceof Element ? m.target : m.target.parentElement;
      if (!node) continue;
      if (isInsideDocumentContent(node)) continue;
      if (
        node.matches?.(MENU_SELECTOR) ||
        node.querySelector?.(MENU_SELECTOR) ||
        node.closest?.("[role='menu'], [role='listbox'], [role='dialog']")
      ) {
        burst(500);
        return;
      }
    }
  });
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "data-state", "aria-expanded"],
  });

  root.addEventListener("pointerdown", onChromeInteract, true);
  root.addEventListener("click", onChromeInteract, true);
  window.addEventListener("resize", onViewport);
  window.addEventListener("orientationchange", onViewport);

  return () => {
    mo.disconnect();
    root.removeEventListener("pointerdown", onChromeInteract, true);
    root.removeEventListener("click", onChromeInteract, true);
    window.removeEventListener("resize", onViewport);
    window.removeEventListener("orientationchange", onViewport);
    if (raf) cancelAnimationFrame(raf);
  };
}
