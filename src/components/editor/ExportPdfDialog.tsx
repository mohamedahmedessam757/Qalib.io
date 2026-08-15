"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Download,
  FileDown,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  Share2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { sanitizePdfBaseName } from "@/lib/export-docx-pdf";

const easeOut = [0.23, 1, 0.32, 1] as const;

const ACTION_BASE =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-[transform,background-color,box-shadow,border-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] touch-manipulation sm:w-auto";
const ACTION_SOLID =
  "bg-accent text-[#042f2e] shadow-[0_10px_30px_rgba(45,212,191,0.25)] hover:bg-accent-hover";
const ACTION_GHOST =
  "glass text-foreground hover:border-accent/40 hover:bg-white/10";

export type ExportPdfPhase = "form" | "generating" | "ready" | "error";

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
  download: string;
  fallbackHint: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
};

/**
 * Mounted only while the dialog is on the form step, so every export starts from
 * a clean form without resetting state from an effect.
 */
function ExportPdfForm({
  initialName,
  isApple,
  canPickPath,
  labels,
  onClose,
  onSubmitForm,
}: {
  initialName: string;
  isApple: boolean;
  canPickPath: boolean;
  labels: ExportPdfDialogLabels;
  onClose: () => void;
  onSubmitForm: (values: ExportPdfFormValues) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initialName);
  const [localPath, setLocalPath] = useState("");
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => nameRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, []);

  async function pickLocalPath() {
    const suggested = `${sanitizePdfBaseName(title.trim() || initialName)}.pdf`;
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
          { description: "PDF", accept: { "application/pdf": [".pdf"] } },
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
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError(labels.nameRequired);
      return;
    }
    setError(null);
    onSubmitForm({ title: nextTitle, fileHandle });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
          enterKeyHint="done"
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
            />
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 shrink-0 gap-1.5 px-3"
              onClick={() => void pickLocalPath()}
            >
              <FolderOpen className="h-4 w-4" />
              <span className="hidden sm:inline">{labels.pickPath}</span>
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

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>
          {labels.cancel}
        </Button>
        <Button type="submit" className="gap-1.5">
          <FileDown className="h-4 w-4" />
          {labels.submit}
        </Button>
      </div>
    </form>
  );
}

export function ExportPdfDialog({
  open,
  initialName,
  phase,
  progressCurrent = 0,
  progressTotal = 0,
  isApple,
  canPickPath,
  canShare,
  readyFile,
  readyUrl,
  labels,
  onClose,
  onSubmitForm,
  onSavePdf,
  onDownloadTap,
  onRetry,
}: {
  open: boolean;
  initialName: string;
  phase: ExportPdfPhase;
  progressCurrent?: number;
  progressTotal?: number;
  isApple: boolean;
  canPickPath: boolean;
  canShare: boolean;
  readyFile: File | null;
  readyUrl: string | null;
  labels: ExportPdfDialogLabels;
  onClose: () => void;
  onSubmitForm: (values: ExportPdfFormValues) => void;
  onSavePdf: () => void;
  onDownloadTap: () => void;
  onRetry: () => void;
}) {
  const titleId = useId();

  const busy = phase === "generating";
  const heading =
    phase === "ready"
      ? labels.readyTitle
      : phase === "error"
        ? labels.errorTitle
        : labels.title;
  const progressLabel =
    progressTotal > 0
      ? labels.progress
          .replace("{current}", String(progressCurrent))
          .replace("{total}", String(progressTotal))
      : null;
  const progressPct =
    progressTotal > 0
      ? Math.min(100, Math.round((progressCurrent / progressTotal) * 100))
      : 0;

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            aria-hidden="true"
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
                {heading}
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
              <div
                className="flex flex-col items-center gap-3 py-6 text-sm text-muted"
                role="status"
                aria-live="polite"
              >
                <LoaderCircle className="h-6 w-6 animate-spin text-accent" />
                <p>{labels.preparing}</p>
                {progressLabel ? (
                  <>
                    <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-200"
                        style={{ width: `${Math.max(progressPct, 6)}%` }}
                      />
                    </div>
                    <p className="text-xs tabular-nums text-muted">
                      {progressLabel}
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}

            {phase === "ready" && readyFile && readyUrl ? (
              <div className="space-y-4">
                <p className="text-[11px] leading-relaxed text-muted">
                  {labels.fallbackHint}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  {/* A real anchor: iOS honours `download` only on a genuine tap. */}
                  <a
                    href={readyUrl}
                    download={readyFile.name}
                    className={`${ACTION_BASE} ${canShare ? ACTION_GHOST : ACTION_SOLID}`}
                    onClick={onDownloadTap}
                  >
                    <Download className="h-4 w-4" />
                    {labels.download}
                  </a>
                  {canShare ? (
                    <button
                      type="button"
                      className={`${ACTION_BASE} ${ACTION_SOLID}`}
                      onClick={onSavePdf}
                    >
                      <Share2 className="h-4 w-4" />
                      {labels.save}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {phase === "error" ? (
              <div className="space-y-4">
                <p className="text-sm text-danger">{labels.errorBody}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={onClose}>
                    {labels.cancel}
                  </Button>
                  <Button className="gap-1.5" onClick={onRetry}>
                    <RotateCcw className="h-4 w-4" />
                    {labels.retry}
                  </Button>
                </div>
              </div>
            ) : null}

            {phase === "form" ? (
              <ExportPdfForm
                initialName={initialName}
                isApple={isApple}
                canPickPath={canPickPath}
                labels={labels}
                onClose={onClose}
                onSubmitForm={onSubmitForm}
              />
            ) : null}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
