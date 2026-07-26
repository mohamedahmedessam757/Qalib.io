"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";

const easeOut = [0.23, 1, 0.32, 1] as const;

export type ParagraphJumpItem = {
  paraId: string;
  text: string;
};

export function ParagraphJumpSheet({
  open,
  items,
  labels,
  onClose,
  onJump,
}: {
  open: boolean;
  items: ParagraphJumpItem[];
  labels: { title: string; empty: string; close: string };
  onClose: () => void;
  onJump: (paraId: string) => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label={labels.close}
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
            className="glass-strong fixed inset-x-0 bottom-0 z-[80] flex max-h-[70dvh] flex-col rounded-t-[1.5rem] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 print:hidden"
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
                aria-label={labels.close}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pb-2">
              {items.length === 0 ? (
                <li className="px-2 py-6 text-center text-sm text-muted">
                  {labels.empty}
                </li>
              ) : (
                items.map((item) => (
                  <li key={item.paraId}>
                    <button
                      type="button"
                      className="w-full rounded-xl px-3 py-3 text-start text-sm transition-colors duration-150 hover:bg-white/8 active:bg-white/12"
                      onClick={() => onJump(item.paraId)}
                    >
                      <span className="line-clamp-2" dir="auto">
                        {item.text || "…"}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
