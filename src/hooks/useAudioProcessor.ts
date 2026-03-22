"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_CONFIG } from "@/lib/constants";
import { AudioStreamer } from "../lib/audio-streamer";
import { Lipsync } from "wawa-lipsync";
import {
  DEFAULT_LIPSYNC_TUNING,
  useLipSyncStore,
} from "@/store/useLipSyncStore";
import { createLogger } from "@/lib/logging/logger";
import { useEmotiveSpeechStore } from "@/store/useEmotiveSpeechStore";

const log = createLogger("useAudioProcessor");
const BASE64_CHUNK_SIZE = 0x8000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  // FIX(AP2): Single decode helper used by all paths — no duplication.
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useAudioProcessor() {
  const [isMicActive, setIsMicActive] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  
  const mode = useEmotiveSpeechStore((s) => s.mode);

  // ── Level refs ──────────────────────────────────────────────────────────────
  const audioLevelRef = useRef(0);
  const inputAudioLevelRef = useRef(0);
  const outputAudioLevelRef = useRef(0);
  const isAssistantSpeakingRef = useRef(false);
  const lastOutputSignalAtRef = useRef(0);

  // ── Mic pipeline refs ───────────────────────────────────────────────────────
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const processorSilentGainRef = useRef<GainNode | null>(null);
  const micChunkCountRef = useRef(0);

  // FIX(AP1): Use a ref for the "is starting" AND "is active" guards.
  // This removes isMicActive from startMic's dep array, making it
  // referentially stable across mic toggles.
  const micStartingRef = useRef(false);
  const micActiveRef = useRef(false);

  // ── Playback pipeline refs ──────────────────────────────────────────────────
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const wawaRef = useRef<Lipsync | null>(null);
  const playbackAnimFrameRef = useRef<number>(0);
  const playbackLoopActiveRef = useRef(false);

  const queuedPlaybackChunkCountRef = useRef(0);
  const droppedPlaybackChunkCountRef = useRef(0);

  const recentChunkSignaturesRef = useRef<Map<string, number>>(new Map());
  const signatureSweepTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const onAudioScheduledRef = useRef<
    ((startMs: number, durationMs: number) => void) | null
  >(null);
  const onPlaybackCompleteRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (audioStreamerRef.current) {
      audioStreamerRef.current.setMode(mode);
    }
  }, [mode]);

  // ── Level sync ──────────────────────────────────────────────────────────────
  const syncCombinedLevel = useCallback(() => {
    audioLevelRef.current = Math.max(
      inputAudioLevelRef.current,
      outputAudioLevelRef.current,
    );
  }, []);

  // ── Signature sweep ─────────────────────────────────────────────────────────
  const startSignatureSweep = useCallback(() => {
    if (signatureSweepTimerRef.current) return;
    signatureSweepTimerRef.current = setInterval(() => {
      const now = performance.now();
      for (const [sig, ts] of recentChunkSignaturesRef.current) {
        if (now - ts > 10_000) recentChunkSignaturesRef.current.delete(sig);
      }
    }, 2_000);
  }, []);

  const stopSignatureSweep = useCallback(() => {
    if (signatureSweepTimerRef.current) {
      clearInterval(signatureSweepTimerRef.current);
      signatureSweepTimerRef.current = null;
    }
  }, []);

  // ── startMic (FIX AP1: no state in deps) ───────────────────────────────────
  const startMic = useCallback(
    async (onChunk: (base64: string) => void): Promise<boolean> => {
      // FIX(AP1): Read refs instead of state — no dep on isMicActive
      if (micActiveRef.current || micStartingRef.current) {
        log.warn("startMic called while already active or starting; ignoring.");
        return false;
      }
      micStartingRef.current = true;
      setPermissionError(null);

      try {
        if (navigator.permissions?.query) {
          try {
            const perm = await navigator.permissions.query({
              name: "microphone" as PermissionName,
            });
            if (perm.state === "denied") {
              throw new Error(
                "Microphone access is explicitly denied in browser settings.",
              );
            }
          } catch (e) {
            log.debug(
              { err: e },
              "Microphone permission query unsupported; continuing.",
            );
          }
        }

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: AUDIO_CONFIG.input_hz,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = mediaStream;

        const ctx = new AudioContext({ sampleRate: AUDIO_CONFIG.input_hz });
        audioCtxRef.current = ctx;
        if (ctx.state === "suspended") {
          await ctx.resume();
          log.info("[AudioProcessor] Input AudioContext resumed.");
        }

        const source = ctx.createMediaStreamSource(mediaStream);

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        let workletLoaded = false;
        if (typeof AudioWorkletNode !== "undefined") {
          try {
            await ctx.audioWorklet.addModule("/pcm-capture-worklet.js");
            const workletNode = new AudioWorkletNode(
              ctx,
              "pcm-capture-processor",
            );
            source.connect(workletNode);

            workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
              const bytes = new Uint8Array(e.data);
              micChunkCountRef.current += 1;
              if (micChunkCountRef.current % 120 === 0) {
                log.debug(
                  {
                    chunksCaptured: micChunkCountRef.current,
                    capturePath: "AudioWorklet",
                  },
                  "Captured microphone chunks.",
                );
              }
              onChunk(bytesToBase64(bytes));
            };

            workletNodeRef.current = workletNode;
            workletLoaded = true;
            log.info("[AudioProcessor] Using AudioWorklet for PCM capture.");
          } catch (workletErr) {
            log.warn(
              { err: workletErr },
              "AudioWorklet failed; falling back to ScriptProcessorNode.",
            );
          }
        }

        if (!workletLoaded) {
          const processor = ctx.createScriptProcessor(4096, 1, 1);
          source.connect(processor);
          const silentGain = ctx.createGain();
          silentGain.gain.value = 0;
          processor.connect(silentGain);
          silentGain.connect(ctx.destination);
          processorRef.current = processor;
          processorSilentGainRef.current = silentGain;

          processor.onaudioprocess = (e) => {
            const float32 = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
              const s = Math.max(-1, Math.min(1, float32[i]));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            const bytes = new Uint8Array(int16.buffer);
            micChunkCountRef.current += 1;
            if (micChunkCountRef.current % 120 === 0) {
              log.debug(
                {
                  chunksCaptured: micChunkCountRef.current,
                  capturePath: "ScriptProcessorNode",
                },
                "Captured microphone chunks.",
              );
            }
            onChunk(bytesToBase64(bytes));
          };
          log.warn(
            "[AudioProcessor] Using ScriptProcessorNode fallback for PCM capture.",
          );
        }

        const updateLevel = () => {
          if (!analyserRef.current || !audioCtxRef.current) return;
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          const avg = data.reduce((s, v) => s + v, 0) / data.length;
          inputAudioLevelRef.current = avg / 255;
          syncCombinedLevel();
          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
        animFrameRef.current = requestAnimationFrame(updateLevel);

        // FIX(AP1): Update both ref and state
        micActiveRef.current = true;
        setIsMicActive(true);
        micStartingRef.current = false;
        return true;
      } catch (err) {
        micStartingRef.current = false;
        log.warn(
          {
            err:
              err instanceof Error
                ? { name: err.name, message: err.message }
                : String(err),
          },
          "Failed to acquire user media or start AudioContext.",
        );
        let errorMsg = "Could not access microphone.";
        if (err instanceof DOMException) {
          if (
            err.name === "NotFoundError" ||
            err.name === "DevicesNotFoundError"
          ) {
            errorMsg = "No microphone found. Please plug one in.";
          } else if (
            err.name === "NotAllowedError" ||
            err.name === "PermissionDeniedError"
          ) {
            errorMsg =
              "Microphone access was denied. Please allow it in settings.";
          } else if (
            err.name === "NotReadableError" ||
            err.name === "TrackStartError"
          ) {
            errorMsg = "Microphone is already in use by another application.";
          }
        } else if (err instanceof Error) {
          errorMsg = err.message;
        }
        setPermissionError(errorMsg);
        return false;
      }
    },
    // FIX(AP1): No state deps — fully stable reference
    [syncCombinedLevel],
  );

  // ── stopMic ─────────────────────────────────────────────────────────────────
  const stopMic = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = 0;

    if (workletNodeRef.current) {
      // Drain partial buffer — response arrives via existing onmessage handler
      workletNodeRef.current.port.postMessage({ command: 'flush' });
      // Don't null onmessage here — the flush response needs to land first.
      // disconnect() severs the audio graph; the node + port get GC'd after
      // we null the ref below.
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (processorSilentGainRef.current) {
      processorSilentGainRef.current.disconnect();
      processorSilentGainRef.current = null;
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;

    inputAudioLevelRef.current = 0;
    syncCombinedLevel();

    const total = micChunkCountRef.current;
    micChunkCountRef.current = 0;
    micStartingRef.current = false;

    // FIX(AP1): Update both ref and state
    micActiveRef.current = false;
    setIsMicActive(false);
    log.info(
      { totalMicChunksCaptured: total },
      "Stopped audio processor and released microphone.",
    );
  }, [syncCombinedLevel]);

  // ── getStreamer (FIX AP3: reuse or replace, never accumulate) ───────────────
  const getStreamer = useCallback((): AudioStreamer => {
    const tuning =
      useLipSyncStore.getState().tuning ?? DEFAULT_LIPSYNC_TUNING;

    // FIX(AP3): If the playback context was closed (e.g. after unmount
    // cleanup or stopPlayback tore it down), discard both it and the
    // streamer so we create fresh ones below.
    if (playbackCtxRef.current?.state === "closed") {
      audioStreamerRef.current = null;
      playbackCtxRef.current = null;
    }

    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({
        sampleRate: AUDIO_CONFIG.output_hz,
      });
      log.info("Initialized AudioContext (Playback)");
    }

    if (!audioStreamerRef.current) {
      const currentMode = useEmotiveSpeechStore.getState().mode;
      const streamer = new AudioStreamer(
        playbackCtxRef.current,
        AUDIO_CONFIG.output_hz,
        currentMode
      );
      streamer.analyserNode.smoothingTimeConstant = tuning.analyserSmoothing;
      streamer.analyserNode.minDecibels = -100;
      streamer.analyserNode.maxDecibels = -30;
      audioStreamerRef.current = streamer;

      streamer.onComplete = () => {
        cancelAnimationFrame(playbackAnimFrameRef.current);
        playbackAnimFrameRef.current = 0;
        playbackLoopActiveRef.current = false;
        outputAudioLevelRef.current = 0;
        isAssistantSpeakingRef.current = false;
        lastOutputSignalAtRef.current = 0;
        syncCombinedLevel();
        log.debug("Assistant playback turn completed.");
        onPlaybackCompleteRef.current?.();
      };

      const wawa = new Lipsync({
        fftSize: streamer.analyserNode.fftSize,
        historySize: 2,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wawaConfig = wawa as any;
      wawaConfig.audioContext = streamer.context;
      wawaConfig.analyser = streamer.analyserNode;
      wawaConfig.dataArray = new Uint8Array(
        streamer.analyserNode.frequencyBinCount,
      );
      wawaConfig.sampleRate = streamer.context.sampleRate;
      wawaConfig.binWidth =
        streamer.context.sampleRate / streamer.analyserNode.fftSize;
      wawaConfig.maxVisemeDuration = tuning.visemePersistenceMs;

      wawaRef.current = wawa;
      useLipSyncStore.getState().setWawaLipsync(wawa);
    }

    const streamer = audioStreamerRef.current;
    const tuningNow =
      useLipSyncStore.getState().tuning ?? DEFAULT_LIPSYNC_TUNING;
    streamer.analyserNode.smoothingTimeConstant = tuningNow.analyserSmoothing;
    if (wawaRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wawaRef.current as any).maxVisemeDuration =
        tuningNow.visemePersistenceMs;
    }
    streamer.onAudioScheduled = (start: number, duration: number) => {
      onAudioScheduledRef.current?.(start, duration);
    };
    return streamer;
  }, [syncCombinedLevel]);

  // ── Playback level loop ─────────────────────────────────────────────────────
  const startPlaybackLevelLoop = useCallback(() => {
    if (playbackLoopActiveRef.current) return;
    playbackLoopActiveRef.current = true;

    const tick = () => {
      if (!playbackLoopActiveRef.current) return;
      if (audioStreamerRef.current) {
        const vol = audioStreamerRef.current.getVolume();
        outputAudioLevelRef.current = Math.min(1, vol * 4);
        if (outputAudioLevelRef.current > 0.01) {
          lastOutputSignalAtRef.current = performance.now();
        }
        isAssistantSpeakingRef.current =
          performance.now() - lastOutputSignalAtRef.current < 180;
        syncCombinedLevel();
      }
      playbackAnimFrameRef.current = requestAnimationFrame(tick);
    };
    playbackAnimFrameRef.current = requestAnimationFrame(tick);
  }, [syncCombinedLevel]);

  const stopPlaybackLevelLoop = useCallback(() => {
    playbackLoopActiveRef.current = false;
    cancelAnimationFrame(playbackAnimFrameRef.current);
    playbackAnimFrameRef.current = 0;
    outputAudioLevelRef.current = 0;
    isAssistantSpeakingRef.current = false;
    lastOutputSignalAtRef.current = 0;
    syncCombinedLevel();
  }, [syncCombinedLevel]);

  // ── playAudioChunk (synchronous hot path) ───────────────────────────────────
  const playAudioChunk = useCallback(
    (base64: string) => {
      const streamer = getStreamer();
      const ctx = playbackCtxRef.current!;

      // Resume is only needed once — after that ctx.state === "running"
      // and this branch is never entered again.
      if (ctx.state === "suspended") {
        // Fire-and-forget the resume, but don't delay the chunk.
        // AudioStreamer internally schedules at currentTime + initialBufferSec,
        // which gives the context ~100ms to actually resume before playback
        // starts. The chunk is queued synchronously into the ring buffer NOW
        // so it's ready when the context wakes up.
        void ctx.resume().then(() => {
          log.info(
            "[AudioProcessor] Playback AudioContext resumed from suspended.",
          );
        });
      }

      const bytes = decodeBase64ToBytes(base64);
      streamer.addPCM16(bytes);

      queuedPlaybackChunkCountRef.current += 1;
      if (
        queuedPlaybackChunkCountRef.current === 1 ||
        queuedPlaybackChunkCountRef.current % 30 === 0
      ) {
        log.debug(
          {
            queuedChunks: queuedPlaybackChunkCountRef.current,
            droppedDuplicates: droppedPlaybackChunkCountRef.current,
            pcmBytes: bytes.length,
          },
          "Queued assistant audio chunk for playback.",
        );
      }

      isAssistantSpeakingRef.current = true;
      lastOutputSignalAtRef.current = performance.now();
      startSignatureSweep();
      startPlaybackLevelLoop();
    },
    [getStreamer, startPlaybackLevelLoop, startSignatureSweep],
  );

  // ── stopPlayback (FIX AP4: null the streamer ref) ──────────────────────────
  const stopPlayback = useCallback(() => {
    if (audioStreamerRef.current) {
      audioStreamerRef.current.stop();
      audioStreamerRef.current.destroy();
      // FIX(AP4): Null the ref so getStreamer creates a fresh instance
      // next time. A stopped streamer's internal generation is stale —
      // reusing it causes scheduleNextBuffer to silently no-op.
      audioStreamerRef.current = null;
    }
    log.info(
      {
        queuedChunks: queuedPlaybackChunkCountRef.current,
        droppedDuplicates: droppedPlaybackChunkCountRef.current,
      },
      "Stopped assistant playback and cleared queue.",
    );
    queuedPlaybackChunkCountRef.current = 0;
    droppedPlaybackChunkCountRef.current = 0;
    recentChunkSignaturesRef.current.clear();
    stopPlaybackLevelLoop();
  }, [stopPlaybackLevelLoop]);

  // ── markAssistantTurnComplete ───────────────────────────────────────────────
  const markAssistantTurnComplete = useCallback(() => {
    if (!audioStreamerRef.current) {
      log.debug(
        "Marked assistant turn complete (no active streamer — firing immediately).",
      );
      onPlaybackCompleteRef.current?.();
      return;
    }
    audioStreamerRef.current.complete();
    log.debug("Marked assistant turn complete.");
  }, []);

  // ── Unmount cleanup ─────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopPlayback();
      stopMic();
      stopSignatureSweep();
      cancelAnimationFrame(playbackAnimFrameRef.current);
      playbackLoopActiveRef.current = false;
      if (playbackCtxRef.current) {
        void playbackCtxRef.current.close().catch(() => {});
        playbackCtxRef.current = null;
      }
      audioStreamerRef.current = null;
      log.info("AudioProcessor unmounted; all audio contexts released.");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isMicActive,
    permissionError,
    audioLevelRef,
    inputAudioLevelRef,
    outputAudioLevelRef,
    isAssistantSpeakingRef,
    startMic,
    stopMic,
    playAudioChunk,
    stopPlayback,
    markAssistantTurnComplete,
    ensureStreamer: getStreamer,
    onAudioScheduledRef,
    onPlaybackCompleteRef,
  };
}