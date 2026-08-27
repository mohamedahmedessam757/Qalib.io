"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfOverlay } from "@/lib/pdf/export-overlays";

type TextItem = {
  id: string;
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type PageSize = { width: number; height: number };

export function PdfCanvas({
  buffer,
  overlays,
  selectedId,
  tool,
  zoom = 1,
  onSelectOverlay,
  onAddAt,
  onReplaceText,
  onMoveOverlay,
  onResizeOverlay,
}: {
  buffer: ArrayBuffer;
  overlays: PdfOverlay[];
  selectedId: string | null;
  tool: string;
  zoom?: number;
  onSelectOverlay: (id: string | null) => void;
  onAddAt: (pageIndex: number, x: number, y: number) => void;
  onReplaceText: (
    pageIndex: number,
    box: { x: number; y: number; w: number; h: number },
    text: string,
  ) => void;
  onMoveOverlay: (id: string, x: number, y: number) => void;
  onResizeOverlay?: (id: string, w: number, h: number) => void;
}) {
  const [pageCount, setPageCount] = useState(0);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [textItems, setTextItems] = useState<TextItem[][]>([]);
  const [ready, setReady] = useState(false);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setPageCount(0);
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

      const pdf = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
      if (cancelled) {
        return;
      }
      pdfRef.current = pdf;

      const sizes: PageSize[] = [];
      const texts: TextItem[][] = [];
      canvasRefs.current = Array.from({ length: pdf.numPages }, () => null);

      for (let i = 1; i <= pdf.numPages; i += 1) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.25 });
        sizes.push({ width: viewport.width, height: viewport.height });

        const content = await page.getTextContent();
        const items: TextItem[] = [];
        for (const raw of content.items) {
          if (!("str" in raw) || !raw.str) continue;
          const tx = pdfjs.Util.transform(viewport.transform, raw.transform);
          const fontHeight = Math.hypot(tx[2], tx[3]);
          const width = (("width" in raw ? Number(raw.width) : 0) || 0) * 1.25;
          items.push({
            id: `t_${i}_${items.length}`,
            str: String(raw.str),
            x: tx[4],
            y: tx[5] - fontHeight,
            w: Math.max(width, 8),
            h: Math.max(fontHeight, 10),
          });
        }
        texts.push(items);
      }

      if (cancelled) return;
      setPageSizes(sizes);
      setTextItems(texts);
      setPageCount(pdf.numPages);
      setReady(true);
    })().catch(() => {
      if (!cancelled) setReady(false);
    });

    return () => {
      cancelled = true;
      pdfRef.current = null;
    };
  }, [buffer]);

  useEffect(() => {
    if (!ready || !pdfRef.current || pageCount === 0) return;
    let cancelled = false;
    (async () => {
      const pdf = pdfRef.current;
      if (!pdf) return;
      for (let i = 1; i <= pageCount; i += 1) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.25 });
        const canvas = canvasRefs.current[i - 1];
        if (!canvas) continue;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, pageCount, buffer]);

  function normFromEvent(
    pageIndex: number,
    clientX: number,
    clientY: number,
    el: HTMLElement,
  ) {
    const rect = el.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  }

  if (!ready && pageCount === 0) {
    return null;
  }

  return (
    <div
      className="mx-auto flex w-full max-w-[920px] flex-col gap-4 p-3 sm:p-4"
      style={{
        transform: `scale(${zoom})`,
        transformOrigin: "top center",
      }}
    >
      {Array.from({ length: pageCount }, (_, pageIndex) => {
        const size = pageSizes[pageIndex];
        const pageOverlays = overlays.filter((o) => o.pageIndex === pageIndex);
        return (
          <div
            key={pageIndex}
            data-pdf-page={pageIndex}
            className="relative mx-auto overflow-hidden rounded-lg bg-white shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
            style={{
              width: "100%",
              maxWidth: size?.width ?? 800,
              aspectRatio: size ? `${size.width} / ${size.height}` : "8.5 / 11",
            }}
            onClick={(e) => {
              if (tool === "select") {
                onSelectOverlay(null);
                return;
              }
              const pos = normFromEvent(
                pageIndex,
                e.clientX,
                e.clientY,
                e.currentTarget,
              );
              onAddAt(pageIndex, pos.x, pos.y);
            }}
          >
            <canvas
              ref={(el) => {
                canvasRefs.current[pageIndex] = el;
              }}
              className="pointer-events-none h-full w-full"
            />

            {tool === "select" &&
              (textItems[pageIndex] || []).map((item) => {
                if (!size) return null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="absolute border border-transparent hover:border-accent/70 hover:bg-accent/10"
                    style={{
                      left: `${(item.x / size.width) * 100}%`,
                      top: `${(item.y / size.height) * 100}%`,
                      width: `${(item.w / size.width) * 100}%`,
                      height: `${(item.h / size.height) * 100}%`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onReplaceText(
                        pageIndex,
                        {
                          x: item.x / size.width,
                          y: item.y / size.height,
                          w: Math.max(item.w / size.width, 0.08),
                          h: Math.max(item.h / size.height, 0.02),
                        },
                        item.str,
                      );
                    }}
                    title={item.str}
                  />
                );
              })}

            {pageOverlays.map((overlay) => {
              const selected = overlay.id === selectedId;
              return (
                <div
                  key={overlay.id}
                  data-overlay-id={overlay.id}
                  className={`absolute cursor-move border ${
                    selected
                      ? "border-accent bg-accent/10"
                      : "border-sky-500/50 bg-sky-500/5"
                  }`}
                  style={{
                    left: `${overlay.x * 100}%`,
                    top: `${overlay.y * 100}%`,
                    width: `${overlay.w * 100}%`,
                    height: `${overlay.h * 100}%`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectOverlay(overlay.id);
                  }}
                  onPointerDown={(e) => {
                    if (tool !== "select") return;
                    e.stopPropagation();
                    onSelectOverlay(overlay.id);
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const pos = normFromEvent(
                      pageIndex,
                      e.clientX,
                      e.clientY,
                      parent,
                    );
                    dragRef.current = {
                      id: overlay.id,
                      ox: pos.x - overlay.x,
                      oy: pos.y - overlay.y,
                    };
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!dragRef.current || dragRef.current.id !== overlay.id)
                      return;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const pos = normFromEvent(
                      pageIndex,
                      e.clientX,
                      e.clientY,
                      parent,
                    );
                    onMoveOverlay(
                      overlay.id,
                      pos.x - dragRef.current.ox,
                      pos.y - dragRef.current.oy,
                    );
                  }}
                  onPointerUp={() => {
                    dragRef.current = null;
                  }}
                >
                  {overlay.type === "text" ? (
                    <div
                      className="h-full w-full overflow-hidden px-1 leading-tight"
                      style={{
                        color: overlay.color,
                        fontSize: `${Math.max(10, overlay.fontSize * 0.85)}px`,
                        textAlign:
                          overlay.align === "center"
                            ? "center"
                            : overlay.align === "end"
                              ? "right"
                              : "left",
                        fontFamily:
                          '"NotoSansArabic", "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif',
                      }}
                      dir={
                        overlay.dir === "rtl"
                          ? "rtl"
                          : overlay.dir === "ltr"
                            ? "ltr"
                            : "auto"
                      }
                    >
                      {overlay.text}
                    </div>
                  ) : null}
                  {overlay.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={overlay.dataUrl}
                      alt=""
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                  ) : null}
                  {overlay.type === "whiteout" ? (
                    <div className="h-full w-full bg-white" />
                  ) : null}
                  {overlay.type === "table" ? (
                    <div
                      className="grid h-full w-full bg-white text-[10px] text-black"
                      style={{
                        gridTemplateColumns: `repeat(${overlay.cols}, 1fr)`,
                        gridTemplateRows: `repeat(${overlay.rows}, 1fr)`,
                      }}
                    >
                      {overlay.cells.map((cell, i) => (
                        <div
                          key={i}
                          className="overflow-hidden border border-black/30 px-0.5"
                        >
                          {cell}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {overlay.type === "rect" || overlay.type === "border" ? (
                    <div
                      className="h-full w-full"
                      style={{
                        borderStyle: "solid",
                        borderWidth:
                          overlay.type === "border"
                            ? Math.max(2, overlay.strokeWidth)
                            : overlay.strokeWidth,
                        borderColor: overlay.stroke,
                        backgroundColor:
                          (overlay.fillOpacity ?? 0) > 0
                            ? overlay.fill || overlay.stroke
                            : "transparent",
                        opacity:
                          (overlay.fillOpacity ?? 0) > 0
                            ? Math.max(overlay.fillOpacity || 0.12, 0.08)
                            : 1,
                      }}
                    />
                  ) : null}
                  {overlay.type === "doubleFrame" ||
                  overlay.type === "fullPageFrame" ? (
                    <div
                      className="h-full w-full border-solid"
                      style={{
                        borderWidth: Math.max(
                          overlay.type === "fullPageFrame" ? 3 : 2,
                          overlay.strokeWidth,
                        ),
                        borderColor: overlay.stroke,
                        padding: overlay.type === "fullPageFrame" ? 10 : 6,
                      }}
                    >
                      <div
                        className="h-full w-full border-solid"
                        style={{
                          borderWidth: Math.max(
                            1,
                            overlay.strokeWidth *
                              (overlay.type === "fullPageFrame" ? 0.55 : 0.75),
                          ),
                          borderColor: overlay.stroke,
                        }}
                      />
                    </div>
                  ) : null}
                  {overlay.type === "oval" || overlay.type === "stamp" ? (
                    <div
                      className="h-full w-full rounded-full border-solid"
                      style={{
                        borderWidth: Math.max(
                          overlay.type === "stamp" ? 2.5 : 2,
                          overlay.strokeWidth,
                        ),
                        borderColor: overlay.stroke,
                        backgroundColor:
                          (overlay.fillOpacity ?? 0) > 0
                            ? overlay.fill || overlay.stroke
                            : "transparent",
                        opacity:
                          (overlay.fillOpacity ?? 0) > 0
                            ? Math.max(overlay.fillOpacity || 0.12, 0.08)
                            : 1,
                      }}
                    />
                  ) : null}
                  {overlay.type === "banner" ? (
                    <div
                      className="h-full w-full border-solid"
                      style={{
                        borderWidth: overlay.strokeWidth,
                        borderColor: overlay.stroke,
                        backgroundColor: overlay.fill || overlay.stroke,
                        opacity: Math.max(overlay.fillOpacity || 0.18, 0.12),
                      }}
                    />
                  ) : null}
                  {overlay.type === "line" ? (
                    <div
                      className="absolute inset-x-0 top-1/2 -translate-y-1/2"
                      style={{
                        height: Math.max(2, overlay.strokeWidth),
                        backgroundColor: overlay.stroke,
                      }}
                    />
                  ) : null}
                  {selected && onResizeOverlay ? (
                    <button
                      type="button"
                      className="absolute -bottom-1.5 -end-1.5 h-3.5 w-3.5 rounded-sm border border-accent bg-white"
                      aria-label="Resize"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const parent = e.currentTarget.parentElement?.parentElement;
                        if (!parent) return;
                        const start = normFromEvent(
                          pageIndex,
                          e.clientX,
                          e.clientY,
                          parent,
                        );
                        const startW = overlay.w;
                        const startH = overlay.h;
                        const onMove = (ev: PointerEvent) => {
                          const pos = normFromEvent(
                            pageIndex,
                            ev.clientX,
                            ev.clientY,
                            parent,
                          );
                          onResizeOverlay(
                            overlay.id,
                            Math.max(0.04, startW + (pos.x - start.x)),
                            Math.max(0.02, startH + (pos.y - start.y)),
                          );
                        };
                        const onUp = () => {
                          window.removeEventListener("pointermove", onMove);
                          window.removeEventListener("pointerup", onUp);
                        };
                        window.addEventListener("pointermove", onMove);
                        window.addEventListener("pointerup", onUp);
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
