import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type AiConversation = {
  id: string;
  ownerId: string;
  documentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AiMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls: unknown | null;
  createdAt: string;
};

export function createAiId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function listConversationsForDocument(
  supabase: Supabase,
  ownerId: string,
  documentId: string,
): Promise<AiConversation[]> {
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("document_id", documentId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    ownerId: r.owner_id as string,
    documentId: r.document_id as string,
    title: r.title as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

export async function createConversation(
  supabase: Supabase,
  ownerId: string,
  documentId: string,
  title: string,
): Promise<AiConversation> {
  const id = createAiId("conv");
  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({
      id,
      owner_id: ownerId,
      document_id: documentId,
      title,
    })
    .select("*")
    .single();
  if (error) throw error;
  return {
    id: data.id as string,
    ownerId: data.owner_id as string,
    documentId: data.document_id as string,
    title: data.title as string,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

export async function getConversationForOwner(
  supabase: Supabase,
  id: string,
  ownerId: string,
): Promise<AiConversation | null> {
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as string,
    ownerId: data.owner_id as string,
    documentId: data.document_id as string,
    title: data.title as string,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

export async function deleteConversation(
  supabase: Supabase,
  id: string,
  ownerId: string,
) {
  const { error } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
}

export async function listMessages(
  supabase: Supabase,
  conversationId: string,
): Promise<AiMessage[]> {
  const { data, error } = await supabase
    .from("ai_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    conversationId: r.conversation_id as string,
    role: r.role as AiMessage["role"],
    content: (r.content as string) || "",
    toolCalls: r.tool_calls ?? null,
    createdAt: r.created_at as string,
  }));
}

export async function appendMessage(
  supabase: Supabase,
  opts: {
    conversationId: string;
    role: AiMessage["role"];
    content: string;
    toolCalls?: unknown;
  },
) {
  const id = createAiId("msg");
  const content = opts.content.slice(0, 20_000);

  const { error } = await supabase.from("ai_messages").insert({
    id,
    conversation_id: opts.conversationId,
    role: opts.role,
    content,
    tool_calls: opts.toolCalls ?? null,
  });
  if (error) throw error;

  await supabase
    .from("ai_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", opts.conversationId);

  return id;
}
