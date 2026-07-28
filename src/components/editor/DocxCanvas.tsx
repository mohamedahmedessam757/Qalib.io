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
} from "react";
import type { EditorView } from "prosemirror-view";
import { startMenuClampWatcher } from "@/lib/clamp-floating-menus";
import { printDocxAsPdf } from "@/lib/print-docx";

const PAGE_PAD = 8;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;

export type DocxCanvasHandle = DocxEditorRef & {
  fitToWidth: () => void;
  printDocument: () => Promise<void>;
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
};

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export const DocxCanvas = forwardRef<DocxCanvasHandle, DocxCanvasProps>(
  function DocxCanvas(
    {
      documentBuffer,
      compactChrome = false,
      onChange,
      onSelectionChange,
      onReady,
      onZoomChange,
    },
    ref,
  ) {
    const editorRef = useRef<DocxEditorRef | null>(null);
    const shellRef = useRef<HTMLDivElement | null>(null);
    const readyRef = useRef(false);
    /** Auto-fit only until the first stable fit (or user zooms). */
    const autoFitRef = useRef(true);
    const lastWidthRef = useRef(0);
    const zoomBusyRef = useRef(false);
    const pendingDeltaRef = useRef(0);
    const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onZoomChangeRef = useRef(onZoomChange);
    const compactRef = useRef(compactChrome);
    onZoomChangeRef.current = onZoomChange;
    compactRef.current = compactChrome;

    const reportZoom = useCallback((z?: number) => {
      const next = z ?? editorRef.current?.getZoom?.() ?? 1;
      onZoomChangeRef.current?.(next);
      return next;
    }, []);

    const applyZoom = useCallback((next: number) => {
      const editor = editorRef.current;
      if (!editor || zoomBusyRef.current) return editor?.getZoom?.() ?? next;
      const clamped = clampZoom(Number(next.toFixed(2)));
      const current = editor.getZoom?.() ?? 1;
      if (Math.abs(current - clamped) < 0.01) {
        return reportZoom(current);
      }
      zoomBusyRef.current = true;
      try {
        editor.setZoom(clamped);
        // One verify pass only — avoid tight setZoom loops that freeze mobile.
        const applied = editor.getZoom?.() ?? clamped;
        if (Math.abs(applied - clamped) > 0.03) {
          editor.setZoom(clamped);
        }
        return reportZoom(editor.getZoom?.() ?? clamped);
      } finally {
        // Release on next frame so Eigenpal can finish layout first.
        requestAnimationFrame(() => {
          zoomBusyRef.current = false;
          const pending = pendingDeltaRef.current;
          if (pending !== 0) {
            pendingDeltaRef.current = 0;
            const base = editorRef.current?.getZoom?.() ?? clamped;
            applyZoom(base + pending);
          }
        });
      }
    }, [reportZoom]);

    const fitToWidth = useCallback((opts?: { keepAuto?: boolean }) => {
      const editor = editorRef.current;
      const shell = shellRef.current;
      if (!editor || !shell) return;

      const layout = editor.getEditorRef()?.getLayout();
      const pageW = layout?.pageSize?.w ?? 816;
      const available = Math.max(shell.clientWidth - PAGE_PAD, 100);
      const next = clampZoom(available / pageW);
      lastWidthRef.current = shell.clientWidth;

      // On phones: fit once, then stop ResizeObserver churn (keyboard/URL bar).
      if (compactRef.current && !opts?.keepAuto) {
        autoFitRef.current = false;
      } else if (opts?.keepAuto) {
        autoFitRef.current = true;
      }

      applyZoom(next);
    }, [applyZoom]);

    const adjustZoom = useCallback((delta: number) => {
      const editor = editorRef.current;
      if (!editor) return 1;
      autoFitRef.current = false;
      if (zoomBusyRef.current) {
        pendingDeltaRef.current += delta;
        return editor.getZoom?.() ?? 1;
      }
      const current = editor.getZoom?.() ?? 1;
      return applyZoom(current + delta);
    }, [applyZoom]);

    const getZoomLevel = useCallback(() => {
      return editorRef.current?.getZoom?.() ?? 1;
    }, []);

    const printDocument = useCallback(async () => {
      const editor = editorRef.current;
      const shell = shellRef.current;
      if (!shell) return;
      await printDocxAsPdf({
        root: shell,
        title: "Qalib document",
        totalPages: editor?.getTotalPages?.() || 1,
        scrollToPage: (page) => editor?.scrollToPage?.(page),
        setZoom: (z) => editor?.setZoom?.(z),
        getZoom: () => editor?.getZoom?.() ?? 1,
      });
    }, []);

    useImperativeHandle(
      ref,
      () =>
        new Proxy({} as DocxCanvasHandle, {
          get(_target, prop) {
            if (prop === "fitToWidth") return () => fitToWidth({ keepAuto: false });
            if (prop === "printDocument") return printDocument;
            if (prop === "adjustZoom") return adjustZoom;
            if (prop === "getZoomLevel") return getZoomLevel;
            if (prop === "print")
              return () => {
                void printDocument();
              };
            const editor = editorRef.current;
            if (!editor) return undefined;
            const value = Reflect.get(editor, prop, editor);
            return typeof value === "function" ? value.bind(editor) : value;
          },
        }),
      [fitToWidth, printDocument, adjustZoom, getZoomLevel],
    );

    useEffect(() => {
      const shell = shellRef.current;
      if (!shell) return;
      const ro = new ResizeObserver(() => {
        if (!readyRef.current || !autoFitRef.current) return;
        const w = shell.clientWidth;
        // Ignore height-only changes (mobile chrome / keyboard).
        if (Math.abs(w - lastWidthRef.current) < 12) return;
        if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
        fitTimerRef.current = setTimeout(() => {
          if (readyRef.current && autoFitRef.current) {
            fitToWidth({ keepAuto: !compactRef.current });
          }
        }, 220);
      });
      ro.observe(shell);
      return () => {
        ro.disconnect();
        if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      };
    }, [fitToWidth]);

    useEffect(() => {
      const shell = shellRef.current;
      if (!shell) return;
      return startMenuClampWatcher(shell);
    }, [documentBuffer]);

    const handleViewReady = useCallback(
      (_view: EditorView) => {
        readyRef.current = true;
        // Single deferred fit — avoid stacked setZoom on open.
        requestAnimationFrame(() => {
          fitToWidth({ keepAuto: !compactRef.current });
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
            void printDocument();
          }}
          onFontsLoaded={() => {
            // Fonts can change page width slightly; one quiet refit if still auto-fitting.
            if (readyRef.current && autoFitRef.current) {
              fitToWidth({ keepAuto: !compactRef.current });
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
