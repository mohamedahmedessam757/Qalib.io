import {
  cellKey,
  parseA1,
  toA1,
  type SheetCellValue,
  type SheetModel,
} from "./model";

function tokenize(expr: string): string[] {
  const out: string[] = [];
  let i = 0;
  const s = expr.trim();
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ("(),*/+-^<>=".includes(ch)) {
      if ((ch === "<" || ch === ">" || ch === "=") && i + 1 < s.length) {
        const two = ch + s[i + 1];
        if (two === "<=" || two === ">=" || two === "<>") {
          out.push(two);
          i += 2;
          continue;
        }
      }
      out.push(ch);
      i += 1;
      continue;
    }
    if (ch === '"' ) {
      let j = i + 1;
      let str = "";
      while (j < s.length && s[j] !== '"') {
        str += s[j];
        j += 1;
      }
      out.push(`"${str}"`);
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < s.length && /[A-Za-z0-9_.$]/.test(s[j])) j += 1;
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

type Ctx = {
  sheet: SheetModel;
  cache: Map<string, SheetCellValue>;
  stack: Set<string>;
};

function resolveRef(ref: string, ctx: Ctx): SheetCellValue {
  const pos = parseA1(ref);
  if (!pos) return null;
  const key = cellKey(pos.r, pos.c);
  if (ctx.stack.has(key)) return "#CYCLE!";
  const cached = ctx.cache.get(key);
  if (cached !== undefined) return cached;
  const cell = ctx.sheet.cells[key];
  if (!cell) return null;
  if (cell.formula) {
    ctx.stack.add(key);
    const v = evalFormula(cell.formula, ctx);
    ctx.stack.delete(key);
    ctx.cache.set(key, v);
    return v;
  }
  ctx.cache.set(key, cell.value);
  return cell.value;
}

function toNum(v: SheetCellValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return 0;
}

function expandRange(a: string, b: string): string[] {
  const pa = parseA1(a);
  const pb = parseA1(b);
  if (!pa || !pb) return [];
  const r0 = Math.min(pa.r, pb.r);
  const r1 = Math.max(pa.r, pb.r);
  const c0 = Math.min(pa.c, pb.c);
  const c1 = Math.max(pa.c, pb.c);
  const fixed: string[] = [];
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      fixed.push(toA1(r, c));
    }
  }
  return fixed;
}

function callFn(name: string, args: SheetCellValue[], ctx: Ctx): SheetCellValue {
  const n = name.toUpperCase();
  const nums = args.map(toNum).filter((x) => !Number.isNaN(x));
  if (n === "SUM") return nums.reduce((a, b) => a + b, 0);
  if (n === "AVERAGE" || n === "AVG") {
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  }
  if (n === "COUNT") return args.filter((v) => v != null && v !== "").length;
  if (n === "MIN") return nums.length ? Math.min(...nums) : 0;
  if (n === "MAX") return nums.length ? Math.max(...nums) : 0;
  if (n === "ABS") return Math.abs(toNum(args[0]));
  if (n === "ROUND") {
    const p = Math.max(0, Math.floor(toNum(args[1] ?? 0)));
    const f = 10 ** p;
    return Math.round(toNum(args[0]) * f) / f;
  }
  if (n === "IF") {
    return toNum(args[0]) ? (args[1] ?? true) : (args[2] ?? false);
  }
  if (n === "CONCAT" || n === "CONCATENATE") {
    return args.map((a) => (a == null ? "" : String(a))).join("");
  }
  void ctx;
  return `#NAME?`;
}

class Parser {
  tokens: string[];
  i = 0;
  ctx: Ctx;
  constructor(tokens: string[], ctx: Ctx) {
    this.tokens = tokens;
    this.ctx = ctx;
  }
  peek() {
    return this.tokens[this.i];
  }
  next() {
    return this.tokens[this.i++];
  }
  parse(): SheetCellValue {
    const v = this.parseCompare();
    return v;
  }
  parseCompare(): SheetCellValue {
    let left = this.parseAdd();
    while (["=", "<>", "<", ">", "<=", ">="].includes(this.peek())) {
      const op = this.next();
      const right = this.parseAdd();
      const ln = toNum(left);
      const rn = toNum(right);
      if (op === "=") left = ln === rn || String(left) === String(right);
      else if (op === "<>") left = ln !== rn && String(left) !== String(right);
      else if (op === "<") left = ln < rn;
      else if (op === ">") left = ln > rn;
      else if (op === "<=") left = ln <= rn;
      else if (op === ">=") left = ln >= rn;
    }
    return left;
  }
  parseAdd(): SheetCellValue {
    let left = this.parseMul();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.next();
      const right = this.parseMul();
      left = op === "+" ? toNum(left) + toNum(right) : toNum(left) - toNum(right);
    }
    return left;
  }
  parseMul(): SheetCellValue {
    let left = this.parseUnary();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.next();
      const right = this.parseUnary();
      left = op === "*" ? toNum(left) * toNum(right) : toNum(right) === 0 ? "#DIV/0!" : toNum(left) / toNum(right);
    }
    return left;
  }
  parseUnary(): SheetCellValue {
    if (this.peek() === "-") {
      this.next();
      return -toNum(this.parseUnary());
    }
    if (this.peek() === "+") {
      this.next();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }
  parsePrimary(): SheetCellValue {
    const t = this.peek();
    if (!t) return null;
    if (t.startsWith('"')) {
      this.next();
      return t.slice(1);
    }
    if (/^\d+(\.\d+)?$/.test(t)) {
      this.next();
      return Number(t);
    }
    if (/^[A-Za-z]+\d+$/.test(t)) {
      this.next();
      if (this.peek() === ":") {
        this.next();
        const end = this.next();
        if (!end || !/^[A-Za-z]+\d+$/.test(end)) return "#REF!";
        const refs = expandRange(t, end);
        // Range as list only valid inside functions — return first for bare use
        return refs.length ? resolveRef(refs[0], this.ctx) : null;
      }
      return resolveRef(t, this.ctx);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && this.tokens[this.i + 1] === "(") {
      const name = this.next();
      this.next(); // (
      const args: SheetCellValue[] = [];
      if (this.peek() !== ")") {
        for (;;) {
          // Range arg A1:B2
          if (
            this.peek() &&
            /^[A-Za-z]+\d+$/.test(this.peek()) &&
            this.tokens[this.i + 1] === ":"
          ) {
            const a = this.next();
            this.next();
            const b = this.next();
            for (const ref of expandRange(a, b || a)) {
              args.push(resolveRef(ref, this.ctx));
            }
          } else {
            args.push(this.parseCompare());
          }
          if (this.peek() === ",") {
            this.next();
            continue;
          }
          break;
        }
      }
      if (this.peek() === ")") this.next();
      return callFn(name, args, this.ctx);
    }
    if (t === "(") {
      this.next();
      const v = this.parseCompare();
      if (this.peek() === ")") this.next();
      return v;
    }
    this.next();
    return `#VALUE!`;
  }
}

export function evalFormula(formula: string, ctx: Ctx): SheetCellValue {
  const expr = formula.replace(/^=/, "").trim();
  if (!expr) return null;
  try {
    const parser = new Parser(tokenize(expr), ctx);
    return parser.parse();
  } catch {
    return "#ERROR!";
  }
}

export function evaluateSheet(sheet: SheetModel): Map<string, SheetCellValue> {
  const cache = new Map<string, SheetCellValue>();
  const ctx: Ctx = { sheet, cache, stack: new Set() };
  for (const cell of Object.values(sheet.cells)) {
    const key = cellKey(cell.r, cell.c);
    if (cache.has(key)) continue;
    if (cell.formula) {
      ctx.stack.add(key);
      const v = evalFormula(cell.formula, ctx);
      ctx.stack.delete(key);
      cache.set(key, v);
    } else {
      cache.set(key, cell.value);
    }
  }
  return cache;
}
