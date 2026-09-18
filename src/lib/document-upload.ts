/**
 * Client helpers: upload documents directly to Supabase Storage so large
 * files never hit the Vercel request-body 413 limit (and upload faster).
 */

import {
  DOCX_MIME,
  isDocxFile,
  isPdfFile,
  isXlsxFile,
  MAX_UPLOAD_BYTES,
  PDF_MIME,
  storageUploadContentType,
  STORAGE_BUCKET,
  XLSX_MIME,
} from "@/lib/documents";
import { createClient } from "@/lib/supabase/client";

export type UploadedDocument = {
  id: string;
  title: string;
  byteSize: number;
  mimeType: string;
  storagePath: string;
};

export class DocumentUploadError extends Error {
  constructor(
    message: string,
    readonly code:
      | "too_large"
      | "invalid_type"
      | "unauthorized"
      | "network"
      | "storage"
      | "register"
      | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "DocumentUploadError";
  }
}

/** Parse API JSON safely — proxies often return plain text on 413. */
export async function readApiJson<T = unknown>(
  res: Response,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      const trimmed = text.replace(/\s+/g, " ").trim().slice(0, 180);
      if (res.status === 413 || /request entity too large/i.test(trimmed)) {
        return {
          ok: false,
          status: 413,
          error: "Request too large for the edge proxy",
        };
      }
      return {
        ok: false,
        status: res.status,
        error: trimmed || `HTTP ${res.status}`,
      };
    }
  }
  if (!res.ok) {
    const err =
      data &&
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: err };
  }
  return { ok: true, data: data as T };
}

function mimeForFile(file: { name: string; type: string }) {
  if (isPdfFile(file)) return PDF_MIME;
  if (isXlsxFile(file)) return XLSX_MIME;
  if (isDocxFile(file)) return DOCX_MIME;
  return null;
}

async function putToSignedUrl(opts: {
  path: string;
  token: string;
  body: Blob;
  contentType: string;
  upsert?: boolean;
}) {
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .uploadToSignedUrl(opts.path, opts.token, opts.body, {
      contentType: opts.contentType,
      upsert: opts.upsert ?? false,
    });
  if (!error) return;

  // Fallback: session upload still goes browser → Supabase (not through Vercel).
  const { error: fallbackError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(opts.path, opts.body, {
      contentType: opts.contentType,
      upsert: opts.upsert ?? false,
    });
  if (fallbackError) {
    throw new DocumentUploadError(
      fallbackError.message || error.message || "Storage upload failed",
      "storage",
    );
  }
}

/**
 * New library upload: sign → direct storage PUT → register row.
 * Body never goes through /api/documents FormData (avoids 413).
 */
export async function uploadNewDocumentFile(
  file: File,
): Promise<UploadedDocument> {
  if (file.size <= 0) {
    throw new DocumentUploadError("Empty file", "invalid_type");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new DocumentUploadError("File too large", "too_large");
  }
  const mimeType = mimeForFile(file);
  if (!mimeType) {
    throw new DocumentUploadError("Invalid file type", "invalid_type");
  }

  const sessionRes = await fetch("/api/documents/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      byteSize: file.size,
      mimeType,
    }),
  });
  const session = await readApiJson<{
    id: string;
    title: string;
    storagePath: string;
    mimeType: string;
    path: string;
    token: string;
  }>(sessionRes);
  if (!session.ok) {
    if (session.status === 401) {
      throw new DocumentUploadError(session.error, "unauthorized");
    }
    if (session.status === 413 || /too large/i.test(session.error)) {
      throw new DocumentUploadError(session.error, "too_large");
    }
    throw new DocumentUploadError(session.error, "network");
  }

  const { id, title, storagePath, path, token } = session.data;
  const contentType = storageUploadContentType(mimeType);

  await putToSignedUrl({
    path,
    token,
    body: file,
    contentType,
    upsert: false,
  });

  const registerRes = await fetch("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "register",
      id,
      title,
      storagePath,
      mimeType,
      byteSize: file.size,
    }),
  });
  const registered = await readApiJson<{ document: UploadedDocument }>(
    registerRes,
  );
  if (!registered.ok) {
    throw new DocumentUploadError(registered.error, "register");
  }
  return registered.data.document;
}

/**
 * Replace an existing document's bytes (editor save) via signed upload.
 */
export async function replaceDocumentBytes(opts: {
  documentId: string;
  bytes: ArrayBuffer | Uint8Array | Blob;
  contentType: string;
}): Promise<void> {
  const blob =
    opts.bytes instanceof Blob
      ? opts.bytes
      : new Blob([opts.bytes as BlobPart], { type: opts.contentType });

  if (blob.size <= 0) {
    throw new DocumentUploadError("Empty body", "invalid_type");
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new DocumentUploadError("File too large", "too_large");
  }

  const sessionRes = await fetch(
    `/api/documents/${encodeURIComponent(opts.documentId)}/upload-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ byteSize: blob.size }),
    },
  );
  const session = await readApiJson<{
    path: string;
    token: string;
    contentType: string;
  }>(sessionRes);
  if (!session.ok) {
    throw new DocumentUploadError(session.error, "network");
  }

  await putToSignedUrl({
    path: session.data.path,
    token: session.data.token,
    body: blob,
    contentType: session.data.contentType || storageUploadContentType(opts.contentType),
    upsert: true,
  });

  const confirmRes = await fetch(
    `/api/documents/${encodeURIComponent(opts.documentId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "confirm-upload",
        byteSize: blob.size,
      }),
    },
  );
  const confirmed = await readApiJson(confirmRes);
  if (!confirmed.ok) {
    throw new DocumentUploadError(confirmed.error, "register");
  }
}
