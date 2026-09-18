import { NextResponse } from "next/server";
import {
  createDocumentId,
  DOCX_MIME,
  isDocxFile,
  isPdfFile,
  isXlsxFile,
  MAX_UPLOAD_BYTES,
  PDF_MIME,
  sanitizeTitle,
  STORAGE_BUCKET,
  XLSX_MIME,
} from "@/lib/documents";
import { ensureProfile, requireUser } from "@/lib/db";

const recentUploads = new Map<string, number[]>();

function rateLimit(userId: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const hits = (recentUploads.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) return false;
  hits.push(now);
  recentUploads.set(userId, hits);
  return true;
}

/**
 * Issue a short-lived signed upload URL so the browser can PUT the file
 * straight to Supabase Storage (bypasses Vercel 413 body limits).
 */
export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!rateLimit(user.id)) {
    return NextResponse.json({ error: "Too many uploads" }, { status: 429 });
  }

  await ensureProfile(user);

  let body: {
    fileName?: string;
    byteSize?: number;
    mimeType?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fileName = String(body.fileName || "").trim();
  const byteSize = Number(body.byteSize);
  if (!fileName || !Number.isFinite(byteSize) || byteSize <= 0) {
    return NextResponse.json({ error: "Missing file metadata" }, { status: 400 });
  }
  if (byteSize > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const probe = {
    name: fileName,
    type: String(body.mimeType || ""),
  };
  let mimeType: string;
  let ext: string;
  if (isPdfFile(probe)) {
    mimeType = PDF_MIME;
    ext = "pdf";
  } else if (isXlsxFile(probe)) {
    mimeType = XLSX_MIME;
    ext = "xlsx";
  } else if (isDocxFile(probe)) {
    mimeType = DOCX_MIME;
    ext = "docx";
  } else {
    return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  }

  const id = createDocumentId();
  const title = sanitizeTitle(fileName);
  const storagePath = `${user.id}/${id}.${ext}`;

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data?.token || !data.path) {
    return NextResponse.json(
      { error: error?.message || "Could not create upload URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id,
    title,
    storagePath,
    mimeType,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
  });
}
