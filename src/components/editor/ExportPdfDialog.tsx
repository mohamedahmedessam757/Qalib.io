"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FileDown, FolderOpen, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { sanitizePdfBaseName } from "@/lib/export-docx-pdf";

const easeOut = [0.23, 1, 0.32, 1] as const;

export type ExportPdfFormValues = {
  title: string;
  fileHandle: FileSystemFileHandle | null;
};

export type ExportPdfDialogLabels = {
  title: string;
  nameLabel: string;
  namePlaceholder: string;
  pathLabel: string;
  pathPlaceholder: string;
  pathHintDesktop: string;
  pathHintIos: string;
  pickPath: string;
  submit: string;
  cancel: string;
  nameRequired: string;
  preparing: string;
  progress: string;
  readyTitle: string;
  save: string;
  openFallback: string;
  fallbackHint: string;
};

export function ExportPdfDialog({
  open,
  initialName,
  phase,
  progressCurrent = 0,
  progressTotal = 0,
  isApple,
  canPickPath,
  readyFile,
  readyUrl,
  submitting,
  labels,
  onClose,
  onSubmitForm,
  onSavePdf,
}: {
  open: boolean;
  initialName: string;
  phase: "form" | "generating" | "ready";
  progressCurrent?: number;
  progressTotal?: number;
  isApple: boolean;
  canPickPath: boolean;
  readyFile: File | null;
  readyUrl: string | null;
  submitting?: boolean;
  labels: ExportPdfDialogLabels;
  onClose: () => void;
  onSubmitForm: (values: ExportPdfFormValues) => void;
  onSavePdf: () => void;
}) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initialName);
  const [localPath, setLocalPath] = useState("");
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (phase !== "form") return;
    setTitle(initialName);
    setLocalPath("");
    setFileHandle(null);
    setError(null);
    const t = window.setTimeout(() => nameRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, initialName, phase]);

  async function pickLocalPath() {
    const suggested = `${sanitizePdfBaseName(title.trim() || initialName || "document")}.pdf`;
    const picker = (
      window as Window & {
        showSaveFilePicker?: (options?: {
          suggestedName?: string;
          types?: {
            description: string;
            accept: Record<string, string[]>;
          }[];
        }) => Promise<FileSystemFileHandle>;
      }
    ).showSaveFilePicker;

    if (typeof picker !== "function") {
      setLocalPath(suggested);
      return;
    }

    try {
      const handle = await picker({
        suggestedName: suggested,
        types: [
          {
            description: "PDF",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
      setFileHandle(handle);
      setLocalPath(handle.name);
    } catch {
      /* user cancelled */
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phase !== "form") return;
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError(labels.nameRequired);
      return;
    }
    setError(null);
    onSubmitForm({
      title: nextTitle,
      fileHandle,
    });
  }

  const busy = submitting || phase === "generating";
  const progressLabel =
    progressTotal > 0
      ? labels.progress
          .replace("{current}", String(progressCurrent))
          .replace("{total}", String(progressTotal))
      : null;

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label={labels.cancel}
            className="fixed inset-0 z-40 bg-black/50 print:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={busy ? undefined : onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="glass-strong fixed inset-x-4 top-[12vh] z-50 mx-auto w-auto max-w-md rounded-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:w-full"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.28, ease: easeOut }}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 id={titleId} className="text-base font-medium">
                {phase === "ready" ? labels.readyTitle : labels.title}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11"
                onClick={onClose}
                aria-label={labels.cancel}
                disabled={busy}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {phase === "generating" ? (
              <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted">
                <LoaderCircle className="h-6 w-6 animate-spin text-accent" />
                <p>{labels.preparing}</p>
                {progressLabel ? (
                  <p className="text-xs text-muted">{progressLabel}</p>
                ) : null}
              </div>
            ) : null}

            {phase === "ready" ? (
              <div className="space-y-4">
                <p className="text-[11px] leading-relaxed text-muted">
                  {labels.fallbackHint}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  {readyUrl && readyFile ? (
                    <a
                      href={readyUrl}
                      download={readyFile.name}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-white/5 px-4 text-sm hover:bg-white/8"
                    >
                      {labels.openFallback}
                    </a>
                  ) : null}
                  <Button
                    type="button"
                    className="min-h-11 w-full gap-1.5 sm:w-auto"
                    onClick={onSavePdf}
                  >
                    <FileDown className="h-4 w-4" />
                    {labels.save}
                  </Button>
                </div>
              </div>
            ) : null}

            {phase === "form" ? (
              <form
                onSubmit={(e) => void handleSubmit(e)}
                className="space-y-4"
              >
                <label className="block space-y-1.5">
                  <span className="text-xs text-muted">{labels.nameLabel}</span>
                  <input
                    ref={nameRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={labels.namePlaceholder}
                    className="h-11 w-full rounded-xl border border-line bg-white/5 px-3 text-sm outline-none focus:border-accent"
                    dir="auto"
                    maxLength={180}
                    disabled={busy}
                  />
                </label>

                {isApple ? (
                  <p className="text-[11px] leading-relaxed text-muted">
                    {labels.pathHintIos}
                  </p>
                ) : canPickPath ? (
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted">{labels.pathLabel}</span>
                    <div className="flex gap-2">
                      <input
                        value={localPath}
                        onChange={(e) => {
                          setLocalPath(e.target.value);
                          setFileHandle(null);
                        }}
                        placeholder={labels.pathPlaceholder}
                        className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white/5 px-3 text-sm outline-none focus:border-accent"
                        dir="ltr"
                        disabled={busy}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 shrink-0 gap-1.5 px-3"
                        onClick={() => void pickLocalPath()}
                        disabled={busy}
                      >
                        <FolderOpen className="h-4 w-4" />
                        <span className="hidden sm:inline">
                          {labels.pickPath}
                        </span>
                      </Button>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted">
                      {labels.pathHintDesktop}
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] leading-relaxed text-muted">
                    {labels.pathHintDesktop}
                  </p>
                )}

                {error ? (
                  <p className="text-xs text-danger">{error}</p>
                ) : null}

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onClose}
                    disabled={busy}
                  >
                    {labels.cancel}
                  </Button>
                  <Button type="submit" disabled={busy} className="gap-1.5">
                    <FileDown className="h-4 w-4" />
                    {labels.submit}
                  </Button>
                </div>
              </form>
            ) : null}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
