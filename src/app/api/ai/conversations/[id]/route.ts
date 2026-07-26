import { NextResponse } from "next/server";
import { requireUser } from "@/lib/db";
import {
  deleteConversation,
  getConversationForOwner,
  listMessages,
} from "@/lib/ai/conversations";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversation = await getConversationForOwner(supabase, id, user.id);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const messages = await listMessages(supabase, id);
    return NextResponse.json({ conversation, messages });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversation = await getConversationForOwner(supabase, id, user.id);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await deleteConversation(supabase, id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete" },
      { status: 500 },
    );
  }
}
