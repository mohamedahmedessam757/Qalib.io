export const MAX_DOCX_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME = "application/pdf";
export const STORAGE_BUCKET = "documents";

export function isDocxFile(file: { name: string; type: string }) {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".docx")) return false;
  if (
    file.type &&
    file.type !== DOCX_MIME &&
    file.type !== "application/octet-stream" &&
    file.type !== "application/zip"
  ) {
    return false;
  }
  return true;
}

export function isPdfFile(file: { name: string; type: string }) {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".pdf")) return false;
  if (
    file.type &&
    file.type !== PDF_MIME &&
    file.type !== "application/octet-stream"
  ) {
    return false;
  }
  return true;
}

export function isSupportedUpload(file: { name: string; type: string }) {
  return isDocxFile(file) || isPdfFile(file);
}

export function sanitizeTitle(name: string) {
  return (
    name
      .replace(/\.docx$/i, "")
      .replace(/\.pdf$/i, "")
      .slice(0, 180) || "document"
  );
}

export function createDocumentId() {
  return `doc_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function isPdfMime(mimeType: string | null | undefined) {
  return mimeType === PDF_MIME || mimeType === "application/x-pdf";
}
