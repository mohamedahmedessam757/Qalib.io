declare module "bidi-js" {
  type EmbeddingLevels = {
    levels: Uint8Array | number[];
    paragraphs: Array<{ start: number; end: number; level: number }>;
  };

  type BidiApi = {
    getEmbeddingLevels: (
      string: string,
      implicitLevel?: "ltr" | "rtl" | number | null,
    ) => EmbeddingLevels;
    getReorderedString: (
      string: string,
      embeddingLevels: EmbeddingLevels,
      start?: number | null,
      end?: number | null,
    ) => string;
  };

  export default function bidiFactory(): BidiApi;
}

declare module "arabic-persian-reshaper" {
  export const ArabicShaper: {
    convertArabic: (text: string) => string;
  };
  export function convertArabic(text: string): string;
  const _default: {
    ArabicShaper: { convertArabic: (text: string) => string };
    convertArabic: (text: string) => string;
  };
  export default _default;
}
