import { NextResponse } from "next/server";
import {
  DOCX_MIME,
  isPdfMime,
  isXlsxMime,
  MAX_UPLOAD_BYTES,
  PDF_MIME,
  STORAGE_BUCKET,
  storageUploadContentType,
  XLSX_MIME,
} from "@/lib/documents";
import { getDocumentForOwner, requireUser } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * Signed upload URL for replacing an existing document (editor save).
 * Uses upsert so the same storage path can be overwritten.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const doc = await getDocumentForOwner(id, user.id);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { byteSize?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* byteSize optional */
  }

  const byteSize = Number(body.byteSize);
  if (Number.isFinite(byteSize) && byteSize > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const mimeType = isPdfMime(doc.mimeType)
    ? PDF_MIME
    : isXlsxMime(doc.mimeType)
      ? XLSX_MIME
      : DOCX_MIME;

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(doc.storagePath, { upsert: true });

  if (error || !data?.token || !data.path) {
    return NextResponse.json(
      { error: error?.message || "Could not create upload URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
    contentType: storageUploadContentType(mimeType),
    mimeType,
  });
}
