"use client";

import { silentWavDataUri } from "./audio";

/**
 * Sesi audio bersama untuk halaman simulasi (khususnya iOS Safari):
 *
 * - Satu elemen <audio> dipakai sepanjang sesi. iOS hanya mengizinkan autoplay pada elemen yang pernah
 *   diputar di dalam gesture pengguna, jadi elemen ini "dibuka" saat pengguna mengetuk "Mulai Simulasi"
 *   — BUKAN saat menekan tombol rekam. Memutar audio tepat ketika perekaman dimulai membuat iOS
 *   mengganti mode audio dan rekaman pertama nyaris kosong.
 * - Mikrofon dinyalakan lebih awal (warm-up) agar tekanan tombol pertama langsung merekam tanpa jeda
 *   permintaan izin / inisialisasi perangkat.
 */

let sharedAudio: HTMLAudioElement | null = null;
let unlocked = false;
let micStream: MediaStream | null = null;
let micPromise: Promise<MediaStream> | null = null;

export function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = "auto";
    sharedAudio.setAttribute("playsinline", "true");
  }
  return sharedAudio;
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

/** Panggil SECARA SINKRON di dalam handler gesture (click/tap/pointerup). */
export function unlockAudioPlayback(): void {
  if (unlocked || typeof window === "undefined") return;
  const audio = getSharedAudio();
  unlocked = true;
  audio.src = silentWavDataUri();
  audio.play().catch((err: unknown) => {
    // Hanya penolakan izin yang berarti belum terbuka; AbortError (klip hening diganti balasan AI) normal.
    if (err instanceof DOMException && err.name === "NotAllowedError") unlocked = false;
  });
}

function isLive(stream: MediaStream | null): stream is MediaStream {
  return !!stream && stream.getAudioTracks().some((t) => t.readyState === "live");
}

/** Mikrofon bersama; meminta izin sekali dan memakai ulang stream yang masih aktif. */
export function getMicStream(): Promise<MediaStream> {
  if (isLive(micStream)) return Promise.resolve(micStream);
  if (micPromise) return micPromise;
  micPromise = navigator.mediaDevices
    .getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    })
    .then((stream) => {
      micStream = stream;
      return stream;
    })
    .finally(() => {
      micPromise = null;
    });
  return micPromise;
}

/** Nyalakan mikrofon lebih awal; error diabaikan (akan ditangani lagi saat tombol rekam ditekan). */
export function warmUpMicrophone(): void {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
  getMicStream().catch(() => undefined);
}

export function releaseMicStream(): void {
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
}
