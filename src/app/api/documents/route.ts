import { NextResponse } from "next/server";
import {
  createBlankDocxBuffer,
} from "@/lib/blank-docx";
import { createBlankPdfBuffer } from "@/lib/blank-pdf";
import { createBlankXlsxBuffer } from "@/lib/blank-xlsx";
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
import {
  ensureProfile,
  listDocumentsForOwner,
  requireUser,
} from "@/lib/db";
import { prisma } from "@/lib/prisma";

const recentUploads = new Map<string, number[]>();

function rateLimit(userId: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const hits = (recentUploads.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) return false;
  hits.push(now);
  recentUploads.set(userId, hits);
  return true;
}

async function persistDocument(opts: {
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"];
  userId: string;
  id: string;
  title: string;
  storagePath: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const { supabase, userId, id, title, storagePath, mimeType, buffer } = opts;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    return { error: uploadError.message };
  }

  const payload = {
    id,
    owner_id: userId,
    title,
    storage_path: storagePath,
    mime_type: mimeType,
    byte_size: buffer.byteLength,
  };

  if (prisma) {
    await prisma.document.create({
      data: {
        id,
        ownerId: userId,
        title,
        storagePath,
        mimeType,
        byteSize: buffer.byteLength,
      },
    });
  } else {
    const { error: insertError } = await supabase.from("documents").insert(payload);
    if (insertError) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return { error: insertError.message };
    }
  }

  return {
    document: {
      id,
      ownerId: userId,
      title,
      storagePath,
      mimeType,
      byteSize: buffer.byteLength,
    },
  };
}

export async function GET() {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureProfile(user);
  const documents = await listDocumentsForOwner(user.id);
  return NextResponse.json({ documents });
}

export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!rateLimit(user.id)) {
    return NextResponse.json({ error: "Too many uploads" }, { status: 429 });
  }

  await ensureProfile(user);

  const contentType = request.headers.get("content-type") || "";

  // JSON create blank document
  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as {
        action?: string;
        type?: string;
        title?: string;
      };
      if (body.action !== "create") {
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
      }

      const kind =
        body.type === "pdf" ? "pdf" : body.type === "xlsx" ? "xlsx" : "docx";
      const id = createDocumentId();
      const title = sanitizeTitle(
        body.title ||
          (kind === "pdf"
            ? "مستند PDF جديد"
            : kind === "xlsx"
              ? "جدول جديد"
              : "مستند جديد"),
      );

      if (kind === "pdf") {
        const buffer = await createBlankPdfBuffer(title);
        const storagePath = `${user.id}/${id}.pdf`;
        const result = await persistDocument({
          supabase,
          userId: user.id,
          id,
          title,
          storagePath,
          mimeType: PDF_MIME,
          buffer,
        });
        if ("error" in result && result.error) {
          return NextResponse.json({ error: result.error }, { status: 500 });
        }
        return NextResponse.json(result);
      }

      if (kind === "xlsx") {
        const buffer = await createBlankXlsxBuffer(title);
        const storagePath = `${user.id}/${id}.xlsx`;
        const result = await persistDocument({
          supabase,
          userId: user.id,
          id,
          title,
          storagePath,
          mimeType: XLSX_MIME,
          buffer,
        });
        if ("error" in result && result.error) {
          return NextResponse.json({ error: result.error }, { status: 500 });
        }
        return NextResponse.json(result);
      }

      const buffer = await createBlankDocxBuffer(title);
      const storagePath = `${user.id}/${id}.docx`;
      const result = await persistDocument({
        supabase,
        userId: user.id,
        id,
        title,
        storagePath,
        mimeType: DOCX_MIME,
        buffer,
      });
      if ("error" in result && result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not create document";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const id = createDocumentId();
  const title = sanitizeTitle(file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (isPdfFile(file)) {
    const storagePath = `${user.id}/${id}.pdf`;
    const result = await persistDocument({
      supabase,
      userId: user.id,
      id,
      title,
      storagePath,
      mimeType: PDF_MIME,
      buffer,
    });
    if ("error" in result && result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json(result);
  }

  if (isXlsxFile(file)) {
    const storagePath = `${user.id}/${id}.xlsx`;
    const result = await persistDocument({
      supabase,
      userId: user.id,
      id,
      title,
      storagePath,
      mimeType: XLSX_MIME,
      buffer,
    });
    if ("error" in result && result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json(result);
  }

  if (!isDocxFile(file)) {
    return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  }

  const storagePath = `${user.id}/${id}.docx`;
  const result = await persistDocument({
    supabase,
    userId: user.id,
    id,
    title,
    storagePath,
    mimeType: DOCX_MIME,
    buffer,
  });
  if ("error" in result && result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
