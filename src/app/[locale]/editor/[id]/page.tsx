import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { DocxEditorClient } from "@/components/editor/DocxEditorClient";
import { getDocumentForOwner, requireUser } from "@/lib/db";
import { isPdfMime } from "@/lib/documents";

export default async function EditorPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { user } = await requireUser();
  if (!user) {
    redirect(`/${locale}/login`);
  }

  const doc = await getDocumentForOwner(id, user.id);
  if (!doc) notFound();

  if (isPdfMime(doc.mimeType)) {
    redirect(`/${locale}/editor/pdf/${doc.id}`);
  }

  return <DocxEditorClient documentId={doc.id} title={doc.title} />;
}
