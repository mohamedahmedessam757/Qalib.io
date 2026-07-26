import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Files } from "lucide-react";
import { AppShell } from "@/components/ui/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { DocumentsClient } from "@/components/documents/DocumentsClient";
import { ensureProfile, listDocumentsForOwner, requireUser } from "@/lib/db";

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("documents");

  const { user } = await requireUser();
  if (!user) {
    redirect(`/${locale}/login`);
  }

  await ensureProfile(user);
  const documents = await listDocumentsForOwner(user.id);

  return (
    <AppShell>
      <PageHeader
        title={t("title")}
        badge={
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white/5 px-3 py-1 text-xs text-accent">
            <Files className="h-3.5 w-3.5" />
            {documents.length}
          </span>
        }
      />
      <DocumentsClient
        initialDocs={documents.map((d) => ({
          id: d.id,
          title: d.title,
          updatedAt: d.updatedAt,
          byteSize: d.byteSize,
          mimeType: d.mimeType,
        }))}
      />
    </AppShell>
  );
}
