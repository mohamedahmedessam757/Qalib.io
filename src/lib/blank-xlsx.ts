import ExcelJS from "exceljs";

export async function createBlankXlsxBuffer(
  title = "Sheet1",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Qalib";
  wb.created = new Date();
  const sheet = wb.addWorksheet(title.slice(0, 31) || "Sheet1");
  sheet.getCell("A1").value = title.slice(0, 80) || "Workbook";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getColumn(1).width = 24;
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
