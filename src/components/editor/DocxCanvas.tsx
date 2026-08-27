"use client";

import {
  DocxEditor,
  type DocxEditorRef,
} from "@eigenpal/docx-editor-react";
import "@eigenpal/docx-editor-react/styles.css";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import type { EditorView } from "prosemirror-view";
import { startMenuClampWatcher } from "@/lib/clamp-floating-menus";
import { exportDocxPagesToPdfBlob } from "@/lib/export-docx-pdf";

const PAGE_PAD = 8;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;

export type PrintDocumentOptions = {
  onProgress?: (current: number, total: number) => void;
};

export type DocxCanvasHandle = DocxEditorRef & {
  fitToWidth: () => void;
  printDocument: (opts?: PrintDocumentOptions) => Promise<Blob>;
  adjustZoom: (delta: number) => number;
  getZoomLevel: () => number;
};

type DocxCanvasProps = {
  documentBuffer: ArrayBuffer;
  compactChrome?: boolean;
  onChange?: () => void;
  onSelectionChange?: () => void;
  onReady?: () => void;
  onZoomChange?: (zoom: number) => void;
  onRequestPdfExport?: () => void;
};

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/**
 * Mobile zoom strategy:
 * - Eigenpal setZoom runs at most once (fit-to-width). That alone is expensive.
 * - User ± buttons only change a CSS `zoom` multiplier — no Eigenpal re-layout,
 *   so scrolling between pages no longer freezes the UI.
 */
export const DocxCanvas = forwardRef<DocxCanvasHandle, DocxCanvasProps>(
  function DocxCanvas(
    {
      documentBuffer,
      compactChrome = false,
      onChange,
      onSelectionChange,
      onReady,
      onZoomChange,
      onRequestPdfExport,
    },
    ref,
  ) {
    const editorRef = useRef<DocxEditorRef | null>(null);
    const shellRef = useRef<HTMLDivElement | null>(null);
    const readyRef = useRef(false);
    const autoFitRef = useRef(true);
    const lastWidthRef = useRef(0);
    const baseZoomRef = useRef(1);
    const viewScaleRef = useRef(1);
    const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onZoomChangeRef = useRef(onZoomChange);
    const onRequestPdfExportRef = useRef(onRequestPdfExport);
    const compactRef = useRef(compactChrome);
    const [viewScale, setViewScale] = useState(1);
    onZoomChangeRef.current = onZoomChange;
    onRequestPdfExportRef.current = onRequestPdfExport;
    compactRef.current = compactChrome;

    const reportZoom = useCallback(() => {
      const z = baseZoomRef.current * viewScaleRef.current;
      onZoomChangeRef.current?.(z);
      return z;
    }, []);

    const applyEigenpalZoom = useCallback((next: number) => {
      const editor = editorRef.current;
      if (!editor) return 1;
      const clamped = clampZoom(Number(next.toFixed(2)));
      editor.setZoom(clamped);
      baseZoomRef.current = editor.getZoom?.() ?? clamped;
      return reportZoom();
    }, [reportZoom]);

    const fitToWidth = useCallback(() => {
      const editor = editorRef.current;
      const shell = shellRef.current;
      if (!editor || !shell) return;

      const layout = editor.getEditorRef()?.getLayout();
      const pageW = layout?.pageSize?.w ?? 816;
      const available = Math.max(shell.clientWidth - PAGE_PAD, 100);
      const next = clampZoom(available / pageW);
      lastWidthRef.current = shell.clientWidth;
      viewScaleRef.current = 1;
      setViewScale(1);
      autoFitRef.current = false;
      applyEigenpalZoom(next);
    }, [applyEigenpalZoom]);

    const adjustZoom = useCallback((delta: number) => {
      const editor = editorRef.current;
      if (!editor) return 1;

      // Phones: CSS zoom only — never call Eigenpal setZoom again.
      if (compactRef.current) {
        autoFitRef.current = false;
        const step = delta > 0 ? 0.12 : -0.12;
        const scaled = Math.min(
          2.2,
          Math.max(0.55, Number((viewScaleRef.current + step).toFixed(2))),
        );
        viewScaleRef.current = scaled;
        setViewScale(scaled);
        return reportZoom();
      }

      autoFitRef.current = false;
      const current = editor.getZoom?.() ?? baseZoomRef.current;
      return applyEigenpalZoom(current + delta);
    }, [applyEigenpalZoom, reportZoom]);

    const getZoomLevel = useCallback(() => {
      return baseZoomRef.current * viewScaleRef.current;
    }, []);

    const printDocument = useCallback(
      async (exportOpts?: PrintDocumentOptions): Promise<Blob> => {
        const editor = editorRef.current;
        const shell = shellRef.current;
        if (!shell) throw new Error("Editor shell not ready");
        const prevScale = viewScaleRef.current;
        const compact = compactRef.current;
        // Must paint CSS zoom:1 before capture (mobile uses style.zoom).
        viewScaleRef.current = 1;
        flushSync(() => {
          setViewScale(1);
        });
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        await new Promise<void>((r) => setTimeout(r, compact ? 320 : 160));

        const layoutPages = editor?.getEditorRef?.()?.getLayout?.()?.pages;
        const totalPages = Math.max(
          1,
          editor?.getTotalPages?.() || 0,
          Array.isArray(layoutPages) ? layoutPages.length : 0,
        );

        const opts = {
          root: shell,
          title: "Qalib document",
          totalPages,
          scrollToPage: (page: number) => editor?.scrollToPage?.(page),
          setZoom: (z: number) => editor?.setZoom?.(z),
          getZoom: () => editor?.getZoom?.() ?? 1,
          onProgress: exportOpts?.onProgress,
        };
        try {
          return await exportDocxPagesToPdfBlob(opts);
        } finally {
          viewScaleRef.current = prevScale;
          flushSync(() => {
            setViewScale(prevScale);
          });
          reportZoom();
        }
      },
      [reportZoom],
    );

    const requestPdfExport = useCallback(() => {
      onRequestPdfExportRef.current?.();
    }, []);

    useImperativeHandle(
      ref,
      () =>
        new Proxy({} as DocxCanvasHandle, {
          get(_target, prop) {
            if (prop === "fitToWidth") return fitToWidth;
            if (prop === "printDocument") return printDocument;
            if (prop === "adjustZoom") return adjustZoom;
            if (prop === "getZoomLevel") return getZoomLevel;
            if (prop === "print")
              return () => {
                requestPdfExport();
              };
            const editor = editorRef.current;
            if (!editor) return undefined;
            const value = Reflect.get(editor, prop, editor);
            return typeof value === "function" ? value.bind(editor) : value;
          },
        }),
      [fitToWidth, printDocument, requestPdfExport, adjustZoom, getZoomLevel],
    );

    useEffect(() => {
      const shell = shellRef.current;
      if (!shell || compactChrome) return;
      const ro = new ResizeObserver(() => {
        if (!readyRef.current || !autoFitRef.current) return;
        const w = shell.clientWidth;
        if (Math.abs(w - lastWidthRef.current) < 12) return;
        if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
        fitTimerRef.current = setTimeout(() => {
          if (readyRef.current && autoFitRef.current) fitToWidth();
        }, 220);
      });
      ro.observe(shell);
      return () => {
        ro.disconnect();
        if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      };
    }, [fitToWidth, compactChrome]);

    useEffect(() => {
      const shell = shellRef.current;
      if (!shell) return;
      return startMenuClampWatcher(shell);
    }, [documentBuffer]);

    const handleViewReady = useCallback(
      (_view: EditorView) => {
        readyRef.current = true;
        requestAnimationFrame(() => {
          fitToWidth();
          onReady?.();
        });
      },
      [fitToWidth, onReady],
    );

    return (
      <div
        ref={shellRef}
        className="docx-shell h-full w-full touch-pan-y overflow-auto overscroll-contain"
        data-compact={compactChrome ? "true" : "false"}
        data-qalib-skip-clamp="true"
        style={
          compactChrome && viewScale !== 1
            ? ({ zoom: viewScale } as CSSProperties)
            : undefined
        }
      >
        <DocxEditor
          ref={editorRef}
          documentBuffer={documentBuffer}
          showToolbar
          showFileOpen={false}
          showHelpMenu={!compactChrome}
          showOutlineButton={!compactChrome}
          showOutline={false}
          showZoomControl={!compactChrome}
          showRuler={!compactChrome}
          showMarginGuides={false}
          initialZoom={compactChrome ? 0.5 : 1}
          onChange={() => onChange?.()}
          onSelectionChange={() => onSelectionChange?.()}
          onEditorViewReady={handleViewReady}
          onPrint={() => {
            requestPdfExport();
          }}
          onFontsLoaded={() => {
            // Never re-fit on mobile after fonts — that freezes mid-scroll.
            if (!compactRef.current && readyRef.current && autoFitRef.current) {
              fitToWidth();
            } else if (readyRef.current) {
              reportZoom();
            }
          }}
          className="h-full min-h-full"
        />
      </div>
    );
  },
);
