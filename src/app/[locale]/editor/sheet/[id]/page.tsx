import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { ExcelEditorClient } from "@/components/excel-editor/ExcelEditorClient";
import { getDocumentForOwner, requireUser } from "@/lib/db";
import { isXlsxMime } from "@/lib/documents";

export default async function SheetEditorPage({
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

  if (!isXlsxMime(doc.mimeType)) {
    if (doc.mimeType?.includes("pdf")) {
      redirect(`/${locale}/editor/pdf/${doc.id}`);
    }
    redirect(`/${locale}/editor/${doc.id}`);
  }

  return <ExcelEditorClient documentId={doc.id} title={doc.title} />;
}
