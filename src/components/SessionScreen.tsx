"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  CircleExclamationPoint,
  ClipboardCheck,
  LoaderCircle,
  Mic,
  MessageSquareText,
  Play,
  Package,
  Store,
  Volume2,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import {
  base64ToObjectUrl,
  extensionForMime,
  formatDuration,
  isRecordingSupported,
  pickRecorderMimeType,
  silentWavDataUri,
} from "@/lib/audio";
import type {
  ChatMessage,
  EvaluateSessionResponse,
  Evaluation,
  SessionContext,
  SessionInfo,
  VoiceTurnResponse,
} from "@/lib/types";

type Phase = "idle" | "recording" | "processing" | "playing";

const MIN_RECORDING_MS = 500;
const MAX_RECORDING_MS = 60_000;

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Siap Bicara",
  recording: "Merekam Suara...",
  processing: "Pemilik Toko Merespons...",
  playing: "Memutar Suara...",
};

interface Props {
  session: SessionInfo;
  context: SessionContext;
  onEvaluated: (evaluation: Evaluation) => void;
  onExit: () => void;
}

/** Mengosongkan elemen audio sepenuhnya agar sumber lama tidak ikut terbawa (penting di iOS). */
function resetAudioElement(audio: HTMLAudioElement) {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

let messageSeq = 0;
const nextId = () => `m-${Date.now()}-${messageSeq++}`;

export default function SessionScreen({ session, context, onEvaluated, onExit }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [evaluating, setEvaluating] = useState(false);
  const [hasReplay, setHasReplay] = useState(false);
  const [supported] = useState(() => isRecordingSupported());

  const phaseRef = useRef<Phase>("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pressingRef = useRef(false);
  const startingRef = useRef(false);
  const recordStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  const lastAudioUrlRef = useRef<string | null>(null);
  /** URL klip balasan yang sedang aktif; event dari klip lain (lama / audio unlock) diabaikan. */
  const activeClipUrlRef = useRef<string | null>(null);
  /** Naik setiap kali pemutaran dimulai/dihentikan, untuk membatalkan promise play() yang basi. */
  const playTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  const customerName = context.counterpart_name || "Pelanggan";

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  // ---------- Audio playback ----------
  const getAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audio.setAttribute("playsinline", "true");
      const isActiveClip = () => !!activeClipUrlRef.current && audio.src === activeClipUrlRef.current;
      audio.addEventListener("ended", () => {
        if (isActiveClip() && phaseRef.current === "playing") setPhase("idle");
      });
      audio.addEventListener("error", () => {
        if (!isActiveClip() || !mountedRef.current) return;
        if (phaseRef.current === "playing") setPhase("idle");
        setHint("Audio balasan gagal dimuat. Ketuk “Putar Ulang” atau baca transkrip.");
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }, [setPhase]);

  const stopPlayback = useCallback(() => {
    playTokenRef.current++;
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.pause();
    if (phaseRef.current === "playing") setPhase("idle");
  }, [setPhase]);

  /** Wajib dipanggil di dalam gesture pengguna agar autoplay diizinkan (iOS Safari). */
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    const audio = getAudio();
    audioUnlockedRef.current = true;
    activeClipUrlRef.current = null; // klip hening bukan balasan AI
    audio.src = silentWavDataUri();
    audio.play().catch((err: unknown) => {
      // Hanya penolakan izin yang berarti elemen belum terbuka; AbortError terjadi
      // ketika klip hening digantikan balasan AI, dan itu normal.
      if (err instanceof DOMException && err.name === "NotAllowedError") audioUnlockedRef.current = false;
    });
  }, [getAudio]);

  /**
   * Memuat & memutar klip balasan dengan bersih: reset elemen, pasang sumber baru, load(), play().
   * Bagian sinkron (sebelum await) sudah memasang sumber baru, jadi pemanggil boleh me-revoke URL lama
   * tepat setelah memanggil fungsi ini.
   */
  const playUrl = useCallback(
    async (url: string) => {
      const audio = getAudio();
      const token = ++playTokenRef.current;

      resetAudioElement(audio);
      activeClipUrlRef.current = url;
      audio.src = url;
      audio.load();
      setPhase("playing");

      try {
        await audio.play();
      } catch (err) {
        // Diabaikan bila sudah digantikan klip lain / dihentikan / komponen sudah unmount.
        if (!mountedRef.current || token !== playTokenRef.current) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "AbortError") return;
        setPhase("idle");
        setHint(
          name === "NotAllowedError"
            ? "Browser memblokir pemutaran otomatis. Ketuk “Putar Ulang” untuk mendengar balasan."
            : "Audio balasan gagal diputar. Ketuk “Putar Ulang” atau baca transkrip."
        );
      }
    },
    [getAudio, setPhase]
  );

  // ---------- Network turn ----------
  const sendTurn = useCallback(
    async (blob: Blob) => {
      setPhase("processing");
      const controller = new AbortController();
      abortRef.current = controller;

      const form = new FormData();
      form.append("session_id", session.id);
      form.append("audio", blob, `rekaman.${extensionForMime(blob.type)}`);

      try {
        const data = await apiFetch<VoiceTurnResponse>("/api/voice-turn", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
        if (!mountedRef.current) return;

        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "user", content: data.userTranscript },
          { id: nextId(), role: "assistant", content: data.assistantReply },
        ]);

        if (data.audioBase64) {
          // Blob URL baru untuk setiap giliran; URL lama baru di-revoke setelah elemen audio
          // sudah dialihkan ke sumber baru (playUrl memasang src secara sinkron).
          const previousUrl = lastAudioUrlRef.current;
          const url = base64ToObjectUrl(data.audioBase64, data.audioMimeType || "audio/mpeg");
          lastAudioUrlRef.current = url;
          setHasReplay(true);
          const playing = playUrl(url);
          if (previousUrl && previousUrl !== url) URL.revokeObjectURL(previousUrl);
          await playing;
        } else {
          setPhase("idle");
          setHint("Suara balasan tidak tersedia, silakan baca transkrip.");
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Gagal mengirim rekaman.");
        setPhase("idle");
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [playUrl, session.id, setPhase]
  );

  // ---------- Recording ----------
  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const getStream = async (): Promise<MediaStream> => {
    const existing = streamRef.current;
    if (existing && existing.getAudioTracks().some((t) => t.readyState === "live")) return existing;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    streamRef.current = stream;
    return stream;
  };

  const stopRecording = useCallback(() => {
    pressingRef.current = false;
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") {
      try {
        rec.requestData();
      } catch {
        // abaikan, sebagian browser tidak mendukung requestData saat stop
      }
      rec.stop();
    }
    clearTimer();
  }, []);

  const startRecording = useCallback(async () => {
    if (evaluating || startingRef.current) return;
    if (phaseRef.current === "processing" || phaseRef.current === "recording") return;
    if (!supported) {
      setError("Browser ini tidak mendukung perekaman suara. Gunakan Chrome/Safari terbaru melalui HTTPS.");
      return;
    }

    pressingRef.current = true;
    startingRef.current = true;
    setError(null);
    setHint(null);
    stopPlayback(); // menyela suara AI bila sedang diputar
    unlockAudio();

    let stream: MediaStream;
    try {
      stream = await getStream();
    } catch (err) {
      startingRef.current = false;
      pressingRef.current = false;
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Izin mikrofon ditolak. Aktifkan akses mikrofon di pengaturan browser lalu coba lagi."
          : name === "NotFoundError"
            ? "Mikrofon tidak ditemukan pada perangkat ini."
            : "Tidak dapat mengakses mikrofon."
      );
      return;
    }

    startingRef.current = false;
    if (!pressingRef.current) {
      // Tombol sudah dilepas saat dialog izin mikrofon muncul.
      setHint("Mikrofon siap. Tahan tombol sambil berbicara, lalu lepas untuk mengirim.");
      return;
    }

    const mimeType = pickRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
    } catch {
      recorder = new MediaRecorder(stream);
    }

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      recorderRef.current = null;
      clearTimer();
      if (!mountedRef.current) return;
      const duration = Date.now() - recordStartRef.current;
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (duration < MIN_RECORDING_MS || blob.size < 1_000) {
        setPhase("idle");
        setHint("Rekaman terlalu singkat — tahan tombol selama Anda berbicara.");
        return;
      }
      void sendTurn(blob);
    };

    recorderRef.current = recorder;
    recordStartRef.current = Date.now();
    setElapsedMs(0);
    recorder.start(250);
    setPhase("recording");
    if ("vibrate" in navigator) navigator.vibrate?.(15);

    timerRef.current = setInterval(() => {
      const ms = Date.now() - recordStartRef.current;
      setElapsedMs(ms);
      if (ms >= MAX_RECORDING_MS) stopRecording();
    }, 200);
  }, [evaluating, sendTurn, setPhase, stopPlayback, stopRecording, supported, unlockAudio]);

  // ---------- Pointer & keyboard handlers ----------
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // abaikan
    }
    void startRecording();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    stopRecording();
  };

  const onButtonKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      void startRecording();
    }
  };

  const onButtonKeyUp = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      stopRecording();
    }
  };

  // Spasi global (desktop) untuk push-to-talk, kecuali saat mengetik di input.
  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName));

    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      void startRecording();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      e.preventDefault();
      stopRecording();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startRecording, stopRecording]);

  // Auto-scroll transcript setiap ada giliran baru / status berubah.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, phase]);

  // Bersihkan resource saat keluar dari layar sesi.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      abortRef.current?.abort();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- penghitung biasa, bukan ref ke node DOM
      playTokenRef.current++;
      activeClipUrlRef.current = null;
      if (audioRef.current) resetAudioElement(audioRef.current);
      if (lastAudioUrlRef.current) URL.revokeObjectURL(lastAudioUrlRef.current);
      lastAudioUrlRef.current = null;
    };
  }, []);

  // ---------- Actions ----------
  const replay = () => {
    if (!lastAudioUrlRef.current || phaseRef.current === "recording" || phaseRef.current === "processing") return;
    setHint(null);
    void playUrl(lastAudioUrlRef.current);
  };

  const finish = async () => {
    if (evaluating) return;
    if (!messages.some((m) => m.role === "user")) {
      setError("Belum ada percakapan untuk dinilai. Tahan tombol mikrofon dan mulai bicara terlebih dahulu.");
      return;
    }
    stopRecording();
    stopPlayback();
    setError(null);
    setEvaluating(true);
    try {
      const data = await apiFetch<EvaluateSessionResponse>("/api/evaluate-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: session.id }),
      });
      if (!mountedRef.current) return;
      onEvaluated(data.evaluation);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Gagal menilai sesi.");
      setEvaluating(false);
    }
  };

  const exit = () => {
    if (messages.length > 0 && !window.confirm("Keluar tanpa menilai sesi? Percakapan tetap tersimpan.")) return;
    onExit();
  };

  // ---------- Render ----------
  const busy = phase === "processing" || evaluating;
  const subLabel =
    phase === "idle"
      ? "Tahan tombol untuk berbicara"
      : phase === "recording"
        ? `${formatDuration(elapsedMs)} · Lepas untuk mengirim`
        : phase === "processing"
          ? `${customerName} sedang berpikir`
          : "Tekan tombol untuk menyela";

  return (
    <div className="relative flex h-dvh flex-col md:h-full">
      {/* Header */}
      <header className="pt-safe flex items-center gap-2 border-b border-line bg-surface px-3 pb-3 md:px-5">
        <button
          type="button"
          onClick={exit}
          disabled={evaluating}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 disabled:opacity-40"
          aria-label="Kembali ke daftar skenario"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold md:text-base">
            {context.customer ? `${context.customer.owner_name} · ${context.customer.store_name}` : context.title}
          </h1>
          <p className="flex items-center gap-1 truncate text-xs text-muted">
            {context.product ? (
              <>
                <Package className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {context.product.name}
                  {context.focus ? ` · ${context.focus.label}` : ""}
                </span>
              </>
            ) : (
              <>
                <Store className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{customerName}</span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={finish}
          disabled={evaluating || phase === "processing" || phase === "recording"}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-soft px-3 py-2 text-xs font-semibold text-brand-strong transition hover:bg-brand hover:text-on-brand disabled:opacity-50 md:text-sm"
        >
          <ClipboardCheck className="h-4 w-4" aria-hidden />
          <span>Selesai &amp; Nilai Sesi</span>
        </button>
      </header>

      {/* Live transcript */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-bg px-3 py-4 md:px-5"
        aria-live="polite"
        aria-label="Live transcript"
      >
        {messages.length === 0 && phase !== "processing" ? (
          <div className="mx-auto mt-8 max-w-sm text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <MessageSquareText className="h-7 w-7" aria-hidden />
            </div>
            <p className="font-semibold">Live Transcript</p>
            <p className="mt-1 text-sm text-muted">
              Mulai percakapan dengan menyapa <span className="font-medium text-ink">{customerName}</span>.
              Tahan tombol mikrofon di bawah, bicara, lalu lepas.
            </p>
            {(context.customer || context.description) && (
              <div className="mt-4 space-y-1.5 rounded-xl border border-line bg-surface p-3 text-left text-xs text-muted">
                {context.customer && (
                  <p>
                    <span className="font-semibold text-ink">{context.customer.store_name}</span>
                    {[context.customer.store_scale, context.customer.area_name].filter(Boolean).length > 0 &&
                      ` — ${[context.customer.store_scale, context.customer.area_name].filter(Boolean).join(", ")}`}
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${context.customer.is_mandatory ? "bg-brand text-on-brand" : "bg-surface-2"}`}>
                      {context.customer.is_mandatory ? "Wajib" : "Opsional"}
                    </span>
                  </p>
                )}
                {context.product && (
                  <p>
                    Produk: <span className="font-medium text-ink">{context.product.name}</span> ({context.product.product_code})
                  </p>
                )}
                {context.focus && (
                  <p>
                    Fokus: <span className="font-medium text-ink">{context.focus.label}</span>
                    {context.challenge_mode === "tough" ? " · Menantang" : ""}
                  </p>
                )}
                {context.description && <p>{context.description}</p>}
              </div>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => (
              <li key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm md:max-w-[75%] ${
                    m.role === "user"
                      ? "rounded-br-md bg-bubble-user text-on-brand"
                      : "rounded-bl-md border border-line bg-bubble-ai text-ink"
                  }`}
                >
                  <p
                    className={`mb-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                      m.role === "user" ? "text-on-brand/75" : "text-brand"
                    }`}
                  >
                    {m.role === "user" ? "Anda" : customerName}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              </li>
            ))}
            {phase === "processing" && (
              <>
                <li className="flex justify-end">
                  <div className="rounded-2xl rounded-br-md bg-bubble-user/60 px-4 py-2.5 text-sm italic text-on-brand">
                    Mentranskrip ucapan...
                  </div>
                </li>
                <li className="flex justify-start">
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-line bg-bubble-ai px-4 py-3.5">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="h-2 w-2 animate-bounce rounded-full bg-muted"
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </div>
                </li>
              </>
            )}
          </ul>
        )}
      </div>

      {/* Bottom control bar */}
      <div className="pb-safe border-t border-line bg-surface px-4 pt-3">
        {(error || hint) && (
          <div
            role={error ? "alert" : "status"}
            className={`mb-3 flex items-start gap-2 rounded-xl px-3 py-2 text-sm ${
              error ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"
            }`}
          >
            <CircleExclamationPoint className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error ?? hint}</span>
          </div>
        )}

        <div className="flex flex-col items-center">
          <p
            className={`text-base font-semibold ${
              phase === "recording" ? "text-danger" : phase === "idle" ? "text-ink" : "text-brand"
            }`}
          >
            {PHASE_LABEL[phase]}
          </p>
          <p className="mb-3 h-5 text-xs text-muted">{subLabel}</p>

          <div className="relative flex w-full items-center justify-center">
            {hasReplay && (
              <button
                type="button"
                onClick={replay}
                disabled={phase !== "idle"}
                className="absolute left-0 flex flex-col items-center gap-1 rounded-xl px-2 py-1 text-xs text-muted transition hover:text-ink disabled:opacity-30 sm:left-4"
                aria-label="Putar ulang balasan terakhir"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2">
                  <Play className="h-5 w-5" aria-hidden />
                </span>
                Putar Ulang
              </button>
            )}

            <div className="relative">
              {phase === "recording" && (
                <span className="animate-pulse-ring pointer-events-none absolute inset-0 rounded-full bg-danger" />
              )}
              <button
                type="button"
                aria-label={phase === "recording" ? "Lepas untuk mengirim" : "Tahan untuk berbicara"}
                aria-pressed={phase === "recording"}
                disabled={busy}
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onLostPointerCapture={() => {
                  if (pressingRef.current) stopRecording();
                }}
                onKeyDown={onButtonKeyDown}
                onKeyUp={onButtonKeyUp}
                onContextMenu={(e) => e.preventDefault()}
                className={`no-callout relative flex h-24 w-24 items-center justify-center rounded-full text-on-brand shadow-lg outline-none transition-all duration-150 focus-visible:ring-4 focus-visible:ring-brand/40 md:h-28 md:w-28 ${
                  phase === "recording"
                    ? "scale-110 bg-danger"
                    : phase === "processing"
                      ? "bg-brand/60"
                      : phase === "playing"
                        ? "bg-success"
                        : "bg-brand hover:bg-brand-strong active:scale-95"
                } disabled:cursor-not-allowed`}
              >
                {phase === "processing" || evaluating ? (
                  <LoaderCircle className="h-10 w-10 animate-spin" aria-hidden />
                ) : phase === "playing" ? (
                  <span className="flex h-10 items-center gap-1" aria-hidden>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className="wave-bar block h-full w-1.5 rounded-full bg-on-brand"
                        style={{ animationDelay: `${i * 120}ms` }}
                      />
                    ))}
                  </span>
                ) : phase === "recording" ? (
                  <Mic className="h-11 w-11" aria-hidden />
                ) : (
                  <Mic className="h-10 w-10" aria-hidden />
                )}
              </button>
            </div>

            {phase === "playing" && (
              <Volume2 className="absolute right-4 h-6 w-6 text-success sm:right-8" aria-hidden />
            )}
          </div>

          <p className="mt-3 hidden text-xs text-muted md:block">
            Tips desktop: tahan tombol <kbd className="rounded border border-line bg-surface-2 px-1.5">Spasi</kbd> untuk
            berbicara.
          </p>
        </div>
      </div>

      {evaluating && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="mx-6 flex flex-col items-center rounded-2xl border border-line bg-surface p-6 text-center shadow-xl">
            <LoaderCircle className="h-10 w-10 animate-spin text-brand" aria-hidden />
            <p className="mt-3 font-semibold">Menilai Sesi...</p>
            <p className="mt-1 text-sm text-muted">AI coach sedang menganalisis percakapan Anda.</p>
          </div>
        </div>
      )}
    </div>
  );
}
