"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

const easeOut = [0.23, 1, 0.32, 1] as const;

export type CreateDocFormValues = {
  title: string;
  localPath: string;
  fileHandle: FileSystemFileHandle | null;
};

type Labels = {
  title: string;
  nameLabel: string;
  namePlaceholder: string;
  pathLabel: string;
  pathPlaceholder: string;
  pathHint: string;
  pickPath: string;
  submit: string;
  cancel: string;
  nameRequired: string;
};

export function DocumentNameDialog({
  open,
  mode,
  initialTitle,
  fileExtension,
  labels,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "rename";
  initialTitle: string;
  fileExtension: ".docx" | ".pdf" | ".xlsx";
  labels: Labels;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (values: CreateDocFormValues) => void | Promise<void>;
}) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initialTitle);
  const [localPath, setLocalPath] = useState("");
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setLocalPath("");
    setFileHandle(null);
    setError(null);
    const t = window.setTimeout(() => nameRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, initialTitle]);

  async function pickLocalPath() {
    const suggested =
      (title.trim() || initialTitle || "document") + fileExtension;
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
      // Fallback: keep typed path as download filename hint
      setLocalPath(suggested);
      return;
    }

    try {
      const handle = await picker({
        suggestedName: suggested,
        types: [
          fileExtension === ".pdf"
            ? {
                description: "PDF",
                accept: { "application/pdf": [".pdf"] },
              }
            : {
                description: "Word",
                accept: {
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                    [".docx"],
                },
              },
        ],
      });
      setFileHandle(handle);
      setLocalPath(handle.name);
    } catch {
      /* user cancelled */
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError(labels.nameRequired);
      return;
    }
    setError(null);
    await onSubmit({
      title: nextTitle,
      localPath: localPath.trim(),
      fileHandle,
    });
  }

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
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="glass-strong fixed inset-x-4 top-[12vh] z-50 mx-auto w-auto max-w-md rounded-2xl p-4 sm:inset-x-auto sm:w-full"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.28, ease: easeOut }}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 id={titleId} className="text-base font-medium">
                {labels.title}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11"
                onClick={onClose}
                aria-label={labels.cancel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
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
                  disabled={submitting}
                />
              </label>

              {mode === "create" ? (
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
                      disabled={submitting}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 shrink-0 gap-1.5 px-3"
                      onClick={() => void pickLocalPath()}
                      disabled={submitting}
                    >
                      <FolderOpen className="h-4 w-4" />
                      <span className="hidden sm:inline">{labels.pickPath}</span>
                    </Button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted">
                    {labels.pathHint}
                  </p>
                </div>
              ) : null}

              {error ? (
                <p className="text-xs text-danger">{error}</p>
              ) : null}

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClose}
                  disabled={submitting}
                >
                  {labels.cancel}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {labels.submit}
                </Button>
              </div>
            </form>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
