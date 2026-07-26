import type { DocxCanvasHandle } from "@/components/editor/DocxCanvas";
import { listDocumentParagraphs, type ParagraphHit } from "./direct-doc-edit";

/** Build a numbered outline from the live editor for the AI agent. */
export function buildDocumentSnapshot(
  editor: DocxCanvasHandle | null | undefined,
  maxChars = 24_000,
): string {
  if (!editor) return "(editor not ready)";

  const paras = listDocumentParagraphs(editor);
  if (!paras.length) {
    // Last resort: Eigenpal agent plain text (no paraIds)
    try {
      const agent = editor.getAgent?.();
      const plain = agent?.getText?.()?.trim();
      if (plain) {
        return [
          "DOCUMENT TEXT (paraIds unavailable — call find_in_document before edits):",
          plain.slice(0, maxChars),
        ].join("\n");
      }
    } catch {
      /* ignore */
    }
    return "(document is empty or not loaded yet — retry read_document after a moment)";
  }

  const lines: string[] = [
    `DOCUMENT OUTLINE (${paras.length} paragraphs). Use paraId values exactly.`,
    "Format: [#index] paraId | style? | text",
  ];

  let size = lines.join("\n").length;
  for (let i = 0; i < paras.length; i += 1) {
    const p = paras[i];
    const style = guessStyle(p);
    const line = `[${i}] ${p.paraId}${style ? ` | ${style}` : ""} | ${p.text}`;
    if (size + line.length + 1 > maxChars) {
      lines.push(`… truncated ${paras.length - i} more paragraphs`);
      break;
    }
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join("\n");
}

function guessStyle(p: ParagraphHit) {
  const t = p.text.trim();
  if (/^(التوصيات|الشائعات|القطاع|أولًا|أولا|ثانيًا|ثالثا)/.test(t)) {
    return "heading-like";
  }
  if (/^\d+\s*[-–—.]/.test(t)) return "list-item";
  return "";
}
