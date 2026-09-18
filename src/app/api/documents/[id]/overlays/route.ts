import { NextResponse } from "next/server";
import {
  MAX_UPLOAD_BYTES,
  overlaysStoragePath,
  STORAGE_BUCKET,
} from "@/lib/documents";
import { getDocumentForOwner, requireUser } from "@/lib/db";

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

  const path = overlaysStoragePath(doc.storagePath);
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);

  if (error || !data) {
    return NextResponse.json({ overlays: [] });
  }

  try {
    const text = await data.text();
    const parsed = JSON.parse(text) as { overlays?: unknown };
    const overlays = Array.isArray(parsed?.overlays)
      ? parsed.overlays
      : Array.isArray(parsed)
        ? parsed
        : [];
    return NextResponse.json({ overlays });
  } catch {
    return NextResponse.json({ overlays: [] });
  }
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const overlays = Array.isArray(body)
    ? body
    : Array.isArray((body as { overlays?: unknown })?.overlays)
      ? (body as { overlays: unknown[] }).overlays
      : null;

  if (!overlays) {
    return NextResponse.json({ error: "Missing overlays" }, { status: 400 });
  }

  const payload = JSON.stringify({ version: 1, overlays });
  if (payload.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Overlays too large" }, { status: 400 });
  }

  const path = overlaysStoragePath(doc.storagePath);
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, new Blob([payload], { type: "application/octet-stream" }), {
      contentType: "application/octet-stream",
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: overlays.length });
}
