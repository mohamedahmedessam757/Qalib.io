/**
 * Normalize any user-picked image into a DOCX/PDF-safe JPEG or PNG File.
 *
 * Why: Eigenpal's insertImageFromFile stores a data URL + a synthetic rId.
 * Selective DOCX saves skip embedding media when rId is already set, so the
 * image looks fine until reload — then only the alt filename remains.
 * We always re-encode to a real image/*;base64 payload that full saves embed.
 *
 * Security: SVG is rejected (scriptable). HEIC/AVIF/WebP/BMP/GIF convert to
 * raster JPEG/PNG via the shared chat compressor.
 */

import {
  compressImageFile,
  isAllowedChatImage,
} from "@/lib/ai/chat-attachments";

export const EDITOR_IMAGE_ACCEPT =
  "image/*,.heic,.heif,.avif,.bmp,.tif,.tiff,.webp,.gif";

export const MAX_EDITOR_IMAGE_BYTES = 8 * 1024 * 1024;

function isSvgLike(file: File) {
  const type = (file.type || "").toLowerCase();
  return type === "image/svg+xml" || /\.svg$/i.test(file.name);
}

export function isAllowedEditorImage(
  file: File,
  opts?: { fromImagePicker?: boolean },
) {
  if (!file || file.size <= 0) return false;
  if (isSvgLike(file)) return false;
  if (file.size > MAX_EDITOR_IMAGE_BYTES) return false;
  return isAllowedChatImage(file, opts);
}

export type NormalizedEditorImage = {
  file: File;
  dataUrl: string;
  mime: "image/png" | "image/jpeg";
  name: string;
};

/**
 * Decode + re-encode to PNG/JPEG so Word/PDF serializers and pdf-lib can
 * embed the bytes reliably across HEIC, WebP, GIF, BMP, AVIF, TIFF, etc.
 */
export async function normalizeEditorImageFile(
  file: File,
  opts?: { fromImagePicker?: boolean },
): Promise<NormalizedEditorImage> {
  if (isSvgLike(file)) {
    throw new Error("UNSUPPORTED_IMAGE");
  }
  if (file.size <= 0 || file.size > MAX_EDITOR_IMAGE_BYTES) {
    throw new Error("IMAGE_TOO_LARGE");
  }
  if (!isAllowedEditorImage(file, opts)) {
    throw new Error("UNSUPPORTED_IMAGE");
  }

  const att = await compressImageFile(file, {
    fromImagePicker: opts?.fromImagePicker ?? true,
  });
  const mime = att.mime === "image/png" ? "image/png" : "image/jpeg";
  const ext = mime === "image/png" ? "png" : "jpg";
  const base =
    (att.name || file.name || "image")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.\-() \u0600-\u06FF]+/g, "_")
      .slice(0, 80) || "image";
  const name = `${base}.${ext}`;

  const res = await fetch(att.dataUrl);
  const blob = await res.blob();
  const normalized = new File([blob], name, { type: mime });

  return {
    file: normalized,
    dataUrl: att.dataUrl,
    mime,
    name,
  };
}
