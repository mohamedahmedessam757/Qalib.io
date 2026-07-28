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

const PAGE_PAD = 16;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

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
    const autoFitRef = useRef(true);
    const onZoomChangeRef = useRef(onZoomChange);
    onZoomChangeRef.current = onZoomChange;

    const reportZoom = useCallback(() => {
      const z = editorRef.current?.getZoom?.() ?? 1;
      onZoomChangeRef.current?.(z);
      return z;
    }, []);

    const fitToWidth = useCallback(() => {
      const editor = editorRef.current;
      const shell = shellRef.current;
      if (!editor || !shell) return;

      autoFitRef.current = true;
      const layout = editor.getEditorRef()?.getLayout();
      const pageW = layout?.pageSize?.w ?? 816;
      const available = Math.max(shell.clientWidth - PAGE_PAD, 120);
      editor.setZoom(clampZoom(available / pageW));
      reportZoom();
    }, [reportZoom]);

    const adjustZoom = useCallback((delta: number) => {
      const editor = editorRef.current;
      if (!editor) return 1;
      autoFitRef.current = false;
      const next = clampZoom((editor.getZoom?.() ?? 1) + delta);
      editor.setZoom(next);
      onZoomChangeRef.current?.(next);
      return next;
    }, []);

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
            if (prop === "fitToWidth") return fitToWidth;
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
        if (readyRef.current && autoFitRef.current) fitToWidth();
      });
      ro.observe(shell);
      return () => ro.disconnect();
    }, [fitToWidth]);

    // Keep toolbar menus in viewport; never clamp document images/floaters
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
            if (readyRef.current && autoFitRef.current) fitToWidth();
          }}
          className="h-full min-h-full"
        />
      </div>
    );
  },
);
