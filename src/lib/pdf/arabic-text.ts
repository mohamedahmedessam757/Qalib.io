/**
 * Shape + reorder Arabic/Persian text for pdf-lib drawText.
 * pdf-lib does not do OpenType shaping or bidi — without this, glyphs look isolated and LTR.
 */
import bidiFactory from "bidi-js";
import { ArabicShaper } from "arabic-persian-reshaper";

const bidi = bidiFactory();

const ARABIC_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function hasArabic(text: string) {
  return ARABIC_RE.test(text);
}

function reshapeArabic(input: string): string {
  try {
    return ArabicShaper.convertArabic(input);
  } catch {
    return input;
  }
}

/** Prepare a line for pdf-lib: reshape Arabic then apply Unicode bidi visual order. */
export function preparePdfTextLine(line: string): {
  text: string;
  rtl: boolean;
} {
  if (!line) return { text: " ", rtl: false };
  const rtl = hasArabic(line);
  const shaped = rtl ? reshapeArabic(line) : line;
  try {
    const embeddingLevels = bidi.getEmbeddingLevels(shaped, rtl ? "rtl" : "ltr");
    const ordered = bidi.getReorderedString(shaped, embeddingLevels);
    return { text: ordered || shaped, rtl };
  } catch {
    return { text: shaped, rtl };
  }
}

/** Normalize user text for tidy PDF overlays (collapse junk whitespace, trim lines). */
export function organizePdfText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
