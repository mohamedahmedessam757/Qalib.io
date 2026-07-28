import { PDFDocument, rgb } from "pdf-lib";

/**
 * Truly blank PDF page — no baked-in title.
 * (Older builds drew "مستند PDF جديد" without Arabic shaping; that text
 * lived in the content stream and could not be deleted from the editor.)
 */
export async function createBlankPdfBuffer(
  _title = "مستند PDF جديد",
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  // Letter size
  pdf.addPage([612, 792]);
  // Soft off-white so the page is visible on dark chrome; no text.
  const page = pdf.getPage(0);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 612,
    height: 792,
    color: rgb(1, 1, 1),
  });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
