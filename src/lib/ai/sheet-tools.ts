import type { OpenRouterTool } from "@/lib/ai/openrouter";

export const SHEET_TOOL_NAMES = [
  "read_sheet_range",
  "write_cells",
  "insert_rows",
  "delete_rows",
  "set_formula",
  "create_sheet",
] as const;

export type SheetToolName = (typeof SHEET_TOOL_NAMES)[number];

export const sheetTools: OpenRouterTool[] = [
  {
    type: "function",
    function: {
      name: "read_sheet_range",
      description: "Read cell values from the active sheet in A1 range (e.g. A1:C10).",
      parameters: {
        type: "object",
        properties: {
          range: { type: "string", description: "A1 range like A1:C10 or single A1" },
        },
        required: ["range"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_cells",
      description: "Write values to cells. Each item needs a1 and value.",
      parameters: {
        type: "object",
        properties: {
          cells: {
            type: "array",
            items: {
              type: "object",
              properties: {
                a1: { type: "string" },
                value: {
                  oneOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "boolean" },
                  ],
                },
              },
              required: ["a1", "value"],
            },
          },
        },
        required: ["cells"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_rows",
      description: "Insert blank rows starting at 1-based row index.",
      parameters: {
        type: "object",
        properties: {
          startRow: { type: "integer", minimum: 1 },
          count: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["startRow"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_rows",
      description: "Delete rows starting at 1-based row index.",
      parameters: {
        type: "object",
        properties: {
          startRow: { type: "integer", minimum: 1 },
          count: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["startRow"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_formula",
      description: "Set a formula on a cell (without leading =).",
      parameters: {
        type: "object",
        properties: {
          a1: { type: "string" },
          formula: { type: "string" },
        },
        required: ["a1", "formula"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_sheet",
      description: "Create a new worksheet tab.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
];

export function isSheetToolName(name: string): name is SheetToolName {
  return (SHEET_TOOL_NAMES as readonly string[]).includes(name);
}

export function validateSheetToolCall(
  name: string,
  args: unknown,
):
  | { ok: true; name: SheetToolName; args: Record<string, unknown> }
  | { ok: false; error: string } {
  if (!isSheetToolName(name)) {
    return { ok: false, error: `Unknown sheet tool: ${name}` };
  }
  if (!args || typeof args !== "object") {
    return { ok: false, error: "Invalid tool args" };
  }
  return { ok: true, name, args: args as Record<string, unknown> };
}
