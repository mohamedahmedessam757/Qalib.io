"use client";

import { AnimatePresence, motion } from "motion/react";
import { Layers, PanelBottom, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DocxPagesPanel } from "./DocxPagesPanel";
import { DocxStructurePanel } from "./DocxStructurePanel";
import type { DocxStructureItem } from "@/lib/editor/docx-structure";

const easeOut = [0.23, 1, 0.32, 1] as const;

export type DocxSideTab = "structure" | "pages";

export function DocxSidePanel({
  mode,
  open,
  tab,
  pageCount,
  currentPage,
  structureItems,
  selectedId,
  canPaste,
  labels,
  onTab,
  onClose,
  onSelectPage,
  onSelectItem,
  onEditItem,
  onCopyItem,
  onDuplicateItem,
  onPasteItem,
}: {
  mode: "sidebar" | "drawer";
  open: boolean;
  tab: DocxSideTab;
  pageCount: number;
  currentPage: number;
  structureItems: DocxStructureItem[];
  selectedId: string | null;
  canPaste: boolean;
  labels: {
    toggleStructure: string;
    structureTitle: string;
    structureHint: string;
    structureEmpty: string;
    pagesTitle: string;
    pagesEmpty: string;
    pageLabel: string;
    layerParagraph: string;
    layerTable: string;
    layerImage: string;
    edit: string;
    copy: string;
    duplicate: string;
    paste: string;
    cancel: string;
  };
  onTab: (tab: DocxSideTab) => void;
  onClose: () => void;
  onSelectPage: (pageIndex: number) => void;
  onSelectItem: (id: string) => void;
  onEditItem: (item: DocxStructureItem) => void;
  onCopyItem: (id: string) => void;
  onDuplicateItem: (id: string) => void;
  onPasteItem: () => void;
}) {
  const tabs = (
    <div className="flex shrink-0 gap-1 border-b border-line px-2 py-2">
      <Button
        size="sm"
        variant={tab === "structure" ? "solid" : "ghost"}
        className="min-h-11 flex-1 gap-1.5 text-xs"
        onClick={() => onTab("structure")}
      >
        <Layers className="h-3.5 w-3.5" />
        {labels.structureTitle}
      </Button>
      <Button
        size="sm"
        variant={tab === "pages" ? "solid" : "ghost"}
        className="min-h-11 flex-1 gap-1.5 text-xs"
        onClick={() => onTab("pages")}
      >
        <PanelBottom className="h-3.5 w-3.5" />
        {labels.pagesTitle}
      </Button>
    </div>
  );

  const body =
    tab === "structure" ? (
      <DocxStructurePanel
        items={structureItems}
        selectedId={selectedId}
        canPaste={canPaste}
        labels={{
          structureTitle: labels.structureTitle,
          structureHint: labels.structureHint,
          structureEmpty: labels.structureEmpty,
          pageLabel: labels.pageLabel,
          layerParagraph: labels.layerParagraph,
          layerTable: labels.layerTable,
          layerImage: labels.layerImage,
          edit: labels.edit,
          copy: labels.copy,
          duplicate: labels.duplicate,
          paste: labels.paste,
        }}
        onSelect={onSelectItem}
        onEdit={onEditItem}
        onCopy={onCopyItem}
        onDuplicate={onDuplicateItem}
        onPaste={onPasteItem}
      />
    ) : (
      <DocxPagesPanel
        pageCount={pageCount}
        currentPage={currentPage}
        labels={{
          pagesTitle: labels.pagesTitle,
          pagesEmpty: labels.pagesEmpty,
          pageLabel: labels.pageLabel,
        }}
        onSelectPage={onSelectPage}
      />
    );

  if (mode === "sidebar") {
    if (!open) return null;
    return (
      <aside className="hidden h-full w-[min(100%,300px)] shrink-0 flex-col overflow-hidden border-s border-line bg-[#0a1220]/95 sm:flex">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
          <p className="text-xs font-medium text-muted">
            {labels.toggleStructure}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-9 min-w-9"
            onClick={onClose}
            aria-label={labels.cancel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {tabs}
        <div className="min-h-0 flex-1">{body}</div>
      </aside>
    );
  }

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label={labels.cancel}
            className="fixed inset-0 z-[60] bg-black/45 sm:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="glass-strong fixed inset-x-0 bottom-0 z-[70] flex max-h-[72dvh] flex-col rounded-t-[1.5rem] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:hidden"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.32, ease: easeOut }}
          >
            <div className="mx-auto mb-2 mt-2 h-1 w-10 rounded-full bg-white/25" />
            <div className="flex shrink-0 items-center justify-between px-4 pb-1">
              <p className="text-sm font-medium">{labels.toggleStructure}</p>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 min-w-11"
                onClick={onClose}
                aria-label={labels.cancel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {tabs}
            <div className="min-h-0 flex-1">{body}</div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
