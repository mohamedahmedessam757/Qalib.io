"use client";

import { AnimatePresence, motion } from "motion/react";
import { Layers, PanelBottom, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PdfLayersPanel } from "./PdfLayersPanel";
import { PdfPagesPanel } from "./PdfPagesPanel";
import type { PdfOverlay, TextOverlay } from "@/lib/pdf/export-overlays";

const easeOut = [0.23, 1, 0.32, 1] as const;

export type PdfSideTab = "layers" | "pages";

export function PdfSidePanel({
  mode,
  open,
  tab,
  buffer,
  overlays,
  pageIndex,
  pageCount,
  selectedId,
  canPaste,
  labels,
  onTab,
  onClose,
  onSelectLayer,
  onEditText,
  onDeleteLayer,
  onCopyLayer,
  onDuplicateLayer,
  onPasteLayer,
  onReorderLayers,
  onRemoveAllLayers,
  onSelectPage,
  onMovePage,
}: {
  mode: "sidebar" | "drawer";
  open: boolean;
  tab: PdfSideTab;
  buffer: ArrayBuffer | null;
  overlays: PdfOverlay[];
  pageIndex: number;
  pageCount: number;
  selectedId: string | null;
  canPaste: boolean;
  labels: {
    toggleLayers: string;
    layersTitle: string;
    layersHint: string;
    layersEmpty: string;
    layersRemoveAll: string;
    layersRemoveAllConfirm: string;
    pagesTitle: string;
    pagesEmpty: string;
    pageLabel: string;
    moveUp: string;
    moveDown: string;
    layerText: string;
    layerImage: string;
    layerTable: string;
    layerShape: string;
    layerStamp: string;
    layerWhiteout: string;
    edit: string;
    delete: string;
    copy: string;
    duplicate: string;
    paste: string;
    cancel: string;
  };
  onTab: (tab: PdfSideTab) => void;
  onClose: () => void;
  onSelectLayer: (id: string) => void;
  onEditText: (overlay: TextOverlay) => void;
  onDeleteLayer: (id: string) => void;
  onCopyLayer: (id: string) => void;
  onDuplicateLayer: (id: string) => void;
  onPasteLayer: () => void;
  onReorderLayers: (
    pageIndex: number,
    fromIndex: number,
    toIndex: number,
  ) => void;
  onRemoveAllLayers: (pageIndex: number) => void;
  onSelectPage: (pageIndex: number) => void;
  onMovePage: (fromIndex: number, toIndex: number) => void;
}) {
  const layerLabels = {
    layersTitle: labels.layersTitle,
    layersHint: labels.layersHint,
    layersEmpty: labels.layersEmpty,
    layersRemoveAll: labels.layersRemoveAll,
    layersRemoveAllConfirm: labels.layersRemoveAllConfirm,
    pageLabel: labels.pageLabel,
    layerText: labels.layerText,
    layerImage: labels.layerImage,
    layerTable: labels.layerTable,
    layerShape: labels.layerShape,
    layerStamp: labels.layerStamp,
    layerWhiteout: labels.layerWhiteout,
    edit: labels.edit,
    delete: labels.delete,
    copy: labels.copy,
    duplicate: labels.duplicate,
    paste: labels.paste,
  };

  const pageLabels = {
    pagesTitle: labels.pagesTitle,
    pagesEmpty: labels.pagesEmpty,
    pageLabel: labels.pageLabel,
    moveUp: labels.moveUp,
    moveDown: labels.moveDown,
  };

  const tabs = (
    <div className="flex shrink-0 gap-1 border-b border-line px-2 py-2">
      <Button
        size="sm"
        variant={tab === "layers" ? "solid" : "ghost"}
        className="min-h-11 flex-1 gap-1.5 text-xs"
        onClick={() => onTab("layers")}
      >
        <Layers className="h-3.5 w-3.5" />
        {labels.layersTitle}
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
    tab === "layers" ? (
      <PdfLayersPanel
        overlays={overlays}
        pageIndex={pageIndex}
        pageCount={pageCount}
        selectedId={selectedId}
        canPaste={canPaste}
        labels={layerLabels}
        onSelect={onSelectLayer}
        onEditText={onEditText}
        onDelete={onDeleteLayer}
        onCopy={onCopyLayer}
        onDuplicate={onDuplicateLayer}
        onPaste={onPasteLayer}
        onReorder={onReorderLayers}
        onRemoveAllPage={onRemoveAllLayers}
      />
    ) : buffer ? (
      <PdfPagesPanel
        buffer={buffer}
        pageCount={pageCount}
        currentPage={pageIndex}
        labels={pageLabels}
        onSelectPage={onSelectPage}
        onMovePage={onMovePage}
      />
    ) : null;

  if (mode === "sidebar") {
    if (!open) return null;
    return (
      <aside className="hidden h-full w-[min(100%,300px)] shrink-0 flex-col overflow-hidden border-s border-line bg-[#0a1220]/95 sm:flex">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
          <p className="text-xs font-medium text-muted">{labels.toggleLayers}</p>
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
              <p className="text-sm font-medium">{labels.toggleLayers}</p>
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
