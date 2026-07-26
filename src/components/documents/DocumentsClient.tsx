"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import {
  FilePlus2,
  FileText,
  FileUp,
  FolderOpen,
  LoaderCircle,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  isPdfMime,
  isSupportedUpload,
  MAX_UPLOAD_BYTES,
} from "@/lib/documents";
import { prefetchDocumentMeta } from "@/lib/document-cache";
import { Link, useRouter } from "@/i18n/navigation";
import {
  DocumentNameDialog,
  type CreateDocFormValues,
} from "./DocumentNameDialog";

type Doc = {
  id: string;
  title: string;
  updatedAt: string;
  byteSize: number;
  mimeType?: string;
};

const easeOut = [0.23, 1, 0.32, 1] as const;

function preloadDocxEditor() {
  void import("@/components/editor/DocxCanvas");
}

function preloadPdfEditor() {
  void import("@/components/pdf-editor/PdfEditorClient");
}

async function saveLocalCopy(opts: {
  documentId: string;
  title: string;
  mimeType: string;
  values: CreateDocFormValues;
}) {
  const { documentId, title, mimeType, values } = opts;
  const ext = isPdfMime(mimeType) ? ".pdf" : ".docx";
  const suggested =
    (values.localPath.replace(/[\\/]+$/, "") || title).replace(
      /\.(docx|pdf)$/i,
      "",
    ) + ext;

  const metaRes = await fetch(`/api/documents/${documentId}`);
  const meta = await metaRes.json();
  if (!metaRes.ok || !meta.signedUrl) return;

  const fileRes = await fetch(meta.signedUrl as string);
  if (!fileRes.ok) return;
  const blob = await fileRes.blob();

  if (values.fileHandle) {
    const writable = await values.fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  if (values.localPath.trim()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggested.split(/[\\/]/).pop() || suggested;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export function DocumentsClient({ initialDocs }: { initialDocs: Doc[] }) {
  const t = useTranslations("documents");
  const tc = useTranslations("common");
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocs);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState<"docx" | "pdf" | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createType, setCreateType] = useState<"docx" | "pdf" | null>(null);
  const [renameDoc, setRenameDoc] = useState<Doc | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function editorHref(doc: Pick<Doc, "id" | "mimeType">) {
    return isPdfMime(doc.mimeType)
      ? `/editor/pdf/${doc.id}`
      : `/editor/${doc.id}`;
  }

  async function onUpload(file: File) {
    if (!isSupportedUpload(file)) {
      toast.error(t("invalidType"));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(t("tooLarge"));
      return;
    }

    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("uploadError"));
      const created = json.document as {
        id: string;
        title: string;
        byteSize: number;
        mimeType: string;
      };
      setDocs((prev) => [
        {
          id: created.id,
          title: created.title,
          byteSize: created.byteSize,
          mimeType: created.mimeType,
          updatedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      toast.success(t("uploadSuccess"));
      router.push(editorHref(created));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("uploadError"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onCreateSubmit(values: CreateDocFormValues) {
    if (!createType) return;
    setCreating(createType);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          type: createType,
          title: values.title,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("createError"));
      const created = json.document as {
        id: string;
        title: string;
        byteSize: number;
        mimeType: string;
      };
      setDocs((prev) => [
        {
          id: created.id,
          title: created.title,
          byteSize: created.byteSize,
          mimeType: created.mimeType,
          updatedAt: new Date().toISOString(),
        },
        ...prev,
      ]);

      if (values.fileHandle || values.localPath.trim()) {
        try {
          await saveLocalCopy({
            documentId: created.id,
            title: created.title,
            mimeType: created.mimeType,
            values,
          });
          toast.success(t("localSaveSuccess"));
        } catch {
          toast.message(t("localSaveHint"));
        }
      }

      toast.success(t("createSuccess"));
      setCreateType(null);
      router.push(editorHref(created));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("createError"));
    } finally {
      setCreating(null);
    }
  }

  async function onRenameSubmit(values: CreateDocFormValues) {
    if (!renameDoc) return;
    setRenamingId(renameDoc.id);
    try {
      const res = await fetch(`/api/documents/${renameDoc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: values.title }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("renameError"));
      setDocs((prev) =>
        prev.map((d) =>
          d.id === renameDoc.id
            ? {
                ...d,
                title: json.title || values.title,
                updatedAt: new Date().toISOString(),
              }
            : d,
        ),
      );
      toast.success(t("renameSuccess"));
      setRenameDoc(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("renameError"));
    } finally {
      setRenamingId(null);
    }
  }

  async function onDelete(doc: Doc) {
    const ok = window.confirm(t("deleteConfirm", { title: doc.title }));
    if (!ok) return;
    setDeletingId(doc.id);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || t("deleteError"));
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success(t("deleteSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("deleteError"));
    } finally {
      setDeletingId(null);
    }
  }

  const busy =
    uploading || creating !== null || renamingId !== null || deletingId !== null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onUpload(file);
          }}
        />
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="min-h-11 gap-2"
        >
          {uploading ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {uploading ? tc("loading") : t("upload")}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          className="min-h-11 gap-2"
          onClick={() => setCreateType("docx")}
        >
          <FilePlus2 className="h-4 w-4" />
          {t("newDoc")}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          className="min-h-11 gap-2"
          onClick={() => setCreateType("pdf")}
        >
          <FileText className="h-4 w-4" />
          {t("newPdf")}
        </Button>
      </div>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void onUpload(file);
        }}
        onClick={() => {
          if (!busy) inputRef.current?.click();
        }}
        className={`mb-6 grid place-items-center rounded-2xl border border-dashed px-4 py-10 text-center transition-colors duration-200 ${
          dragOver
            ? "border-accent bg-accent-soft text-accent"
            : "border-line bg-white/[0.03] text-muted hover:border-accent/40 hover:bg-white/[0.05]"
        }`}
      >
        <FileUp className="mb-2 h-6 w-6 opacity-80" />
        <p className="text-sm font-medium text-foreground">{t("dropTitle")}</p>
        <p className="mt-1 max-w-sm text-xs">{t("dropBody")}</p>
      </div>

      <AnimatePresence mode="popLayout">
        {docs.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ y: 8, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ scale: 0.98 }}
            transition={{ duration: 0.28, ease: easeOut }}
            className="glass rounded-[1.75rem] px-6 py-16 text-center"
          >
            <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
              <FileUp className="h-6 w-6" />
            </span>
            <h2 className="text-lg font-medium">{t("emptyTitle")}</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
              {t("emptyBody")}
            </p>
          </motion.div>
        ) : (
          <motion.ul
            key="list"
            initial={false}
            animate={{ y: 0 }}
            className="grid gap-3"
          >
            {docs.map((doc, index) => {
              const pdf = isPdfMime(doc.mimeType);
              const rowBusy =
                deletingId === doc.id || renamingId === doc.id;
              return (
                <motion.li
                  key={doc.id}
                  layout
                  initial={{ y: 8 }}
                  animate={{ y: 0 }}
                  transition={{
                    duration: 0.28,
                    delay: Math.min(index * 0.04, 0.2),
                    ease: easeOut,
                  }}
                  className="glass group flex flex-col gap-3 rounded-2xl px-4 py-4 transition-[border-color,transform,background-color] duration-200 hover:border-accent/35 hover:bg-white/[0.06] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                      {pdf ? (
                        <FileText className="h-4 w-4" />
                      ) : (
                        <FolderOpen className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{doc.title}</p>
                      <p
                        className="mt-1 font-mono text-xs text-muted"
                        suppressHydrationWarning
                      >
                        {pdf ? "PDF" : "Word"} · {t("updated")}:{" "}
                        {new Date(doc.updatedAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 min-w-11"
                      disabled={rowBusy || busy}
                      aria-label={t("rename")}
                      title={t("rename")}
                      onClick={() => setRenameDoc(doc)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 min-w-11 text-danger hover:border-danger/40"
                      disabled={rowBusy || busy}
                      aria-label={t("delete")}
                      title={t("delete")}
                      onClick={() => void onDelete(doc)}
                    >
                      {deletingId === doc.id ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                    <Link
                      href={editorHref(doc)}
                      onMouseEnter={() => {
                        prefetchDocumentMeta(doc.id);
                        if (pdf) preloadPdfEditor();
                        else preloadDocxEditor();
                      }}
                      onFocus={() => {
                        prefetchDocumentMeta(doc.id);
                        if (pdf) preloadPdfEditor();
                        else preloadDocxEditor();
                      }}
                      onTouchStart={() => {
                        prefetchDocumentMeta(doc.id);
                        if (pdf) preloadPdfEditor();
                        else preloadDocxEditor();
                      }}
                    >
                      <Button
                        variant="ghost"
                        className="min-h-11 min-w-[5.5rem]"
                        disabled={rowBusy}
                      >
                        {t("open")}
                      </Button>
                    </Link>
                  </div>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>

      <DocumentNameDialog
        open={createType !== null}
        mode="create"
        initialTitle={
          createType === "pdf" ? t("newPdfTitle") : t("newDocTitle")
        }
        fileExtension={createType === "pdf" ? ".pdf" : ".docx"}
        submitting={creating !== null}
        labels={{
          title: createType === "pdf" ? t("createPdfFormTitle") : t("createDocFormTitle"),
          nameLabel: t("fileNameLabel"),
          namePlaceholder: t("fileNamePlaceholder"),
          pathLabel: t("savePathLabel"),
          pathPlaceholder: t("savePathPlaceholder"),
          pathHint: t("savePathHint"),
          pickPath: t("pickSavePath"),
          submit: creating ? tc("loading") : t("createSubmit"),
          cancel: t("cancel"),
          nameRequired: t("nameRequired"),
        }}
        onClose={() => {
          if (!creating) setCreateType(null);
        }}
        onSubmit={onCreateSubmit}
      />

      <DocumentNameDialog
        open={renameDoc !== null}
        mode="rename"
        initialTitle={renameDoc?.title || ""}
        fileExtension={
          isPdfMime(renameDoc?.mimeType) ? ".pdf" : ".docx"
        }
        submitting={renamingId !== null}
        labels={{
          title: t("renameFormTitle"),
          nameLabel: t("fileNameLabel"),
          namePlaceholder: t("fileNamePlaceholder"),
          pathLabel: "",
          pathPlaceholder: "",
          pathHint: "",
          pickPath: "",
          submit: renamingId ? tc("loading") : t("renameSubmit"),
          cancel: t("cancel"),
          nameRequired: t("nameRequired"),
        }}
        onClose={() => {
          if (!renamingId) setRenameDoc(null);
        }}
        onSubmit={onRenameSubmit}
      />
    </div>
  );
}
