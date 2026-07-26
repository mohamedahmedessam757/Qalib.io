import type { DocxCanvasHandle } from "@/components/editor/DocxCanvas";
import type { ValidatedToolCall } from "./tools";
import { LIBRARY_TOOLS } from "./tools";
import { buildDocumentSnapshot } from "./document-snapshot";
import { applyLibraryTool } from "./library-doc-tools";
import {
  addCommentOnParagraph,
  appendToParagraph,
  applyFormatByQuery,
  applyFormatToParagraph,
  deleteParagraphById,
  deleteParagraphByQuery,
  findParagraphsByQuery,
  formatSectionItems,
  insertBreakAfter,
  insertImageAfter,
  insertParagraphAfter,
  insertTableAfter,
  mutateParagraphText,
  replaceInsideParagraph,
  rewriteSectionLines,
  setParagraphAlignment,
  setParagraphDirection,
  setParagraphList,
  setParagraphStyleById,
} from "./direct-doc-edit";

export type SelectionContext = {
  paraId: string | null;
  paragraphText: string;
  selectedText: string;
};

export const MUTATING_TOOLS = new Set([
  "replace_in_paragraph",
  "set_paragraph_text",
  "delete_paragraph",
  "delete_matching_paragraph",
  "insert_paragraph_after",
  "insert_at_paragraph_end",
  "apply_formatting",
  "format_matching",
  "format_section_items",
  "set_paragraph_style",
  "set_alignment",
  "set_list",
  "set_direction",
  "insert_break",
  "insert_table",
  "insert_image",
  "add_comment",
  "rewrite_section",
  "create_document",
  "rename_document",
  "delete_document",
]);

export type ApplyDocToolResult = {
  ok: boolean;
  result: string;
  mutated: boolean;
  navigateTo?: string;
  /** Paragraph to scroll into view after a successful edit. */
  focusParaId?: string;
};

export async function applyDocTool(
  editor: DocxCanvasHandle | null | undefined,
  call: ValidatedToolCall,
  selection: SelectionContext | null,
  opts?: { currentDocumentId?: string },
): Promise<ApplyDocToolResult> {
  if (LIBRARY_TOOLS.has(call.name as never)) {
    return applyLibraryTool(call.name, call.args as Record<string, unknown>, {
      currentDocumentId: opts?.currentDocumentId,
    });
  }

  if (!editor && call.name !== "get_selection_context") {
    return { ok: false, result: "Editor is not ready", mutated: false };
  }

  try {
    switch (call.name) {
      case "read_document":
        return {
          ok: true,
          mutated: false,
          result: buildDocumentSnapshot(editor, 22_000),
        };
      case "get_selection_context": {
        if (!selection?.paraId) {
          return {
            ok: true,
            mutated: false,
            result: JSON.stringify({
              paraId: null,
              message: "No paragraph selected",
            }),
          };
        }
        return {
          ok: true,
          mutated: false,
          result: JSON.stringify({
            paraId: selection.paraId,
            paragraphText: selection.paragraphText.slice(0, 2000),
            selectedText: selection.selectedText.slice(0, 1000),
          }),
        };
      }
      case "find_in_document": {
        const hits = findParagraphsByQuery(editor!, call.args.query, 12);
        return {
          ok: true,
          mutated: false,
          result: JSON.stringify(
            hits.map((h) => ({
              paraId: h.paraId,
              text: h.text.slice(0, 280),
              page: h.page || undefined,
            })),
          ),
        };
      }
      case "replace_in_paragraph": {
        const res = replaceInsideParagraph(
          editor!,
          call.args.paraId,
          call.args.search,
          call.args.replaceWith,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.paraId : undefined,
          result: res.ok
            ? `replaced in ${call.args.paraId}`
            : `replace failed: ${res.detail}`,
        };
      }
      case "set_paragraph_text": {
        const res = mutateParagraphText(
          editor!,
          call.args.paraId,
          call.args.text,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.paraId : undefined,
          result: res.ok
            ? `set text on ${call.args.paraId}`
            : `set text failed: ${res.detail}`,
        };
      }
      case "delete_paragraph": {
        const res = deleteParagraphById(editor!, call.args.paraId);
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.paraId : undefined,
          result: res.ok
            ? `deleted paragraph ${call.args.paraId}`
            : `delete failed: ${res.detail}`,
        };
      }
      case "delete_matching_paragraph": {
        const res = deleteParagraphByQuery(editor!, call.args.query);
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? res.paraId : undefined,
          result: res.ok
            ? `deleted matching (${res.paraId})`
            : `delete matching failed: ${res.detail}`,
        };
      }
      case "insert_paragraph_after": {
        const res = insertParagraphAfter(
          editor!,
          call.args.afterParaId,
          call.args.text,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.afterParaId : undefined,
          result: res.ok ? res.detail : `insert failed: ${res.detail}`,
        };
      }
      case "insert_at_paragraph_end": {
        const res = appendToParagraph(
          editor!,
          call.args.paraId,
          call.args.text,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.paraId : undefined,
          result: res.ok
            ? `appended to ${call.args.paraId}`
            : `append failed: ${res.detail}`,
        };
      }
      case "apply_formatting": {
        const res = applyFormatToParagraph(
          editor!,
          call.args.paraId,
          call.args.marks,
          call.args.search,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.paraId : undefined,
          result: res.detail,
        };
      }
      case "format_matching": {
        const res = applyFormatByQuery(
          editor!,
          call.args.query,
          call.args.marks,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? res.paraId : undefined,
          result: res.ok
            ? `formatted matching (${res.paraId})`
            : `format matching failed: ${res.detail}`,
        };
      }
      case "format_section_items": {
        const res = formatSectionItems(
          editor!,
          call.args.headingQuery,
          call.args.itemNumbers,
          call.args.marks,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.focusParaId,
          result: res.detail,
        };
      }
      case "set_paragraph_style": {
        const res = setParagraphStyleById(
          editor!,
          call.args.paraId,
          call.args.styleId,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.paraId : undefined,
          result: res.detail,
        };
      }
      case "set_alignment": {
        const res = setParagraphAlignment(
          editor!,
          call.args.paraId,
          call.args.alignment,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.paraId : undefined,
          result: res.detail,
        };
      }
      case "set_list": {
        const res = setParagraphList(editor!, call.args.paraId, call.args.list);
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.paraId : undefined,
          result: res.detail,
        };
      }
      case "set_direction": {
        const res = setParagraphDirection(
          editor!,
          call.args.paraId,
          call.args.direction,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.paraId : undefined,
          result: res.detail,
        };
      }
      case "insert_break": {
        const res = insertBreakAfter(
          editor!,
          call.args.paraId,
          call.args.type,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.paraId : undefined,
          result: res.detail,
        };
      }
      case "insert_table": {
        const res = insertTableAfter(
          editor!,
          call.args.afterParaId,
          call.args.rows,
          call.args.cols,
          call.args.data,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.afterParaId : undefined,
          result: res.detail,
        };
      }
      case "insert_image": {
        const res = await insertImageAfter(
          editor!,
          call.args.afterParaId,
          call.args.src,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.afterParaId : undefined,
          result: res.detail,
        };
      }
      case "add_comment": {
        const res = addCommentOnParagraph(
          editor!,
          call.args.paraId,
          call.args.text,
          "Qalib AI",
          call.args.search,
        );
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? call.args.paraId : undefined,
          result: res.detail,
        };
      }
      case "rewrite_section": {
        const res = rewriteSectionLines(
          editor!,
          call.args.headingQuery,
          call.args.lines,
        );
        const heading = findParagraphsByQuery(
          editor!,
          call.args.headingQuery,
          1,
        )[0];
        return {
          ok: res.ok,
          mutated: res.ok,
          focusParaId: res.ok ? heading?.paraId : undefined,
          result: res.detail,
        };
      }
      default:
        return { ok: false, result: "unsupported tool", mutated: false };
    }
  } catch (err) {
    return {
      ok: false,
      mutated: false,
      result: err instanceof Error ? err.message : "tool error",
    };
  }
}
