import {
  findParaIdRange,
  findTextInPmParagraph,
  getVanillaNodeText,
  getVanillaTextBetween,
} from "@eigenpal/docx-editor-core/prosemirror/paraText";
import {
  insertImageFromFile,
  insertTable,
  removeList,
  setAlignment,
  setLtr,
  setRtl,
  toggleBulletList,
  toggleNumberedList,
} from "@eigenpal/docx-editor-core/prosemirror/commands";
import { TextSelection } from "prosemirror-state";
import type { Node as PmNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import type { DocxCanvasHandle } from "@/components/editor/DocxCanvas";

export type ParagraphHit = {
  paraId: string;
  text: string;
  page: number;
};

/** Normalize Arabic/Latin text for resilient matching. */
export function normalizeSearchText(value: string) {
  return value
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function listDocumentParagraphs(
  editor: DocxCanvasHandle,
): ParagraphHit[] {
  // Prefer live ProseMirror doc — getPageContent depends on layout pages and
  // often returns empty even when the document has text (breaks AI read).
  const fromPm = listParagraphsFromProseMirror(editor);
  if (fromPm.length) return fromPm;

  const total = Math.max(1, editor.getTotalPages?.() || 1);
  const seen = new Set<string>();
  const out: ParagraphHit[] = [];

  for (let page = 1; page <= total; page += 1) {
    const content = editor.getPageContent?.(page);
    if (!content?.paragraphs) continue;
    for (const p of content.paragraphs) {
      const paraId = (p.paraId || "").trim();
      if (!paraId || seen.has(paraId)) continue;
      seen.add(paraId);
      const text = (p.text || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      out.push({ paraId, text, page });
    }
  }
  return out;
}

function listParagraphsFromProseMirror(
  editor: DocxCanvasHandle,
): ParagraphHit[] {
  const view = editor.getEditorRef()?.getView();
  if (!view) return [];

  const out: ParagraphHit[] = [];
  const seen = new Set<string>();
  view.state.doc.descendants((node: PmNode) => {
    if (!node.isTextblock) return true;
    const paraId = String(node.attrs?.paraId || "").trim();
    if (!paraId || seen.has(paraId)) return true;
    const text = getVanillaNodeText(node).replace(/\s+/g, " ").trim();
    if (!text) return true;
    seen.add(paraId);
    out.push({ paraId, text, page: 0 });
    return true;
  });
  return out;
}

/** Scroll + flash the paragraph so the user sees where the AI edited. */
export function revealParagraph(
  editor: DocxCanvasHandle | null | undefined,
  paraId: string | null | undefined,
) {
  if (!paraId) return;

  const flashDom = () => {
    try {
      const safe =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(paraId)
          : paraId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const nodes = document.querySelectorAll(
        `.layout-paragraph[data-para-id="${safe}"], [data-para-id="${safe}"]`,
      );
      const el = (nodes[nodes.length - 1] || nodes[0]) as
        | HTMLElement
        | undefined;
      if (!el) return false;
      el.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
      const prevOutline = el.style.outline;
      const prevBg = el.style.backgroundColor;
      el.style.outline = "2px solid rgba(45, 212, 191, 0.95)";
      el.style.backgroundColor = "rgba(45, 212, 191, 0.25)";
      window.setTimeout(() => {
        el.style.outline = prevOutline;
        el.style.backgroundColor = prevBg;
      }, 1400);
      return true;
    } catch {
      return false;
    }
  };

  try {
    editor?.scrollToParaId?.(paraId, {
      highlight: { color: "rgba(45, 212, 191, 0.45)" },
    });
  } catch {
    /* ignore API scroll failure */
  }

  if (!flashDom()) {
    window.setTimeout(() => {
      try {
        editor?.scrollToParaId?.(paraId, {
          highlight: { color: "rgba(45, 212, 191, 0.45)" },
        });
      } catch {
        /* ignore */
      }
      flashDom();
    }, 160);
  }
}

export function findParagraphsByQuery(
  editor: DocxCanvasHandle,
  query: string,
  limit = 12,
): ParagraphHit[] {
  const q = normalizeSearchText(query);
  if (!q) return [];

  const local = listDocumentParagraphs(editor)
    .map((p) => ({
      ...p,
      score: scoreMatch(normalizeSearchText(p.text), q),
    }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ paraId, text, page }) => ({ paraId, text, page }));

  if (local.length) return local;

  // Fallback to Eigenpal finder
  try {
    const hits = editor.findInDocument(query, { limit });
    return hits.map((h) => ({
      paraId: h.paraId,
      text: `${h.before || ""}${h.match || ""}${h.after || ""}`.trim(),
      page: 0,
    }));
  } catch {
    return [];
  }
}

function scoreMatch(hay: string, needle: string) {
  if (!hay || !needle) return 0;
  if (hay === needle) return 100;
  if (hay.includes(needle)) return 80 + Math.min(19, needle.length);
  // token overlap for partial phrases
  const tokens = needle.split(" ").filter((t) => t.length > 1);
  if (!tokens.length) return 0;
  const hit = tokens.filter((t) => hay.includes(t)).length;
  if (hit === 0) return 0;
  return Math.round((hit / tokens.length) * 60);
}

function readParagraphText(
  editor: DocxCanvasHandle,
  paraId: string,
): string | null {
  const view = editor.getEditorRef()?.getView();
  if (!view) {
    const hit = listDocumentParagraphs(editor).find((p) => p.paraId === paraId);
    return hit ? hit.text : null;
  }
  const range = findParaIdRange(view.state.doc, paraId);
  if (!range) return null;
  return getVanillaTextBetween(view.state.doc, range.from + 1, range.to - 1);
}

function highlightParagraph(editor: DocxCanvasHandle, paraId: string) {
  revealParagraph(editor, paraId);
}

/**
 * Replace/clear paragraph text with verification.
 * Uses ProseMirror direct edit first (visible immediately), then proposeChange fallback.
 */
export function mutateParagraphText(
  editor: DocxCanvasHandle,
  paraId: string,
  nextText: string,
): { ok: boolean; detail: string; before: string; after: string } {
  const before = readParagraphText(editor, paraId);
  if (before == null) {
    return {
      ok: false,
      detail: "unknown paraId",
      before: "",
      after: "",
    };
  }

  const view = editor.getEditorRef()?.getView();
  let mutated = false;

  if (view) {
    const range = findParaIdRange(view.state.doc, paraId);
    if (range) {
      const from = range.from + 1;
      const to = range.to - 1;
      if (from <= to || nextText.length > 0) {
        const tr =
          from <= to
            ? view.state.tr.insertText(nextText, from, to)
            : view.state.tr.insertText(nextText, from);
        view.dispatch(tr);
        mutated = true;
      } else {
        mutated = true; // already empty
      }
    }
  }

  // Verify; if direct edit didn't stick, try official proposeChange API
  let after = readParagraphText(editor, paraId);
  if ((after ?? before) === before && nextText !== before) {
    const ok = editor.proposeChange({
      paraId,
      search: before,
      replaceWith: nextText,
      author: "Qalib AI",
    });
    if (ok) {
      mutated = true;
      after = readParagraphText(editor, paraId);
    }
  }

  after = readParagraphText(editor, paraId) ?? after ?? before;

  // Success if text actually changed toward target (or already matched)
  const normalizedAfter = normalizeSearchText(after);
  const normalizedTarget = normalizeSearchText(nextText);
  const ok =
    normalizedAfter === normalizedTarget ||
    (nextText === "" && normalizedAfter.length === 0) ||
    (mutated && after !== before && nextText === "" && after.length < before.length);

  if (ok) highlightParagraph(editor, paraId);

  return {
    ok,
    detail: ok
      ? nextText
        ? "paragraph updated"
        : "paragraph cleared"
      : "edit did not stick in editor",
    before,
    after,
  };
}

export function replaceInsideParagraph(
  editor: DocxCanvasHandle,
  paraId: string,
  search: string,
  replaceWith: string,
): { ok: boolean; detail: string } {
  const before = readParagraphText(editor, paraId);
  if (before == null) return { ok: false, detail: "unknown paraId" };

  if (!search) {
    const res = mutateParagraphText(editor, paraId, replaceWith);
    return { ok: res.ok, detail: res.detail };
  }

  const view = editor.getEditorRef()?.getView();
  if (view) {
    const range = findParaIdRange(view.state.doc, paraId);
    if (range) {
      const found = findTextInPmParagraph(
        view.state.doc,
        range.from,
        range.to,
        search,
      );
      if (found) {
        const tr = view.state.tr.insertText(replaceWith, found.from, found.to);
        view.dispatch(tr);
        const after = readParagraphText(editor, paraId) ?? "";
        const ok = after !== before || replaceWith === search;
        if (ok) highlightParagraph(editor, paraId);
        return {
          ok,
          detail: ok ? "replaced" : "replace did not stick",
        };
      }

      // Normalized fallback: rebuild full paragraph text
      const normBefore = normalizeSearchText(before);
      const normSearch = normalizeSearchText(search);
      const idx = normBefore.indexOf(normSearch);
      if (idx >= 0) {
        // Map approx by original indexOf first
        let origIdx = before.indexOf(search);
        if (origIdx < 0) {
          // loose: replace first occurrence of any substring length
          origIdx = before
            .toLowerCase()
            .indexOf(search.toLowerCase());
        }
        if (origIdx >= 0) {
          const next =
            before.slice(0, origIdx) +
            replaceWith +
            before.slice(origIdx + search.length);
          const res = mutateParagraphText(editor, paraId, next);
          return { ok: res.ok, detail: res.detail };
        }
      }
    }
  }

  const ok = editor.proposeChange({
    paraId,
    search,
    replaceWith,
    author: "Qalib AI",
  });
  if (ok) highlightParagraph(editor, paraId);
  return {
    ok,
    detail: ok ? "replaced via proposeChange" : "replace failed",
  };
}

export function appendToParagraph(
  editor: DocxCanvasHandle,
  paraId: string,
  text: string,
): { ok: boolean; detail: string } {
  const before = readParagraphText(editor, paraId);
  if (before == null) return { ok: false, detail: "unknown paraId" };
  const res = mutateParagraphText(editor, paraId, `${before}${text}`);
  return { ok: res.ok, detail: res.detail };
}

export function deleteParagraphById(
  editor: DocxCanvasHandle,
  paraId: string,
): { ok: boolean; detail: string; before: string } {
  const res = mutateParagraphText(editor, paraId, "");
  return { ok: res.ok, detail: res.detail, before: res.before };
}

export function deleteParagraphByQuery(
  editor: DocxCanvasHandle,
  query: string,
): { ok: boolean; detail: string; paraId?: string; before?: string } {
  const hits = findParagraphsByQuery(editor, query, 5);
  if (!hits.length) {
    return { ok: false, detail: `no paragraph matched: ${query}` };
  }
  // Prefer the best-scoring single hit
  const best = hits[0];
  const res = deleteParagraphById(editor, best.paraId);
  return {
    ok: res.ok,
    detail: res.ok
      ? `cleared paragraph ${best.paraId}`
      : res.detail,
    paraId: best.paraId,
    before: res.before,
  };
}

/** Insert a brand-new paragraph AFTER the given paraId (does not mash into existing text). */
export function insertParagraphAfter(
  editor: DocxCanvasHandle,
  afterParaId: string,
  text: string,
): { ok: boolean; detail: string } {
  const view = editor.getEditorRef()?.getView();
  if (!view) return { ok: false, detail: "editor view missing" };
  const range = findParaIdRange(view.state.doc, afterParaId);
  if (!range) return { ok: false, detail: "unknown afterParaId" };

  const schema = view.state.schema;
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return { ok: false, detail: "paragraph node missing" };

  const clean = text.replace(/\r/g, "");
  const content = clean
    ? schema.text(clean)
    : null;
  const node = paragraph.create(
    undefined,
    content ? [content] : undefined,
  );

  const tr = view.state.tr.insert(range.to, node);
  view.dispatch(tr);
  highlightParagraph(editor, afterParaId);
  return { ok: true, detail: `inserted paragraph after ${afterParaId}` };
}

export type FormatMarks = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean | { style?: string };
  strike?: boolean;
  color?: { rgb?: string };
  highlight?: string;
  fontSize?: number;
  fontFamily?: { ascii?: string; hAnsi?: string };
};

export function applyFormatToParagraph(
  editor: DocxCanvasHandle,
  paraId: string,
  marks: FormatMarks,
  search?: string,
): { ok: boolean; detail: string } {
  const ok = editor.applyFormatting({
    paraId,
    search,
    marks: {
      bold: marks.bold,
      italic: marks.italic,
      underline: marks.underline,
      strike: marks.strike,
      color: marks.color,
      highlight: marks.highlight,
      fontSize: marks.fontSize,
      fontFamily: marks.fontFamily,
    },
  });
  if (ok) highlightParagraph(editor, paraId);
  return {
    ok,
    detail: ok ? `formatted ${paraId}` : "format failed (missing paraId/search)",
  };
}

export function applyFormatByQuery(
  editor: DocxCanvasHandle,
  query: string,
  marks: FormatMarks,
): { ok: boolean; detail: string; paraId?: string } {
  const hits = findParagraphsByQuery(editor, query, 5);
  if (!hits.length) {
    return { ok: false, detail: `no paragraph matched: ${query}` };
  }
  const best = hits[0];
  // Whole-paragraph formatting is far more reliable than phrase search
  // (phrase search often "succeeds" on a tiny match the user can't see).
  const whole = applyFormatToParagraph(editor, best.paraId, marks);
  if (whole.ok) return { ...whole, paraId: best.paraId };

  const search =
    best.text.includes(query) ||
    normalizeSearchText(best.text).includes(normalizeSearchText(query))
      ? query
      : undefined;
  const res = applyFormatToParagraph(editor, best.paraId, marks, search);
  return { ...res, paraId: best.paraId };
}

/** Format numbered list items under a heading (e.g. bold points 1 and 2). */
export function formatSectionItems(
  editor: DocxCanvasHandle,
  headingQuery: string,
  itemNumbers: number[],
  marks: FormatMarks,
): { ok: boolean; detail: string; focusParaId?: string; count: number } {
  const all = listDocumentParagraphs(editor);
  if (!all.length) return { ok: false, detail: "empty document", count: 0 };

  const headingHits = findParagraphsByQuery(editor, headingQuery, 3);
  if (!headingHits.length) {
    return {
      ok: false,
      detail: `heading not found: ${headingQuery}`,
      count: 0,
    };
  }
  const headingId = headingHits[0].paraId;
  const hIdx = all.findIndex((p) => p.paraId === headingId);
  if (hIdx < 0) return { ok: false, detail: "heading index missing", count: 0 };

  const wanted = new Set(
    itemNumbers.filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.floor(n)),
  );
  if (!wanted.size) {
    return { ok: false, detail: "itemNumbers required", count: 0 };
  }

  let count = 0;
  let focusParaId: string | undefined;
  for (let i = hIdx + 1; i < all.length; i += 1) {
    const p = all[i];
    // stop at next section heading
    if (
      /:$/.test(p.text) &&
      p.text.length < 80 &&
      !/^\d+\s*[-–—.]/.test(p.text)
    ) {
      break;
    }
    if (
      /^(أولًا|أولا|ثانيًا|ثالثا|التوصيات|الشائعات)/.test(p.text) &&
      i > hIdx + 1
    ) {
      break;
    }
    const m = p.text.match(/^(\d+)\s*[-–—.]/);
    if (!m) {
      if (count > 0) break;
      continue;
    }
    const num = Number(m[1]);
    if (!wanted.has(num)) continue;
    const res = applyFormatToParagraph(editor, p.paraId, marks);
    if (res.ok) {
      count += 1;
      focusParaId = p.paraId;
    }
  }

  return {
    ok: count > 0,
    count,
    focusParaId,
    detail: count
      ? `formatted ${count} item(s) under "${headingQuery}"`
      : `no matching numbered items under "${headingQuery}"`,
  };
}

/**
 * After a heading-like paragraph matching `headingQuery`, rewrite the following
 * N list paragraphs with `lines` (creates/clears as needed).
 */
export function rewriteSectionLines(
  editor: DocxCanvasHandle,
  headingQuery: string,
  lines: string[],
): { ok: boolean; detail: string } {
  const all = listDocumentParagraphs(editor);
  if (!all.length) return { ok: false, detail: "empty document" };

  const headingHits = findParagraphsByQuery(editor, headingQuery, 3);
  if (!headingHits.length) {
    return { ok: false, detail: `heading not found: ${headingQuery}` };
  }
  const headingId = headingHits[0].paraId;
  const headingIdx = all.findIndex((p) => p.paraId === headingId);
  if (headingIdx < 0) return { ok: false, detail: "heading index missing" };

  // Collect following paragraphs until next heading-like or blank break of structure
  const targets: ParagraphHit[] = [];
  for (let i = headingIdx + 1; i < all.length; i += 1) {
    const p = all[i];
    const t = p.text.trim();
    if (
      /^(التوصيات|الشائعات|\d+\s*[-–—.]?\s*القطاع|أولًا|أولا|ثاني)/.test(t) &&
      !/^\d+\s*[-–—.]/.test(t)
    ) {
      break;
    }
    // stop at major section headers that aren't numbered list items
    if (
      targets.length > 0 &&
      !/^\d+\s*[-–—.]/.test(t) &&
      t.length < 40 &&
      /:$/.test(t)
    ) {
      break;
    }
    targets.push(p);
    if (targets.length >= Math.max(lines.length, 12)) break;
  }

  let lastId = headingId;
  let changed = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (i < targets.length) {
      const res = mutateParagraphText(editor, targets[i].paraId, line);
      if (res.ok) {
        changed += 1;
        lastId = targets[i].paraId;
      }
    } else {
      const ins = insertParagraphAfter(editor, lastId, line);
      if (ins.ok) {
        changed += 1;
        // refresh list to get new last id roughly via text match
        const again = findParagraphsByQuery(editor, line.slice(0, 40), 1);
        if (again[0]) lastId = again[0].paraId;
      }
    }
  }

  // Clear leftover old points beyond new length
  for (let i = lines.length; i < targets.length; i += 1) {
    const res = deleteParagraphById(editor, targets[i].paraId);
    if (res.ok) changed += 1;
  }

  highlightParagraph(editor, headingId);
  return {
    ok: changed > 0,
    detail: changed
      ? `rewrote section under "${headingQuery}" (${changed} ops)`
      : "no section changes applied",
  };
}

function getView(editor: DocxCanvasHandle): EditorView | null {
  return editor.getEditorRef()?.getView() ?? null;
}

/** Place the caret inside a paragraph so toolbar-style commands can run. */
function selectInsideParagraph(
  editor: DocxCanvasHandle,
  paraId: string,
): EditorView | null {
  const view = getView(editor);
  if (!view) return null;
  const range = findParaIdRange(view.state.doc, paraId);
  if (!range) return null;
  const pos = Math.min(range.to - 1, range.from + 1);
  const sel = TextSelection.near(view.state.doc.resolve(Math.max(1, pos)));
  view.dispatch(view.state.tr.setSelection(sel));
  return view;
}

export function setParagraphStyleById(
  editor: DocxCanvasHandle,
  paraId: string,
  styleId: string,
): { ok: boolean; detail: string } {
  const ok = editor.setParagraphStyle({ paraId, styleId });
  if (ok) highlightParagraph(editor, paraId);
  return {
    ok,
    detail: ok ? `style ${styleId} on ${paraId}` : "setParagraphStyle failed",
  };
}

export function insertBreakAfter(
  editor: DocxCanvasHandle,
  paraId: string,
  type: "page" | "sectionNextPage" | "sectionContinuous",
): { ok: boolean; detail: string } {
  const ok = editor.insertBreak({ paraId, type });
  if (ok) highlightParagraph(editor, paraId);
  return {
    ok,
    detail: ok ? `inserted ${type} break after ${paraId}` : "insertBreak failed",
  };
}

export function setParagraphAlignment(
  editor: DocxCanvasHandle,
  paraId: string,
  alignment: "left" | "center" | "right" | "both" | "distribute",
): { ok: boolean; detail: string } {
  const view = selectInsideParagraph(editor, paraId);
  if (!view) return { ok: false, detail: "unknown paraId or view missing" };
  const ok = setAlignment(alignment)(view.state, view.dispatch);
  if (ok) highlightParagraph(editor, paraId);
  return {
    ok,
    detail: ok ? `alignment ${alignment} on ${paraId}` : "setAlignment failed",
  };
}

export function setParagraphList(
  editor: DocxCanvasHandle,
  paraId: string,
  list: "bullet" | "numbered" | "none",
): { ok: boolean; detail: string } {
  const view = selectInsideParagraph(editor, paraId);
  if (!view) return { ok: false, detail: "unknown paraId or view missing" };
  let ok = false;
  if (list === "none") ok = removeList(view.state, view.dispatch);
  else if (list === "bullet") ok = toggleBulletList(view.state, view.dispatch);
  else ok = toggleNumberedList(view.state, view.dispatch);
  if (ok) highlightParagraph(editor, paraId);
  return {
    ok,
    detail: ok ? `list ${list} on ${paraId}` : "set list failed",
  };
}

export function setParagraphDirection(
  editor: DocxCanvasHandle,
  paraId: string,
  direction: "rtl" | "ltr",
): { ok: boolean; detail: string } {
  const view = selectInsideParagraph(editor, paraId);
  if (!view) return { ok: false, detail: "unknown paraId or view missing" };
  const ok =
    direction === "rtl"
      ? setRtl(view.state, view.dispatch)
      : setLtr(view.state, view.dispatch);
  if (ok) highlightParagraph(editor, paraId);
  return {
    ok,
    detail: ok ? `direction ${direction} on ${paraId}` : "set direction failed",
  };
}

function fillTableCells(view: EditorView, data: string[][]): number {
  const { doc, schema } = view.state;
  let lastTablePos = -1;
  let lastTableNode: PmNode | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name === "table") {
      lastTablePos = pos;
      lastTableNode = node;
    }
    return true;
  });
  if (lastTablePos < 0 || lastTableNode == null) return 0;

  const tableNode: PmNode = lastTableNode;
  const targets: Array<{ from: number; to: number }> = [];
  tableNode.descendants((node, relPos) => {
    if (node.type.name === "paragraph") {
      const abs = lastTablePos + 1 + relPos;
      targets.push({ from: abs + 1, to: abs + 1 + node.content.size });
    }
    return true;
  });

  const flat = data.flatMap((row) => row.map((cell) => cell ?? ""));
  const tr = view.state.tr;
  let filled = 0;
  const n = Math.min(flat.length, targets.length);
  for (let i = n - 1; i >= 0; i -= 1) {
    const text = flat[i];
    if (typeof text !== "string") continue;
    const { from, to } = targets[i];
    if (to > from) tr.delete(from, to);
    if (text) tr.insert(from, schema.text(text));
    filled += 1;
  }
  if (filled > 0) view.dispatch(tr);
  return filled;
}

export function insertTableAfter(
  editor: DocxCanvasHandle,
  afterParaId: string,
  rows: number,
  cols: number,
  data?: string[][],
): { ok: boolean; detail: string } {
  const view = selectInsideParagraph(editor, afterParaId);
  if (!view) return { ok: false, detail: "unknown afterParaId or view missing" };
  const r = Math.min(20, Math.max(1, Math.floor(rows)));
  const c = Math.min(12, Math.max(1, Math.floor(cols)));
  const ok = insertTable(r, c)(view.state, view.dispatch);
  if (!ok) return { ok: false, detail: "insertTable failed" };
  let filled = 0;
  if (data?.length) {
    filled = fillTableCells(view, data);
  }
  highlightParagraph(editor, afterParaId);
  return {
    ok: true,
    detail: filled
      ? `inserted ${r}x${c} table (filled ${filled} cells) after ${afterParaId}`
      : `inserted ${r}x${c} table after ${afterParaId}`,
  };
}

export async function insertImageAfter(
  editor: DocxCanvasHandle,
  afterParaId: string,
  src: string,
): Promise<{ ok: boolean; detail: string }> {
  const view = selectInsideParagraph(editor, afterParaId);
  if (!view) return { ok: false, detail: "unknown afterParaId or view missing" };

  let file: File;
  try {
    if (src.startsWith("data:")) {
      const res = await fetch(src);
      const blob = await res.blob();
      const ext = blob.type.includes("png")
        ? "png"
        : blob.type.includes("jpeg") || blob.type.includes("jpg")
          ? "jpg"
          : blob.type.includes("webp")
            ? "webp"
            : "img";
      file = new File([blob], `ai-image.${ext}`, {
        type: blob.type || "image/png",
      });
    } else {
      const url = new URL(src);
      if (!/^https?:$/.test(url.protocol)) {
        return { ok: false, detail: "image src must be https URL or data URL" };
      }
      const res = await fetch(url.toString());
      if (!res.ok) return { ok: false, detail: `image fetch failed: ${res.status}` };
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) {
        return { ok: false, detail: "URL did not return an image" };
      }
      file = new File([blob], "ai-image", { type: blob.type });
    }
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "image load failed",
    };
  }

  return new Promise((resolve) => {
    insertImageFromFile(view, file, {
      onError: (error) => {
        resolve({
          ok: false,
          detail:
            error instanceof Error ? error.message : "insertImageFromFile failed",
        });
      },
      onInserted: () => {
        highlightParagraph(editor, afterParaId);
        resolve({ ok: true, detail: `inserted image after ${afterParaId}` });
      },
    });
  });
}

export async function insertImageFileAfter(
  editor: DocxCanvasHandle,
  afterParaId: string,
  file: File,
): Promise<{ ok: boolean; detail: string }> {
  const view = selectInsideParagraph(editor, afterParaId);
  if (!view) return { ok: false, detail: "unknown afterParaId or view missing" };
  if (!file.type.startsWith("image/")) {
    return { ok: false, detail: "file is not an image" };
  }
  return new Promise((resolve) => {
    insertImageFromFile(view, file, {
      onError: (error) => {
        resolve({
          ok: false,
          detail:
            error instanceof Error ? error.message : "insertImageFromFile failed",
        });
      },
      onInserted: () => {
        highlightParagraph(editor, afterParaId);
        resolve({ ok: true, detail: `inserted image after ${afterParaId}` });
      },
    });
  });
}

export function addCommentOnParagraph(
  editor: DocxCanvasHandle,
  paraId: string,
  text: string,
  author = "Qalib AI",
  search?: string,
): { ok: boolean; detail: string } {
  const id = editor.addComment({
    paraId,
    search,
    text,
    author,
  });
  if (id == null) return { ok: false, detail: "addComment failed" };
  highlightParagraph(editor, paraId);
  return { ok: true, detail: `comment #${id} on ${paraId}` };
}
