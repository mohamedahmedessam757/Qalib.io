/** Client-side chat image attachments (vision + insert_image). */

export const MAX_CHAT_IMAGES = 3;
export const MAX_IMAGE_EDGE = 1600;
export const MAX_DATA_URL_CHARS = 900_000;

export type ChatImageAttachment = {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
};

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

export function isAllowedChatImage(file: File) {
  return ALLOWED.has(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

export function buildPersistableUserText(
  text: string,
  attachments: Array<{ name: string }>,
  locale: "ar" | "en",
) {
  const base = text.trim();
  if (!attachments.length) return base;
  const labels = attachments.map((a) =>
    locale === "ar" ? `[مرفق: ${a.name}]` : `[Attachment: ${a.name}]`,
  );
  return [base, ...labels].filter(Boolean).join("\n");
}

export function buildMultimodalUserContent(
  text: string,
  attachments: ChatImageAttachment[],
): string | ChatContentPart[] {
  const trimmed = text.trim();
  if (!attachments.length) return trimmed;
  const parts: ChatContentPart[] = [];
  if (trimmed) parts.push({ type: "text", text: trimmed });
  else {
    parts.push({
      type: "text",
      text: "Please analyze the attached image(s). If useful for the document, insert or describe professionally using tools.",
    });
  }
  for (const img of attachments) {
    parts.push({
      type: "image_url",
      image_url: { url: img.dataUrl },
    });
  }
  return parts;
}

export async function compressImageFile(
  file: File,
): Promise<ChatImageAttachment> {
  if (!isAllowedChatImage(file)) {
    throw new Error("UNSUPPORTED_IMAGE");
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("CANVAS_FAILED");
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const preferPng = file.type === "image/png" || file.type === "image/gif";
  let mime = preferPng ? "image/png" : "image/jpeg";
  let quality = 0.84;
  let dataUrl = canvas.toDataURL(mime, quality);

  while (dataUrl.length > MAX_DATA_URL_CHARS && quality > 0.45) {
    mime = "image/jpeg";
    quality -= 0.12;
    dataUrl = canvas.toDataURL(mime, quality);
  }

  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    throw new Error("IMAGE_TOO_LARGE");
  }

  return {
    id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || "image",
    mime,
    dataUrl,
  };
}
