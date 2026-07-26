import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { PdfEditorClient } from "@/components/pdf-editor/PdfEditorClient";
import { getDocumentForOwner, requireUser } from "@/lib/db";
import { isPdfMime } from "@/lib/documents";

export default async function PdfEditorPage({
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

  if (!isPdfMime(doc.mimeType)) {
    redirect(`/${locale}/editor/${doc.id}`);
  }

  return <PdfEditorClient documentId={doc.id} title={doc.title} />;
}
