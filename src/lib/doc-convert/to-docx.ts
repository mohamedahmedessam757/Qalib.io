/**
 * Renders the Word 97 `DocModel` into an OOXML .docx package.
 *
 * Alignment and indents are written with physical left/right semantics
 * because that is how the in-app editor (Eigenpal) lays out RTL
 * paragraphs; the common "start" alignment is omitted entirely so both
 * the editor and Microsoft Word fall back to the paragraph's natural side.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeightRule,
  HighlightColor,
  ImageRun,
  LineRuleType,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  SectionType,
  ShadingType,
  Tab,
  Table,
  TableBorders,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlignTable,
  VerticalMergeType,
  WidthType,
  type IBorderOptions,
  type IParagraphOptions,
  type IRunOptions,
  type ISectionOptions,
  type ParagraphChild,
} from "docx";
import type {
  Block,
  Border,
  DocModel,
  ParagraphBlock,
  RunStyle,
  SectionModel,
  TableBlock,
  Token,
} from "./word97";

const TWIPS_PER_PX = 15;
const COMPLEX_SCRIPT_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

const HIGHLIGHTS: Record<number, (typeof HighlightColor)[keyof typeof HighlightColor]> = {
  1: HighlightColor.BLACK,
  2: HighlightColor.BLUE,
  3: HighlightColor.CYAN,
  4: HighlightColor.GREEN,
  5: HighlightColor.MAGENTA,
  6: HighlightColor.RED,
  7: HighlightColor.YELLOW,
  8: HighlightColor.WHITE,
  9: HighlightColor.DARK_BLUE,
  10: HighlightColor.DARK_CYAN,
  11: HighlightColor.DARK_GREEN,
  12: HighlightColor.DARK_MAGENTA,
  13: HighlightColor.DARK_RED,
  14: HighlightColor.DARK_YELLOW,
  15: HighlightColor.DARK_GRAY,
  16: HighlightColor.LIGHT_GRAY,
};

const UNDERLINES: Record<number, (typeof UnderlineType)[keyof typeof UnderlineType]> = {
  1: UnderlineType.SINGLE,
  2: UnderlineType.WORDS,
  3: UnderlineType.DOUBLE,
  4: UnderlineType.DOTTED,
  6: UnderlineType.THICK,
  7: UnderlineType.DASH,
  9: UnderlineType.DOTDASH,
  10: UnderlineType.DOTDOTDASH,
  11: UnderlineType.WAVE,
  20: UnderlineType.DOTTEDHEAVY,
  23: UnderlineType.DASHEDHEAVY,
  25: UnderlineType.DASHDOTHEAVY,
  26: UnderlineType.DASHDOTDOTHEAVY,
  27: UnderlineType.WAVYHEAVY,
  39: UnderlineType.DASHLONG,
  43: UnderlineType.WAVYDOUBLE,
  55: UnderlineType.DASHLONGHEAVY,
};

const BORDER_STYLES: Record<number, (typeof BorderStyle)[keyof typeof BorderStyle]> = {
  1: BorderStyle.SINGLE,
  2: BorderStyle.THICK,
  3: BorderStyle.DOUBLE,
  5: BorderStyle.SINGLE,
  6: BorderStyle.DOTTED,
  7: BorderStyle.DASHED,
  8: BorderStyle.DOT_DASH,
  9: BorderStyle.DOT_DOT_DASH,
  10: BorderStyle.TRIPLE,
  11: BorderStyle.THIN_THICK_SMALL_GAP,
  12: BorderStyle.THICK_THIN_SMALL_GAP,
  13: BorderStyle.THIN_THICK_THIN_SMALL_GAP,
  14: BorderStyle.THIN_THICK_MEDIUM_GAP,
  15: BorderStyle.THICK_THIN_MEDIUM_GAP,
  16: BorderStyle.THIN_THICK_THIN_MEDIUM_GAP,
  17: BorderStyle.THIN_THICK_LARGE_GAP,
  18: BorderStyle.THICK_THIN_LARGE_GAP,
  19: BorderStyle.THIN_THICK_THIN_LARGE_GAP,
  20: BorderStyle.WAVE,
  21: BorderStyle.DOUBLE_WAVE,
  22: BorderStyle.DASH_SMALL_GAP,
  23: BorderStyle.DASH_DOT_STROKED,
  24: BorderStyle.THREE_D_EMBOSS,
  25: BorderStyle.THREE_D_ENGRAVE,
  26: BorderStyle.OUTSET,
  27: BorderStyle.INSET,
};

function runOptions(style: RunStyle, text: string | null): IRunOptions {
  const complex = style.rtl || (text !== null && COMPLEX_SCRIPT_RE.test(text));
  const primaryFont = complex ? style.fontBi ?? style.fontAscii : style.fontAscii;
  const otherFont = complex ? style.fontBi ?? style.fontOther : style.fontOther;
  const font =
    primaryFont || otherFont || style.fontBi || style.fontEastAsia
      ? {
          ascii: primaryFont ?? undefined,
          hAnsi: otherFont ?? primaryFont ?? undefined,
          cs: style.fontBi ?? primaryFont ?? undefined,
          eastAsia: style.fontEastAsia ?? undefined,
        }
      : undefined;
  return {
    bold: complex ? style.boldBi || style.bold : style.bold,
    boldComplexScript: style.boldBi || (complex && style.bold),
    italics: complex ? style.italicBi || style.italic : style.italic,
    italicsComplexScript: style.italicBi || (complex && style.italic),
    size: complex ? style.sizeBi : style.size,
    sizeComplexScript: style.sizeBi,
    font,
    rightToLeft: style.rtl || undefined,
    color: style.color ?? undefined,
    highlight: HIGHLIGHTS[style.highlight],
    underline: style.underline ? { type: UNDERLINES[style.underline] ?? UnderlineType.SINGLE } : undefined,
    strike: style.strike || undefined,
    doubleStrike: style.doubleStrike || undefined,
    allCaps: style.caps || undefined,
    smallCaps: style.smallCaps || undefined,
    superScript: style.vertAlign === 1 || undefined,
    subScript: style.vertAlign === 2 || undefined,
  };
}

function imageRun(token: Extract<Token, { kind: "image" }>, maxWidthTwips: number): ImageRun {
  let w = token.widthTwips;
  let h = token.heightTwips;
  if (w > maxWidthTwips && maxWidthTwips > 0) {
    h = Math.round((h * maxWidthTwips) / w);
    w = maxWidthTwips;
  }
  return new ImageRun({
    type: token.format,
    data: token.data,
    transformation: {
      width: Math.max(1, Math.round(w / TWIPS_PER_PX)),
      height: Math.max(1, Math.round(h / TWIPS_PER_PX)),
    },
  });
}

function paragraphChildren(tokens: Token[], maxWidthTwips: number): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  let pending: (string | Tab)[] = [];
  let pendingStyle: RunStyle | null = null;
  let pendingText = "";
  let breakBefore = 0;

  const flush = () => {
    if (pendingStyle && (pending.length > 0 || breakBefore > 0)) {
      out.push(
        new TextRun({
          ...runOptions(pendingStyle, pendingText),
          break: breakBefore || undefined,
          children: pending,
        }),
      );
    }
    pending = [];
    pendingStyle = null;
    pendingText = "";
    breakBefore = 0;
  };

  for (const token of tokens) {
    switch (token.kind) {
      case "text":
      case "tab": {
        if (pendingStyle !== null && pendingStyle !== token.style) flush();
        pendingStyle = token.style;
        if (token.kind === "text") {
          pending.push(token.text);
          pendingText += token.text;
        } else {
          pending.push(new Tab());
        }
        break;
      }
      case "break":
        flush();
        pendingStyle = token.style;
        breakBefore = 1;
        break;
      case "pageBreak":
        flush();
        out.push(new PageBreak());
        break;
      case "image":
        flush();
        out.push(imageRun(token, maxWidthTwips));
        break;
      default:
        break;
    }
  }
  flush();
  return out;
}

function paragraphAlignment(p: ParagraphBlock): IParagraphOptions["alignment"] {
  switch (p.align) {
    case 1:
      return AlignmentType.CENTER;
    case 2:
      return p.bidi ? AlignmentType.LEFT : AlignmentType.RIGHT;
    case 3:
      return AlignmentType.BOTH;
    default:
      return undefined;
  }
}

function renderParagraph(p: ParagraphBlock, maxWidthTwips: number): Paragraph {
  const indent: { left?: number; right?: number; firstLine?: number; hanging?: number } = {};
  const start = p.indentStart ?? undefined;
  const end = p.indentEnd ?? undefined;
  if (start !== undefined) indent[p.bidi ? "right" : "left"] = start;
  if (end !== undefined) indent[p.bidi ? "left" : "right"] = end;
  if (p.indentFirst !== null && p.indentFirst !== 0) {
    if (p.indentFirst > 0) indent.firstLine = p.indentFirst;
    else indent.hanging = -p.indentFirst;
  }

  const spacing: {
    before?: number;
    after?: number;
    line?: number;
    lineRule?: (typeof LineRuleType)[keyof typeof LineRuleType];
  } = {};
  if (p.spaceBefore !== null) spacing.before = p.spaceBefore;
  if (p.spaceAfter !== null) spacing.after = p.spaceAfter;
  if (p.line !== null) {
    spacing.line = p.line;
    spacing.lineRule =
      p.lineRule === "exact"
        ? LineRuleType.EXACT
        : p.lineRule === "atLeast"
          ? LineRuleType.AT_LEAST
          : LineRuleType.AUTO;
  }

  return new Paragraph({
    children: paragraphChildren(p.tokens, maxWidthTwips),
    alignment: paragraphAlignment(p),
    bidirectional: p.bidi || undefined,
    indent: Object.keys(indent).length > 0 ? indent : undefined,
    spacing: Object.keys(spacing).length > 0 ? spacing : undefined,
    keepNext: p.keepNext || undefined,
    keepLines: p.keepLines || undefined,
    pageBreakBefore: p.pageBreakBefore || undefined,
  });
}

function borderOptions(b: Border | null): IBorderOptions | undefined {
  if (!b) return undefined;
  return {
    style: BORDER_STYLES[b.type] ?? BorderStyle.SINGLE,
    size: Math.min(96, Math.max(2, b.width)),
    color: b.color ?? "auto",
  };
}

function renderTable(t: TableBlock, maxWidthTwips: number): Table {
  const total = t.gridTwips.reduce((a, b) => a + b, 0);
  const rows = t.rows.map(
    (r) =>
      new TableRow({
        tableHeader: r.header || undefined,
        height:
          r.height !== 0
            ? {
                value: Math.abs(r.height),
                rule: r.height < 0 ? HeightRule.EXACT : HeightRule.ATLEAST,
              }
            : undefined,
        children: r.cells.map((c) => {
          const start = borderOptions(c.borders.start);
          const end = borderOptions(c.borders.end);
          return new TableCell({
            children: c.paragraphs.map((p) => renderParagraph(p, c.widthTwips || maxWidthTwips)),
            columnSpan: c.gridSpan > 1 ? c.gridSpan : undefined,
            width: c.widthTwips > 0 ? { size: c.widthTwips, type: WidthType.DXA } : undefined,
            verticalMerge:
              c.vMerge === "restart"
                ? VerticalMergeType.RESTART
                : c.vMerge === "continue"
                  ? VerticalMergeType.CONTINUE
                  : undefined,
            verticalAlign:
              c.vAlign === 1
                ? VerticalAlignTable.CENTER
                : c.vAlign === 2
                  ? VerticalAlignTable.BOTTOM
                  : undefined,
            borders: {
              top: borderOptions(c.borders.top),
              bottom: borderOptions(c.borders.bottom),
              left: t.bidi ? end : start,
              right: t.bidi ? start : end,
            },
            shading: c.shading
              ? { fill: c.shading, type: ShadingType.CLEAR, color: "auto" }
              : undefined,
          });
        }),
      }),
  );

  return new Table({
    rows,
    columnWidths: t.gridTwips,
    width: { size: total, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    borders: TableBorders.NONE,
    visuallyRightToLeft: t.bidi || undefined,
    alignment:
      t.align === 1
        ? AlignmentType.CENTER
        : t.align === 2
          ? t.bidi
            ? AlignmentType.LEFT
            : AlignmentType.RIGHT
          : undefined,
  });
}

function renderBlocks(blocks: Block[], maxWidthTwips: number): (Paragraph | Table)[] {
  return blocks.map((b) =>
    b.kind === "table" ? renderTable(b, maxWidthTwips) : renderParagraph(b, maxWidthTwips),
  );
}

function sectionType(bkc: number) {
  switch (bkc) {
    case 0:
      return SectionType.CONTINUOUS;
    case 1:
      return SectionType.NEXT_COLUMN;
    case 3:
      return SectionType.EVEN_PAGE;
    case 4:
      return SectionType.ODD_PAGE;
    default:
      return SectionType.NEXT_PAGE;
  }
}

function renderSection(s: SectionModel): ISectionOptions {
  const contentWidth = Math.max(
    1440,
    s.pageWidth - s.marginLeft - s.marginRight - s.gutter,
  );
  // docx swaps width/height itself for landscape, so pass portrait dims.
  const shortSide = Math.min(s.pageWidth, s.pageHeight);
  const longSide = Math.max(s.pageWidth, s.pageHeight);
  return {
    properties: {
      type: sectionType(s.breakType),
      titlePage: s.titlePage || undefined,
      page: {
        size: {
          width: s.landscape ? shortSide : s.pageWidth,
          height: s.landscape ? longSide : s.pageHeight,
          orientation: s.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
        },
        margin: {
          top: s.marginTop,
          bottom: s.marginBottom,
          left: s.marginLeft,
          right: s.marginRight,
          header: s.headerDistance,
          footer: s.footerDistance,
          gutter: s.gutter,
        },
      },
    },
    headers: {
      default: s.headers.default
        ? new Header({ children: renderBlocks(s.headers.default, contentWidth) })
        : undefined,
      first: s.headers.first
        ? new Header({ children: renderBlocks(s.headers.first, contentWidth) })
        : undefined,
    },
    footers: {
      default: s.footers.default
        ? new Footer({ children: renderBlocks(s.footers.default, contentWidth) })
        : undefined,
      first: s.footers.first
        ? new Footer({ children: renderBlocks(s.footers.first, contentWidth) })
        : undefined,
    },
    children: renderBlocks(s.blocks, contentWidth),
  };
}

export async function modelToDocx(model: DocModel): Promise<Uint8Array> {
  const base = runOptions(model.defaultStyle, null);
  const doc = new Document({
    creator: "Qalib",
    styles: {
      default: {
        document: {
          run: {
            font: base.font,
            size: base.size,
            sizeComplexScript: base.sizeComplexScript,
          },
        },
      },
    },
    sections: model.sections.map(renderSection),
  });
  const buffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buffer);
}
