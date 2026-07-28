import {
  setDocumentWatermark,
  type Document,
} from "@eigenpal/docx-editor-core/headless";

export type PageFrameStyle = "single" | "double" | "thick" | "dashed" | "none";

type BorderSide = {
  style: "single" | "double" | "thick" | "dashed" | "none";
  size: number;
  color: { rgb: string };
  space?: number;
};

function borderFor(
  style: PageFrameStyle,
  color: string,
): BorderSide | undefined {
  if (style === "none") return undefined;
  const rgb = color.replace("#", "").toUpperCase();
  const size =
    style === "thick" ? 48 : style === "double" ? 24 : style === "dashed" ? 18 : 24;
  return {
    style: style === "thick" ? "thick" : style,
    size,
    color: { rgb },
    space: 24,
  };
}

/** Apply (or clear) page borders on every section — persists in the .docx. */
export function applyPageFrame(
  doc: Document,
  style: PageFrameStyle,
  color = "#0F172A",
): Document {
  const side = borderFor(style, color);
  const pageBorders = side
    ? {
        top: side,
        bottom: side,
        left: side,
        right: side,
        display: "allPages" as const,
        offsetFrom: "page" as const,
        zOrder: "front" as const,
      }
    : undefined;

  const body = doc.package.document;
  if (body.finalSectionProperties) {
    body.finalSectionProperties = {
      ...body.finalSectionProperties,
      pageBorders,
    };
  } else {
    body.finalSectionProperties = { pageBorders };
  }

  if (body.sections?.length) {
    body.sections = body.sections.map((section) => ({
      ...section,
      properties: {
        ...section.properties,
        pageBorders,
      },
    }));
  }

  return doc;
}

export function applyTextWatermark(
  doc: Document,
  text: string | null,
  opts?: { color?: string; layout?: "diagonal" | "horizontal" },
): Document {
  if (!text?.trim()) {
    return setDocumentWatermark(doc, null);
  }
  return setDocumentWatermark(doc, {
    kind: "text",
    text: text.trim().slice(0, 40),
    font: "Arial",
    color: opts?.color || "#C0C0C0",
    semitransparent: true,
    layout: opts?.layout || "diagonal",
  });
}
