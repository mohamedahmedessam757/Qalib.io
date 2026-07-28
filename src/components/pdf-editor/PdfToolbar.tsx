"use client";

import {
  Circle,
  Eraser,
  Frame,
  ImagePlus,
  Minus,
  MousePointer2,
  PanelTop,
  Plus,
  Slash,
  Square,
  SquareStack,
  Table2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

export type PdfTool =
  | "select"
  | "text"
  | "image"
  | "table"
  | "whiteout"
  | "rect"
  | "border"
  | "line"
  | "oval"
  | "doubleFrame"
  | "banner";

export function PdfToolbar({
  tool,
  fontSize,
  color,
  zoom,
  labels,
  onTool,
  onFontSize,
  onColor,
  onPickImage,
  onZoomIn,
  onZoomOut,
}: {
  tool: PdfTool;
  fontSize: number;
  color: string;
  zoom: number;
  labels: {
    select: string;
    text: string;
    image: string;
    table: string;
    whiteout: string;
    rect: string;
    border: string;
    line: string;
    oval: string;
    doubleFrame: string;
    banner: string;
    fontSize: string;
    fontColor: string;
    zoomIn: string;
    zoomOut: string;
  };
  onTool: (tool: PdfTool) => void;
  onFontSize: (size: number) => void;
  onColor: (color: string) => void;
  onPickImage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const tools: { id: PdfTool; icon: typeof Type; label: string }[] = [
    { id: "select", icon: MousePointer2, label: labels.select },
    { id: "text", icon: Type, label: labels.text },
    { id: "image", icon: ImagePlus, label: labels.image },
    { id: "table", icon: Table2, label: labels.table },
    { id: "whiteout", icon: Eraser, label: labels.whiteout },
    { id: "rect", icon: Square, label: labels.rect },
    { id: "border", icon: Frame, label: labels.border },
    { id: "doubleFrame", icon: SquareStack, label: labels.doubleFrame },
    { id: "oval", icon: Circle, label: labels.oval },
    { id: "banner", icon: PanelTop, label: labels.banner },
    { id: "line", icon: Slash, label: labels.line },
  ];

  return (
    <div className="pdf-toolbar flex items-center gap-1 overflow-x-auto overscroll-x-contain px-1 py-1 [-ms-overflow-style:none] [scrollbar-width:thin]">
      {tools.map(({ id, icon: Icon, label }) => (
        <Button
          key={id}
          size="sm"
          variant={tool === id ? "solid" : "ghost"}
          className="min-h-11 min-w-11 shrink-0 gap-1.5 px-2 sm:min-h-9"
          aria-label={label}
          title={label}
          onClick={() => {
            if (id === "image") onPickImage();
            else onTool(id);
          }}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden xl:inline">{label}</span>
        </Button>
      ))}
      <div className="mx-1 hidden h-6 w-px shrink-0 bg-white/15 sm:block" />
      <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-line bg-white/[0.03] px-0.5">
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 min-w-10 px-1.5 sm:min-h-9 sm:min-w-8"
          onClick={onZoomOut}
          aria-label={labels.zoomOut}
          title={labels.zoomOut}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="min-w-[2.75rem] text-center text-[11px] tabular-nums text-muted">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 min-w-10 px-1.5 sm:min-h-9 sm:min-w-8"
          onClick={onZoomIn}
          aria-label={labels.zoomIn}
          title={labels.zoomIn}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <label className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted">
        <span className="hidden sm:inline">{labels.fontSize}</span>
        <input
          type="number"
          min={8}
          max={72}
          value={fontSize}
          onChange={(e) => onFontSize(Number(e.target.value) || 14)}
          className="h-9 w-14 rounded-lg border border-line bg-white/5 px-2 text-foreground"
        />
      </label>
      <label className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted">
        <span className="hidden sm:inline">{labels.fontColor}</span>
        <input
          type="color"
          value={color}
          onChange={(e) => onColor(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded-lg border border-line bg-transparent"
          aria-label={labels.fontColor}
        />
      </label>
    </div>
  );
}
