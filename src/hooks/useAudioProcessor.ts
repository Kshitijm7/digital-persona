"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_CONFIG } from "@/lib/constants";
import { AudioStreamer } from "../lib/audio-streamer";
import { Lipsync } from "wawa-lipsync";
import { DEFAULT_LIPSYNC_TUNING, useLipSyncStore } from "@/store/useLipSyncStore";
import { createLogger } from "@/lib/logging/logger";

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

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useAudioProcessor() {
  const [isMicActive, setIsMicActive] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

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

  // Fix A2: track whether startMic is in progress to prevent double-starts
  const micStartingRef = useRef(false);

  // ── Playback pipeline refs ──────────────────────────────────────────────────
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const wawaRef = useRef<Lipsync | null>(null);
  const playbackAnimFrameRef = useRef<number>(0);
  // Fix A6: single rAF chain guard
  const playbackLoopActiveRef = useRef(false);

  const queuedPlaybackChunkCountRef = useRef(0);
  const droppedPlaybackChunkCountRef = useRef(0);

  // Fix A8: signature sweep handled off-hot-path
  const recentChunkSignaturesRef = useRef<Map<string, number>>(new Map());
  const signatureSweepTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  const onAudioScheduledRef = useRef<
    ((startMs: number, durationMs: number) => void) | null
  >(null);
  const onPlaybackCompleteRef = useRef<(() => void) | null>(null);

  // ── Level sync ──────────────────────────────────────────────────────────────
  const syncCombinedLevel = useCallback(() => {
    audioLevelRef.current = Math.max(
      inputAudioLevelRef.current,
      outputAudioLevelRef.current
    );
  }, []);

  // ── Signature sweep (Fix A8) ────────────────────────────────────────────────
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

  // ── startMic (Fix A1, A2, A3, A9, A10) ─────────────────────────────────────
  // Returns a Promise<boolean> so callers can await and detect failure.
  const startMic = useCallback(
    async (onChunk: (base64: string) => void): Promise<boolean> => {
      // Fix A2: prevent concurrent startMic calls
      if (isMicActive || micStartingRef.current) {
        log.warn("startMic called while already active or starting; ignoring.");
        return false;
      }
      micStartingRef.current = true;
      setPermissionError(null);

      try {
        // Pre-flight permission check where supported
        if (navigator.permissions?.query) {
          try {
            const perm = await navigator.permissions.query({
              name: "microphone" as PermissionName,
            });
            if (perm.state === "denied") {
              throw new Error(
                "Microphone access is explicitly denied in browser settings."
              );
            }
          } catch (e) {
            log.debug(
              { err: e },
              "Microphone permission query unsupported; continuing."
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

        // Analyser for input level
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        // Capture path: AudioWorklet preferred, ScriptProcessor fallback
        let workletLoaded = false;
        if (typeof AudioWorkletNode !== "undefined") {
          try {
            await ctx.audioWorklet.addModule("/pcm-capture-worklet.js");
            const workletNode = new AudioWorkletNode(
              ctx,
              "pcm-capture-processor"
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
                  "Captured microphone chunks."
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
              "AudioWorklet failed; falling back to ScriptProcessorNode."
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
                "Captured microphone chunks."
              );
            }
            onChunk(bytesToBase64(bytes));
          };
          log.warn(
            "[AudioProcessor] Using ScriptProcessorNode fallback for PCM capture."
          );
        }

        // Input level rAF loop — Fix A9: start AFTER ctx is confirmed live
        const updateLevel = () => {
          // Guard: stop updating if context was closed
          if (!analyserRef.current || !audioCtxRef.current) return;
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          const avg = data.reduce((s, v) => s + v, 0) / data.length;
          inputAudioLevelRef.current = avg / 255;
          syncCombinedLevel();
          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
        animFrameRef.current = requestAnimationFrame(updateLevel);

        setIsMicActive(true);
        micStartingRef.current = false;
        return true;
      } catch (err) {
        micStartingRef.current = false;
        log.error(
          { err },
          "Failed to acquire user media or start AudioContext."
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
            errorMsg =
              "Microphone is already in use by another application.";
          }
        } else if (err instanceof Error) {
          errorMsg = err.message;
        }
        setPermissionError(errorMsg);
        return false;
      }
    },
    // Fix A2: isMicActive in deps so the guard is always current
    [isMicActive, syncCombinedLevel]
  );

  // ── stopMic (Fix A3, A9, A10) ───────────────────────────────────────────────
  const stopMic = useCallback(() => {
    // Fix A9: cancel rAF BEFORE zeroing refs so the loop can't write after stop
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = 0;

    // Fix A10: null the worklet message handler before disconnecting
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
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

    // Stop media tracks
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    // Fix A3: close() is async — we void it but null the ref immediately so
    // no further operations can target the closing context
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;

    // Zero levels after rAF is cancelled
    inputAudioLevelRef.current = 0;
    syncCombinedLevel();

    const total = micChunkCountRef.current;
    micChunkCountRef.current = 0;
    micStartingRef.current = false;

    setIsMicActive(false);
    log.info(
      { totalMicChunksCaptured: total },
      "Stopped audio processor and released microphone."
    );
  }, [syncCombinedLevel]);

  // ── getStreamer / ensureStreamer (Fix A4, A7) ────────────────────────────────
  const getStreamer = useCallback((): AudioStreamer => {
    const tuning =
      useLipSyncStore.getState().tuning ?? DEFAULT_LIPSYNC_TUNING;

    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({
        sampleRate: AUDIO_CONFIG.output_hz,
      });
      log.info("Initialized AudioContext (Playback)");
    }

    if (!audioStreamerRef.current) {
      const streamer = new AudioStreamer(
        playbackCtxRef.current,
        AUDIO_CONFIG.output_hz
      );
      streamer.analyserNode.smoothingTimeConstant = tuning.analyserSmoothing;
      streamer.analyserNode.minDecibels = -100;
      streamer.analyserNode.maxDecibels = -30;
      audioStreamerRef.current = streamer;

      // Fix A7: onComplete reads onPlaybackCompleteRef.current at CALL TIME
      // not at streamer creation time — the ref is always current
      streamer.onComplete = () => {
        cancelAnimationFrame(playbackAnimFrameRef.current);
        playbackAnimFrameRef.current = 0;
        playbackLoopActiveRef.current = false;
        outputAudioLevelRef.current = 0;
        isAssistantSpeakingRef.current = false;
        lastOutputSignalAtRef.current = 0;
        syncCombinedLevel();
        log.debug("Assistant playback turn completed.");
        // Read the ref at call time — always gets the latest handler
        onPlaybackCompleteRef.current?.();
      };

      // Wawa lipsync setup
      const wawa = new Lipsync({
        fftSize: streamer.analyserNode.fftSize,
        historySize: 2,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wawaConfig = wawa as any;
      wawaConfig.audioContext = streamer.context;
      wawaConfig.analyser = streamer.analyserNode;
      wawaConfig.dataArray = new Uint8Array(
        streamer.analyserNode.frequencyBinCount
      );
      wawaConfig.sampleRate = streamer.context.sampleRate;
      wawaConfig.binWidth =
        streamer.context.sampleRate / streamer.analyserNode.fftSize;
      wawaConfig.maxVisemeDuration = tuning.visemePersistenceMs;
      if ("audioStreamerRef" in wawaConfig) {
        wawaConfig.audioStreamerRef = audioStreamerRef;
      }
      wawaRef.current = wawa;
      useLipSyncStore.getState().setWawaLipsync(wawa);
    }

    const streamer = audioStreamerRef.current;
    const tuningNow =
      useLipSyncStore.getState().tuning ?? DEFAULT_LIPSYNC_TUNING;
    streamer.analyserNode.smoothingTimeConstant = tuningNow.analyserSmoothing;
    if (wawaRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wawaRef.current as any).maxVisemeDuration = tuningNow.visemePersistenceMs;
    }
    streamer.onAudioScheduled = (start: number, duration: number) => {
      onAudioScheduledRef.current?.(start, duration);
    };
    return streamer;
  }, [syncCombinedLevel]);

  // ── Playback level loop (Fix A6) ────────────────────────────────────────────
  // Single-flight guard ensures only one rAF chain is ever active.
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

  // ── playAudioChunk (Fix A5, A8) ─────────────────────────────────────────────
  const playAudioChunk = useCallback(
    (base64: string) => {
      // Fix A5: capture streamer reference synchronously before any await
      // so stopPlayback can't replace it between the async boundary
      const streamer = audioStreamerRef.current;
      if (!streamer) {
        // Streamer not yet initialised — get it now (synchronous path)
        void (async () => {
          try {
            const s = getStreamer();
            const ctx = playbackCtxRef.current!;
            if (ctx.state === "suspended") await ctx.resume();
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++)
              bytes[i] = binary.charCodeAt(i);
            s.addPCM16(bytes);
            queuedPlaybackChunkCountRef.current += 1;
            isAssistantSpeakingRef.current = true;
            lastOutputSignalAtRef.current = performance.now();
            startSignatureSweep();
            startPlaybackLevelLoop();
          } catch (err) {
            log.error({ err }, "Failed to queue assistant audio chunk.");
          }
        })();
        return;
      }

      void (async () => {
        try {
          const ctx = playbackCtxRef.current;
          if (!ctx) return;

          if (ctx.state === "suspended") {
            await ctx.resume();
            log.info(
              "[AudioProcessor] Playback AudioContext resumed from suspended."
            );
          }

          // Fix A5: verify the streamer hasn't been replaced while we awaited
          if (audioStreamerRef.current !== streamer) {
            log.debug(
              "Streamer replaced during async resume; dropping stale chunk."
            );
            return;
          }

          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);

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
              "Queued assistant audio chunk for playback."
            );
          }

          isAssistantSpeakingRef.current = true;
          lastOutputSignalAtRef.current = performance.now();
          startSignatureSweep();
          startPlaybackLevelLoop();
        } catch (err) {
          log.error({ err }, "Failed to queue assistant audio chunk.");
        }
      })();
    },
    [getStreamer, startPlaybackLevelLoop, startSignatureSweep]
  );

  // ── stopPlayback ────────────────────────────────────────────────────────────
  const stopPlayback = useCallback(() => {
    if (audioStreamerRef.current) {
      audioStreamerRef.current.stop();
    }
    log.info(
      {
        queuedChunks: queuedPlaybackChunkCountRef.current,
        droppedDuplicates: droppedPlaybackChunkCountRef.current,
      },
      "Stopped assistant playback and cleared queue."
    );
    queuedPlaybackChunkCountRef.current = 0;
    droppedPlaybackChunkCountRef.current = 0;
    recentChunkSignaturesRef.current.clear();
    stopPlaybackLevelLoop();
  }, [stopPlaybackLevelLoop]);

  // ── markAssistantTurnComplete ───────────────────────────────────────────────
  const markAssistantTurnComplete = useCallback(() => {
    if (!audioStreamerRef.current) {
      // No streamer means no audio was ever queued — fire complete immediately
      log.debug(
        "Marked assistant turn complete (no active streamer — firing immediately)."
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
  // Intentionally empty: we only want mount/unmount semantics.
  // stopPlayback, stopMic, stopSignatureSweep are stable (no changing deps).

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