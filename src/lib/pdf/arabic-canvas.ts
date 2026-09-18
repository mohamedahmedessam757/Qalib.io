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

function resolveFontStack(
  family: "noto" | "sans" | "serif" | undefined,
  notoOk: boolean,
): string {
  if (family === "serif") {
    return 'Georgia, "Times New Roman", serif';
  }
  if (family === "sans") {
    return 'system-ui, "Segoe UI", Tahoma, Arial, sans-serif';
  }
  return notoOk
    ? '"NotoSansArabic", "Segoe UI", Tahoma, Arial, sans-serif'
    : '"Segoe UI", Tahoma, Arial, sans-serif';
}

export async function rasterizePdfTextBlock(opts: {
  text: string;
  fontSize: number;
  color: string;
  /** Target box width in CSS/PDF points (approx px). */
  boxWidth: number;
  align?: "start" | "center" | "end";
  rtl?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontFamily?: "noto" | "sans" | "serif";
}): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (typeof document === "undefined") return null;

  const ok = await ensureNotoArabicFont();
  const fontStack = resolveFontStack(opts.fontFamily, ok);
  const weight = opts.bold ? "700" : "400";
  const style = opts.italic ? "italic" : "normal";

  const dpr = Math.min(
    3,
    Math.max(2, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2),
  );
  const fontSize = Math.max(8, Math.min(opts.fontSize, 72));
  const lineHeight = fontSize * 1.45;
  const pad = 3;
  const lines = (opts.text || " ").replace(/\r\n/g, "\n").split("\n");
  const rtl = opts.rtl !== false;
  const align = opts.align || (rtl ? "end" : "start");
  const color = parseHexColor(opts.color);
  const fontCss = `${style} ${weight} ${fontSize}px ${fontStack}`;

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  measure.font = fontCss;
  try {
    measure.letterSpacing = "0px";
  } catch {
    /* ignore */
  }

  let contentW = 0;
  for (const line of lines) {
    contentW = Math.max(contentW, measure.measureText(line || " ").width);
  }

  const cssW = Math.max(
    Math.ceil(opts.boxWidth),
    Math.ceil(contentW) + pad * 2,
    8,
  );
  const cssH = Math.max(
    Math.ceil(lines.length * lineHeight + pad * 2 + (opts.underline ? 4 : 0)),
    fontSize + pad * 2,
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cssW * dpr);
  canvas.height = Math.ceil(cssH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.font = fontCss;
  try {
    ctx.letterSpacing = "0px";
  } catch {
    /* ignore */
  }
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.direction = rtl ? "rtl" : "ltr";

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
    const ty = pad + i * lineHeight;
    ctx.fillText(line || " ", x, ty);
    if (opts.underline) {
      const tw = ctx.measureText(line || " ").width;
      const x1 =
        align === "center" ? x - tw / 2 : align === "end" ? x - tw : x;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, fontSize * 0.06);
      ctx.beginPath();
      ctx.moveTo(x1, ty + fontSize + 1);
      ctx.lineTo(x1 + tw, ty + fontSize + 1);
      ctx.stroke();
    }
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
