import type { OpenRouterTool } from "./openrouter";
import { sheetTools } from "./sheet-tools";

export const DOC_TOOL_NAMES = [
  "read_document",
  "find_in_document",
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
  "get_selection_context",
  "list_documents",
  "create_document",
  "rename_document",
  "delete_document",
] as const;

export type DocToolName = (typeof DOC_TOOL_NAMES)[number];

export const LIBRARY_TOOLS = new Set<DocToolName>([
  "list_documents",
  "create_document",
  "rename_document",
  "delete_document",
]);

const marksSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    bold: { type: "boolean" },
    italic: { type: "boolean" },
    underline: { type: "boolean" },
    strike: { type: "boolean" },
    fontSize: { type: "number", description: "Font size in points (e.g. 14)" },
    fontFamily: {
      type: "string",
      description: "Font name e.g. Arial, Times New Roman, Cairo",
    },
    color: {
      type: "object",
      additionalProperties: false,
      properties: { rgb: { type: "string", maxLength: 9 } },
    },
    highlight: {
      type: "string",
      description:
        "Word highlight: yellow, green, cyan, magenta, blue, red, darkBlue, darkCyan, darkGreen, darkMagenta, darkRed, darkYellow, darkGray, lightGray, black, white, none",
    },
  },
} as const;

export const documentTools: OpenRouterTool[] = [
  {
    type: "function",
    function: {
      name: "read_document",
      description:
        "Read the full live document outline with paraId for every paragraph. Call BEFORE organizing, formatting, or editing. Never ask the user to paste document text.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_in_document",
      description: "Find paragraphs containing a query. Returns paraId + text.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_in_paragraph",
      description:
        "Replace a substring inside a paragraph. replaceWith '' deletes the matched text.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paraId: { type: "string", minLength: 1, maxLength: 120 },
          search: { type: "string", maxLength: 4000 },
          replaceWith: { type: "string", maxLength: 8000 },
        },
        required: ["paraId", "search", "replaceWith"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_paragraph_text",
      description: "Replace the entire text of a paragraph by paraId.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paraId: { type: "string", minLength: 1, maxLength: 120 },
          text: { type: "string", maxLength: 8000 },
        },
        required: ["paraId", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_paragraph",
      description: "Clear an entire paragraph by paraId.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paraId: { type: "string", minLength: 1, maxLength: 120 },
        },
        required: ["paraId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_matching_paragraph",
      description: "Find paragraph by text query and clear it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", minLength: 2, maxLength: 500 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_paragraph_after",
      description:
        "Insert a NEW paragraph after afterParaId. Use for new list items — never glue onto a heading.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          afterParaId: { type: "string", minLength: 1, maxLength: 120 },
          text: { type: "string", minLength: 1, maxLength: 8000 },
        },
        required: ["afterParaId", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_at_paragraph_end",
      description:
        "Append text to the end of an existing paragraph. Prefer insert_paragraph_after for new points.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paraId: { type: "string", minLength: 1, maxLength: 120 },
          text: { type: "string", minLength: 1, maxLength: 8000 },
        },
        required: ["paraId", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_formatting",
      description:
        "Apply Word-style character formatting (bold/italic/underline/strike/color/highlight/fontSize/fontFamily) to a paragraph or unique phrase (search).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paraId: { type: "string", minLength: 1, maxLength: 120 },
          search: { type: "string", maxLength: 4000 },
          marks: marksSchema,
        },
        required: ["paraId", "marks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "format_matching",
      description:
        "Find text/heading by query and apply formatting to the whole paragraph. Best for 'make X bold and underlined'.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", minLength: 2, maxLength: 500 },
          marks: marksSchema,
        },
        required: ["query", "marks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "format_section_items",
      description:
        "Under a section heading, format specific numbered list items (e.g. bold items 1 and 2 under القطاع المدني).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          headingQuery: { type: "string", minLength: 2, maxLength: 300 },
          itemNumbers: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: { type: "number" },
          },
          marks: marksSchema,
        },
        required: ["headingQuery", "itemNumbers", "marks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_paragraph_style",
      description:
        "Apply a paragraph style by styleId: Normal, Heading1, Heading2, Heading3, Title, Subtitle, Quote, ListParagraph.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paraId: { type: "string", minLength: 1, maxLength: 120 },
          styleId: { type: "string", minLength: 1, maxLength: 80 },
        },
        required: ["paraId", "styleId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_alignment",
      description: "Set paragraph alignment: left, center, right, both (justify).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paraId: { type: "string", minLength: 1, maxLength: 120 },
          alignment: {
            type: "string",
            enum: ["left", "center", "right", "both", "distribute"],
          },
        },
        required: ["paraId", "alignment"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_list",
      description: "Toggle bullet/numbered list or remove list formatting.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paraId: { type: "string", minLength: 1, maxLength: 120 },
          list: { type: "string", enum: ["bullet", "numbered", "none"] },
        },
        required: ["paraId", "list"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_direction",
      description: "Set paragraph text direction rtl or ltr.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paraId: { type: "string", minLength: 1, maxLength: 120 },
          direction: { type: "string", enum: ["rtl", "ltr"] },
        },
        required: ["paraId", "direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_break",
      description:
        "Insert a page or section break after a paragraph (toolbar Insert > Break).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paraId: { type: "string", minLength: 1, maxLength: 120 },
          type: {
            type: "string",
            enum: ["page", "sectionNextPage", "sectionContinuous"],
          },
        },
        required: ["paraId", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_table",
      description:
        "Insert a table after a paragraph. Optional data is a 2D string array of cell texts.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          afterParaId: { type: "string", minLength: 1, maxLength: 120 },
          rows: { type: "number" },
          cols: { type: "number" },
          data: {
            type: "array",
            maxItems: 20,
            items: {
              type: "array",
              maxItems: 12,
              items: { type: "string", maxLength: 500 },
            },
          },
        },
        required: ["afterParaId", "rows", "cols"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_image",
      description:
        "Insert an image after a paragraph from an https URL or data: URL.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          afterParaId: { type: "string", minLength: 1, maxLength: 120 },
          src: { type: "string", minLength: 8, maxLength: 2_000_000 },
        },
        required: ["afterParaId", "src"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_comment",
      description: "Add a review comment on a paragraph (optional unique search phrase).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paraId: { type: "string", minLength: 1, maxLength: 120 },
          text: { type: "string", minLength: 1, maxLength: 2000 },
          search: { type: "string", maxLength: 4000 },
        },
        required: ["paraId", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rewrite_section",
      description:
        "Organize/rewrite list items under a heading. headingQuery e.g. 'القطاع المدني'. lines = full new numbered lines.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          headingQuery: { type: "string", minLength: 2, maxLength: 300 },
          lines: {
            type: "array",
            minItems: 1,
            maxItems: 40,
            items: { type: "string", maxLength: 2000 },
          },
        },
        required: ["headingQuery", "lines"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_selection_context",
      description: "Get the user's current selection in the editor.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_documents",
      description: "List the user's documents in the Qalib library (id, title, path).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_document",
      description:
        "Create a new blank Word (docx), PDF, or Excel (xlsx) document in the library. open=true navigates to it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", maxLength: 200 },
          type: { type: "string", enum: ["docx", "pdf", "xlsx"] },
          open: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_document",
      description:
        "Rename a document. Omit documentId to rename the currently open document.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          documentId: { type: "string", maxLength: 80 },
          title: { type: "string", minLength: 1, maxLength: 200 },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_document",
      description:
        "Permanently delete a document. MUST pass confirm=true. Omit documentId to delete the current document (navigates to library).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          documentId: { type: "string", maxLength: 80 },
          confirm: { type: "boolean" },
        },
        required: ["confirm"],
      },
    },
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.slice(0, max);
}

const HIGHLIGHTS = new Set([
  "black",
  "blue",
  "cyan",
  "darkBlue",
  "darkCyan",
  "darkGray",
  "darkGreen",
  "darkMagenta",
  "darkRed",
  "darkYellow",
  "green",
  "lightGray",
  "magenta",
  "none",
  "red",
  "white",
  "yellow",
]);

function parseMarks(raw: unknown): {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSize?: number;
  fontFamily?: { ascii?: string; hAnsi?: string };
  color?: { rgb?: string };
  highlight?: string;
} | null {
  const marksRec = asRecord(raw);
  if (!marksRec) return null;
  const marks: NonNullable<ReturnType<typeof parseMarks>> = {};
  if (typeof marksRec.bold === "boolean") marks.bold = marksRec.bold;
  if (typeof marksRec.italic === "boolean") marks.italic = marksRec.italic;
  if (typeof marksRec.underline === "boolean") marks.underline = marksRec.underline;
  if (typeof marksRec.strike === "boolean") marks.strike = marksRec.strike;
  if (typeof marksRec.fontSize === "number" && Number.isFinite(marksRec.fontSize)) {
    marks.fontSize = Math.min(96, Math.max(8, marksRec.fontSize));
  }
  if (typeof marksRec.fontFamily === "string" && marksRec.fontFamily.trim()) {
    const name = marksRec.fontFamily.trim().slice(0, 80);
    marks.fontFamily = { ascii: name, hAnsi: name };
  }
  const colorRec = asRecord(marksRec.color);
  if (colorRec && typeof colorRec.rgb === "string") {
    marks.color = { rgb: colorRec.rgb.slice(0, 9) };
  }
  if (typeof marksRec.highlight === "string" && HIGHLIGHTS.has(marksRec.highlight)) {
    marks.highlight = marksRec.highlight;
  }
  return marks;
}

export type ValidatedToolCall =
  | { name: "read_document"; args: Record<string, never> }
  | { name: "find_in_document"; args: { query: string } }
  | {
      name: "replace_in_paragraph";
      args: { paraId: string; search: string; replaceWith: string };
    }
  | { name: "set_paragraph_text"; args: { paraId: string; text: string } }
  | { name: "delete_paragraph"; args: { paraId: string } }
  | { name: "delete_matching_paragraph"; args: { query: string } }
  | {
      name: "insert_paragraph_after";
      args: { afterParaId: string; text: string };
    }
  | { name: "insert_at_paragraph_end"; args: { paraId: string; text: string } }
  | {
      name: "apply_formatting";
      args: {
        paraId: string;
        search?: string;
        marks: NonNullable<ReturnType<typeof parseMarks>>;
      };
    }
  | {
      name: "format_matching";
      args: {
        query: string;
        marks: NonNullable<ReturnType<typeof parseMarks>>;
      };
    }
  | {
      name: "format_section_items";
      args: {
        headingQuery: string;
        itemNumbers: number[];
        marks: NonNullable<ReturnType<typeof parseMarks>>;
      };
    }
  | { name: "set_paragraph_style"; args: { paraId: string; styleId: string } }
  | {
      name: "set_alignment";
      args: {
        paraId: string;
        alignment: "left" | "center" | "right" | "both" | "distribute";
      };
    }
  | {
      name: "set_list";
      args: { paraId: string; list: "bullet" | "numbered" | "none" };
    }
  | {
      name: "set_direction";
      args: { paraId: string; direction: "rtl" | "ltr" };
    }
  | {
      name: "insert_break";
      args: {
        paraId: string;
        type: "page" | "sectionNextPage" | "sectionContinuous";
      };
    }
  | {
      name: "insert_table";
      args: {
        afterParaId: string;
        rows: number;
        cols: number;
        data?: string[][];
      };
    }
  | { name: "insert_image"; args: { afterParaId: string; src: string } }
  | {
      name: "add_comment";
      args: { paraId: string; text: string; search?: string };
    }
  | {
      name: "rewrite_section";
      args: { headingQuery: string; lines: string[] };
    }
  | { name: "get_selection_context"; args: Record<string, never> }
  | { name: "list_documents"; args: Record<string, never> }
  | {
      name: "create_document";
      args: { title?: string; type?: "docx" | "pdf" | "xlsx"; open?: boolean };
    }
  | {
      name: "rename_document";
      args: { documentId?: string; title: string };
    }
  | {
      name: "delete_document";
      args: { documentId?: string; confirm: boolean };
    };

export function validateToolCall(
  name: string,
  rawArgs: unknown,
): { ok: true; call: ValidatedToolCall } | { ok: false; error: string } {
  if (!DOC_TOOL_NAMES.includes(name as DocToolName)) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  let argsObj: Record<string, unknown> = {};
  if (typeof rawArgs === "string") {
    try {
      const parsed = JSON.parse(rawArgs) as unknown;
      const rec = asRecord(parsed);
      if (!rec) return { ok: false, error: "Invalid tool arguments" };
      argsObj = rec;
    } catch {
      return { ok: false, error: "Invalid tool JSON" };
    }
  } else {
    const rec = asRecord(rawArgs);
    if (rec) argsObj = rec;
    else if (rawArgs != null) return { ok: false, error: "Invalid tool arguments" };
  }

  switch (name as DocToolName) {
    case "read_document":
      return { ok: true, call: { name: "read_document", args: {} } };
    case "get_selection_context":
      return { ok: true, call: { name: "get_selection_context", args: {} } };
    case "list_documents":
      return { ok: true, call: { name: "list_documents", args: {} } };
    case "find_in_document": {
      const query = asString(argsObj.query, 500)?.trim();
      if (!query) return { ok: false, error: "query required" };
      return { ok: true, call: { name: "find_in_document", args: { query } } };
    }
    case "replace_in_paragraph": {
      const paraId = asString(argsObj.paraId, 120)?.trim();
      const search = asString(argsObj.search, 4000);
      const replaceWith = asString(argsObj.replaceWith, 8000);
      if (!paraId || search == null || replaceWith == null) {
        return { ok: false, error: "paraId, search, replaceWith required" };
      }
      return {
        ok: true,
        call: {
          name: "replace_in_paragraph",
          args: { paraId, search, replaceWith },
        },
      };
    }
    case "set_paragraph_text": {
      const paraId = asString(argsObj.paraId, 120)?.trim();
      const text = asString(argsObj.text, 8000);
      if (!paraId || text == null) {
        return { ok: false, error: "paraId and text required" };
      }
      return {
        ok: true,
        call: { name: "set_paragraph_text", args: { paraId, text } },
      };
    }
    case "delete_paragraph": {
      const paraId = asString(argsObj.paraId, 120)?.trim();
      if (!paraId) return { ok: false, error: "paraId required" };
      return { ok: true, call: { name: "delete_paragraph", args: { paraId } } };
    }
    case "delete_matching_paragraph": {
      const query = asString(argsObj.query, 500)?.trim();
      if (!query || query.length < 2) return { ok: false, error: "query required" };
      return {
        ok: true,
        call: { name: "delete_matching_paragraph", args: { query } },
      };
    }
    case "insert_paragraph_after": {
      const afterParaId = asString(argsObj.afterParaId, 120)?.trim();
      const text = asString(argsObj.text, 8000)?.trim();
      if (!afterParaId || !text) {
        return { ok: false, error: "afterParaId and text required" };
      }
      return {
        ok: true,
        call: { name: "insert_paragraph_after", args: { afterParaId, text } },
      };
    }
    case "insert_at_paragraph_end": {
      const paraId = asString(argsObj.paraId, 120)?.trim();
      const text = asString(argsObj.text, 8000);
      if (!paraId || !text?.trim()) {
        return { ok: false, error: "paraId and text required" };
      }
      return {
        ok: true,
        call: { name: "insert_at_paragraph_end", args: { paraId, text } },
      };
    }
    case "apply_formatting": {
      const paraId = asString(argsObj.paraId, 120)?.trim();
      const marks = parseMarks(argsObj.marks);
      if (!paraId || !marks) return { ok: false, error: "paraId and marks required" };
      const search = asString(argsObj.search, 4000) || undefined;
      return {
        ok: true,
        call: { name: "apply_formatting", args: { paraId, search, marks } },
      };
    }
    case "format_matching": {
      const query = asString(argsObj.query, 500)?.trim();
      const marks = parseMarks(argsObj.marks);
      if (!query || query.length < 2 || !marks) {
        return { ok: false, error: "query and marks required" };
      }
      return {
        ok: true,
        call: { name: "format_matching", args: { query, marks } },
      };
    }
    case "format_section_items": {
      const headingQuery = asString(argsObj.headingQuery, 300)?.trim();
      const marks = parseMarks(argsObj.marks);
      if (!headingQuery || !marks) {
        return { ok: false, error: "headingQuery and marks required" };
      }
      const raw = argsObj.itemNumbers;
      if (!Array.isArray(raw) || !raw.length) {
        return { ok: false, error: "itemNumbers required" };
      }
      const itemNumbers = raw
        .map((n) => (typeof n === "number" ? Math.floor(n) : Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, 20);
      if (!itemNumbers.length) {
        return { ok: false, error: "itemNumbers required" };
      }
      return {
        ok: true,
        call: {
          name: "format_section_items",
          args: { headingQuery, itemNumbers, marks },
        },
      };
    }
    case "set_paragraph_style": {
      const paraId = asString(argsObj.paraId, 120)?.trim();
      const styleId = asString(argsObj.styleId, 80)?.trim();
      if (!paraId || !styleId) {
        return { ok: false, error: "paraId and styleId required" };
      }
      return {
        ok: true,
        call: { name: "set_paragraph_style", args: { paraId, styleId } },
      };
    }
    case "set_alignment": {
      const paraId = asString(argsObj.paraId, 120)?.trim();
      const alignment = asString(argsObj.alignment, 20);
      if (
        !paraId ||
        !alignment ||
        !["left", "center", "right", "both", "distribute"].includes(alignment)
      ) {
        return { ok: false, error: "paraId and valid alignment required" };
      }
      return {
        ok: true,
        call: {
          name: "set_alignment",
          args: {
            paraId,
            alignment: alignment as
              | "left"
              | "center"
              | "right"
              | "both"
              | "distribute",
          },
        },
      };
    }
    case "set_list": {
      const paraId = asString(argsObj.paraId, 120)?.trim();
      const list = asString(argsObj.list, 20);
      if (!paraId || !list || !["bullet", "numbered", "none"].includes(list)) {
        return { ok: false, error: "paraId and list required" };
      }
      return {
        ok: true,
        call: {
          name: "set_list",
          args: { paraId, list: list as "bullet" | "numbered" | "none" },
        },
      };
    }
    case "set_direction": {
      const paraId = asString(argsObj.paraId, 120)?.trim();
      const direction = asString(argsObj.direction, 8);
      if (!paraId || !direction || !["rtl", "ltr"].includes(direction)) {
        return { ok: false, error: "paraId and direction required" };
      }
      return {
        ok: true,
        call: {
          name: "set_direction",
          args: { paraId, direction: direction as "rtl" | "ltr" },
        },
      };
    }
    case "insert_break": {
      const paraId = asString(argsObj.paraId, 120)?.trim();
      const type = asString(argsObj.type, 40);
      if (
        !paraId ||
        !type ||
        !["page", "sectionNextPage", "sectionContinuous"].includes(type)
      ) {
        return { ok: false, error: "paraId and break type required" };
      }
      return {
        ok: true,
        call: {
          name: "insert_break",
          args: {
            paraId,
            type: type as "page" | "sectionNextPage" | "sectionContinuous",
          },
        },
      };
    }
    case "insert_table": {
      const afterParaId = asString(argsObj.afterParaId, 120)?.trim();
      const rows =
        typeof argsObj.rows === "number" ? Math.floor(argsObj.rows) : NaN;
      const cols =
        typeof argsObj.cols === "number" ? Math.floor(argsObj.cols) : NaN;
      if (!afterParaId || !Number.isFinite(rows) || !Number.isFinite(cols)) {
        return { ok: false, error: "afterParaId, rows, cols required" };
      }
      let data: string[][] | undefined;
      if (Array.isArray(argsObj.data)) {
        data = argsObj.data
          .slice(0, 20)
          .map((row) =>
            Array.isArray(row)
              ? row
                  .slice(0, 12)
                  .map((cell) =>
                    typeof cell === "string" ? cell.slice(0, 500) : "",
                  )
              : [],
          );
      }
      return {
        ok: true,
        call: {
          name: "insert_table",
          args: {
            afterParaId,
            rows: Math.min(20, Math.max(1, rows)),
            cols: Math.min(12, Math.max(1, cols)),
            data,
          },
        },
      };
    }
    case "insert_image": {
      const afterParaId = asString(argsObj.afterParaId, 120)?.trim();
      const src = asString(argsObj.src, 2_000_000)?.trim();
      if (!afterParaId || !src) {
        return { ok: false, error: "afterParaId and src required" };
      }
      if (!src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:")) {
        return { ok: false, error: "src must be http(s) or data URL" };
      }
      return {
        ok: true,
        call: { name: "insert_image", args: { afterParaId, src } },
      };
    }
    case "add_comment": {
      const paraId = asString(argsObj.paraId, 120)?.trim();
      const text = asString(argsObj.text, 2000)?.trim();
      if (!paraId || !text) {
        return { ok: false, error: "paraId and text required" };
      }
      const search = asString(argsObj.search, 4000) || undefined;
      return {
        ok: true,
        call: { name: "add_comment", args: { paraId, text, search } },
      };
    }
    case "rewrite_section": {
      const headingQuery = asString(argsObj.headingQuery, 300)?.trim();
      const linesRaw = argsObj.lines;
      if (!headingQuery || !Array.isArray(linesRaw) || linesRaw.length === 0) {
        return { ok: false, error: "headingQuery and lines required" };
      }
      const lines = linesRaw
        .map((l) => (typeof l === "string" ? l.slice(0, 2000).trim() : ""))
        .filter(Boolean)
        .slice(0, 40);
      if (!lines.length) return { ok: false, error: "lines required" };
      return {
        ok: true,
        call: { name: "rewrite_section", args: { headingQuery, lines } },
      };
    }
    case "create_document": {
      const title = asString(argsObj.title, 200)?.trim() || undefined;
      const type =
        argsObj.type === "pdf"
          ? "pdf"
          : argsObj.type === "xlsx"
            ? "xlsx"
            : "docx";
      const open = argsObj.open !== false;
      return {
        ok: true,
        call: { name: "create_document", args: { title, type, open } },
      };
    }
    case "rename_document": {
      const title = asString(argsObj.title, 200)?.trim();
      if (!title) return { ok: false, error: "title required" };
      const documentId = asString(argsObj.documentId, 80)?.trim() || undefined;
      return {
        ok: true,
        call: { name: "rename_document", args: { documentId, title } },
      };
    }
    case "delete_document": {
      if (argsObj.confirm !== true) {
        return { ok: false, error: "confirm=true required" };
      }
      const documentId = asString(argsObj.documentId, 80)?.trim() || undefined;
      return {
        ok: true,
        call: { name: "delete_document", args: { documentId, confirm: true } },
      };
    }
    default:
      return { ok: false, error: "Unknown tool" };
  }
}

export const MAX_MESSAGE_CHARS = 20_000;
export const MAX_CONTEXT_CHARS = 28_000;
export const MAX_HISTORY_MESSAGES = 24;
export const MAX_TOOL_ROUNDS = 6;

export function toolsForDocKind(kind: "docx" | "pdf" | "xlsx" = "docx") {
  if (kind === "xlsx") {
    const libraryOnly = documentTools.filter((t) =>
      LIBRARY_TOOLS.has(t.function.name as DocToolName),
    );
    return [...sheetTools, ...libraryOnly];
  }
  return documentTools;
}
