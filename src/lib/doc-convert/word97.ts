/**
 * Parser for binary Word 97–2003 documents ([MS-DOC]) into a small,
 * renderer-agnostic document model (see `DocModel`).
 *
 * Scope: body text, character/paragraph formatting, styles, tables
 * (including merged cells, borders and shading), automatic numbering,
 * inline + floating JPEG/PNG pictures, headers/footers and page setup.
 * Unsupported constructs (text boxes, footnotes, comments, OLE objects,
 * metafile pictures) are skipped rather than failing the conversion.
 *
 * All reads are bounds-checked; malformed input raises `DocParseError`.
 */

import { CfbReader } from "./cfb";

export type DocParseErrorCode =
  | "encrypted"
  | "unsupported_version"
  | "not_word"
  | "corrupt";

export class DocParseError extends Error {
  constructor(
    readonly code: DocParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocParseError";
  }
}

// ─── Public model ────────────────────────────────────────────────────────────

export type Border = {
  /** Word brcType (1 single, 3 double, 6 dotted, …). */
  type: number;
  /** Width in eighths of a point. */
  width: number;
  /** RRGGBB, or null for automatic. */
  color: string | null;
};

export type RunStyle = {
  bold: boolean;
  italic: boolean;
  boldBi: boolean;
  italicBi: boolean;
  strike: boolean;
  doubleStrike: boolean;
  caps: boolean;
  smallCaps: boolean;
  /** Word kul underline code (0 = none). */
  underline: number;
  /** Half-points. */
  size: number;
  sizeBi: number;
  fontAscii: string | null;
  fontOther: string | null;
  fontEastAsia: string | null;
  fontBi: string | null;
  color: string | null;
  /** Word ico highlight index (0 = none). */
  highlight: number;
  /** 0 normal, 1 superscript, 2 subscript. */
  vertAlign: number;
  rtl: boolean;
};

export type Token =
  | { kind: "text"; text: string; style: RunStyle }
  | { kind: "tab"; style: RunStyle }
  | { kind: "break"; style: RunStyle }
  | { kind: "pageBreak" }
  | {
      kind: "image";
      data: Uint8Array;
      format: "png" | "jpg";
      widthTwips: number;
      heightTwips: number;
    };

export type ParagraphBlock = {
  kind: "paragraph";
  /** Word jc resolved to a logical value: 0 start, 1 center, 2 end, 3 justify. */
  align: number | null;
  bidi: boolean;
  spaceBefore: number | null;
  spaceAfter: number | null;
  /** Twips (exact / at-least) or 240ths of a line when `lineMultiple`. */
  line: number | null;
  lineRule: "auto" | "exact" | "atLeast";
  indentStart: number | null;
  indentEnd: number | null;
  /** Positive = first-line indent, negative = hanging. */
  indentFirst: number | null;
  keepNext: boolean;
  keepLines: boolean;
  pageBreakBefore: boolean;
  tokens: Token[];
};

export type TableCellBlock = {
  paragraphs: ParagraphBlock[];
  gridSpan: number;
  widthTwips: number;
  vMerge: "restart" | "continue" | null;
  /** 0 top, 1 center, 2 bottom. */
  vAlign: number;
  borders: {
    top: Border | null;
    bottom: Border | null;
    start: Border | null;
    end: Border | null;
  };
  shading: string | null;
};

export type TableRowBlock = {
  cells: TableCellBlock[];
  /** Positive = at least, negative = exact (twips), 0 = auto. */
  height: number;
  header: boolean;
};

export type TableBlock = {
  kind: "table";
  bidi: boolean;
  /** 0 start, 1 center, 2 end. */
  align: number;
  gridTwips: number[];
  rows: TableRowBlock[];
};

export type Block = ParagraphBlock | TableBlock;

export type SectionModel = {
  pageWidth: number;
  pageHeight: number;
  landscape: boolean;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  headerDistance: number;
  footerDistance: number;
  gutter: number;
  titlePage: boolean;
  /** Word bkc: 0 continuous, 1 column, 2 new page, 3 even, 4 odd. */
  breakType: number;
  headers: { default: Block[] | null; first: Block[] | null };
  footers: { default: Block[] | null; first: Block[] | null };
  blocks: Block[];
};

export type DocModel = {
  sections: SectionModel[];
  defaultStyle: RunStyle;
  stats: { paragraphs: number; tables: number; images: number };
};

// ─── Internal formats ────────────────────────────────────────────────────────

type CharFormat = {
  bold: boolean;
  italic: boolean;
  boldBi: boolean;
  italicBi: boolean;
  strike: boolean;
  dstrike: boolean;
  caps: boolean;
  smallCaps: boolean;
  vanish: boolean;
  deleted: boolean;
  rtl: boolean;
  spec: boolean;
  underline: number;
  hps: number;
  hpsBi: number;
  ftcAscii: number;
  ftcFE: number;
  ftcOther: number;
  ftcBi: number;
  color: string | null;
  highlight: number;
  iss: number;
  picLocation: number;
  symbol: number;
};

type TcFormat = {
  horzMerge: number;
  vertMerge: number;
  vAlign: number;
  top: Border | null | undefined;
  left: Border | null | undefined;
  bottom: Border | null | undefined;
  right: Border | null | undefined;
};

type TableFormat = {
  centers: number[];
  tcs: TcFormat[];
  bidi: boolean;
  jc: number;
  borders: {
    top: Border | null;
    left: Border | null;
    bottom: Border | null;
    right: Border | null;
    insideH: Border | null;
    insideV: Border | null;
  } | null;
  shading: (string | null)[];
  rowHeight: number;
  header: boolean;
};

type ParaFormat = {
  istd: number;
  jcLogical: number | null;
  jcPhysical: number | null;
  bidi: boolean;
  before: number | null;
  after: number | null;
  lineDya: number | null;
  lineMult: boolean;
  indStart: number | null;
  indEnd: number | null;
  indFirst: number | null;
  keepNext: boolean;
  keepLines: boolean;
  pageBreakBefore: boolean;
  inTable: boolean;
  ttp: boolean;
  innerTtp: boolean;
  itap: number;
  ilfo: number;
  ilvl: number;
  table: TableFormat | null;
};

type Piece = {
  cpStart: number;
  cpEnd: number;
  byteStart: number;
  compressed: boolean;
  prm: number;
};

type FkpRun = { start: number; end: number; istd: number; grpprl: Uint8Array };

type StyleDef = {
  stk: number;
  base: number;
  papx: Uint8Array | null;
  chpx: Uint8Array | null;
};

type ListLevel = {
  startAt: number;
  nfc: number;
  legal: boolean;
  follow: number;
  xst: number[];
  papx: Uint8Array;
};

type ListDef = { levels: ListLevel[] };
type LfoDef = { lsid: number; startOverrides: Map<number, number> };

type Spa = { spid: number; widthTwips: number; heightTwips: number };

type RawImage = { data: Uint8Array; format: "png" | "jpg" };

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_TEXT_CHARS = 20_000_000;
const MAX_FIELD_DEPTH = 64;
const MAX_STYLE_DEPTH = 16;
const MAX_GRID_COLUMNS = 128;
const MAX_IMAGES = 400;
const ISTD_NIL = 0x0fff;

const CP1252_HIGH: (number | undefined)[] = [
  0x20ac, undefined, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, undefined, 0x017d, undefined,
  undefined, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, undefined, 0x017e, 0x0178,
];

const ICO_COLORS: (string | null)[] = [
  null, "000000", "0000FF", "00FFFF", "00FF00", "FF00FF", "FF0000", "FFFF00",
  "FFFFFF", "000080", "008080", "008000", "800080", "800000", "808000",
  "808080", "C0C0C0",
];

/** Symbol/Wingdings private-use code points commonly used as bullets. */
const SYMBOL_MAP: Record<number, string> = {
  0xf0b7: "•", 0xf0a7: "▪", 0xf0a8: "□", 0xf0d8: "➢", 0xf0fc: "✓",
  0xf076: "❖", 0xf06f: "o", 0xf06e: "■", 0xf071: "❑", 0xf0e8: "➔",
  0xf0f0: "⇨", 0xf0a4: "●", 0xf09f: "•", 0xf02d: "-", 0xf0b2: "◊",
};

const ARABIC_ALPHA = "أبتثجحخدذرزسشصضطظعغفقكلمنهوي";
const ARABIC_ABJAD = "أبجدهوزحطيكلمنسعفصقرشتثخذضظغ";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function corrupt(message: string): never {
  throw new DocParseError("corrupt", message);
}

class Bytes {
  readonly view: DataView;
  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  get length() {
    return this.data.length;
  }
  has(offset: number, size: number) {
    return offset >= 0 && size >= 0 && offset + size <= this.data.length;
  }
  u8(o: number) {
    if (!this.has(o, 1)) corrupt("u8 out of range");
    return this.data[o];
  }
  u16(o: number) {
    if (!this.has(o, 2)) corrupt("u16 out of range");
    return this.view.getUint16(o, true);
  }
  i16(o: number) {
    if (!this.has(o, 2)) corrupt("i16 out of range");
    return this.view.getInt16(o, true);
  }
  u32(o: number) {
    if (!this.has(o, 4)) corrupt("u32 out of range");
    return this.view.getUint32(o, true);
  }
  i32(o: number) {
    if (!this.has(o, 4)) corrupt("i32 out of range");
    return this.view.getInt32(o, true);
  }
  slice(o: number, len: number) {
    if (!this.has(o, len)) corrupt("slice out of range");
    return this.data.subarray(o, o + len);
  }
}

function opU16(op: Uint8Array, o = 0) {
  return o + 2 <= op.length ? op[o] | (op[o + 1] << 8) : 0;
}

function opI16(op: Uint8Array, o = 0) {
  const v = opU16(op, o);
  return v & 0x8000 ? v - 0x10000 : v;
}

function opU32(op: Uint8Array, o = 0) {
  return o + 4 <= op.length
    ? (op[o] | (op[o + 1] << 8) | (op[o + 2] << 16) | (op[o + 3] << 24)) >>> 0
    : 0;
}

function opI32(op: Uint8Array, o = 0) {
  return opU32(op, o) | 0;
}

function toggle(op: number, base: boolean): boolean {
  if (op === 0) return false;
  if (op === 1) return true;
  if (op === 0x80) return base;
  if (op === 0x81) return !base;
  return base;
}

function hex2(n: number) {
  return n.toString(16).padStart(2, "0").toUpperCase();
}

/** COLORREF (r, g, b, fAuto) → RRGGBB, null when automatic. */
function colorRef(op: Uint8Array, o = 0): string | null {
  if (o + 4 > op.length) return null;
  if (op[o + 3] === 0xff) return null;
  return hex2(op[o]) + hex2(op[o + 1]) + hex2(op[o + 2]);
}

/** Walk a grpprl, invoking `cb` with each sprm and its operand bytes. */
function forEachSprm(
  g: Uint8Array,
  cb: (sprm: number, op: Uint8Array) => void,
) {
  let pos = 0;
  while (pos + 2 <= g.length) {
    const sprm = g[pos] | (g[pos + 1] << 8);
    pos += 2;
    const spra = sprm >>> 13;
    let start = pos;
    let len: number;
    if (spra === 0 || spra === 1) len = 1;
    else if (spra === 2 || spra === 4 || spra === 5) len = 2;
    else if (spra === 3) len = 4;
    else if (spra === 7) len = 3;
    else if (sprm === 0xd608 || sprm === 0xd606) {
      if (pos + 2 > g.length) return;
      len = (g[pos] | (g[pos + 1] << 8)) - 1;
      start = pos + 2;
    } else if (sprm === 0xc615 && g[pos] === 255) {
      let d = pos + 1;
      if (d >= g.length) return;
      d += 1 + g[d] * 4;
      if (d >= g.length) return;
      d += 1 + g[d] * 3;
      start = pos + 1;
      len = d - start;
    } else {
      if (pos >= g.length) return;
      len = g[pos];
      start = pos + 1;
    }
    if (len < 0 || start + len > g.length) return;
    cb(sprm, g.subarray(start, start + len));
    pos = start + len;
  }
}

function parseBrc80(op: Uint8Array, o: number): Border | null | undefined {
  if (o + 4 > op.length) return undefined;
  const raw = opU32(op, o);
  if (raw === 0xffffffff) return null;
  if (raw === 0) return undefined;
  const type = op[o + 1];
  if (type === 0 || type === 0xff) return null;
  return { type, width: op[o] || 4, color: ICO_COLORS[op[o + 2]] ?? null };
}

function parseBrc(op: Uint8Array, o: number): Border | null | undefined {
  if (o + 8 > op.length) return undefined;
  if (opU32(op, o) === 0xffffffff && opU32(op, o + 4) === 0xffffffff) {
    return null;
  }
  const type = op[o + 5];
  if (type === 0 && op[o + 4] === 0) return undefined;
  if (type === 0 || type === 0xff) return null;
  return { type, width: op[o + 4] || 4, color: colorRef(op, o) };
}

/** Blend a Word shading pattern into a single fill colour. */
function shadingFill(
  fore: string | null,
  back: string | null,
  ipat: number,
): string | null {
  const pct: Record<number, number> = {
    1: 100, 2: 5, 3: 10, 4: 20, 5: 25, 6: 30, 7: 40, 8: 50, 9: 60, 10: 70,
    11: 75, 12: 80, 13: 90, 35: 2.5, 36: 7.5, 37: 12.5, 38: 15, 39: 17.5,
    40: 22.5, 41: 27.5, 42: 32.5, 43: 35, 44: 37.5, 45: 42.5, 46: 45,
    47: 47.5, 48: 52.5, 49: 55, 50: 57.5, 51: 62.5, 52: 65, 53: 67.5,
    54: 72.5, 55: 77.5, 56: 82.5, 57: 85, 58: 87.5, 59: 92.5, 60: 95,
    61: 97.5, 62: 97,
  };
  if (ipat === 0) return back;
  const p = pct[ipat];
  if (p === undefined) return back;
  const f = fore ?? "000000";
  const b = back ?? "FFFFFF";
  const mix = (i: number) => {
    const fv = parseInt(f.slice(i, i + 2), 16);
    const bv = parseInt(b.slice(i, i + 2), 16);
    return hex2(Math.round(bv + ((fv - bv) * p) / 100));
  };
  return mix(0) + mix(2) + mix(4);
}

function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const map: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of map) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

function toLetters(n: number, alphabet: string): string {
  if (n <= 0) return String(n);
  const len = alphabet.length;
  const ch = alphabet[(n - 1) % len];
  return ch.repeat(Math.floor((n - 1) / len) + 1);
}

function formatNumber(n: number, nfc: number): string {
  switch (nfc) {
    case 1:
      return toRoman(n);
    case 2:
      return toRoman(n).toLowerCase();
    case 3:
      return toLetters(n, "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    case 4:
      return toLetters(n, "abcdefghijklmnopqrstuvwxyz");
    case 22:
      return n < 10 ? `0${n}` : String(n);
    case 45:
      return toLetters(n, ARABIC_ALPHA);
    case 47:
      return toLetters(n, ARABIC_ABJAD);
    case 53:
      return `- ${n} -`;
    case 255:
      return "";
    default:
      return String(n);
  }
}

function mapSymbol(code: number): string {
  if (code >= 0xf000 && code <= 0xf0ff) {
    const mapped = SYMBOL_MAP[code];
    if (mapped) return mapped;
    const low = code - 0xf000;
    return low >= 0x20 && low < 0x7f ? String.fromCharCode(low) : "•";
  }
  return String.fromCharCode(code);
}

function lowerBound(runs: FkpRun[], pos: number): number {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const r = runs[mid];
    if (pos < r.start) hi = mid - 1;
    else if (pos >= r.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function isContentfulParagraph(p: ParagraphBlock) {
  return p.tokens.some(
    (t) =>
      t.kind === "image" ||
      t.kind === "pageBreak" ||
      (t.kind === "text" && t.text.trim().length > 0),
  );
}

function emptyParagraph(): ParagraphBlock {
  return {
    kind: "paragraph",
    align: null,
    bidi: false,
    spaceBefore: null,
    spaceAfter: null,
    line: null,
    lineRule: "auto",
    indentStart: null,
    indentEnd: null,
    indentFirst: null,
    keepNext: false,
    keepLines: false,
    pageBreakBefore: false,
    tokens: [],
  };
}

// ─── Parser ──────────────────────────────────────────────────────────────────

type FlatItem = {
  para: ParagraphBlock;
  fmt: ParaFormat;
  mark: "para" | "cell" | "row" | "skip";
};

type MarkInfo = { cp: number; fmt: ParaFormat; char: number };

class NumberingState {
  private readonly counters = new Map<number, (number | undefined)[]>();

  next(lfo: LfoDef, list: ListDef, ilvl: number): string {
    const levels = list.levels;
    const level = levels[Math.min(ilvl, levels.length - 1)];
    if (!level) return "";
    let counters = this.counters.get(lfo.lsid);
    if (!counters) {
      counters = new Array<number | undefined>(9).fill(undefined);
      this.counters.set(lfo.lsid, counters);
    }
    const current = counters[ilvl];
    counters[ilvl] =
      current === undefined
        ? (lfo.startOverrides.get(ilvl) ?? level.startAt)
        : current + 1;
    for (let k = ilvl + 1; k < 9; k += 1) counters[k] = undefined;

    let out = "";
    for (const code of level.xst) {
      if (code < 9) {
        const lvl = levels[Math.min(code, levels.length - 1)];
        const value = counters[code] ?? lvl?.startAt ?? 1;
        const nfc = level.legal ? 0 : (lvl?.nfc ?? 0);
        out += formatNumber(value, nfc);
      } else {
        out += mapSymbol(code);
      }
    }
    return out;
  }
}

export class Word97Parser {
  private readonly wd: Bytes;
  private readonly table: Bytes;
  private readonly dataStream: Bytes;
  private readonly fcLcbBase: number;
  private readonly fcLcbCount: number;
  private readonly ccp: {
    text: number;
    ftn: number;
    hdd: number;
  };
  private readonly pieces: Piece[];
  private readonly prcs: Uint8Array[];
  private readonly text: Uint16Array;
  private readonly chpxRuns: FkpRun[];
  private readonly papxRuns: FkpRun[];
  private readonly fonts: string[];
  private readonly styles: (StyleDef | null)[];
  private readonly defaultFtc: [number, number, number, number];
  private readonly lists = new Map<number, ListDef>();
  private readonly lfos: LfoDef[] = [];
  private readonly styleCharCache = new Map<number, CharFormat>();
  private readonly styleParaCache = new Map<number, ParaFormat>();
  private readonly runStyleCache = new Map<string, RunStyle>();
  private readonly blipCache = new Map<number, RawImage | null>();
  private bstore: { offset: number; length: number; inWd: boolean }[] = [];
  private spidToPib = new Map<number, number>();
  private imageCount = 0;
  private pieceCursor = 0;

  constructor(bytes: Uint8Array) {
    const cfb = new CfbReader(bytes);
    const wdStream = cfb.getStream("WordDocument");
    if (!wdStream) {
      throw new DocParseError("not_word", "No WordDocument stream (not a Word file)");
    }
    this.wd = new Bytes(wdStream);

    const wIdent = this.wd.u16(0);
    if (wIdent === 0xa5dc) {
      throw new DocParseError(
        "unsupported_version",
        "Word 6/95 documents are not supported",
      );
    }
    if (wIdent !== 0xa5ec) {
      throw new DocParseError("not_word", "Bad FIB signature");
    }
    const nFib = this.wd.u16(2);
    const flags = this.wd.u16(0x0a);
    if (flags & 0x0100) {
      throw new DocParseError("encrypted", "Document is password protected");
    }
    if (nFib < 0x00c1) {
      throw new DocParseError(
        "unsupported_version",
        "Word 95 and older documents are not supported",
      );
    }

    const tableStream = cfb.getStream(flags & 0x0200 ? "1Table" : "0Table");
    if (!tableStream) corrupt("Missing table stream");
    this.table = new Bytes(tableStream);
    this.dataStream = new Bytes(cfb.getStream("Data") ?? new Uint8Array(0));

    const csw = this.wd.u16(0x20);
    const rgLw = 0x22 + csw * 2;
    const cslw = this.wd.u16(rgLw);
    const lw = rgLw + 2;
    this.ccp = {
      text: Math.max(0, this.wd.i32(lw + 3 * 4)),
      ftn: Math.max(0, this.wd.i32(lw + 4 * 4)),
      hdd: Math.max(0, this.wd.i32(lw + 5 * 4)),
    };
    this.fcLcbCount = this.wd.u16(lw + cslw * 4);
    this.fcLcbBase = lw + cslw * 4 + 2;

    const { pieces, prcs } = this.readPieces();
    this.pieces = pieces;
    this.prcs = prcs;
    this.text = this.decodeText();
    // Formatting is best-effort: damaged FKPs/styles degrade to plain text.
    this.chpxRuns = this.safely(() => this.readChpxRuns()) ?? [];
    this.papxRuns = this.safely(() => this.readPapxRuns()) ?? [];
    this.fonts = this.safely(() => this.readFonts()) ?? [];
    const stsh = this.safely(() => this.readStyles()) ?? {
      styles: [],
      ftc: [0, 0, 0, 0] as [number, number, number, number],
    };
    this.styles = stsh.styles;
    this.defaultFtc = stsh.ftc;
    this.safely(() => this.readLists());
    this.safely(() => this.readOfficeArt());
  }

  parse(): DocModel {
    const numbering = new NumberingState();
    const sections = this.readSections();
    const hdd = this.readHeaderStories();
    const spaMain = this.safely(() => this.readSpa(40)) ?? new Map();
    const spaHdr = this.safely(() => this.readSpa(41)) ?? new Map();
    const hdrBase = this.ccp.text + this.ccp.ftn;

    const out: SectionModel[] = [];
    sections.forEach((sec, idx) => {
      const blocks = this.buildRange(sec.cpStart, sec.cpEnd, spaMain, 0, numbering);
      const story = (i: number): Block[] | null => {
        const range = hdd[6 + idx * 6 + i];
        if (!range) return null;
        const local = new NumberingState();
        const built = this.buildRange(
          hdrBase + range[0],
          hdrBase + range[1],
          spaHdr,
          hdrBase,
          local,
        );
        while (built.length > 0) {
          const last = built[built.length - 1];
          if (last.kind === "paragraph" && !isContentfulParagraph(last)) {
            built.pop();
          } else break;
        }
        return built.length > 0 ? built : null;
      };
      out.push({
        ...sec.page,
        headers: { default: story(1), first: sec.page.titlePage ? story(4) : null },
        footers: { default: story(3), first: sec.page.titlePage ? story(5) : null },
        blocks: blocks.length > 0 ? blocks : [emptyParagraph()],
      });
    });

    let paragraphs = 0;
    let tables = 0;
    for (const s of out) {
      for (const b of s.blocks) {
        if (b.kind === "table") tables += 1;
        else paragraphs += 1;
      }
    }

    return {
      sections: out,
      defaultStyle: this.toRunStyle(this.styleChar(0)),
      stats: { paragraphs, tables, images: this.imageCount },
    };
  }

  // ── FIB / low level ──

  private fcLcb(index: number): { fc: number; lcb: number } {
    if (index >= this.fcLcbCount) return { fc: 0, lcb: 0 };
    const o = this.fcLcbBase + index * 8;
    return { fc: this.wd.u32(o), lcb: this.wd.u32(o + 4) };
  }

  private tableSlice(index: number): Bytes | null {
    const { fc, lcb } = this.fcLcb(index);
    if (lcb === 0 || !this.table.has(fc, lcb)) return null;
    return new Bytes(this.table.slice(fc, lcb));
  }

  private safely<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch (err) {
      if (err instanceof DocParseError && err.code !== "corrupt") throw err;
      return undefined;
    }
  }

  // ── Text ──

  private readPieces(): { pieces: Piece[]; prcs: Uint8Array[] } {
    const clx = this.tableSlice(33);
    if (!clx) corrupt("Missing piece table");
    const prcs: Uint8Array[] = [];
    let pos = 0;
    let plc: Bytes | null = null;
    while (pos < clx.length) {
      const clxt = clx.u8(pos);
      if (clxt === 1) {
        const cb = clx.i16(pos + 1);
        if (cb < 0) corrupt("Bad Prc size");
        prcs.push(clx.slice(pos + 3, cb));
        pos += 3 + cb;
      } else if (clxt === 2) {
        const lcb = clx.u32(pos + 1);
        plc = new Bytes(clx.slice(pos + 5, lcb));
        break;
      } else {
        corrupt("Bad Clx entry");
      }
    }
    if (!plc || plc.length < 4 || (plc.length - 4) % 12 !== 0) {
      corrupt("Bad piece table");
    }
    const n = (plc.length - 4) / 12;
    const pieces: Piece[] = [];
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      const cpStart = plc.u32(i * 4);
      const cpEnd = plc.u32((i + 1) * 4);
      if (cpEnd < cpStart) corrupt("Piece CPs out of order");
      if (cpEnd > MAX_TEXT_CHARS) corrupt("Document text too large");
      const pcd = 4 * (n + 1) + i * 8;
      const fcRaw = plc.u32(pcd + 2);
      const compressed = (fcRaw & 0x40000000) !== 0;
      const fc = fcRaw & 0x3fffffff;
      const byteStart = compressed ? fc / 2 : fc;
      total += cpEnd - cpStart;
      if (total > MAX_TEXT_CHARS) corrupt("Document text too large");
      pieces.push({ cpStart, cpEnd, byteStart, compressed, prm: plc.u16(pcd + 6) });
    }
    return { pieces, prcs };
  }

  private decodeText(): Uint16Array {
    const last = this.pieces[this.pieces.length - 1];
    const total = last ? last.cpEnd : 0;
    const out = new Uint16Array(total);
    const data = this.wd.data;
    for (const p of this.pieces) {
      for (let cp = p.cpStart; cp < p.cpEnd; cp += 1) {
        const k = cp - p.cpStart;
        if (p.compressed) {
          const b = p.byteStart + k;
          if (b >= data.length) break;
          const v = data[b];
          out[cp] = v >= 0x80 && v <= 0x9f ? (CP1252_HIGH[v - 0x80] ?? v) : v;
        } else {
          const b = p.byteStart + k * 2;
          if (b + 1 >= data.length) break;
          out[cp] = data[b] | (data[b + 1] << 8);
        }
      }
    }
    return out;
  }

  private pieceIndexForCp(cp: number): number {
    const pieces = this.pieces;
    const cur = pieces[this.pieceCursor];
    if (cur && cp >= cur.cpStart && cp < cur.cpEnd) return this.pieceCursor;
    let lo = 0;
    let hi = pieces.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const p = pieces[mid];
      if (cp < p.cpStart) hi = mid - 1;
      else if (cp >= p.cpEnd) lo = mid + 1;
      else {
        this.pieceCursor = mid;
        return mid;
      }
    }
    return -1;
  }

  private byteOfCp(cp: number, pieceIdx: number): number {
    const p = this.pieces[pieceIdx];
    return p.byteStart + (cp - p.cpStart) * (p.compressed ? 1 : 2);
  }

  // ── FKPs ──

  private readBteRuns(index: number, kind: "chpx" | "papx"): FkpRun[] {
    const plc = this.tableSlice(index);
    if (!plc || plc.length < 4 || (plc.length - 4) % 8 !== 0) return [];
    const n = (plc.length - 4) / 8;
    const runs: FkpRun[] = [];
    const seenPages = new Set<number>();
    for (let i = 0; i < n; i += 1) {
      const pn = plc.u32(4 * (n + 1) + i * 4) & 0x3fffff;
      if (seenPages.has(pn)) continue;
      seenPages.add(pn);
      const off = pn * 512;
      if (!this.wd.has(off, 512)) continue;
      const page = new Bytes(this.wd.slice(off, 512));
      const count = page.u8(511);
      if (kind === "chpx") {
        if (4 * (count + 1) + count > 511) continue;
        for (let j = 0; j < count; j += 1) {
          const start = page.u32(j * 4);
          const end = page.u32((j + 1) * 4);
          const rgb = page.u8(4 * (count + 1) + j);
          let grpprl: Uint8Array = new Uint8Array(0);
          if (rgb !== 0) {
            const at = rgb * 2;
            const cb = page.u8(at);
            if (page.has(at + 1, cb)) grpprl = page.slice(at + 1, cb);
          }
          if (end > start) runs.push({ start, end, istd: 0, grpprl });
        }
      } else {
        if (4 * (count + 1) + 13 * count > 511) continue;
        for (let j = 0; j < count; j += 1) {
          const start = page.u32(j * 4);
          const end = page.u32((j + 1) * 4);
          const bOffset = page.u8(4 * (count + 1) + j * 13);
          let istd = 0;
          let grpprl: Uint8Array = new Uint8Array(0);
          if (bOffset !== 0) {
            const at = bOffset * 2;
            const cb = page.u8(at);
            let dataAt: number;
            let len: number;
            if (cb !== 0) {
              dataAt = at + 1;
              len = cb * 2 - 1;
            } else {
              dataAt = at + 2;
              len = page.u8(at + 1) * 2;
            }
            if (len >= 2 && page.has(dataAt, len)) {
              istd = page.u16(dataAt);
              grpprl = page.slice(dataAt + 2, len - 2);
            }
          }
          if (end > start) runs.push({ start, end, istd, grpprl });
        }
      }
    }
    runs.sort((a, b) => a.start - b.start);
    return runs;
  }

  private readChpxRuns() {
    return this.readBteRuns(12, "chpx");
  }

  private readPapxRuns() {
    return this.readBteRuns(13, "papx");
  }

  // ── Fonts & styles ──

  private readFonts(): string[] {
    const sttb = this.safely(() => this.tableSlice(15));
    if (!sttb || sttb.length < 4) return [];
    const fonts: string[] = [];
    const count = sttb.u16(0);
    if (count === 0xffff) return [];
    let pos = 4;
    for (let i = 0; i < count && pos < sttb.length; i += 1) {
      const cch = sttb.u8(pos);
      const ffn = pos + 1;
      let name = "";
      for (let o = ffn + 39; o + 1 < ffn + cch && o + 1 < sttb.length; o += 2) {
        const c = sttb.u16(o);
        if (c === 0) break;
        name += String.fromCharCode(c);
      }
      fonts.push(name.trim());
      pos = ffn + cch;
    }
    return fonts;
  }

  private readStyles(): {
    styles: (StyleDef | null)[];
    ftc: [number, number, number, number];
  } {
    const stsh = this.tableSlice(1);
    const ftc: [number, number, number, number] = [0, 0, 0, 0];
    if (!stsh || stsh.length < 2) return { styles: [], ftc };
    const cbStshi = stsh.u16(0);
    const cstd = stsh.u16(2);
    const cbBase = stsh.u16(4);
    if (cbStshi >= 18) {
      ftc[0] = stsh.u16(14);
      ftc[1] = stsh.u16(16);
      ftc[2] = stsh.u16(18);
    }
    if (cbStshi >= 20) ftc[3] = stsh.u16(20);

    const styles: (StyleDef | null)[] = [];
    let pos = 2 + cbStshi;
    for (let i = 0; i < cstd && pos + 2 <= stsh.length; i += 1) {
      const cbStd = stsh.u16(pos);
      pos += 2;
      if (cbStd === 0 || !stsh.has(pos, cbStd)) {
        styles.push(null);
        pos += cbStd;
        continue;
      }
      const std = new Bytes(stsh.slice(pos, cbStd));
      pos += cbStd;
      styles.push(this.safely(() => this.parseStd(std, cbBase)) ?? null);
    }
    return { styles, ftc };
  }

  private parseStd(std: Bytes, cbBase: number): StyleDef {
    const w2 = std.u16(2);
    const w3 = std.u16(4);
    const stk = w2 & 0x0f;
    const base = w2 >> 4;
    const cupx = w3 & 0x0f;
    let off = cbBase;
    const cch = std.u16(off);
    off += 2 + cch * 2 + 2;
    const upx: Uint8Array[] = [];
    for (let k = 0; k < cupx && off + 2 <= std.length; k += 1) {
      const cb = std.u16(off);
      off += 2;
      upx.push(std.has(off, cb) ? std.slice(off, cb) : new Uint8Array(0));
      off += cb + (cb & 1);
    }
    let papx: Uint8Array | null = null;
    let chpx: Uint8Array | null = null;
    if (stk === 1) {
      papx = upx[0] && upx[0].length >= 2 ? upx[0].subarray(2) : null;
      chpx = upx[1] ?? null;
    } else if (stk === 2) {
      chpx = upx[0] ?? null;
    } else if (stk === 3) {
      papx = upx[1] && upx[1].length >= 2 ? upx[1].subarray(2) : null;
      chpx = upx[2] ?? null;
    }
    return { stk, base, papx, chpx };
  }

  private styleChain(istd: number): StyleDef[] {
    const chain: StyleDef[] = [];
    let cur = istd;
    for (let depth = 0; depth < MAX_STYLE_DEPTH && cur !== ISTD_NIL; depth += 1) {
      const s = this.styles[cur];
      if (!s) break;
      chain.unshift(s);
      cur = s.base;
    }
    return chain;
  }

  private defaultChar(): CharFormat {
    return {
      bold: false,
      italic: false,
      boldBi: false,
      italicBi: false,
      strike: false,
      dstrike: false,
      caps: false,
      smallCaps: false,
      vanish: false,
      deleted: false,
      rtl: false,
      spec: false,
      underline: 0,
      hps: 20,
      hpsBi: 20,
      ftcAscii: this.defaultFtc[0],
      ftcFE: this.defaultFtc[1],
      ftcOther: this.defaultFtc[2],
      ftcBi: this.defaultFtc[3],
      color: null,
      highlight: 0,
      iss: 0,
      picLocation: -1,
      symbol: 0,
    };
  }

  private defaultPara(istd: number): ParaFormat {
    return {
      istd,
      jcLogical: null,
      jcPhysical: null,
      bidi: false,
      before: null,
      after: null,
      lineDya: null,
      lineMult: true,
      indStart: null,
      indEnd: null,
      indFirst: null,
      keepNext: false,
      keepLines: false,
      pageBreakBefore: false,
      inTable: false,
      ttp: false,
      innerTtp: false,
      itap: 0,
      ilfo: 0,
      ilvl: 0,
      table: null,
    };
  }

  private styleChar(istd: number): CharFormat {
    const cached = this.styleCharCache.get(istd);
    if (cached) return cached;
    const props = this.defaultChar();
    for (const s of this.styleChain(istd)) {
      if (s.chpx) this.applyGrpprl(s.chpx, props, null);
    }
    this.styleCharCache.set(istd, props);
    return props;
  }

  private stylePara(istd: number): ParaFormat {
    const cached = this.styleParaCache.get(istd);
    if (cached) return cached;
    const props = this.defaultPara(istd);
    for (const s of this.styleChain(istd)) {
      if (s.papx) this.applyGrpprl(s.papx, null, props);
    }
    props.istd = istd;
    this.styleParaCache.set(istd, props);
    return props;
  }

  // ── Sprm application ──

  private applyGrpprl(
    g: Uint8Array,
    chr: CharFormat | null,
    para: ParaFormat | null,
    depth = 0,
  ) {
    let base = chr ? { ...chr } : null;
    forEachSprm(g, (sprm, op) => {
      const sgc = (sprm >> 10) & 7;
      if (sgc === 2 && chr && base) {
        if (sprm === 0x4a30) {
          const istd = opU16(op);
          const s = this.styles[istd];
          if (s && s.stk === 2) {
            for (const st of this.styleChain(istd)) {
              if (st.chpx) this.applyGrpprl(st.chpx, chr, null, depth + 1);
            }
            base = { ...chr };
          }
          return;
        }
        this.applyChar(chr, base, sprm, op);
      } else if ((sgc === 1 || sgc === 5) && para) {
        if (sprm === 0x6646 && depth === 0) {
          const fc = opU32(op);
          if (this.dataStream.has(fc, 2)) {
            const cb = this.dataStream.u16(fc);
            if (this.dataStream.has(fc + 2, cb)) {
              this.applyGrpprl(this.dataStream.slice(fc + 2, cb), null, para, 1);
            }
          }
          return;
        }
        if (sgc === 1) this.applyPara(para, sprm, op);
        else this.applyTable(para, sprm, op);
      }
    });
  }

  private applyChar(c: CharFormat, base: CharFormat, sprm: number, op: Uint8Array) {
    const b = op[0] ?? 0;
    switch (sprm) {
      case 0x0835: c.bold = toggle(b, base.bold); break;
      case 0x0836: c.italic = toggle(b, base.italic); break;
      case 0x0837: c.strike = toggle(b, base.strike); break;
      case 0x2a53: c.dstrike = toggle(b, base.dstrike); break;
      case 0x083a: c.smallCaps = toggle(b, base.smallCaps); break;
      case 0x083b: c.caps = toggle(b, base.caps); break;
      case 0x083c: c.vanish = toggle(b, base.vanish); break;
      case 0x085c: c.boldBi = toggle(b, base.boldBi); break;
      case 0x085d: c.italicBi = toggle(b, base.italicBi); break;
      case 0x085a: c.rtl = b !== 0; break;
      case 0x0800: c.deleted = b !== 0; break;
      case 0x0855: c.spec = b !== 0; break;
      case 0x6a03: c.picLocation = opU32(op); break;
      case 0x6a09: c.symbol = opU16(op, 2); break;
      case 0x2a3e: c.underline = b; break;
      case 0x2a42: c.color = ICO_COLORS[b] ?? null; break;
      case 0x6870: c.color = colorRef(op); break;
      case 0x2a0c: c.highlight = b; break;
      case 0x4a43: c.hps = opU16(op) || c.hps; break;
      case 0x4a61: c.hpsBi = opU16(op) || c.hpsBi; break;
      case 0x4a4f: c.ftcAscii = opU16(op); break;
      case 0x4a50: c.ftcFE = opU16(op); break;
      case 0x4a51: c.ftcOther = opU16(op); break;
      case 0x4a5e: c.ftcBi = opU16(op); break;
      case 0x2a48: c.iss = b; break;
      case 0x2a33: {
        const keepSpec = c.spec;
        const keepPic = c.picLocation;
        Object.assign(c, this.defaultChar(), { spec: keepSpec, picLocation: keepPic });
        break;
      }
      default:
        break;
    }
  }

  private applyPara(p: ParaFormat, sprm: number, op: Uint8Array) {
    const b = op[0] ?? 0;
    switch (sprm) {
      case 0x2403: p.jcPhysical = b; break;
      case 0x2461: p.jcLogical = b; break;
      case 0x2441: p.bidi = b !== 0; break;
      case 0x2405: p.keepNext = b !== 0; break;
      case 0x2406: p.keepLines = b !== 0; break;
      case 0x2407: p.pageBreakBefore = b !== 0; break;
      case 0x840e:
      case 0x845d: p.indEnd = opI16(op); break;
      case 0x840f:
      case 0x845e: p.indStart = opI16(op); break;
      case 0x8411:
      case 0x8460: p.indFirst = opI16(op); break;
      case 0xa413: p.before = opU16(op); break;
      case 0xa414: p.after = opU16(op); break;
      case 0x6412:
        p.lineDya = opI16(op);
        p.lineMult = opI16(op, 2) === 1;
        break;
      case 0x2416: p.inTable = b !== 0; break;
      case 0x2417: p.ttp = b !== 0; break;
      case 0x244c: p.innerTtp = b !== 0; break;
      case 0x6649: p.itap = Math.max(0, opI32(op)); break;
      case 0x664a: p.itap = Math.max(0, p.itap + opI32(op)); break;
      case 0x460b: p.ilfo = opI16(op); break;
      case 0x260a: p.ilvl = Math.min(8, b); break;
      default:
        break;
    }
  }

  private ensureTable(p: ParaFormat): TableFormat {
    if (!p.table) {
      p.table = {
        centers: [],
        tcs: [],
        bidi: false,
        jc: 0,
        borders: null,
        shading: [],
        rowHeight: 0,
        header: false,
      };
    }
    return p.table;
  }

  private applyTable(p: ParaFormat, sprm: number, op: Uint8Array) {
    switch (sprm) {
      case 0xd608: {
        const t = this.ensureTable(p);
        const itcMac = op[0] ?? 0;
        if (itcMac === 0 || itcMac > 63) return;
        const centers: number[] = [];
        for (let i = 0; i <= itcMac; i += 1) {
          if (1 + i * 2 + 2 > op.length) return;
          centers.push(opI16(op, 1 + i * 2));
        }
        const tcStart = 1 + (itcMac + 1) * 2;
        const tcs: TcFormat[] = [];
        for (let i = 0; i < itcMac; i += 1) {
          const o = tcStart + i * 20;
          if (o + 20 > op.length) {
            tcs.push({ horzMerge: 0, vertMerge: 0, vAlign: 0, top: undefined, left: undefined, bottom: undefined, right: undefined });
            continue;
          }
          const grf = opU16(op, o);
          tcs.push({
            horzMerge: grf & 3,
            vertMerge: (grf >> 5) & 3,
            vAlign: (grf >> 7) & 3,
            top: parseBrc80(op, o + 4),
            left: parseBrc80(op, o + 8),
            bottom: parseBrc80(op, o + 12),
            right: parseBrc80(op, o + 16),
          });
        }
        t.centers = centers;
        t.tcs = tcs;
        break;
      }
      case 0xd605:
      case 0xd613: {
        const t = this.ensureTable(p);
        const size = sprm === 0xd605 ? 4 : 8;
        const read = (i: number) =>
          (sprm === 0xd605 ? parseBrc80(op, i * size) : parseBrc(op, i * size)) ?? null;
        t.borders = {
          top: read(0),
          left: read(1),
          bottom: read(2),
          right: read(3),
          insideH: read(4),
          insideV: read(5),
        };
        break;
      }
      case 0x560b: this.ensureTable(p).bidi = opU16(op) !== 0; break;
      case 0x5400:
      case 0x548a: this.ensureTable(p).jc = opU16(op) & 3; break;
      case 0x9407: this.ensureTable(p).rowHeight = opI16(op); break;
      case 0x3404: this.ensureTable(p).header = (op[0] ?? 0) !== 0; break;
      case 0xd609: {
        const t = this.ensureTable(p);
        for (let i = 0; i * 2 + 2 <= op.length; i += 1) {
          const shd = opU16(op, i * 2);
          t.shading[i] = shadingFill(
            ICO_COLORS[shd & 0x1f] ?? null,
            ICO_COLORS[(shd >> 5) & 0x1f] ?? null,
            (shd >> 10) & 0x3f,
          );
        }
        break;
      }
      case 0xd612:
      case 0xd616:
      case 0xd60c: {
        const t = this.ensureTable(p);
        const offset = sprm === 0xd612 ? 0 : sprm === 0xd616 ? 22 : 44;
        for (let i = 0; i * 10 + 10 <= op.length; i += 1) {
          const o = i * 10;
          t.shading[offset + i] = shadingFill(
            colorRef(op, o),
            colorRef(op, o + 4),
            opU16(op, o + 8),
          );
        }
        break;
      }
      case 0xd62b: {
        const t = this.ensureTable(p);
        const tc = t.tcs[op[0] ?? 255];
        if (tc) tc.vertMerge = op[1] ?? 0;
        break;
      }
      case 0xd62c: {
        const t = this.ensureTable(p);
        const first = op[0] ?? 0;
        const lim = op[1] ?? 0;
        for (let i = first; i < lim && i < t.tcs.length; i += 1) {
          t.tcs[i].vAlign = op[2] ?? 0;
        }
        break;
      }
      case 0xd620:
      case 0xd62f: {
        const t = this.ensureTable(p);
        const first = op[0] ?? 0;
        const lim = op[1] ?? 0;
        const which = op[2] ?? 0;
        const brc = sprm === 0xd620 ? parseBrc80(op, 3) : parseBrc(op, 3);
        if (brc === undefined) return;
        for (let i = first; i < lim && i < t.tcs.length; i += 1) {
          const tc = t.tcs[i];
          if (which & 1) tc.top = brc;
          if (which & 2) tc.left = brc;
          if (which & 4) tc.bottom = brc;
          if (which & 8) tc.right = brc;
        }
        break;
      }
      default:
        break;
    }
  }

  // ── Paragraph / run resolution ──

  private paraFormatAt(cp: number): ParaFormat {
    const pi = this.pieceIndexForCp(cp);
    if (pi < 0) return this.stylePara(0);
    const pos = this.byteOfCp(cp, pi);
    const idx = lowerBound(this.papxRuns, pos);
    const run = idx >= 0 ? this.papxRuns[idx] : null;
    const istd = run?.istd ?? 0;
    const direct = run?.grpprl ?? new Uint8Array(0);
    const prm = this.complexPrm(pi);

    const build = (listPapx: Uint8Array | null) => {
      const props = structuredCloneFormat(this.stylePara(istd));
      props.istd = istd;
      if (listPapx) this.applyGrpprl(listPapx, null, props);
      this.applyGrpprl(direct, null, props);
      if (prm) this.applyGrpprl(prm, null, props);
      return props;
    };

    const first = build(null);
    if (first.ilfo > 0) {
      const level = this.listLevel(first.ilfo, first.ilvl);
      if (level && level.papx.length > 0) return build(level.papx);
    }
    return first;
  }

  private complexPrm(pieceIdx: number): Uint8Array | null {
    const prm = this.pieces[pieceIdx]?.prm ?? 0;
    if ((prm & 1) === 0) return null;
    return this.prcs[prm >> 1] ?? null;
  }

  private charFormat(chpxIdx: number, pieceIdx: number, istd: number): CharFormat {
    const props = { ...this.styleChar(istd) };
    if (chpxIdx >= 0) this.applyGrpprl(this.chpxRuns[chpxIdx].grpprl, props, null);
    const prm = this.complexPrm(pieceIdx);
    if (prm) this.applyGrpprl(prm, props, null);
    return props;
  }

  private fontName(index: number): string | null {
    const name = this.fonts[index];
    return name ? name : null;
  }

  private toRunStyle(c: CharFormat): RunStyle {
    const key = [
      +c.bold, +c.italic, +c.boldBi, +c.italicBi, +c.strike, +c.dstrike,
      +c.caps, +c.smallCaps, c.underline, c.hps, c.hpsBi, c.ftcAscii,
      c.ftcOther, c.ftcFE, c.ftcBi, c.color ?? "", c.highlight, c.iss, +c.rtl,
    ].join("|");
    const cached = this.runStyleCache.get(key);
    if (cached) return cached;
    const style: RunStyle = {
      bold: c.bold,
      italic: c.italic,
      boldBi: c.boldBi,
      italicBi: c.italicBi,
      strike: c.strike,
      doubleStrike: c.dstrike,
      caps: c.caps,
      smallCaps: c.smallCaps,
      underline: c.underline,
      size: Math.min(3276, Math.max(2, c.hps)),
      sizeBi: Math.min(3276, Math.max(2, c.hpsBi)),
      fontAscii: this.fontName(c.ftcAscii),
      fontOther: this.fontName(c.ftcOther),
      fontEastAsia: this.fontName(c.ftcFE),
      fontBi: this.fontName(c.ftcBi),
      color: c.color,
      highlight: c.highlight,
      vertAlign: c.iss === 1 || c.iss === 2 ? c.iss : 0,
      rtl: c.rtl,
    };
    this.runStyleCache.set(key, style);
    return style;
  }

  // ── Lists ──

  private listLevel(ilfo: number, ilvl: number): ListLevel | null {
    const lfo = this.lfos[ilfo - 1];
    if (!lfo) return null;
    const list = this.lists.get(lfo.lsid);
    if (!list) return null;
    return list.levels[Math.min(ilvl, list.levels.length - 1)] ?? null;
  }

  private readLvl(t: Bytes, pos: number): { level: ListLevel; next: number } {
    const startAt = t.i32(pos);
    const nfc = t.u8(pos + 4);
    const flags = t.u8(pos + 5);
    const follow = t.u8(pos + 15);
    const cbChpx = t.u8(pos + 24);
    const cbPapx = t.u8(pos + 25);
    let o = pos + 28;
    const papx = t.slice(o, cbPapx);
    o += cbPapx + cbChpx;
    const cch = t.u16(o);
    o += 2;
    const xst: number[] = [];
    for (let i = 0; i < cch; i += 1) xst.push(t.u16(o + i * 2));
    o += cch * 2;
    return {
      level: { startAt, nfc, legal: (flags & 4) !== 0, follow, xst, papx },
      next: o,
    };
  }

  private readLists() {
    const { fc, lcb } = this.fcLcb(73);
    if (lcb === 0 || !this.table.has(fc, 2)) return;
    const t = this.table;
    const cLst = t.i16(fc);
    if (cLst <= 0 || cLst > 4096) return;
    const heads: { lsid: number; simple: boolean }[] = [];
    for (let i = 0; i < cLst; i += 1) {
      const o = fc + 2 + i * 28;
      heads.push({ lsid: t.i32(o), simple: (t.u8(o + 26) & 1) !== 0 });
    }
    let pos = fc + 2 + cLst * 28;
    for (const head of heads) {
      const levels: ListLevel[] = [];
      const count = head.simple ? 1 : 9;
      for (let k = 0; k < count; k += 1) {
        const { level, next } = this.readLvl(t, pos);
        levels.push(level);
        pos = next;
      }
      this.lists.set(head.lsid, { levels });
    }

    const lfo = this.fcLcb(74);
    if (lfo.lcb === 0 || !t.has(lfo.fc, 4)) return;
    const lfoMac = t.i32(lfo.fc);
    if (lfoMac <= 0 || lfoMac > 32767) return;
    const defs: { lsid: number; clfolvl: number }[] = [];
    for (let i = 0; i < lfoMac; i += 1) {
      const o = lfo.fc + 4 + i * 16;
      defs.push({ lsid: t.i32(o), clfolvl: t.u8(o + 12) });
    }
    let p = lfo.fc + 4 + lfoMac * 16;
    for (const def of defs) {
      const startOverrides = new Map<number, number>();
      // Every LFOData starts with a 4-byte cp, even with no level overrides.
      p += 4;
      if (def.clfolvl > 0) {
        for (let k = 0; k < def.clfolvl; k += 1) {
          const startAt = t.i32(p);
          const grf = t.u32(p + 4);
          p += 8;
          const ilvl = grf & 0x0f;
          if (grf & 0x10) startOverrides.set(ilvl, startAt);
          if (grf & 0x20) p = this.readLvl(t, p).next;
        }
      }
      this.lfos.push({ lsid: def.lsid, startOverrides });
    }
  }

  // ── Pictures ──

  private readOfficeArt() {
    const art = this.tableSlice(50);
    if (!art) return;
    const blips: { offset: number; length: number; inWd: boolean }[] = [];
    const walk = (bytes: Bytes, start: number, end: number, depth: number, spid: number | null) => {
      let pos = start;
      let currentSpid = spid;
      while (pos + 8 <= end) {
        const verInst = bytes.u16(pos);
        const type = bytes.u16(pos + 2);
        const len = bytes.u32(pos + 4);
        const body = pos + 8;
        if (body + len > end || len > bytes.length) return;
        if ((verInst & 0x0f) === 0x0f) {
          if (depth < 16) walk(bytes, body, body + len, depth + 1, type === 0xf004 ? null : currentSpid);
        } else if (type === 0xf007 && len >= 36) {
          const cbName = bytes.u8(body + 33);
          const embedded = body + 36 + cbName;
          if (embedded + 8 <= body + len) {
            blips.push({ offset: art.data.byteOffset + embedded - this.table.data.byteOffset, length: body + len - embedded, inWd: false });
          } else {
            blips.push({ offset: bytes.u32(body + 28), length: bytes.u32(body + 20), inWd: true });
          }
        } else if (type === 0xf00a && len >= 8) {
          currentSpid = bytes.u32(body);
        } else if (type === 0xf00b && currentSpid !== null) {
          const count = verInst >> 4;
          for (let i = 0; i < count && body + i * 6 + 6 <= body + len; i += 1) {
            const opid = bytes.u16(body + i * 6);
            if ((opid & 0x3fff) === 0x0104) {
              this.spidToPib.set(currentSpid, bytes.u32(body + i * 6 + 2));
            }
          }
        }
        pos = body + len;
      }
    };
    // OfficeArtContent = DggContainer, then (dgglbl byte + DgContainer)*.
    if (art.length < 8) return;
    const dggEnd = Math.min(art.length, 8 + art.u32(4));
    walk(art, 0, dggEnd, 0, null);
    let pos = dggEnd;
    while (pos + 9 <= art.length) {
      pos += 1;
      const len = art.u32(pos + 4);
      const end = pos + 8 + len;
      if (end > art.length) break;
      walk(art, pos, end, 0, null);
      pos = end;
    }
    this.bstore = blips;
  }

  private readSpa(index: number): Map<number, Spa> {
    const plc = this.tableSlice(index);
    const out = new Map<number, Spa>();
    if (!plc || plc.length < 4 || (plc.length - 4) % 30 !== 0) return out;
    const n = (plc.length - 4) / 30;
    for (let i = 0; i < n; i += 1) {
      const cp = plc.u32(i * 4);
      const o = 4 * (n + 1) + i * 26;
      const spid = plc.u32(o);
      const w = plc.i32(o + 12) - plc.i32(o + 4);
      const h = plc.i32(o + 16) - plc.i32(o + 8);
      out.set(cp, { spid, widthTwips: Math.abs(w), heightTwips: Math.abs(h) });
    }
    return out;
  }

  /** Find the first JPEG/PNG BLIP record inside `[start, end)` of `src`. */
  private findBlip(src: Bytes, start: number, end: number): RawImage | null {
    const limit = Math.min(end, src.length);
    for (let p = start; p + 8 <= limit; p += 1) {
      const verInst = src.data[p] | (src.data[p + 1] << 8);
      const type = src.data[p + 2] | (src.data[p + 3] << 8);
      if (type !== 0xf01d && type !== 0xf01e && type !== 0xf02a) continue;
      if ((verInst & 0x0f) !== 0) continue;
      const inst = verInst >> 4;
      let uids: number;
      if (inst === 0x46a || inst === 0x6e2 || inst === 0x6e0) uids = 1;
      else if (inst === 0x46b || inst === 0x6e3 || inst === 0x6e1) uids = 2;
      else continue;
      const len = src.view.getUint32(p + 4, true);
      const dataStart = p + 8 + 16 * uids + 1;
      const dataLen = len - 16 * uids - 1;
      if (dataLen <= 16 || dataStart + dataLen > src.length) continue;
      const d = src.data;
      if (type === 0xf01e) {
        if (d[dataStart] !== 0x89 || d[dataStart + 1] !== 0x50 || d[dataStart + 2] !== 0x4e || d[dataStart + 3] !== 0x47) continue;
        return { data: d.slice(dataStart, dataStart + dataLen), format: "png" };
      }
      if (d[dataStart] !== 0xff || d[dataStart + 1] !== 0xd8) continue;
      return { data: d.slice(dataStart, dataStart + dataLen), format: "jpg" };
    }
    return null;
  }

  private inlinePicture(fc: number): Token | null {
    const data = this.dataStream;
    if (!data.has(fc, 0x44)) return null;
    const lcb = data.u32(fc);
    const cbHeader = data.u16(fc + 4);
    if (lcb < cbHeader || cbHeader < 0x44 || !data.has(fc, lcb)) return null;
    let img = this.blipCache.get(fc);
    if (img === undefined) {
      img = this.findBlip(data, fc + cbHeader, fc + lcb);
      this.blipCache.set(fc, img);
    }
    if (!img) return null;
    const mx = data.u16(fc + 32) || 1000;
    const my = data.u16(fc + 34) || 1000;
    const w = Math.round((Math.abs(data.i16(fc + 28)) * mx) / 1000);
    const h = Math.round((Math.abs(data.i16(fc + 30)) * my) / 1000);
    if (w <= 0 || h <= 0) return null;
    return { kind: "image", data: img.data, format: img.format, widthTwips: w, heightTwips: h };
  }

  private floatingPicture(spa: Spa): Token | null {
    const pib = this.spidToPib.get(spa.spid);
    if (!pib || pib < 1) return null;
    const cacheKey = -pib;
    let img = this.blipCache.get(cacheKey);
    if (img === undefined) {
      const entry = this.bstore[pib - 1];
      img = null;
      if (entry) {
        const src = entry.inWd ? this.wd : this.table;
        if (src.has(entry.offset, Math.min(entry.length, 8))) {
          img = this.findBlip(src, entry.offset, entry.offset + Math.max(entry.length, 8));
        }
      }
      this.blipCache.set(cacheKey, img);
    }
    if (!img || spa.widthTwips <= 0 || spa.heightTwips <= 0) return null;
    return { kind: "image", data: img.data, format: img.format, widthTwips: spa.widthTwips, heightTwips: spa.heightTwips };
  }

  // ── Sections & headers ──

  private readSections(): {
    cpStart: number;
    cpEnd: number;
    page: Omit<SectionModel, "headers" | "footers" | "blocks">;
  }[] {
    const textEnd = Math.min(this.ccp.text, this.text.length);
    const plc = this.tableSlice(6);
    const ranges: { cpStart: number; cpEnd: number; sepx: Uint8Array | null }[] = [];
    if (plc && plc.length >= 4 && (plc.length - 4) % 16 === 0) {
      const n = (plc.length - 4) / 16;
      for (let i = 0; i < n; i += 1) {
        const cpStart = Math.min(plc.u32(i * 4), textEnd);
        const cpEnd = Math.min(plc.u32((i + 1) * 4), textEnd);
        const fcSepx = plc.u32(4 * (n + 1) + i * 12 + 2);
        let sepx: Uint8Array | null = null;
        if (fcSepx !== 0xffffffff && this.wd.has(fcSepx, 2)) {
          const cb = this.wd.i16(fcSepx);
          if (cb > 0 && this.wd.has(fcSepx + 2, cb)) sepx = this.wd.slice(fcSepx + 2, cb);
        }
        if (cpEnd > cpStart) ranges.push({ cpStart, cpEnd, sepx });
      }
    }
    if (ranges.length === 0) ranges.push({ cpStart: 0, cpEnd: textEnd, sepx: null });
    ranges[ranges.length - 1].cpEnd = textEnd;

    return ranges.map((r) => {
      const page = {
        pageWidth: 12240,
        pageHeight: 15840,
        landscape: false,
        marginTop: 1440,
        marginBottom: 1440,
        marginLeft: 1800,
        marginRight: 1800,
        headerDistance: 720,
        footerDistance: 720,
        gutter: 0,
        titlePage: false,
        breakType: 2,
      };
      let orient = 1;
      if (r.sepx) {
        forEachSprm(r.sepx, (sprm, op) => {
          switch (sprm) {
            case 0xb01f: page.pageWidth = opU16(op) || page.pageWidth; break;
            case 0xb020: page.pageHeight = opU16(op) || page.pageHeight; break;
            case 0xb021: page.marginLeft = opU16(op); break;
            case 0xb022: page.marginRight = opU16(op); break;
            case 0x9023: page.marginTop = Math.abs(opI16(op)); break;
            case 0x9024: page.marginBottom = Math.abs(opI16(op)); break;
            case 0xb017: page.headerDistance = opU16(op); break;
            case 0xb018: page.footerDistance = opU16(op); break;
            case 0xb025: page.gutter = opU16(op); break;
            case 0x301d: orient = op[0] ?? 1; break;
            case 0x3009: page.breakType = op[0] ?? 2; break;
            case 0x300a: page.titlePage = (op[0] ?? 0) !== 0; break;
            default: break;
          }
        });
      }
      page.landscape = orient === 2 || page.pageWidth > page.pageHeight;
      return { cpStart: r.cpStart, cpEnd: r.cpEnd, page };
    });
  }

  private readHeaderStories(): ([number, number] | null)[] {
    const plc = this.tableSlice(11);
    if (!plc || plc.length < 8 || this.ccp.hdd === 0) return [];
    const count = Math.floor(plc.length / 4);
    const out: ([number, number] | null)[] = [];
    for (let i = 0; i + 1 < count; i += 1) {
      const a = plc.u32(i * 4);
      const b = Math.min(plc.u32((i + 1) * 4), this.ccp.hdd);
      out.push(b > a ? [a, b] : null);
    }
    return out;
  }

  // ── Body assembly ──

  private buildRange(
    start: number,
    end: number,
    spa: Map<number, Spa>,
    spaBase: number,
    numbering: NumberingState,
  ): Block[] {
    end = Math.min(end, this.text.length);
    if (end <= start) return [];
    const text = this.text;

    const marks: MarkInfo[] = [];
    for (let cp = start; cp < end; cp += 1) {
      const ch = text[cp];
      if (ch === 0x0d || ch === 0x07 || (ch === 0x0c && cp === end - 1)) {
        marks.push({ cp, fmt: this.paraFormatAt(cp), char: ch });
      }
    }
    if (marks.length === 0 || marks[marks.length - 1].cp !== end - 1) {
      marks.push({ cp: end, fmt: this.paraFormatAt(end - 1), char: 0x0d });
    }

    const flat: FlatItem[] = [];
    let tokens: Token[] = [];
    let markIdx = 0;
    const fieldStack: boolean[] = [];
    let instrDepth = 0;
    let prevKey = "";
    let prevStyle: RunStyle | null = null;
    let prevChar: CharFormat | null = null;
    let textBuf = "";
    let chpxIdx = -1;
    let prevMarkChar = 0;
    const hasPapx = this.papxRuns.length > 0;

    const flushText = () => {
      if (textBuf && prevStyle) {
        tokens.push({ kind: "text", text: sanitizeText(textBuf), style: prevStyle });
      }
      textBuf = "";
    };

    const finalize = (mark: MarkInfo) => {
      flushText();
      const fmt = mark.fmt;
      const para = this.makeParagraph(fmt, tokens, numbering, prevStyle);
      tokens = [];
      let kind: FlatItem["mark"] = "para";
      if (mark.char === 0x07) {
        if (hasPapx) {
          if (fmt.ttp && fmt.itap <= 1) kind = "row";
          else if (fmt.inTable || fmt.itap >= 1) kind = "cell";
        } else {
          kind = prevMarkChar === 0x07 && para.tokens.length === 0 ? "row" : "cell";
        }
      } else if (fmt.innerTtp) {
        kind = "skip";
      }
      prevMarkChar = mark.char;
      flat.push({ para, fmt, mark: kind });
    };

    for (let cp = start; cp < end; cp += 1) {
      const mark = marks[markIdx];
      if (mark && cp === mark.cp) {
        finalize(mark);
        markIdx += 1;
        fieldStack.length = 0;
        instrDepth = 0;
        continue;
      }
      const ch = text[cp];
      const pi = this.pieceIndexForCp(cp);
      if (pi < 0) continue;
      const pos = this.byteOfCp(cp, pi);
      const runs = this.chpxRuns;
      if (!(chpxIdx >= 0 && pos >= runs[chpxIdx].start && pos < runs[chpxIdx].end)) {
        chpxIdx = lowerBound(runs, pos);
      }
      const istd = mark ? mark.fmt.istd : 0;
      const key = `${chpxIdx}:${pi}:${istd}`;
      let chr: CharFormat;
      if (key === prevKey && prevChar) {
        chr = prevChar;
      } else {
        chr = this.charFormat(chpxIdx, pi, istd);
        const style = this.toRunStyle(chr);
        if (style !== prevStyle) flushText();
        prevStyle = style;
        prevChar = chr;
        prevKey = key;
      }

      if (ch === 0x13) {
        flushText();
        if (fieldStack.length < MAX_FIELD_DEPTH) {
          fieldStack.push(true);
          instrDepth += 1;
        }
        continue;
      }
      if (ch === 0x14) {
        if (fieldStack.length > 0 && fieldStack[fieldStack.length - 1]) {
          fieldStack[fieldStack.length - 1] = false;
          instrDepth -= 1;
        }
        continue;
      }
      if (ch === 0x15) {
        const top = fieldStack.pop();
        if (top) instrDepth -= 1;
        continue;
      }
      if (instrDepth > 0 || chr.vanish || chr.deleted) continue;

      const style = prevStyle!;
      if (ch >= 0x20 && ch !== 0x7f) {
        if (chr.spec && ch === 0x28 && chr.symbol) {
          textBuf += mapSymbol(chr.symbol);
        } else if (ch >= 0xf000 && ch <= 0xf0ff) {
          textBuf += mapSymbol(ch);
        } else {
          textBuf += String.fromCharCode(ch);
        }
        continue;
      }
      switch (ch) {
        case 0x09:
          flushText();
          tokens.push({ kind: "tab", style });
          break;
        case 0x0b:
          flushText();
          tokens.push({ kind: "break", style });
          break;
        case 0x0c:
          flushText();
          tokens.push({ kind: "pageBreak" });
          break;
        case 0x1e:
          textBuf += "\u2011";
          break;
        case 0x01: {
          if (!chr.spec || chr.picLocation < 0 || this.imageCount >= MAX_IMAGES) break;
          const img = this.safely(() => this.inlinePicture(chr.picLocation));
          if (img) {
            flushText();
            tokens.push(img);
            this.imageCount += 1;
          }
          break;
        }
        case 0x08: {
          const s = spa.get(cp - spaBase);
          if (!s || this.imageCount >= MAX_IMAGES) break;
          const img = this.safely(() => this.floatingPicture(s));
          if (img) {
            flushText();
            tokens.push(img);
            this.imageCount += 1;
          }
          break;
        }
        default:
          break;
      }
    }
    const tail = marks[markIdx];
    if (tail && tail.cp >= end) finalize(tail);

    return this.groupBlocks(flat);
  }

  private makeParagraph(
    fmt: ParaFormat,
    tokens: Token[],
    numbering: NumberingState,
    fallbackStyle: RunStyle | null,
  ): ParagraphBlock {
    const para = emptyParagraph();
    para.bidi = fmt.bidi;
    if (fmt.jcLogical !== null) {
      para.align = Math.min(3, fmt.jcLogical);
    } else if (fmt.jcPhysical !== null) {
      const jc = Math.min(3, fmt.jcPhysical);
      para.align = fmt.bidi && (jc === 0 || jc === 2) ? 2 - jc : jc;
    }
    para.spaceBefore = fmt.before;
    para.spaceAfter = fmt.after;
    if (fmt.lineDya !== null && fmt.lineDya !== 0) {
      if (fmt.lineMult) {
        para.line = Math.abs(fmt.lineDya);
        para.lineRule = "auto";
      } else if (fmt.lineDya < 0) {
        para.line = -fmt.lineDya;
        para.lineRule = "exact";
      } else {
        para.line = fmt.lineDya;
        para.lineRule = "atLeast";
      }
    }
    para.indentStart = fmt.indStart;
    para.indentEnd = fmt.indEnd;
    para.indentFirst = fmt.indFirst;
    para.keepNext = fmt.keepNext;
    para.keepLines = fmt.keepLines;
    para.pageBreakBefore = fmt.pageBreakBefore;
    para.tokens = tokens;

    if (fmt.ilfo > 0 && fmt.ilfo < 0x0800) {
      const lfo = this.lfos[fmt.ilfo - 1];
      const list = lfo ? this.lists.get(lfo.lsid) : undefined;
      if (lfo && list) {
        const label = numbering.next(lfo, list, fmt.ilvl);
        const level = list.levels[Math.min(fmt.ilvl, list.levels.length - 1)];
        const firstStyled = tokens.find(
          (t): t is Extract<Token, { style: RunStyle }> => "style" in t,
        );
        const style =
          firstStyled?.style ?? fallbackStyle ?? this.toRunStyle(this.styleChar(fmt.istd));
        if (label) {
          const prefix: Token[] = [{ kind: "text", text: sanitizeText(label), style }];
          if (level?.follow === 0) prefix.push({ kind: "tab", style });
          else if (level?.follow === 1) prefix.push({ kind: "text", text: " ", style });
          para.tokens = [...prefix, ...tokens];
        }
      }
    }
    return para;
  }

  private groupBlocks(flat: FlatItem[]): Block[] {
    const blocks: Block[] = [];
    let rows: { cells: ParagraphBlock[][]; fmt: ParaFormat | null }[] = [];
    let cells: ParagraphBlock[][] = [];
    let cellParas: ParagraphBlock[] = [];

    const closeTable = () => {
      if (cellParas.length > 0) {
        cells.push(cellParas);
        cellParas = [];
      }
      if (cells.length > 0) {
        rows.push({ cells, fmt: null });
        cells = [];
      }
      if (rows.length > 0) blocks.push(this.buildTable(rows));
      rows = [];
    };

    for (const item of flat) {
      const inTable =
        item.mark === "cell" ||
        item.mark === "row" ||
        (item.mark === "skip" && (rows.length > 0 || cells.length > 0)) ||
        (item.mark === "para" && (item.fmt.inTable || item.fmt.itap >= 1));
      if (!inTable) {
        if (rows.length > 0 || cells.length > 0 || cellParas.length > 0) closeTable();
        if (item.mark !== "skip") blocks.push(item.para);
        continue;
      }
      switch (item.mark) {
        case "para":
          cellParas.push(item.para);
          break;
        case "cell":
          cellParas.push(item.para);
          cells.push(cellParas);
          cellParas = [];
          break;
        case "row":
          if (cellParas.length > 0) {
            cells.push(cellParas);
            cellParas = [];
          }
          if (cells.length > 0) rows.push({ cells, fmt: item.fmt });
          cells = [];
          break;
        default:
          break;
      }
    }
    closeTable();
    return blocks;
  }

  private buildTable(rawRows: { cells: ParagraphBlock[][]; fmt: ParaFormat | null }[]): TableBlock {
    const first = rawRows.find((r) => r.fmt?.table)?.fmt?.table ?? null;
    const bidi = first?.bidi ?? false;

    type Pending = {
      paragraphs: ParagraphBlock[];
      left: number;
      right: number;
      tc: TcFormat | null;
      shading: string | null;
    };

    const rowsPending: { cells: Pending[]; fmt: TableFormat | null }[] = rawRows.map((r) => {
      const t = r.fmt?.table ?? null;
      const centers = t && t.centers.length >= 2 ? t.centers : null;
      const out: Pending[] = [];
      r.cells.forEach((paras, i) => {
        let left: number;
        let right: number;
        if (centers && i + 1 < centers.length) {
          left = centers[i];
          right = centers[i + 1];
        } else if (centers) {
          const w = 1440;
          left = centers[centers.length - 1] + (i + 1 - centers.length) * w;
          right = left + w;
        } else {
          left = NaN;
          right = NaN;
        }
        const tc = t?.tcs[i] ?? null;
        if (tc && tc.horzMerge === 2 && out.length > 0) {
          const prev = out[out.length - 1];
          prev.right = Math.max(prev.right, right);
          if (paras.some(isContentfulParagraph)) prev.paragraphs.push(...paras);
          return;
        }
        out.push({ paragraphs: paras, left, right, tc, shading: t?.shading[i] ?? null });
      });
      return { cells: out, fmt: t };
    });

    const edges: number[] = [];
    for (const r of rowsPending) {
      for (const c of r.cells) {
        if (Number.isFinite(c.left) && Number.isFinite(c.right) && c.right > c.left) {
          edges.push(c.left, c.right);
        }
      }
    }
    edges.sort((a, b) => a - b);
    const grid: number[] = [];
    for (const e of edges) {
      if (grid.length === 0 || e - grid[grid.length - 1] > 30) grid.push(e);
    }

    const maxCells = Math.max(1, ...rowsPending.map((r) => r.cells.length));
    const useEdges = grid.length >= 2 && grid.length - 1 <= MAX_GRID_COLUMNS;
    const gridTwips: number[] = [];
    if (useEdges) {
      for (let i = 0; i + 1 < grid.length; i += 1) gridTwips.push(grid[i + 1] - grid[i]);
    } else {
      const w = Math.max(400, Math.floor(9000 / maxCells));
      for (let i = 0; i < maxCells; i += 1) gridTwips.push(w);
    }
    const cols = gridTwips.length;
    const nearest = (x: number) => {
      let best = 0;
      let dist = Infinity;
      for (let i = 0; i < grid.length; i += 1) {
        const d = Math.abs(grid[i] - x);
        if (d < dist) {
          dist = d;
          best = i;
        }
      }
      return best;
    };

    const outRows: TableRowBlock[] = [];
    const prevStarts: Map<number, "restart" | "continue" | null>[] = [];
    rowsPending.forEach((r, rowIdx) => {
      const t = r.fmt;
      const cellsOut: TableCellBlock[] = [];
      const starts = new Map<number, "restart" | "continue" | null>();
      let col = 0;
      r.cells.forEach((c, i) => {
        let span: number;
        if (useEdges && Number.isFinite(c.left) && Number.isFinite(c.right)) {
          // Span to this cell's right edge; any gap before it (Word's
          // gridBefore, unsupported downstream) is absorbed into the cell.
          span = Math.max(1, nearest(c.right) - col);
        } else {
          const remaining = r.cells.length - i;
          span = i === r.cells.length - 1 ? cols - col : Math.max(1, Math.floor((cols - col) / remaining));
        }
        if (col + span > cols) span = Math.max(1, cols - col);
        if (i === r.cells.length - 1 && col + span < cols) span = cols - col;

        let vMerge: "restart" | "continue" | null = null;
        const vm = c.tc?.vertMerge ?? 0;
        if (vm === 3) vMerge = "restart";
        else if (vm === 1 || vm === 2) {
          const above = prevStarts[rowIdx - 1]?.get(col);
          vMerge = above === "restart" || above === "continue" ? "continue" : null;
        }
        starts.set(col, vMerge);

        const isFirstRow = rowIdx === 0;
        const isLastRow = rowIdx === rowsPending.length - 1;
        const isFirstCell = i === 0;
        const isLastCell = i === r.cells.length - 1;
        const tb = t?.borders ?? null;
        const pick = (own: Border | null | undefined, fallback: Border | null | undefined) =>
          own !== undefined ? own : (fallback ?? null);

        let width = 0;
        for (let k = col; k < col + span && k < cols; k += 1) width += gridTwips[k];

        cellsOut.push({
          paragraphs: c.paragraphs.length > 0 ? c.paragraphs : [emptyParagraph()],
          gridSpan: span,
          widthTwips: width,
          vMerge,
          vAlign: c.tc?.vAlign ?? 0,
          borders: {
            top: pick(c.tc?.top, isFirstRow ? tb?.top : tb?.insideH),
            bottom: pick(c.tc?.bottom, isLastRow ? tb?.bottom : tb?.insideH),
            start: pick(c.tc?.left, isFirstCell ? tb?.left : tb?.insideV),
            end: pick(c.tc?.right, isLastCell ? tb?.right : tb?.insideV),
          },
          shading: c.shading,
        });
        col += span;
      });
      prevStarts.push(starts);
      outRows.push({
        cells: cellsOut,
        height: t?.rowHeight ?? 0,
        header: t?.header ?? false,
      });
    });

    return {
      kind: "table",
      bidi,
      align: first?.jc ?? 0,
      gridTwips,
      rows: outRows,
    };
  }
}

function structuredCloneFormat(p: ParaFormat): ParaFormat {
  return {
    ...p,
    table: p.table
      ? {
          ...p.table,
          centers: [...p.table.centers],
          tcs: p.table.tcs.map((tc) => ({ ...tc })),
          borders: p.table.borders ? { ...p.table.borders } : null,
          shading: [...p.table.shading],
        }
      : null,
  };
}

/**
 * Drop code units that are invalid in XML (lone surrogates, U+FFFE/FFFF).
 * Hand-rolled because regex lookbehind breaks Safari < 16.4.
 */
function sanitizeText(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === 0xfffe || c === 0xffff) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i += 1;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    out += s[i];
  }
  return out;
}

export function parseWord97(bytes: Uint8Array): DocModel {
  return new Word97Parser(bytes).parse();
}
