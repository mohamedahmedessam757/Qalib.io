"use client";

import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/Button";

const easeOut = [0.23, 1, 0.32, 1] as const;

export function ConfirmDialog({
  open,
  title,
  warning,
  confirmLabel,
  cancelLabel,
  danger,
  submitting,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  warning: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label={cancelLabel}
            className="fixed inset-0 z-[80] bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="glass-strong fixed inset-x-4 top-[20%] z-[81] mx-auto max-w-md rounded-2xl p-5 shadow-[0_24px_60px_rgba(0,0,0,0.55)] sm:inset-x-auto"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: easeOut }}
          >
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-2 text-sm text-muted">{warning}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={submitting}
                onClick={onClose}
              >
                {cancelLabel}
              </Button>
              <Button
                variant={danger ? "danger" : "solid"}
                disabled={submitting}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
