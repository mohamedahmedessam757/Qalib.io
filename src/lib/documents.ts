export const MAX_DOCX_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME = "application/pdf";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const STORAGE_BUCKET = "documents";

/** Mobile pickers often send empty or generic MIME — trust extension then. */
function isGenericOrEmptyMime(type: string) {
  const t = (type || "").trim().toLowerCase();
  return (
    !t ||
    t === "application/octet-stream" ||
    t === "binary/octet-stream" ||
    t === "application/download" ||
    t === "application/x-download" ||
    t === "application/zip"
  );
}

export function isDocxFile(file: { name: string; type: string }) {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".docx")) return false;
  if (isGenericOrEmptyMime(file.type)) return true;
  return (
    file.type === DOCX_MIME ||
    file.type === "application/msword" ||
    file.type === "application/vnd.ms-word"
  );
}

export function isPdfFile(file: { name: string; type: string }) {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".pdf")) return false;
  if (isGenericOrEmptyMime(file.type)) return true;
  return file.type === PDF_MIME || file.type === "application/x-pdf";
}

export function isXlsxFile(file: { name: string; type: string }) {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".xlsx")) return false;
  if (isGenericOrEmptyMime(file.type)) return true;
  return (
    file.type === XLSX_MIME ||
    file.type === "application/vnd.ms-excel"
  );
}

export function isSupportedUpload(file: { name: string; type: string }) {
  return isDocxFile(file) || isPdfFile(file) || isXlsxFile(file);
}

export function sanitizeTitle(name: string) {
  return (
    name
      .replace(/\.docx$/i, "")
      .replace(/\.pdf$/i, "")
      .replace(/\.xlsx$/i, "")
      .slice(0, 180) || "document"
  );
}

export function createDocumentId() {
  return `doc_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function isPdfMime(mimeType: string | null | undefined) {
  return mimeType === PDF_MIME || mimeType === "application/x-pdf";
}

export function isXlsxMime(mimeType: string | null | undefined) {
  return (
    mimeType === XLSX_MIME ||
    mimeType === "application/vnd.ms-excel"
  );
}

/**
 * Supabase Storage buckets often whitelist only pdf/docx.
 * Keep the real mime in the DB; upload bytes with a bucket-safe type.
 */
export function storageUploadContentType(mimeType: string) {
  if (mimeType === XLSX_MIME || mimeType === "application/vnd.ms-excel") {
    return "application/octet-stream";
  }
  return mimeType;
}

export function editorPathForMime(id: string, mimeType?: string | null) {
  if (isPdfMime(mimeType)) return `/editor/pdf/${id}`;
  if (isXlsxMime(mimeType)) return `/editor/sheet/${id}`;
  return `/editor/${id}`;
}

/** Sidecar JSON next to the PDF so overlays stay editable after save. */
export function overlaysStoragePath(storagePath: string) {
  // Keep a storage-safe key (some buckets only allow known extensions).
  return `${storagePath}.overlays`;
}
