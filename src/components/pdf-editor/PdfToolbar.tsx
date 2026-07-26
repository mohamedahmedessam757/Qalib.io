"use client";

import {
  Eraser,
  ImagePlus,
  MousePointer2,
  Table2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

export type PdfTool = "select" | "text" | "image" | "table" | "whiteout";

export function PdfToolbar({
  tool,
  fontSize,
  color,
  labels,
  onTool,
  onFontSize,
  onColor,
  onPickImage,
}: {
  tool: PdfTool;
  fontSize: number;
  color: string;
  labels: {
    select: string;
    text: string;
    image: string;
    table: string;
    whiteout: string;
    fontSize: string;
    fontColor: string;
  };
  onTool: (tool: PdfTool) => void;
  onFontSize: (size: number) => void;
  onColor: (color: string) => void;
  onPickImage: () => void;
}) {
  const tools: { id: PdfTool; icon: typeof Type; label: string }[] = [
    { id: "select", icon: MousePointer2, label: labels.select },
    { id: "text", icon: Type, label: labels.text },
    { id: "image", icon: ImagePlus, label: labels.image },
    { id: "table", icon: Table2, label: labels.table },
    { id: "whiteout", icon: Eraser, label: labels.whiteout },
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
          <span className="hidden lg:inline">{label}</span>
        </Button>
      ))}
      <div className="mx-1 hidden h-6 w-px shrink-0 bg-white/15 sm:block" />
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
