"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

const easeOut = [0.23, 1, 0.32, 1] as const;

const ARABIC_LETTER_RE = /[\u0600-\u06FF]/;

export function isPdfSeedTextUnreadable(text: string): boolean {
  if (!text) return false;
  if (text.includes("\uFFFD")) return true;
  // Real Arabic letters present → treat as readable enough for the dialog seed.
  if (ARABIC_LETTER_RE.test(text)) return false;
  let suspicious = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xe000 && code <= 0xf8ff) suspicious += 1;
  }
  return text.length > 2 && suspicious / text.length > 0.35;
}

export function EditPdfTextDialog({
  open,
  initialText,
  unreadable,
  labels,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  initialText: string;
  unreadable: boolean;
  labels: {
    title: string;
    hint: string;
    unreadable: string;
    placeholder: string;
    save: string;
    cancel: string;
  };
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText(unreadable ? "" : initialText);
    }
  }, [open, initialText, unreadable]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label={labels.cancel}
            className="fixed inset-0 z-[90] bg-black/50 print:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onCancel}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={labels.title}
            className="glass-strong fixed inset-x-4 top-[max(1.5rem,env(safe-area-inset-top))] z-[100] mx-auto max-w-lg rounded-2xl px-4 pb-4 pt-3 print:hidden sm:inset-x-auto sm:start-1/2 sm:top-[15vh] sm:w-full sm:max-w-md sm:-translate-x-1/2 rtl:sm:translate-x-1/2"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.24, ease: easeOut }}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{labels.title}</p>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11"
                onClick={onCancel}
                aria-label={labels.cancel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="mb-2 text-xs text-muted">{labels.hint}</p>
            {unreadable ? (
              <p className="mb-2 rounded-xl border border-line bg-white/5 px-3 py-2 text-xs text-muted">
                {labels.unreadable}
              </p>
            ) : null}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={labels.placeholder}
              dir="auto"
              className="min-h-[7rem] w-full resize-y rounded-xl border border-line bg-white/5 px-3 py-3 text-base leading-relaxed outline-none transition-[border-color,box-shadow] duration-200 focus:border-accent/50 focus:shadow-[0_0_0_3px_rgba(45,212,191,0.15)]"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                className="min-h-11 flex-1 gap-1.5"
                onClick={() => onSubmit(text)}
              >
                <Check className="h-4 w-4" />
                {labels.save}
              </Button>
              <Button
                variant="ghost"
                className="min-h-11 flex-1"
                onClick={onCancel}
              >
                {labels.cancel}
              </Button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
