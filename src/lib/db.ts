import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export type DocumentRow = {
  id: string;
  ownerId: string;
  title: string;
  storagePath: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
};

function mapSupabaseDoc(row: {
  id: string;
  owner_id: string;
  title: string;
  storage_path: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
  updated_at: string;
}): DocumentRow {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null };
  return { supabase, user };
}

export async function ensureProfile(
  user: { id: string; email?: string | null },
  locale = "ar",
) {
  const email = user.email ?? "owner@qalib.local";
  if (prisma) {
    await prisma.profile.upsert({
      where: { id: user.id },
      create: { id: user.id, email, locale },
      update: { email },
    });
    return;
  }
  const supabase = await createClient();
  await supabase.from("profiles").upsert(
    {
      id: user.id,
      email,
      locale,
    },
    { onConflict: "id" },
  );
}

export async function listDocumentsForOwner(ownerId: string) {
  if (prisma) {
    const rows = await prisma.document.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      title: r.title,
      storagePath: r.storagePath,
      mimeType: r.mimeType,
      byteSize: r.byteSize,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapSupabaseDoc);
}

export async function getDocumentForOwner(id: string, ownerId: string) {
  if (prisma) {
    const row = await prisma.document.findFirst({
      where: { id, ownerId },
    });
    if (!row) return null;
    return {
      id: row.id,
      ownerId: row.ownerId,
      title: row.title,
      storagePath: row.storagePath,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapSupabaseDoc(data) : null;
}
