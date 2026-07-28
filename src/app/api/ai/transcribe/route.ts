import { requireUser } from "@/lib/db";
import { aiRateLimit } from "@/lib/ai/rate-limit";
import { friendlyOpenRouterError } from "@/lib/ai/openrouter";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ALLOWED_AUDIO = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "video/webm", // some browsers label webm audio this way
]);

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function pickMime(file: File) {
  const type = (file.type || "").split(";")[0].trim().toLowerCase();
  if (type && ALLOWED_AUDIO.has(type)) return type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".webm")) return "audio/webm";
  if (name.endsWith(".mp4") || name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".mp3") || name.endsWith(".mpeg")) return "audio/mpeg";
  if (name.endsWith(".wav")) return "audio/wav";
  return type || "audio/webm";
}

async function transcribeWithProvider(opts: {
  blob: Blob;
  filename: string;
  lang?: string;
}): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const sttBase =
    process.env.STT_BASE_URL?.trim() ||
    (openaiKey ? "https://api.openai.com/v1" : null);
  const sttModel = process.env.STT_MODEL?.trim() || "whisper-1";

  // Prefer dedicated OpenAI / custom STT base
  if (sttBase && (openaiKey || process.env.STT_API_KEY?.trim())) {
    const key = process.env.STT_API_KEY?.trim() || openaiKey!;
    const form = new FormData();
    form.append("file", opts.blob, opts.filename);
    form.append("model", sttModel);
    if (opts.lang) form.append("language", opts.lang.slice(0, 2));

    const res = await fetch(`${sttBase.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(friendlyOpenRouterError(res.status, text));
    }
    const json = (await res.json()) as { text?: string };
    return (json.text || "").trim();
  }

  // OpenRouter: some accounts expose OpenAI-compatible audio
  if (openrouterKey) {
    const form = new FormData();
    form.append("file", opts.blob, opts.filename);
    form.append("model", process.env.STT_MODEL?.trim() || "openai/whisper-1");
    if (opts.lang) form.append("language", opts.lang.slice(0, 2));

    const res = await fetch(
      "https://openrouter.ai/api/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          "HTTP-Referer":
            process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
          "X-Title": "Qalib",
        },
        body: form,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(friendlyOpenRouterError(res.status, text));
    }
    const json = (await res.json()) as { text?: string };
    return (json.text || "").trim();
  }

  throw new Error("STT is not configured");
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    if (!user) return jsonError("Unauthorized", 401);
    if (!aiRateLimit(user.id, 12, 60_000)) {
      return jsonError("Too many requests", 429);
    }

    const form = await request.formData().catch(() => null);
    if (!form) return jsonError("Invalid form data", 400);

    const audio = form.get("audio");
    if (!(audio instanceof Blob)) {
      return jsonError("audio required", 400);
    }
    const file =
      typeof File !== "undefined" && audio instanceof File
        ? audio
        : new File([audio], "recording.webm", {
            type: audio.type || "audio/webm",
          });

    if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
      return jsonError("Invalid audio size", 400);
    }

    const mime = pickMime(file);
    if (!ALLOWED_AUDIO.has(mime) && !mime.startsWith("audio/")) {
      return jsonError("Unsupported audio type", 400);
    }

    const langRaw = form.get("lang");
    const lang =
      typeof langRaw === "string" && langRaw.trim() ? langRaw.trim() : undefined;

    const ext =
      mime.includes("mp4") || mime.includes("m4a")
        ? "mp4"
        : mime.includes("ogg")
          ? "ogg"
          : mime.includes("mpeg") || mime.includes("mp3")
            ? "mp3"
            : mime.includes("wav")
              ? "wav"
              : "webm";

    const text = await transcribeWithProvider({
      blob: file,
      filename: file.name || `recording.${ext}`,
      lang,
    });

    return Response.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcribe failed";
    console.error("[ai/transcribe]", message);
    const status =
      message.includes("RATE_LIMIT") || message.includes("429")
        ? 429
        : message.includes("not configured")
          ? 503
          : message.includes("AUTH")
            ? 401
            : 500;
    return jsonError(message, status);
  }
}
