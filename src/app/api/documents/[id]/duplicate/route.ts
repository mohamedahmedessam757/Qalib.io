import { NextResponse } from "next/server";
import {
  createDocumentId,
  isPdfMime,
  isXlsxMime,
  overlaysStoragePath,
  STORAGE_BUCKET,
} from "@/lib/documents";
import { nextDuplicateTitle } from "@/lib/document-duplicate";
import {
  getDocumentForOwner,
  listDocumentsForOwner,
  requireUser,
} from "@/lib/db";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const recentDupes = new Map<string, number[]>();

function rateLimit(userId: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const hits = (recentDupes.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) return false;
  hits.push(now);
  recentDupes.set(userId, hits);
  return true;
}

function extensionForDoc(mimeType: string, storagePath: string) {
  if (isPdfMime(mimeType) || storagePath.toLowerCase().endsWith(".pdf")) {
    return "pdf";
  }
  if (isXlsxMime(mimeType) || storagePath.toLowerCase().endsWith(".xlsx")) {
    return "xlsx";
  }
  return "docx";
}

/**
 * Duplicate a document: copy storage bytes (+ PDF overlays) and insert a
 * sibling row titled "Name 1", "Name 2", …
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!rateLimit(user.id)) {
    return NextResponse.json({ error: "Too many duplicates" }, { status: 429 });
  }

  const source = await getDocumentForOwner(id, user.id);
  if (!source) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const siblings = await listDocumentsForOwner(user.id);
  const title = nextDuplicateTitle(
    source.title,
    siblings.map((d) => d.title),
  );

  const newId = createDocumentId();
  const ext = extensionForDoc(source.mimeType, source.storagePath);
  const storagePath = `${user.id}/${newId}.${ext}`;

  const { error: copyError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .copy(source.storagePath, storagePath);

  if (copyError) {
    return NextResponse.json(
      { error: copyError.message || "Could not copy file" },
      { status: 500 },
    );
  }

  // Best-effort: copy editable PDF overlays sidecar when present.
  if (isPdfMime(source.mimeType)) {
    const fromOverlays = overlaysStoragePath(source.storagePath);
    const toOverlays = overlaysStoragePath(storagePath);
    await supabase.storage.from(STORAGE_BUCKET).copy(fromOverlays, toOverlays);
  }

  const payload = {
    id: newId,
    owner_id: user.id,
    title,
    storage_path: storagePath,
    mime_type: source.mimeType,
    byte_size: source.byteSize,
  };

  try {
    if (prisma) {
      await prisma.document.create({
        data: {
          id: newId,
          ownerId: user.id,
          title,
          storagePath,
          mimeType: source.mimeType,
          byteSize: source.byteSize,
        },
      });
    } else {
      const { error: insertError } = await supabase
        .from("documents")
        .insert(payload);
      if (insertError) {
        throw new Error(insertError.message);
      }
    }
  } catch (err) {
    await supabase.storage.from(STORAGE_BUCKET).remove([
      storagePath,
      overlaysStoragePath(storagePath),
    ]);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not create duplicate",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    document: {
      id: newId,
      ownerId: user.id,
      title,
      storagePath,
      mimeType: source.mimeType,
      byteSize: source.byteSize,
    },
  });
}
