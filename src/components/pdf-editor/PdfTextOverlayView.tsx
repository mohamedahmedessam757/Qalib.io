"use client";

import { useEffect, useState } from "react";
import { rasterizePdfTextBlock } from "@/lib/pdf/arabic-canvas";
import { hasArabic } from "@/lib/pdf/arabic-text";
import type { TextOverlay } from "@/lib/pdf/export-overlays";

/**
 * Renders Arabic overlay text as a PNG (browser HarfBuzz shaping).
 * Matches export output — HTML divs can diverge inside RTL app shells.
 */
export function PdfTextOverlayView({
  overlay,
  boxWidthPx,
}: {
  overlay: TextOverlay;
  boxWidthPx: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!hasArabic(overlay.text)) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      const raster = await rasterizePdfTextBlock({
        text: overlay.text,
        fontSize: overlay.fontSize,
        color: overlay.color || "#111827",
        boxWidth: Math.max(40, boxWidthPx),
        align: overlay.align || "end",
        rtl: overlay.dir !== "ltr",
        bold: Boolean(overlay.bold),
        italic: Boolean(overlay.italic),
        underline: Boolean(overlay.underline),
        fontFamily: overlay.fontFamily || "noto",
      });
      if (cancelled || !raster) return;
      objectUrl = URL.createObjectURL(
        new Blob([new Uint8Array(raster.bytes)], { type: "image/png" }),
      );
      setSrc(objectUrl);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    overlay.text,
    overlay.fontSize,
    overlay.color,
    overlay.align,
    overlay.dir,
    overlay.bold,
    overlay.italic,
    overlay.underline,
    overlay.fontFamily,
    boxWidthPx,
  ]);

  if (!src) {
    return (
      <div className="h-full w-full animate-pulse bg-white/10" aria-hidden />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="pointer-events-none h-full w-full object-contain object-left-top"
      draggable={false}
    />
  );
}
