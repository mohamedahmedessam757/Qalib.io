import type { DocxCanvasHandle } from "@/components/editor/DocxCanvas";
import {
  applyFormatByQuery,
  deleteParagraphByQuery,
  findParagraphsByQuery,
  formatSectionItems,
  insertParagraphAfter,
  listDocumentParagraphs,
  replaceInsideParagraph,
  rewriteSectionLines,
} from "./direct-doc-edit";

/**
 * When free models talk instead of calling tools, attempt a safe local edit
 * from clear user intent (delete / replace / append / format / organize).
 */
export function tryLocalEditFromUserIntent(
  editor: DocxCanvasHandle | null | undefined,
  userText: string,
): { mutated: boolean; detail: string; focusParaId?: string } {
  if (!editor) return { mutated: false, detail: "editor missing" };
  const text = userText.trim();
  if (!text) return { mutated: false, detail: "empty" };

  const deleteIntent =
    /(احذف|امسح|شيّ?ل|امسحي|احذفي|\bdelete\b|\bremove\b|\bclear\b)/i.test(
      text,
    );
  const formatIntent =
    /(عريض|سمّ?ك|مسطر|تسطير|italic|bold|underline|تنسيق)/i.test(text);
  const replaceIntent =
    /(استبدل|عدّل|عدل|غيّر|غير|\breplace\b|\bchange\b)/i.test(text);
  const insertIntent =
    /(أضف|اضف|اكتب|أدرج|ادرج|\badd\b|\binsert\b|\bwrite\b)/i.test(text);
  const organizeIntent =
    /(نظّ?م|رتّ?ب|أعد ترتيب|organize|reorder)/i.test(text);

  const quoted =
    text.match(/[«"“](.+?)[»"”]/)?.[1] ||
    text.match(/'(.+?)'/)?.[1] ||
    null;

  if (formatIntent) {
    const heading =
      text.match(/القطاع\s*المدني/)?.[0] ||
      text.match(/الشائعات|التوصيات/)?.[0] ||
      null;
    const nums = [
      ...text.matchAll(/(?:النقطة|نقطة|point)\s*(\d+)/gi),
      ...text.matchAll(/(\d+)\s*و\s*(\d+)/g),
    ]
      .flatMap((m) => [Number(m[1]), Number(m[2])])
      .filter((n) => Number.isFinite(n) && n > 0 && n < 100);
    const uniqueNums = [...new Set(nums)].slice(0, 10);
    if (heading && uniqueNums.length) {
      const wantsBold = /(عريض|سمّ?ك|\bbold\b)/i.test(text);
      const wantsUnderline = /(مسطر|تسطير|\bunderline\b)/i.test(text);
      const wantsItalic = /(مائل|\bitalic\b)/i.test(text);
      const marks = {
        bold: wantsBold || (!wantsUnderline && !wantsItalic),
        underline: wantsUnderline,
        italic: wantsItalic,
      };
      const res = formatSectionItems(editor, heading, uniqueNums, marks);
      return {
        mutated: res.ok,
        focusParaId: res.focusParaId,
        detail: res.detail,
      };
    }

    const query =
      quoted ||
      text.match(/القطاع\s*المدني/)?.[0] ||
      text.match(/الشائعات|التوصيات/)?.[0] ||
      extractAfterKeyword(
        text,
        /(اجعل|خلي|make|bold|underline|عريض|مسطر)\s*/i,
      );
    if (query && query.length >= 2) {
      const wantsBold = /(عريض|سمّ?ك|\bbold\b)/i.test(text);
      const wantsUnderline = /(مسطر|تسطير|\bunderline\b)/i.test(text);
      const wantsItalic = /(مائل|\bitalic\b)/i.test(text);
      const marks = {
        bold: wantsBold,
        underline: wantsUnderline,
        italic: wantsItalic,
      };
      if (!wantsBold && !wantsUnderline && !wantsItalic) {
        marks.bold = true;
      }
      const res = applyFormatByQuery(editor, query.slice(0, 200), marks);
      return {
        mutated: res.ok,
        focusParaId: res.ok ? res.paraId : undefined,
        detail: res.ok
          ? `local format: ${res.paraId}`
          : `local format failed: ${res.detail}`,
      };
    }
  }

  if (organizeIntent) {
    const heading =
      text.match(/القطاع\s*المدني/)?.[0] ||
      text.match(/الشائعات|التوصيات/)?.[0] ||
      "القطاع المدني";
    const block = quoted || extractNumberedBlock(text);
    const lines = block
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => /^\d+\s*[-–—.]/.test(l) || l.length > 8);
    if (lines.length) {
      const res = rewriteSectionLines(editor, heading, lines);
      return {
        mutated: res.ok,
        focusParaId: res.ok
          ? findParagraphsByQuery(editor, heading, 1)[0]?.paraId
          : undefined,
        detail: res.detail,
      };
    }
  }

  if (deleteIntent) {
    const query =
      quoted ||
      extractAfterKeyword(
        text,
        /(احذف|امسح|شيّ?ل|امسحي|احذفي|delete|remove|clear)\s*/i,
      );
    if (!query || query.length < 3) {
      return {
        mutated: false,
        detail: "delete intent but no searchable text",
      };
    }
    const contentQuery = query
      .replace(/^(النقطة|نقطة|point)\s*\d+\s*(من|:)?\s*/i, "")
      .replace(/^(القطاع\s+المدني|المدني)\s*/i, "")
      .trim();
    const res = deleteParagraphByQuery(
      editor,
      contentQuery.length >= 4 ? contentQuery : query,
    );
    return {
      mutated: res.ok,
      focusParaId: res.ok ? res.paraId : undefined,
      detail: res.ok
        ? `local delete: ${res.paraId}`
        : `local delete failed: ${res.detail}`,
    };
  }

  if (replaceIntent && quoted) {
    const parts = text.split(/\s+(?:ب|إلى|to|with|by)\s+/i);
    const replaceWith = parts.length > 1 ? parts[parts.length - 1].trim() : "";
    const hits = findParagraphsByQuery(editor, quoted, 3);
    if (!hits.length) {
      return { mutated: false, detail: "replace: no match" };
    }
    const res = replaceInsideParagraph(
      editor,
      hits[0].paraId,
      quoted,
      replaceWith.replace(/[«»"“”]/g, "").trim(),
    );
    return {
      mutated: res.ok,
      focusParaId: res.ok ? hits[0].paraId : undefined,
      detail: res.ok ? `local replace: ${hits[0].paraId}` : res.detail,
    };
  }

  if (insertIntent) {
    const addText =
      quoted ||
      extractAfterKeyword(text, /(أضف|اضف|اكتب|أدرج|ادرج|add|insert|write)\s*/i);
    if (!addText || addText.length < 2) {
      return { mutated: false, detail: "insert intent but no text" };
    }
    const section =
      text.match(/القطاع\s*المدني/)?.[0] ||
      text.match(/الشائعات|التوصيات/)?.[0] ||
      text.match(/(?:بعد|after)\s+[«"“]?(.+?)[»"”]?(?:\s|$)/i)?.[1] ||
      null;
    if (!section) {
      return { mutated: false, detail: "insert needs a section/anchor" };
    }

    const headingHits = findParagraphsByQuery(editor, section, 3);
    if (!headingHits.length) {
      return { mutated: false, detail: "insert: section not found" };
    }

    const paras = listDocumentParagraphs(editor);
    const hIdx = paras.findIndex((p) => p.paraId === headingHits[0].paraId);
    let afterId = headingHits[0].paraId;
    if (hIdx >= 0) {
      for (let i = hIdx + 1; i < paras.length; i += 1) {
        if (/^\d+\s*[-–—.]/.test(paras[i].text)) {
          afterId = paras[i].paraId;
          continue;
        }
        if (paras[i].text.length < 48 && /:$/.test(paras[i].text)) break;
        if (i > hIdx + 1) break;
      }
    }

    const cleaned = addText
      .replace(/^نقطة\s*\d+\s*/i, "")
      .replace(/^point\s*\d+\s*/i, "")
      .trim();
    const nextNum = (() => {
      const m = paras
        .map((p) => p.text.match(/^(\d+)\s*[-–—.]/))
        .filter(Boolean)
        .map((m) => Number(m![1]));
      return m.length ? Math.max(...m) + 1 : 6;
    })();
    const line = /^\d+\s*[-–—.]/.test(cleaned)
      ? cleaned
      : `${nextNum}- ${cleaned}`;

    const res = insertParagraphAfter(editor, afterId, line);
    return {
      mutated: res.ok,
      focusParaId: res.ok ? afterId : undefined,
      detail: res.ok ? res.detail : `local insert failed: ${res.detail}`,
    };
  }

  return { mutated: false, detail: "no local intent" };
}

function extractAfterKeyword(text: string, re: RegExp) {
  const matched = text.match(re);
  if (!matched || matched.index == null) return "";
  return text.slice(matched.index + matched[0].length).trim();
}

function extractNumberedBlock(text: string) {
  const lines = text.split(/\n+/).map((l) => l.trim());
  const numbered = lines.filter((l) => /^\d+\s*[-–—.]/.test(l));
  return numbered.join("\n");
}
