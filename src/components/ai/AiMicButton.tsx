"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Mic, Square } from "lucide-react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult:
    | ((ev: {
        results: ArrayLike<{
          0: { transcript: string };
          isFinal: boolean;
        }>;
      }) => void)
    | null;
  onerror: ((ev?: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const BAR_COUNT = 28;
const easeOut = [0.23, 1, 0.32, 1] as const;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function AiMicButton({
  lang,
  disabled,
  draft,
  labels,
  onDraftChange,
  onListeningChange,
}: {
  lang: string;
  disabled?: boolean;
  draft: string;
  labels: {
    start: string;
    stop: string;
    unsupported: string;
    listeningHint?: string;
  };
  onDraftChange: (draft: string) => void;
  onListeningChange?: (listening: boolean) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListenRef = useRef(false);
  const finalsRef = useRef("");
  const baseInputRef = useRef("");
  const draftRef = useRef(draft);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const smoothedRef = useRef<number[]>(
    Array.from({ length: BAR_COUNT }, () => 0.12),
  );
  const phaseRef = useRef(0);

  draftRef.current = draft;

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognition()));
  }, []);

  useEffect(() => {
    onListeningChange?.(listening);
  }, [listening, onListeningChange]);

  useEffect(() => {
    return () => {
      wantListenRef.current = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close().catch(() => undefined);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      try {
        recRef.current?.abort?.();
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  function clearRestart() {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }

  function applyBarScales(levels: number[]) {
    for (let i = 0; i < BAR_COUNT; i += 1) {
      const el = barsRef.current[i];
      if (!el) continue;
      const scale = 0.18 + levels[i] * 0.82;
      el.style.transform = `scaleY(${scale})`;
    }
  }

  function stopAudioMeter() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    analyserRef.current = null;
    smoothedRef.current = Array.from({ length: BAR_COUNT }, () => 0.12);
    applyBarScales(smoothedRef.current);
  }

  async function startAudioMeter() {
    stopAudioMeter();
    const timeData = new Uint8Array(256);

    const tickFromRms = (rms: number) => {
      phaseRef.current += 0.085;
      const speaking = rms > 0.045;
      const breath = 0.1 + 0.06 * (0.5 + 0.5 * Math.sin(phaseRef.current));
      const energy = speaking
        ? Math.min(1, (rms - 0.045) * 7.5)
        : 0;

      const next = smoothedRef.current.map((prev, i) => {
        const center = (i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
        const envelope = 1 - Math.abs(center) * 0.35;
        const ripple =
          0.55 +
          0.45 *
            Math.sin(phaseRef.current * 1.6 + i * 0.42) *
            Math.cos(phaseRef.current * 0.7 + i * 0.18);
        const target = speaking
          ? Math.min(1, breath * 0.35 + energy * envelope * ripple)
          : breath * envelope;
        const alpha = speaking ? 0.42 : 0.14;
        return lerp(prev, target, alpha);
      });
      smoothedRef.current = next;
      applyBarScales(next);
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      analyserRef.current = analyser;

      const loop = () => {
        const node = analyserRef.current;
        if (!node || !wantListenRef.current) return;
        node.getByteTimeDomainData(timeData);
        let sum = 0;
        for (let i = 0; i < timeData.length; i += 1) {
          const v = (timeData[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / timeData.length);
        tickFromRms(rms);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch {
      const pulse = () => {
        if (!wantListenRef.current) return;
        // Soft synthetic breath when meter unavailable
        tickFromRms(0.02 + 0.01 * Math.sin(phaseRef.current));
        rafRef.current = requestAnimationFrame(pulse);
      };
      rafRef.current = requestAnimationFrame(pulse);
    }
  }

  function buildDraft(interim: string) {
    const base = baseInputRef.current.trim();
    const spoken = [finalsRef.current, interim]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!base) return spoken;
    if (!spoken) return base;
    return `${base} ${spoken}`.trim();
  }

  function startRecognition() {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (ev) => {
      let interim = "";
      let sessionFinals = "";
      for (let i = 0; i < ev.results.length; i += 1) {
        const item = ev.results[i];
        const piece = item[0]?.transcript || "";
        if (item.isFinal) sessionFinals += `${piece} `;
        else interim += piece;
      }
      const cleaned = sessionFinals.replace(/\s+/g, " ").trim();
      if (cleaned) {
        if (!finalsRef.current) finalsRef.current = cleaned;
        else if (cleaned.startsWith(finalsRef.current)) {
          finalsRef.current = cleaned;
        } else if (!finalsRef.current.includes(cleaned)) {
          finalsRef.current = `${finalsRef.current} ${cleaned}`.trim();
        }
      }
      onDraftChange(buildDraft(interim));
    };

    rec.onerror = (ev) => {
      const code = ev?.error || "";
      if (code === "aborted" || code === "no-speech") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        wantListenRef.current = false;
        setListening(false);
        stopAudioMeter();
      }
    };

    rec.onend = () => {
      if (!wantListenRef.current) {
        setListening(false);
        stopAudioMeter();
        return;
      }
      clearRestart();
      restartTimerRef.current = setTimeout(() => {
        if (!wantListenRef.current) return;
        try {
          rec.start();
        } catch {
          restartTimerRef.current = setTimeout(() => {
            if (!wantListenRef.current) return;
            try {
              rec.start();
            } catch {
              /* ignore */
            }
          }, 280);
        }
      }, 180);
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      wantListenRef.current = false;
      setListening(false);
      stopAudioMeter();
    }
  }

  async function startListening() {
    if (disabled) return;
    wantListenRef.current = true;
    finalsRef.current = "";
    baseInputRef.current = draftRef.current;
    await startAudioMeter();
    startRecognition();
  }

  function stopListening() {
    wantListenRef.current = false;
    clearRestart();
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setListening(false);
    stopAudioMeter();
    onDraftChange(buildDraft(""));
  }

  if (!supported) return null;

  if (listening) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0.75, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: easeOut }}
        className="flex min-h-14 w-full items-center gap-2.5 rounded-full border border-accent/40 bg-gradient-to-l from-accent/18 via-accent/10 to-white/5 px-2.5 py-2 shadow-[0_12px_32px_rgba(45,212,191,0.16)] sm:min-h-12"
        role="status"
        aria-live="polite"
      >
        <button
          type="button"
          onClick={stopListening}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-danger text-white transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] sm:h-10 sm:w-10"
          aria-label={labels.stop}
          title={labels.stop}
        >
          <Square className="h-4 w-4 fill-current sm:h-[1.125rem] sm:w-[1.125rem]" />
        </button>

        <div className="flex h-9 min-w-0 flex-1 items-center justify-center gap-px px-1 sm:h-8 sm:gap-[2px]">
          {Array.from({ length: BAR_COUNT }, (_, i) => (
            <span
              key={i}
              ref={(el) => {
                barsRef.current[i] = el;
              }}
              className="h-full w-[2px] origin-center rounded-full bg-accent will-change-transform sm:w-[2.5px]"
              style={{ transform: "scaleY(0.18)" }}
            />
          ))}
        </div>

        <span className="hidden max-w-[9rem] truncate pe-2 text-[11px] text-accent sm:inline">
          {labels.listeningHint || labels.stop}
        </span>
      </motion.div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={labels.start}
      title={labels.start}
      onClick={() => void startListening()}
      className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-line bg-white/5 text-foreground transition-[transform,background-color,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-accent/40 hover:bg-accent/10 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-45 sm:h-11 sm:w-11"
    >
      <Mic className="h-5 w-5" />
    </button>
  );
}
