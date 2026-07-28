import { NextResponse } from "next/server";
import {
  DOCX_MIME,
  isPdfMime,
  isXlsxMime,
  MAX_UPLOAD_BYTES,
  PDF_MIME,
  sanitizeTitle,
  STORAGE_BUCKET,
  XLSX_MIME,
} from "@/lib/documents";
import { getDocumentForOwner, requireUser } from "@/lib/db";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const doc = await getDocumentForOwner(id, user.id);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(doc.storagePath, 60 * 10);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: error?.message ?? "Could not sign URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({ document: doc, signedUrl: data.signedUrl });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const doc = await getDocumentForOwner(id, user.id);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") || "";

  // Rename title via JSON body
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { title?: string };
    const title = sanitizeTitle(body.title || "");
    if (!title) {
      return NextResponse.json({ error: "Missing title" }, { status: 400 });
    }

    if (prisma) {
      await prisma.document.update({
        where: { id },
        data: { title },
      });
    } else {
      const { error } = await supabase
        .from("documents")
        .update({ title })
        .eq("id", id)
        .eq("owner_id", user.id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, title });
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const mimeType = isPdfMime(doc.mimeType)
    ? PDF_MIME
    : isXlsxMime(doc.mimeType)
      ? XLSX_MIME
      : DOCX_MIME;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(doc.storagePath, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  if (prisma) {
    await prisma.document.update({
      where: { id },
      data: { byteSize: buffer.byteLength },
    });
  } else {
    const { error } = await supabase
      .from("documents")
      .update({ byte_size: buffer.byteLength })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, byteSize: buffer.byteLength });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const doc = await getDocumentForOwner(id, user.id);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await supabase.storage.from(STORAGE_BUCKET).remove([doc.storagePath]);

  if (prisma) {
    await prisma.document.delete({ where: { id } });
  } else {
    await supabase.from("documents").delete().eq("id", id).eq("owner_id", user.id);
  }

  return NextResponse.json({ ok: true });
}
