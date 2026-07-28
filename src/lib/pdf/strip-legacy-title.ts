/**
 * Detect the old blank-template title baked into early Qalib PDFs and return
 * a whiteout box covering it (normalized 0–1 coords, top-left origin).
 */
export async function findLegacyBlankTitleBox(
  buffer: ArrayBuffer,
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
    if (pdf.numPages < 1) return null;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const markers = ["مستند", "جديد", "PDF", "New PDF", "document"];
    type Hit = { x: number; y: number; w: number; h: number; str: string };
    const hits: Hit[] = [];

    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str) continue;
      const str = String(raw.str);
      const matched = markers.some((m) => str.includes(m));
      if (!matched && !/[\u0600-\u06FF]/.test(str)) continue;
      // Only care about items near the top of page 1 (legacy title zone)
      const tx = pdfjs.Util.transform(viewport.transform, raw.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]) || 14;
      const width = (("width" in raw ? Number(raw.width) : 0) || str.length * 8);
      const x = tx[4];
      const y = viewport.height - tx[5];
      if (y > viewport.height * 0.22) continue;
      hits.push({
        x,
        y: y - fontHeight,
        w: Math.max(width, 40),
        h: Math.max(fontHeight * 1.4, 16),
        str,
      });
    }

    if (!hits.length) return null;
    // Prefer hits that look like the old title
    const titleish = hits.filter(
      (h) =>
        h.str.includes("مستند") ||
        h.str.includes("جديد") ||
        h.str.includes("New PDF") ||
        (h.str.includes("PDF") && /[\u0600-\u06FF]/.test(h.str)),
    );
    const use = titleish.length ? titleish : hits.slice(0, 3);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = 0;
    let maxY = 0;
    for (const h of use) {
      minX = Math.min(minX, h.x);
      minY = Math.min(minY, h.y);
      maxX = Math.max(maxX, h.x + h.w);
      maxY = Math.max(maxY, h.y + h.h);
    }
    // Pad so isolated glyphs are fully covered
    minX = Math.max(0, minX - 8);
    minY = Math.max(0, minY - 6);
    maxX = Math.min(viewport.width, maxX + 8);
    maxY = Math.min(viewport.height, maxY + 6);

    return {
      x: minX / viewport.width,
      y: minY / viewport.height,
      w: (maxX - minX) / viewport.width,
      h: (maxY - minY) / viewport.height,
    };
  } catch {
    return null;
  }
}
