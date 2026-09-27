/**
 * Minimal, bounds-checked reader for the Compound File Binary format
 * ([MS-CFB]) — the OLE container used by legacy .doc files.
 *
 * Only reading top-level streams is supported. Every offset read from the
 * file is validated so malformed or hostile input fails with a
 * `CfbError` instead of looping or reading out of range.
 */

export class CfbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CfbError";
  }
}

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const MAX_REG_SECT = 0xfffffffa;
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECT = 0xffffffff;
const NO_STREAM = 0xffffffff;
const DIR_ENTRY_SIZE = 128;
const TYPE_STORAGE = 1;
const TYPE_STREAM = 2;
const TYPE_ROOT = 5;

export function isCfb(bytes: Uint8Array): boolean {
  if (bytes.length < 512) return false;
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) return false;
  }
  return true;
}

type DirEntry = {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
};

export class CfbReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly sectorCount: number;
  private readonly fat: Uint32Array;
  private readonly miniFat: Uint32Array;
  private readonly entries: DirEntry[];
  private readonly miniStream: Uint8Array;
  private readonly rootChildren: Map<string, DirEntry>;

  constructor(bytes: Uint8Array) {
    if (!isCfb(bytes)) throw new CfbError("Not a compound file");
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const major = this.u16(0x1a);
    const sectorShift = this.u16(0x1e);
    const miniShift = this.u16(0x20);
    if (this.u16(0x1c) !== 0xfffe) throw new CfbError("Bad byte order mark");
    if (
      !(
        (major === 3 && sectorShift === 9) ||
        (major === 4 && sectorShift === 12)
      )
    ) {
      throw new CfbError("Unsupported sector size");
    }
    if (miniShift !== 6) throw new CfbError("Unsupported mini sector size");

    this.sectorSize = 1 << sectorShift;
    this.miniSectorSize = 1 << miniShift;
    this.miniCutoff = this.u32(0x38);
    // Some writers leave the final sector truncated; count it and zero-fill.
    this.sectorCount = Math.max(
      0,
      Math.ceil((bytes.length - this.sectorSize) / this.sectorSize),
    );

    this.fat = this.readFat();
    const firstDir = this.u32(0x30);
    const dirBytes = this.readChain(firstDir, this.fat, null);
    this.entries = this.parseEntries(dirBytes);
    const root = this.entries[0];
    if (!root || root.type !== TYPE_ROOT) {
      throw new CfbError("Missing root entry");
    }

    const miniFatStart = this.u32(0x3c);
    const miniFatBytes =
      miniFatStart >= MAX_REG_SECT
        ? new Uint8Array(0)
        : this.readChain(miniFatStart, this.fat, null);
    this.miniFat = toU32Array(miniFatBytes);
    this.miniStream =
      root.start >= MAX_REG_SECT || root.size === 0
        ? new Uint8Array(0)
        : this.readChain(root.start, this.fat, root.size);

    this.rootChildren = this.collectChildren(root.child);
  }

  /** Returns a copy of the named top-level stream, or null if absent. */
  getStream(name: string): Uint8Array | null {
    const entry = this.rootChildren.get(name.toLowerCase());
    if (!entry || entry.type !== TYPE_STREAM) return null;
    if (entry.size === 0) return new Uint8Array(0);
    if (entry.size < this.miniCutoff) {
      return this.readMiniChain(entry.start, entry.size);
    }
    return this.readChain(entry.start, this.fat, entry.size);
  }

  private u16(offset: number): number {
    if (offset < 0 || offset + 2 > this.bytes.length) {
      throw new CfbError("Read out of range");
    }
    return this.view.getUint16(offset, true);
  }

  private u32(offset: number): number {
    if (offset < 0 || offset + 4 > this.bytes.length) {
      throw new CfbError("Read out of range");
    }
    return this.view.getUint32(offset, true);
  }

  private sectorOffset(sector: number): number {
    if (sector >= this.sectorCount) {
      throw new CfbError("Sector index out of range");
    }
    return (sector + 1) * this.sectorSize;
  }

  private readFat(): Uint32Array {
    const fatSectorCount = this.u32(0x2c);
    if (fatSectorCount > this.sectorCount) {
      throw new CfbError("FAT sector count out of range");
    }
    const fatSectors: number[] = [];
    for (let i = 0; i < 109 && fatSectors.length < fatSectorCount; i += 1) {
      const s = this.u32(0x4c + i * 4);
      if (s < MAX_REG_SECT) fatSectors.push(s);
    }

    let difat = this.u32(0x44);
    let difatCount = this.u32(0x48);
    const perDifat = this.sectorSize / 4 - 1;
    const seen = new Set<number>();
    while (
      difat < MAX_REG_SECT &&
      difatCount > 0 &&
      fatSectors.length < fatSectorCount
    ) {
      if (seen.has(difat)) throw new CfbError("DIFAT cycle");
      seen.add(difat);
      const base = this.sectorOffset(difat);
      for (let i = 0; i < perDifat && fatSectors.length < fatSectorCount; i += 1) {
        const s = this.u32(base + i * 4);
        if (s < MAX_REG_SECT) fatSectors.push(s);
      }
      difat = this.u32(base + perDifat * 4);
      difatCount -= 1;
    }

    const perSector = this.sectorSize / 4;
    const fat = new Uint32Array(fatSectors.length * perSector);
    fatSectors.forEach((sector, idx) => {
      const base = this.sectorOffset(sector);
      for (let i = 0; i < perSector; i += 1) {
        fat[idx * perSector + i] = this.u32(base + i * 4);
      }
    });
    return fat;
  }

  /** Follow a FAT chain; `size` truncates the result when known. */
  private readChain(
    start: number,
    fat: Uint32Array,
    size: number | null,
  ): Uint8Array {
    const chunks: number[] = [];
    const seen = new Set<number>();
    let sector = start;
    while (sector !== END_OF_CHAIN) {
      if (sector >= MAX_REG_SECT || sector >= fat.length) {
        if (sector === FREE_SECT && chunks.length > 0) break;
        throw new CfbError("Broken sector chain");
      }
      if (seen.has(sector)) throw new CfbError("Sector chain cycle");
      seen.add(sector);
      chunks.push(sector);
      if (size !== null && chunks.length * this.sectorSize >= size) break;
      sector = fat[sector];
    }

    const total = chunks.length * this.sectorSize;
    const wanted = size === null ? total : Math.min(size, total);
    const out = new Uint8Array(wanted);
    let written = 0;
    for (const s of chunks) {
      if (written >= wanted) break;
      const off = this.sectorOffset(s);
      const len = Math.min(this.sectorSize, wanted - written);
      const available = Math.max(0, Math.min(len, this.bytes.length - off));
      out.set(this.bytes.subarray(off, off + available), written);
      written += len;
    }
    return out;
  }

  private readMiniChain(start: number, size: number): Uint8Array {
    const out = new Uint8Array(size);
    const seen = new Set<number>();
    let sector = start;
    let written = 0;
    while (written < size) {
      if (sector >= MAX_REG_SECT || sector >= this.miniFat.length) {
        throw new CfbError("Broken mini sector chain");
      }
      if (seen.has(sector)) throw new CfbError("Mini sector chain cycle");
      seen.add(sector);
      const off = sector * this.miniSectorSize;
      const len = Math.min(this.miniSectorSize, size - written);
      if (off + len > this.miniStream.length) {
        throw new CfbError("Mini sector past end of mini stream");
      }
      out.set(this.miniStream.subarray(off, off + len), written);
      written += len;
      sector = this.miniFat[sector];
    }
    return out;
  }

  private parseEntries(dir: Uint8Array): DirEntry[] {
    const view = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
    const count = Math.floor(dir.length / DIR_ENTRY_SIZE);
    const entries: DirEntry[] = [];
    for (let i = 0; i < count; i += 1) {
      const base = i * DIR_ENTRY_SIZE;
      // Name length is in bytes and includes the UTF-16 null terminator.
      const nameLen = Math.min(64, view.getUint16(base + 0x40, true));
      const chars = Math.max(0, Math.floor(nameLen / 2) - 1);
      let name = "";
      for (let j = 0; j < chars; j += 1) {
        name += String.fromCharCode(view.getUint16(base + j * 2, true));
      }
      const sizeLow = view.getUint32(base + 0x78, true);
      const sizeHigh = view.getUint32(base + 0x7c, true);
      if (sizeHigh !== 0 && this.sectorSize === 4096) {
        throw new CfbError("Stream too large");
      }
      entries.push({
        name,
        type: dir[base + 0x42],
        left: view.getUint32(base + 0x44, true),
        right: view.getUint32(base + 0x48, true),
        child: view.getUint32(base + 0x4c, true),
        start: view.getUint32(base + 0x74, true),
        // v3 files may leave garbage in the high dword; only v4 uses it.
        size: sizeLow,
      });
    }
    return entries;
  }

  /** Walk the red-black sibling tree of a storage without recursion. */
  private collectChildren(first: number): Map<string, DirEntry> {
    const out = new Map<string, DirEntry>();
    const stack: number[] = [];
    const seen = new Set<number>();
    if (first !== NO_STREAM) stack.push(first);
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === NO_STREAM || id >= this.entries.length) continue;
      if (seen.has(id)) throw new CfbError("Directory cycle");
      seen.add(id);
      const entry = this.entries[id];
      if (entry.type === TYPE_STREAM || entry.type === TYPE_STORAGE) {
        out.set(entry.name.toLowerCase(), entry);
      }
      stack.push(entry.left, entry.right);
    }
    return out;
  }
}

function toU32Array(bytes: Uint8Array): Uint32Array {
  const count = Math.floor(bytes.length / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = view.getUint32(i * 4, true);
  return out;
}
