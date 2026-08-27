"use client";

import { useState } from "react";
import {
  Circle,
  Eraser,
  Frame,
  GripVertical,
  PanelTop,
  Slash,
  Square,
  SquareStack,
  Stamp,
  Table2,
  Trash2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { PdfOverlay, TextOverlay } from "@/lib/pdf/export-overlays";

function layerIcon(type: PdfOverlay["type"]) {
  switch (type) {
    case "text":
      return Type;
    case "image":
      return Frame;
    case "table":
      return Table2;
    case "whiteout":
      return Eraser;
    case "rect":
    case "border":
      return Square;
    case "oval":
      return Circle;
    case "doubleFrame":
    case "fullPageFrame":
      return SquareStack;
    case "banner":
      return PanelTop;
    case "stamp":
      return Stamp;
    case "line":
      return Slash;
    default:
      return Square;
  }
}

function layerTitle(
  overlay: PdfOverlay,
  labels: {
    layerText: string;
    layerImage: string;
    layerTable: string;
    layerShape: string;
    layerStamp: string;
    layerWhiteout: string;
  },
): string {
  if (overlay.type === "text") {
    const text = overlay.text.trim();
    if (!text) return labels.layerText;
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  }
  if (overlay.type === "image") return labels.layerImage;
  if (overlay.type === "table") return labels.layerTable;
  if (overlay.type === "whiteout") return labels.layerWhiteout;
  if (overlay.type === "stamp") return labels.layerStamp;
  return labels.layerShape;
}

export function PdfLayersPanel({
  overlays,
  pageIndex,
  pageCount,
  selectedId,
  labels,
  onSelect,
  onEditText,
  onDelete,
  onReorder,
  onRemoveAllPage,
}: {
  overlays: PdfOverlay[];
  pageIndex: number;
  pageCount: number;
  selectedId: string | null;
  labels: {
    layersTitle: string;
    layersHint: string;
    layersEmpty: string;
    layersRemoveAll: string;
    layersRemoveAllConfirm: string;
    pageLabel: string;
    layerText: string;
    layerImage: string;
    layerTable: string;
    layerShape: string;
    layerStamp: string;
    layerWhiteout: string;
    edit: string;
    delete: string;
  };
  onSelect: (id: string) => void;
  onEditText: (overlay: TextOverlay) => void;
  onDelete: (id: string) => void;
  onReorder: (pageIndex: number, fromIndex: number, toIndex: number) => void;
  onRemoveAllPage: (pageIndex: number) => void;
}) {
  const [removeConfirm, setRemoveConfirm] = useState(false);

  const grouped = Array.from({ length: pageCount }, (_, page) => ({
    page,
    items: overlays.filter((o) => o.pageIndex === page),
  })).filter((g) => g.items.length > 0 || g.page === pageIndex);

  const currentPageLayers = overlays.filter((o) => o.pageIndex === pageIndex);

  if (overlays.length === 0) {
    return (
      <div className="flex h-full flex-col px-3 py-4">
        <p className="text-sm font-medium">{labels.layersTitle}</p>
        <p className="mt-1 text-xs text-muted">{labels.layersHint}</p>
        <p className="mt-6 text-center text-sm text-muted">{labels.layersEmpty}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-line px-3 py-3">
        <p className="text-sm font-medium">{labels.layersTitle}</p>
        <p className="mt-0.5 text-[11px] text-muted">{labels.layersHint}</p>
        {currentPageLayers.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 h-9 w-full text-xs text-danger"
            onClick={() => {
              if (!removeConfirm) {
                setRemoveConfirm(true);
                return;
              }
              onRemoveAllPage(pageIndex);
              setRemoveConfirm(false);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {removeConfirm
              ? labels.layersRemoveAllConfirm
              : labels.layersRemoveAll}
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {grouped.map(({ page, items }) => (
          <div key={page} className="mb-3">
            <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-muted">
              {labels.pageLabel} {page + 1}
            </p>
            <ul className="space-y-1">
              {items.map((overlay, idx) => {
                const Icon = layerIcon(overlay.type);
                const selected = overlay.id === selectedId;
                return (
                  <li
                    key={overlay.id}
                    className={`flex items-center gap-1 rounded-xl border px-1.5 py-1 ${
                      selected
                        ? "border-accent/50 bg-accent/10"
                        : "border-line bg-white/[0.03]"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex min-h-11 min-w-8 shrink-0 cursor-grab touch-manipulation items-center justify-center text-muted active:cursor-grabbing"
                      aria-label="Reorder"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          "text/plain",
                          JSON.stringify({ page, idx }),
                        );
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        try {
                          const raw = e.dataTransfer.getData("text/plain");
                          const parsed = JSON.parse(raw) as {
                            page?: number;
                            idx?: number;
                          };
                          const fromPage = parsed.page;
                          const fromIdx = parsed.idx;
                          if (
                            typeof fromPage !== "number" ||
                            typeof fromIdx !== "number" ||
                            !Number.isFinite(fromPage) ||
                            !Number.isFinite(fromIdx)
                          ) {
                            return;
                          }
                          if (fromPage !== page) return;
                          if (fromIdx === idx) return;
                          onReorder(page, fromIdx, idx);
                        } catch {
                          /* ignore malformed drag payload */
                        }
                      }}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-start text-xs"
                      onClick={() => onSelect(overlay.id)}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
                      <span className="truncate">
                        {layerTitle(overlay, labels)}
                      </span>
                    </button>
                    {overlay.type === "text" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-11 min-w-11 shrink-0 px-1"
                        aria-label={labels.edit}
                        onClick={() => onEditText(overlay)}
                      >
                        <Type className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11 min-w-11 shrink-0 px-1 text-danger"
                      aria-label={labels.delete}
                      onClick={() => onDelete(overlay.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
