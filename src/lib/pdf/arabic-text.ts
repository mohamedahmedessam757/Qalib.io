/**
 * Shape + reorder Arabic for pdf-lib drawText.
 * pdf-lib paints LTR and does no OpenType shaping — we must:
 * 1) convert to Arabic Presentation Forms (connect letters)
 * 2) put characters in visual order for an LTR painter
 */
import { ArabicShaper } from "arabic-persian-reshaper";

const ARABIC_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_RE = /[A-Za-z0-9]/;

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

function reverseChars(input: string): string {
  return Array.from(input).reverse().join("");
}

type Run = { kind: "ar" | "lat" | "neutral"; text: string };

function splitRuns(line: string): Run[] {
  const runs: Run[] = [];
  let kind: Run["kind"] | null = null;
  let buf = "";

  const flush = () => {
    if (!buf || !kind) return;
    runs.push({ kind, text: buf });
    buf = "";
  };

  for (const ch of line) {
    const next: Run["kind"] = ARABIC_RE.test(ch)
      ? "ar"
      : LATIN_RE.test(ch)
        ? "lat"
        : "neutral";

    if (kind === null) {
      kind = next === "neutral" ? "ar" : next;
      buf = ch;
      continue;
    }

    if (next === "neutral" || next === kind) {
      buf += ch;
      continue;
    }

    flush();
    kind = next;
    buf = ch;
  }
  flush();
  return runs;
}

/**
 * Prepare one line for pdf-lib.
 * Mixed example: "مستند PDF جديد" → connected Arabic + correct visual order.
 */
export function preparePdfTextLine(line: string): {
  text: string;
  rtl: boolean;
} {
  if (!line) return { text: " ", rtl: false };
  if (!hasArabic(line)) return { text: line, rtl: false };

  const runs = splitRuns(line);
  if (!runs.length) {
    return { text: reverseChars(reshapeArabic(line)), rtl: true };
  }

  const rendered = runs.map((run) => {
    if (run.kind === "lat") return run.text;
    // Arabic + neutrals attached to Arabic runs
    if (run.kind === "ar" || hasArabic(run.text)) {
      return reverseChars(reshapeArabic(run.text));
    }
    return run.text;
  });

  // RTL paragraph: reverse run order for LTR painter
  return { text: rendered.reverse().join(""), rtl: true };
}

/** Normalize user text for tidy PDF overlays. */
export function organizePdfText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
