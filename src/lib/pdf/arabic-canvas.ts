/**
 * Rasterize text with the browser's Arabic shaper (HarfBuzz), then embed as PNG.
 * pdf-lib drawText cannot join Arabic glyphs reliably even with reshape hacks.
 */

let fontReady: Promise<boolean> | null = null;

export async function ensureNotoArabicFont(): Promise<boolean> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") {
    return false;
  }
  if (!fontReady) {
    fontReady = (async () => {
      try {
        const existing = Array.from(document.fonts).some(
          (f) => f.family.replace(/["']/g, "") === "NotoSansArabic",
        );
        if (!existing) {
          const face = new FontFace(
            "NotoSansArabic",
            "url(/fonts/NotoSansArabic-Regular.ttf)",
            { weight: "400", style: "normal" },
          );
          const loaded = await face.load();
          document.fonts.add(loaded);
        }
        await document.fonts.load('16px "NotoSansArabic"');
        return true;
      } catch {
        return false;
      }
    })();
  }
  return fontReady;
}

function parseHexColor(hex: string): string {
  if (!hex) return "#111827";
  return hex.startsWith("#") ? hex : `#${hex}`;
}

export async function rasterizePdfTextBlock(opts: {
  text: string;
  fontSize: number;
  color: string;
  /** Target box width in CSS/PDF points (approx px). */
  boxWidth: number;
  align?: "start" | "center" | "end";
  rtl?: boolean;
}): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (typeof document === "undefined") return null;

  const ok = await ensureNotoArabicFont();
  const fontStack = ok
    ? '"NotoSansArabic", "Segoe UI", Tahoma, Arial, sans-serif'
    : '"Segoe UI", Tahoma, Arial, sans-serif';

  const dpr = Math.min(3, Math.max(2, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2));
  const fontSize = Math.max(8, Math.min(opts.fontSize, 72));
  const lineHeight = fontSize * 1.4;
  const pad = 3;
  const lines = (opts.text || " ").replace(/\r\n/g, "\n").split("\n");
  const rtl = opts.rtl !== false;
  const align = opts.align || (rtl ? "end" : "start");
  const color = parseHexColor(opts.color);

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  measure.font = `${fontSize}px ${fontStack}`;

  let contentW = 0;
  for (const line of lines) {
    contentW = Math.max(contentW, measure.measureText(line || " ").width);
  }

  const cssW = Math.max(
    Math.ceil(opts.boxWidth),
    Math.ceil(contentW) + pad * 2,
    8,
  );
  const cssH = Math.max(Math.ceil(lines.length * lineHeight + pad * 2), fontSize + pad * 2);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cssW * dpr);
  canvas.height = Math.ceil(cssH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.font = `${fontSize}px ${fontStack}`;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.direction = rtl ? "rtl" : "ltr";

  // Physical left/right alignment inside the box (independent of bidi).
  if (align === "center") {
    ctx.textAlign = "center";
  } else if (align === "end") {
    ctx.textAlign = "right";
  } else {
    ctx.textAlign = "left";
  }

  const x =
    align === "center" ? cssW / 2 : align === "end" ? cssW - pad : pad;

  lines.forEach((line, i) => {
    ctx.fillText(line || " ", x, pad + i * lineHeight);
  });

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  return {
    bytes: new Uint8Array(buf),
    width: cssW,
    height: cssH,
  };
}
