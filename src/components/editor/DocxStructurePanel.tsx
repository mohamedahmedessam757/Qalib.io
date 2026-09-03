"use client";

import {
  Copy,
  CopyPlus,
  ImageIcon,
  Table2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { DocxStructureItem } from "@/lib/editor/docx-structure";

function kindIcon(kind: DocxStructureItem["kind"]) {
  if (kind === "table") return Table2;
  if (kind === "image") return ImageIcon;
  return Type;
}

export function DocxStructurePanel({
  items,
  selectedId,
  canPaste,
  labels,
  onSelect,
  onEdit,
  onCopy,
  onDuplicate,
  onPaste,
}: {
  items: DocxStructureItem[];
  selectedId: string | null;
  canPaste: boolean;
  labels: {
    structureTitle: string;
    structureHint: string;
    structureEmpty: string;
    pageLabel: string;
    layerParagraph: string;
    layerTable: string;
    layerImage: string;
    edit: string;
    copy: string;
    duplicate: string;
    paste: string;
  };
  onSelect: (id: string) => void;
  onEdit: (item: DocxStructureItem) => void;
  onCopy: (id: string) => void;
  onDuplicate: (id: string) => void;
  onPaste: () => void;
}) {
  const kindLabel = (kind: DocxStructureItem["kind"]) => {
    if (kind === "table") return labels.layerTable;
    if (kind === "image") return labels.layerImage;
    return labels.layerParagraph;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-line px-3 py-3">
        <p className="text-sm font-medium">{labels.structureTitle}</p>
        <p className="mt-0.5 text-[11px] text-muted">{labels.structureHint}</p>
        <div className="mt-2">
          <Button
            size="sm"
            variant="ghost"
            className="min-h-9 w-full text-xs"
            disabled={!canPaste}
            onClick={onPaste}
          >
            {labels.paste}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted">
          {labels.structureEmpty}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
          {items.map((item) => {
            const Icon = kindIcon(item.kind);
            const selected = item.id === selectedId;
            return (
              <li
                key={item.id}
                className={`flex items-center gap-0.5 rounded-xl border px-1 py-1 ${
                  selected
                    ? "border-accent/50 bg-accent/10"
                    : "border-line bg-white/[0.03]"
                }`}
              >
                <button
                  type="button"
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-1 text-start text-xs"
                  onClick={() => onSelect(item.id)}
                  onDoubleClick={() => onEdit(item)}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-[10px] text-muted">
                      {labels.pageLabel} {item.page} · {kindLabel(item.kind)}
                    </span>
                    <span className="mt-0.5 block truncate">{item.label}</span>
                  </span>
                </button>
                {item.kind !== "image" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11 min-w-9 shrink-0 px-0.5"
                    aria-label={labels.edit}
                    onClick={() => onEdit(item)}
                  >
                    <Type className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 min-w-9 shrink-0 px-0.5"
                  aria-label={labels.copy}
                  onClick={() => onCopy(item.id)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 min-w-9 shrink-0 px-0.5"
                  aria-label={labels.duplicate}
                  onClick={() => onDuplicate(item.id)}
                >
                  <CopyPlus className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
