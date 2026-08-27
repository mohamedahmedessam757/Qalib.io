"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/Button";

const THUMB_SCALE = 0.22;
const MAX_EAGER_PAGES = 15;

export function PdfPagesPanel({
  buffer,
  pageCount,
  currentPage,
  labels,
  onSelectPage,
  onMovePage,
}: {
  buffer: ArrayBuffer;
  pageCount: number;
  currentPage: number;
  labels: {
    pagesTitle: string;
    pagesEmpty: string;
    pageLabel: string;
    moveUp: string;
    moveDown: string;
  };
  onSelectPage: (pageIndex: number) => void;
  onMovePage: (fromIndex: number, toIndex: number) => void;
}) {
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Map<number, string>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  const renderThumb = useCallback(
    async (pageNum: number) => {
      if (cacheRef.current.has(pageNum)) return;
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      const pdf = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: THUMB_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const url = canvas.toDataURL("image/jpeg", 0.82);
      cacheRef.current.set(pageNum, url);
      setThumbs(new Map(cacheRef.current));
    },
    [buffer],
  );

  useEffect(() => {
    cacheRef.current.clear();
    setThumbs(new Map());
  }, [buffer]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const eager = Math.min(pageCount, MAX_EAGER_PAGES);
      for (let i = 1; i <= eager; i += 1) {
        if (cancelled) return;
        await renderThumb(i);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [pageCount, renderThumb]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || pageCount <= MAX_EAGER_PAGES) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number(
            (entry.target as HTMLElement).dataset.pageIndex || "0",
          );
          void renderThumb(idx + 1);
        }
      },
      { root, rootMargin: "120px" },
    );

    const nodes = root.querySelectorAll("[data-page-index]");
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [pageCount, renderThumb, thumbs]);

  if (pageCount <= 0) {
    return (
      <div className="px-3 py-4">
        <p className="text-sm font-medium">{labels.pagesTitle}</p>
        <p className="mt-4 text-center text-sm text-muted">{labels.pagesEmpty}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-line px-3 py-3">
        <p className="text-sm font-medium">{labels.pagesTitle}</p>
        {loading ? (
          <p className="mt-1 text-[11px] text-muted">…</p>
        ) : null}
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2"
      >
        {Array.from({ length: pageCount }, (_, idx) => {
          const thumb = thumbs.get(idx + 1);
          const active = idx === currentPage;
          return (
            <div
              key={idx}
              data-page-index={idx}
              className={`rounded-xl border p-2 ${
                active
                  ? "border-accent/50 bg-accent/10"
                  : "border-line bg-white/[0.03]"
              }`}
            >
              <button
                type="button"
                className="block w-full text-start"
                onClick={() => onSelectPage(idx)}
              >
                <div className="mb-1.5 aspect-[8.5/11] overflow-hidden rounded-lg bg-white">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-muted">
                      …
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted">
                  {labels.pageLabel} {idx + 1}
                </p>
              </button>
              <div className="mt-1.5 flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 flex-1 text-xs"
                  disabled={idx === 0}
                  aria-label={labels.moveUp}
                  onClick={() => onMovePage(idx, idx - 1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 flex-1 text-xs"
                  disabled={idx >= pageCount - 1}
                  aria-label={labels.moveDown}
                  onClick={() => onMovePage(idx, idx + 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
