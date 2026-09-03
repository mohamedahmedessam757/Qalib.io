"use client";

import { FileText } from "lucide-react";

export function DocxPagesPanel({
  pageCount,
  currentPage,
  labels,
  onSelectPage,
}: {
  pageCount: number;
  currentPage: number;
  labels: {
    pagesTitle: string;
    pagesEmpty: string;
    pageLabel: string;
  };
  onSelectPage: (pageIndex: number) => void;
}) {
  if (pageCount <= 0) {
    return (
      <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted">
        {labels.pagesEmpty}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-line px-3 py-3">
        <p className="text-sm font-medium">{labels.pagesTitle}</p>
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {Array.from({ length: pageCount }, (_, i) => {
          const selected = i === currentPage;
          return (
            <li key={i}>
              <button
                type="button"
                className={`flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-start text-sm transition-colors ${
                  selected
                    ? "border-accent/50 bg-accent/10"
                    : "border-line bg-white/[0.03] hover:bg-white/[0.06]"
                }`}
                onClick={() => onSelectPage(i)}
              >
                <FileText className="h-4 w-4 shrink-0 text-accent" />
                <span>
                  {labels.pageLabel} {i + 1}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
