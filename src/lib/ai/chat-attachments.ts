/** Client-side chat image attachments (vision + insert_image). */

export const MAX_CHAT_IMAGES = 3;
export const MAX_IMAGE_EDGE = 1600;
export const MAX_DATA_URL_CHARS = 900_000;

export type ChatImageAttachment = {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
  /** Object URL preview while compression runs (revoke when done). */
  previewUrl?: string;
  pending?: boolean;
};

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function isHeicLike(file: File) {
  const type = (file.type || "").toLowerCase();
  return (
    type.includes("heic") ||
    type.includes("heif") ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name)
  );
}

export function isAllowedChatImage(
  file: File,
  opts?: { fromImagePicker?: boolean },
) {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (/\.(png|jpe?g|webp|gif|heic|heif)$/i.test(file.name)) return true;
  // iOS Photos often yields empty MIME + no extension when picking from library
  if (opts?.fromImagePicker && !type && file.size > 0) {
    if (/\.(docx|pdf|xlsx|mp4|mov|m4a|mp3|webm)$/i.test(file.name)) return false;
    return true;
  }
  return false;
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
  const ready = attachments.filter((a) => a.dataUrl && !a.pending);
  if (!ready.length) return trimmed;
  const parts: ChatContentPart[] = [];
  if (trimmed) parts.push({ type: "text", text: trimmed });
  else {
    parts.push({
      type: "text",
      text: "Please analyze the attached image(s). If useful for the document, insert or describe professionally using tools.",
    });
  }
  for (const img of ready) {
    parts.push({
      type: "image_url",
      image_url: { url: img.dataUrl },
    });
  }
  return parts;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
    img.src = src;
  });
}

async function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

async function canvasFromSource(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_FAILED");
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

function encodeCanvas(canvas: HTMLCanvasElement, preferPng: boolean): string {
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
  return dataUrl;
}

async function heicToJpegBlob(file: File): Promise<Blob> {
  const heic2any = (await import("heic2any")).default;
  const result = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.86,
  });
  const blob = Array.isArray(result) ? result[0] : result;
  if (!(blob instanceof Blob)) throw new Error("IMAGE_CONVERT_FAILED");
  return blob;
}

async function decodeToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = await canvasFromSource(
      bitmap,
      bitmap.width,
      bitmap.height,
    );
    bitmap.close();
    return canvas;
  } catch {
    /* fall through */
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    if (!img.naturalWidth || !img.naturalHeight) {
      throw new Error("IMAGE_LOAD_FAILED");
    }
    return await canvasFromSource(img, img.naturalWidth, img.naturalHeight);
  } catch {
    const dataUrlSrc = await readFileAsDataUrl(file);
    const img = await loadImageElement(dataUrlSrc);
    if (!img.naturalWidth || !img.naturalHeight) {
      throw new Error("IMAGE_LOAD_FAILED");
    }
    return await canvasFromSource(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function compressImageFile(
  file: File,
  opts?: { fromImagePicker?: boolean },
): Promise<ChatImageAttachment> {
  if (!isAllowedChatImage(file, opts)) {
    throw new Error("UNSUPPORTED_IMAGE");
  }

  let working: Blob = file;
  let name = file.name || "image.jpg";

  if (isHeicLike(file)) {
    try {
      working = await heicToJpegBlob(file);
      name = name.replace(/\.(heic|heif)$/i, ".jpg") || "image.jpg";
    } catch {
      throw new Error("IMAGE_CONVERT_FAILED");
    }
  }

  const preferPng =
    (working.type || file.type) === "image/png" ||
    (working.type || file.type) === "image/gif" ||
    /\.png$/i.test(name);

  let canvas: HTMLCanvasElement;
  try {
    canvas = await decodeToCanvas(working);
  } catch {
    // Last resort: if original wasn't heic but still failed, try heic converter
    if (!isHeicLike(file)) {
      try {
        working = await heicToJpegBlob(file);
        canvas = await decodeToCanvas(working);
        name = name.replace(/\.(heic|heif)$/i, ".jpg") || "image.jpg";
      } catch {
        throw new Error("IMAGE_CONVERT_FAILED");
      }
    } else {
      throw new Error("IMAGE_CONVERT_FAILED");
    }
  }

  const dataUrl = encodeCanvas(canvas, preferPng);
  const mime = dataUrl.startsWith("data:image/png")
    ? "image/png"
    : "image/jpeg";

  return {
    id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    mime,
    dataUrl,
  };
}
