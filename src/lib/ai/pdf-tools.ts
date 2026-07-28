import type { OpenRouterTool } from "@/lib/ai/openrouter";

export const PDF_TOOL_NAMES = [
  "read_pdf_state",
  "add_pdf_text",
  "update_pdf_text",
  "organize_pdf_text",
  "add_pdf_shape",
  "add_pdf_full_frame",
  "add_pdf_table",
  "add_pdf_whiteout",
  "delete_pdf_overlay",
  "list_pdf_overlays",
] as const;

export type PdfToolName = (typeof PDF_TOOL_NAMES)[number];

export function isPdfToolName(name: string): name is PdfToolName {
  return (PDF_TOOL_NAMES as readonly string[]).includes(name);
}

export const pdfTools: OpenRouterTool[] = [
  {
    type: "function",
    function: {
      name: "read_pdf_state",
      description: "Read page count and a summary of current PDF overlays.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pdf_overlays",
      description: "List overlay ids, types, pageIndex, and text snippets.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "add_pdf_text",
      description:
        "Add a text box overlay. Arabic is supported. Prefer tidy multi-line text.",
      parameters: {
        type: "object",
        properties: {
          pageIndex: { type: "integer", minimum: 0 },
          text: { type: "string" },
          x: { type: "number", minimum: 0, maximum: 1 },
          y: { type: "number", minimum: 0, maximum: 1 },
          w: { type: "number", minimum: 0.05, maximum: 1 },
          h: { type: "number", minimum: 0.02, maximum: 1 },
          fontSize: { type: "number", minimum: 8, maximum: 72 },
          color: { type: "string" },
          align: { type: "string", enum: ["start", "center", "end"] },
          coverOriginal: { type: "boolean" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_pdf_text",
      description: "Update text/align/color of an existing text overlay by id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          align: { type: "string", enum: ["start", "center", "end"] },
          fontSize: { type: "number" },
          color: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "organize_pdf_text",
      description:
        "Clean whitespace and normalize line breaks for a text overlay (or all text overlays if id omitted).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          align: { type: "string", enum: ["start", "center", "end"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_pdf_shape",
      description:
        "Add decorative shape: rect, border, doubleFrame, oval, banner, stamp, line.",
      parameters: {
        type: "object",
        properties: {
          pageIndex: { type: "integer", minimum: 0 },
          shape: {
            type: "string",
            enum: [
              "rect",
              "border",
              "doubleFrame",
              "oval",
              "banner",
              "stamp",
              "line",
            ],
          },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          color: { type: "string" },
        },
        required: ["shape"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_pdf_full_frame",
      description: "Add a full-page decorative double frame near page margins.",
      parameters: {
        type: "object",
        properties: {
          pageIndex: { type: "integer", minimum: 0 },
          color: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_pdf_table",
      description: "Add a table overlay with optional cell texts (row-major).",
      parameters: {
        type: "object",
        properties: {
          pageIndex: { type: "integer", minimum: 0 },
          rows: { type: "integer", minimum: 1, maximum: 12 },
          cols: { type: "integer", minimum: 1, maximum: 8 },
          cells: { type: "array", items: { type: "string" } },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_pdf_whiteout",
      description: "Cover an area with a white rectangle (redact/cover).",
      parameters: {
        type: "object",
        properties: {
          pageIndex: { type: "integer", minimum: 0 },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_pdf_overlay",
      description: "Delete an overlay by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
];
