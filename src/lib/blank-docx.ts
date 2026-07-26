import { Document, Packer, Paragraph, TextRun } from "docx";

export async function createBlankDocxBuffer(title = "مستند جديد"): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: title,
                bold: true,
                size: 28,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: " ",
                size: 22,
              }),
            ],
          }),
        ],
      },
    ],
  });
  const out = await Packer.toBuffer(doc);
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
