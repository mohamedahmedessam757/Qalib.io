import { NextResponse } from "next/server";
import { getDocumentForOwner, requireUser } from "@/lib/db";
import {
  createConversation,
  listConversationsForDocument,
} from "@/lib/ai/conversations";

export async function GET(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const documentId = new URL(request.url).searchParams.get("documentId");
  if (!documentId) {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }

  const doc = await getDocumentForOwner(documentId, user.id);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const conversations = await listConversationsForDocument(
      supabase,
      user.id,
      documentId,
    );
    return NextResponse.json({ conversations });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    documentId?: string;
    title?: string;
  } | null;

  const documentId = body?.documentId;
  if (!documentId) {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }

  const doc = await getDocumentForOwner(documentId, user.id);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const conversation = await createConversation(
      supabase,
      user.id,
      documentId,
      (body?.title || "Conversation").slice(0, 120),
    );
    return NextResponse.json({ conversation });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create" },
      { status: 500 },
    );
  }
}
