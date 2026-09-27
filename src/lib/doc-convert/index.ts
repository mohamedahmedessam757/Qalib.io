/**
 * Legacy Word (.doc) → .docx conversion that runs entirely on the client.
 * No file ever leaves the user's device and no third-party service is used.
 */

import { CfbError, isCfb } from "./cfb";
import { modelToDocx } from "./to-docx";
import { DocParseError, parseWord97 } from "./word97";

export type DocConvertErrorCode =
  | "encrypted"
  | "unsupported_version"
  | "rtf"
  | "not_word"
  | "corrupt";

export class DocConvertError extends Error {
  constructor(
    readonly code: DocConvertErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocConvertError";
  }
}

export type DocConvertResult = {
  bytes: Uint8Array;
  /** True when the ".doc" was already an OOXML package (renamed .docx). */
  passthrough: boolean;
};

function startsWith(bytes: Uint8Array, sig: number[]) {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

function containsAscii(bytes: Uint8Array, needle: string) {
  const n = needle.length;
  const first = needle.charCodeAt(0);
  outer: for (let i = 0; i + n <= bytes.length; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < n; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}

export async function convertDocToDocx(
  input: ArrayBuffer | Uint8Array,
): Promise<DocConvertResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (!containsAscii(bytes, "word/document.xml")) {
      throw new DocConvertError("not_word", "ZIP package is not a Word document");
    }
    return { bytes, passthrough: true };
  }
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) {
    throw new DocConvertError("rtf", "File is RTF, not binary Word");
  }
  if (
    startsWith(bytes, [0xdb, 0xa5]) ||
    startsWith(bytes, [0x9b, 0xa5])
  ) {
    throw new DocConvertError(
      "unsupported_version",
      "Word 1.x/2.x documents are not supported",
    );
  }
  if (!isCfb(bytes)) {
    throw new DocConvertError("not_word", "Not a Word 97-2003 document");
  }

  try {
    const model = parseWord97(bytes);
    const out = await modelToDocx(model);
    return { bytes: out, passthrough: false };
  } catch (err) {
    if (err instanceof DocConvertError) throw err;
    if (err instanceof DocParseError) {
      throw new DocConvertError(err.code, err.message);
    }
    if (err instanceof CfbError) {
      throw new DocConvertError("corrupt", err.message);
    }
    throw new DocConvertError(
      "corrupt",
      err instanceof Error ? err.message : "Conversion failed",
    );
  }
}
