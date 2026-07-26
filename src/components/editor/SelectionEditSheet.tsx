"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

const easeOut = [0.23, 1, 0.32, 1] as const;

export type SelectionDraft = {
  paraId: string;
  paragraphText: string;
  selectedText: string;
};

export function SelectionEditSheet({
  open,
  draft,
  labels,
  onClose,
  onApply,
  onDelete,
}: {
  open: boolean;
  draft: SelectionDraft | null;
  labels: {
    title: string;
    apply: string;
    cancel: string;
    deleteSelection: string;
    deleteConfirm: string;
    placeholder: string;
  };
  onClose: () => void;
  onApply: (text: string) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open && draft) {
      setText(draft.paragraphText);
      setConfirmDelete(false);
    }
  }, [open, draft]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && draft ? (
        <>
          <motion.button
            type="button"
            aria-label={labels.cancel}
            className="fixed inset-0 z-[70] bg-black/45 print:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={labels.title}
            className="glass-strong fixed inset-x-0 bottom-0 z-[80] max-h-[78dvh] rounded-t-[1.5rem] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 print:hidden"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.32, ease: easeOut }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{labels.title}</p>
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
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={labels.placeholder}
              dir="auto"
              className="min-h-[9rem] w-full resize-y rounded-2xl border border-line bg-white/5 px-3 py-3 text-base leading-relaxed text-foreground outline-none transition-[border-color,box-shadow] duration-200 focus:border-accent/50 focus:shadow-[0_0_0_3px_rgba(45,212,191,0.15)]"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                className="min-h-11 flex-1 gap-1.5"
                onClick={() => onApply(text)}
              >
                <Check className="h-4 w-4" />
                {labels.apply}
              </Button>
              <Button
                variant="ghost"
                className="min-h-11 flex-1"
                onClick={onClose}
              >
                {labels.cancel}
              </Button>
              <Button
                variant="danger"
                className="min-h-11 gap-1.5"
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    return;
                  }
                  onDelete();
                }}
              >
                <Trash2 className="h-4 w-4" />
                {confirmDelete ? labels.deleteConfirm : labels.deleteSelection}
              </Button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
