import { readFile } from "fs/promises";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

let cachedFontBytes: Uint8Array | null | undefined;

async function loadArabicFontBytes() {
  if (cachedFontBytes !== undefined) return cachedFontBytes;
  try {
    const fontPath = path.join(
      process.cwd(),
      "public",
      "fonts",
      "NotoSansArabic-Regular.ttf",
    );
    cachedFontBytes = new Uint8Array(await readFile(fontPath));
  } catch {
    cachedFontBytes = null;
  }
  return cachedFontBytes;
}

function needsArabic(text: string) {
  return /[\u0600-\u06FF]/.test(text);
}

export async function createBlankPdfBuffer(
  title = "مستند PDF جديد",
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([612, 792]);
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);

  let font = helvetica;
  let text = title.slice(0, 80) || "Document";

  if (needsArabic(text)) {
    const arabicBytes = await loadArabicFontBytes();
    if (arabicBytes) {
      try {
        font = await pdf.embedFont(arabicBytes, { subset: true });
      } catch {
        font = helvetica;
        text = "New PDF document";
      }
    } else {
      text = "New PDF document";
    }
  }

  try {
    page.drawText(text, {
      x: 72,
      y: 720,
      size: 18,
      font,
      color: rgb(0.15, 0.15, 0.18),
    });
  } catch {
    page.drawText("New PDF document", {
      x: 72,
      y: 720,
      size: 18,
      font: helvetica,
      color: rgb(0.15, 0.15, 0.18),
    });
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
