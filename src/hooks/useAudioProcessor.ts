"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_CONFIG } from "@/lib/constants";
import { AudioStreamer } from "../lib/audio-streamer";
import { Lipsync } from "wawa-lipsync";
import { DEFAULT_LIPSYNC_TUNING, useLipSyncStore } from "@/store/useLipSyncStore";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("useAudioProcessor");

/**
 * Manages microphone audio capture, Gemini audio playback, and real-time audio levels.
 *
 * @remarks
 * - Capture: Records at 16kHz 16-bit PCM mono, outputs base64 chunks.
 * - Playback: Uses `AudioStreamer` for time-scheduled, gapless 24kHz PCM playback.
 * - Stop: `stopPlayback()` immediately halts output and clears the queue
 *   (called on Gemini `interrupted` signal).
 * - Audio Level: Exposed as a `useRef` to avoid 60fps re-renders.
 *   Components that need it (e.g. Avatar, AudioWaveform) should read
 *   `audioLevelRef.current` inside their own animation loops (useFrame / rAF).
 */
export function useAudioProcessor() {
  const [isMicActive, setIsMicActive] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  /**
   * Audio level as a ref — NOT state — to prevent 60fps re-renders.
   * Read this inside `useFrame` / `requestAnimationFrame`.
   */
  const audioLevelRef = useRef(0);
  const inputAudioLevelRef = useRef(0);
  const outputAudioLevelRef = useRef(0);
  const isAssistantSpeakingRef = useRef(false);
  const lastOutputSignalAtRef = useRef(0);
  const recentChunkSignaturesRef = useRef<Map<string, number>>(new Map());
  const micChunkCountRef = useRef(0);
  const queuedPlaybackChunkCountRef = useRef(0);
  const droppedPlaybackChunkCountRef = useRef(0);

  // Mic capture refs
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const processorSilentGainRef = useRef<GainNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  // Playback via AudioStreamer
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const wawaRef = useRef<Lipsync | null>(null);
  // rAF handle for playback-level animation loop
  const playbackAnimFrameRef = useRef<number>(0);
  const onAudioScheduledRef = useRef<((startMs: number, durationMs: number) => void) | null>(null);
  const onPlaybackCompleteRef = useRef<(() => void) | null>(null);

  const syncCombinedLevel = useCallback(() => {
    audioLevelRef.current = Math.max(
      inputAudioLevelRef.current,
      outputAudioLevelRef.current,
    );
  }, []);

  // ── Mic capture ──────────────────────────────────────────────────────────
  const startMic = useCallback(
    (onChunk: (base64: string) => void) => {
      (async () => {
        setPermissionError(null);
        try {
          // Explicitly check permissions on browsers that support it
          if (navigator.permissions && navigator.permissions.query) {
            try {
              const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
              if (perm.state === "denied") {
                throw new Error("Microphone access is explicitly denied in browser settings.");
              }
            } catch (e) {
              // Ignore if browser doesn't support 'microphone' permission query (e.g. Firefox)
              log.debug({ err: e }, "Microphone permission query unsupported; continuing.");
            }
          }

          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              sampleRate: AUDIO_CONFIG.input_hz,
              channelCount: 1,
              // Enable browser-side AGC and noise processing.
              // This is CRITICAL for speakerphone setups to prevent the speakers
              // from feeding back into the microphone and causing Gemini to interrupt itself.
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          streamRef.current = stream;

          const ctx = new AudioContext({ sampleRate: AUDIO_CONFIG.input_hz });
          audioCtxRef.current = ctx;
          
          if (ctx.state === "suspended") {
            await ctx.resume();
            log.info("[AudioProcessor] Input AudioContext resumed.");
          }

          const source = ctx.createMediaStreamSource(stream);

          // Analyser for audio level (used for lip-sync during mic input)
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyserRef.current = analyser;

          // ── Prefer AudioWorklet, fallback to ScriptProcessorNode ──────
          let workletLoaded = false;
          if (typeof AudioWorkletNode !== "undefined") {
            try {
              await ctx.audioWorklet.addModule("/pcm-capture-worklet.js");
              const workletNode = new AudioWorkletNode(ctx, "pcm-capture-processor");
              source.connect(workletNode);
              // ✅ Fix: Do NOT connect workletNode to ctx.destination.
              // Routing mic → destination would play the raw mic audio back
              // through the speakers, creating a feedback/echo loop.
              workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
                // e.data is an ArrayBuffer of Int16 PCM data
                const bytes = new Uint8Array(e.data);
                let binary = "";
                for (let i = 0; i < bytes.length; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                micChunkCountRef.current += 1;
                if (micChunkCountRef.current % 120 === 0) {
                  log.debug(
                    { chunksCaptured: micChunkCountRef.current, capturePath: "AudioWorklet" },
                    "Captured microphone chunks.",
                  );
                }
                onChunk(btoa(binary));
              };
              workletNodeRef.current = workletNode;
              workletLoaded = true;
              log.info("[AudioProcessor] Using AudioWorklet for PCM capture.");
            } catch (workletErr) {
              log.warn({ err: workletErr }, "AudioWorklet failed, falling back to ScriptProcessor");
            }
          }

          if (!workletLoaded) {
            // Fallback: deprecated ScriptProcessorNode (still widely supported)
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            source.connect(processor);
            // Keep ScriptProcessor active without audible loopback.
            // Direct processor -> destination causes users to hear their own mic.
            const silentGain = ctx.createGain();
            silentGain.gain.value = 0;
            processor.connect(silentGain);
            silentGain.connect(ctx.destination);
            processorRef.current = processor;
            processorSilentGainRef.current = silentGain;

            processor.onaudioprocess = (e) => {
              const float32 = e.inputBuffer.getChannelData(0);
              // Float32 → Int16
              const int16 = new Int16Array(float32.length);
              for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
              }
              // Int16 → base64
              const bytes = new Uint8Array(int16.buffer);
              let binary = "";
              for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              micChunkCountRef.current += 1;
              if (micChunkCountRef.current % 120 === 0) {
                log.debug(
                  { chunksCaptured: micChunkCountRef.current, capturePath: "ScriptProcessorNode" },
                  "Captured microphone chunks.",
                );
              }
              onChunk(btoa(binary));
            };
            log.warn(
              "[AudioProcessor] Using ScriptProcessorNode fallback for PCM capture with muted monitor path.",
            );
          }

          // rAF loop for audio level → ref (not state)
          const updateLevel = () => {
            if (!analyserRef.current) return;
            const data = new Uint8Array(analyserRef.current.frequencyBinCount);
            analyserRef.current.getByteFrequencyData(data);
            const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
            inputAudioLevelRef.current = avg / 255;
            syncCombinedLevel();
            animFrameRef.current = requestAnimationFrame(updateLevel);
          };
          updateLevel();

          setIsMicActive(true);
        } catch (err) {
          log.error({ err }, "Failed to acquire user media or start AudioContext");
          let errorMsg = "Could not access microphone.";
          if (err instanceof DOMException) {
            if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
              errorMsg = "No microphone found. Please plug one in.";
            } else if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
              errorMsg = "Microphone access was denied. Please allow it in settings.";
            } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
              errorMsg = "Microphone is already in use by another application.";
            }
          } else if (err instanceof Error) {
            errorMsg = err.message;
          }
          setPermissionError(errorMsg);
        }
      })();
    },
    [syncCombinedLevel],
  );

  const stopMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    cancelAnimationFrame(animFrameRef.current);
    // Clean up AudioWorklet node if it was used
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (processorSilentGainRef.current) {
      processorSilentGainRef.current.disconnect();
      processorSilentGainRef.current = null;
    }
    streamRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    processorRef.current = null;
    setIsMicActive(false);
    inputAudioLevelRef.current = 0;
    syncCombinedLevel();
    log.info({ totalMicChunksCaptured: micChunkCountRef.current }, "Stopped audio processor and released microphone");
    micChunkCountRef.current = 0;
  }, [syncCombinedLevel]);

  // ── Playback via AudioStreamer ────────────────────────────────────────────

  /**
   * Get or create the AudioStreamer instance (single shared AudioContext).
   */
  const getStreamer = useCallback((): AudioStreamer => {
    const tuning = useLipSyncStore.getState().tuning ?? DEFAULT_LIPSYNC_TUNING;
    if (!audioStreamerRef.current) {
      if (!playbackCtxRef.current) {
        playbackCtxRef.current = new AudioContext({
          sampleRate: AUDIO_CONFIG.output_hz,
        });
        log.info("Initialized AudioContext (Playback)");
      }
      const streamer = new AudioStreamer(
        playbackCtxRef.current,
        AUDIO_CONFIG.output_hz,
      );
      streamer.analyserNode.smoothingTimeConstant = tuning.analyserSmoothing;
      streamer.analyserNode.minDecibels = -100;
      streamer.analyserNode.maxDecibels = -30;
      audioStreamerRef.current = streamer;
      streamer.onComplete = () => {
        cancelAnimationFrame(playbackAnimFrameRef.current);
        outputAudioLevelRef.current = 0;
        isAssistantSpeakingRef.current = false;
        lastOutputSignalAtRef.current = 0;
        syncCombinedLevel();
        log.debug("Assistant playback turn completed.");
        onPlaybackCompleteRef.current?.();
      };

      // Ensure Lipsync is correctly instantiated and mapped to AudioStreamer
      const wawa = new Lipsync({
        fftSize: streamer.analyserNode.fftSize,
        historySize: 2, // Reduced from 6 to minimize latency (2*10ms = 20ms lag)
      });
      
      // Patch private properties to safely integrate without relying on HTMLAudioElement
      // @ts-expect-error - patching private context to match AudioStreamer
      wawa.audioContext = streamer.context;
      // @ts-expect-error - use the streamer's own analyser that's already in the audio chain
      wawa.analyser = streamer.analyserNode;
      // @ts-expect-error - update the dataArray to identically match the analyser
      wawa.dataArray = new Uint8Array(streamer.analyserNode.frequencyBinCount);
      // @ts-expect-error - override sampleRate for wawa
      wawa.sampleRate = streamer.context.sampleRate;
      // @ts-expect-error - recompute binWidth
      wawa.binWidth = wawa.sampleRate / streamer.analyserNode.fftSize;
      // @ts-expect-error - configurable persistence to reduce viseme lag on rapid speech transitions
      wawa.maxVisemeDuration = tuning.visemePersistenceMs;
      // @ts-expect-error - expose streamer for mode detection
      wawa.audioStreamerRef = audioStreamerRef;

      wawaRef.current = wawa;
      useLipSyncStore.getState().setWawaLipsync(wawa);

      // Reset internal gain to prevent stale levels
      outputAudioLevelRef.current = 0;
    }
    const streamer = audioStreamerRef.current;
    streamer.analyserNode.smoothingTimeConstant = tuning.analyserSmoothing;
    if (wawaRef.current) {
      // @ts-expect-error - runtime tuning for persistence
      wawaRef.current.maxVisemeDuration = tuning.visemePersistenceMs;
    }
    streamer.onAudioScheduled = (start: number, duration: number) => {
      onAudioScheduledRef.current?.(start, duration);
    };
    return streamer;
  }, [syncCombinedLevel]);

  /**
   * Continuous rAF loop that keeps audioLevelRef updated from the streamer
   * during playback. Runs at 60fps so Avatar lip-sync is always smooth.
   * Only active while playback is on-going; cancelled by stopPlayback().
   */
  const startPlaybackLevelLoop = useCallback(() => {
    const tick = () => {
      if (audioStreamerRef.current) {
        const vol = audioStreamerRef.current.getVolume();
        // Map streamer RMS (0-1 float) → output level (0-1) with a boost.
        outputAudioLevelRef.current = Math.min(1, vol * 4);
        if (outputAudioLevelRef.current > 0.01) {
          lastOutputSignalAtRef.current = performance.now();
        }
        isAssistantSpeakingRef.current =
          performance.now() - lastOutputSignalAtRef.current < 180;
        syncCombinedLevel();
        
        // Output trace when the volume changes significantly, throttle with frame count
        if (vol > 0.01 && Math.random() < 0.03) {
           log.trace({ rms: vol }, "AudioStreamer volumetric output");
        }
      }
      playbackAnimFrameRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(playbackAnimFrameRef.current);
    playbackAnimFrameRef.current = requestAnimationFrame(tick);
  }, [syncCombinedLevel]);

  const stopPlaybackLevelLoop = useCallback(() => {
    cancelAnimationFrame(playbackAnimFrameRef.current);
    outputAudioLevelRef.current = 0;
    isAssistantSpeakingRef.current = false;
    lastOutputSignalAtRef.current = 0;
    syncCombinedLevel();
  }, [syncCombinedLevel]);

  /**
   * Queue a base64-encoded PCM16 audio chunk for time-scheduled playback.
   * Converts base64 → Uint8Array → hands off to AudioStreamer.
   *
   * Best practice: resume the AudioContext before scheduling audio.
   * Browsers (especially mobile) suspend the context until a user gesture;
   * attempting to schedule without resuming causes silent playback.
   */
  const playAudioChunk = useCallback((base64: string) => {
    (async () => {
      try {
        const now = performance.now();
        const signature = `${base64.length}:${base64.slice(0, 48)}:${base64.slice(Math.max(0, Math.floor(base64.length / 2) - 24), Math.floor(base64.length / 2) + 24)}:${base64.slice(-48)}`;
        const SIGNATURE_TTL_MS = 10000;

        recentChunkSignaturesRef.current.set(signature, now);
        for (const [seenSignature, seenTime] of recentChunkSignaturesRef.current) {
          if (now - seenTime > SIGNATURE_TTL_MS) {
            recentChunkSignaturesRef.current.delete(seenSignature);
          }
        }

        const streamer = getStreamer();
        const ctx = playbackCtxRef.current!;

        // ✅ Fix: Resume suspended AudioContext (browser autoplay policy).
        if (ctx.state === "suspended") {
          await ctx.resume();
          log.info("[AudioProcessor] AudioContext resumed from suspended state.");
        }

        // base64 → Uint8Array (PCM16 bytes)
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        // Feed to AudioStreamer for gapless scheduling.
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

        // ✅ Fix: Instead of computing per-chunk bulk RMS (which freezes
        // lip-sync between packets), start a continuous rAF loop that
        // samples the streamer volume at 60fps.
        startPlaybackLevelLoop();
      } catch (error) {
        log.error({ err: error }, "Failed to queue assistant audio chunk");
      }
    })();
  }, [getStreamer, startPlaybackLevelLoop]);

  /**
   * Immediately stop all audio playback and clear the queue.
   * Called when the Gemini server sends an `interrupted` signal.
   *
   * @see Official docs: "stop and empty the current playback queue"
   */
  const stopPlayback = useCallback(() => {
    if (audioStreamerRef.current) {
      audioStreamerRef.current.stop();
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

  /**
   * Mark the current assistant turn as complete. This allows AudioStreamer
   * to stop polling for additional chunks when the Live API emits turnComplete.
   */
  const markAssistantTurnComplete = useCallback(() => {
    if (!audioStreamerRef.current) return;
    audioStreamerRef.current.complete();
    log.debug("Marked assistant turn complete.");
  }, []);

  useEffect(() => {
    return () => {
      stopPlayback();
      stopMic();
      cancelAnimationFrame(playbackAnimFrameRef.current);
      if (playbackCtxRef.current) {
        void playbackCtxRef.current.close();
        playbackCtxRef.current = null;
      }
      audioStreamerRef.current = null;
      log.info("AudioProcessor unmounted and audio contexts were cleaned up.");
    };
  }, [stopMic, stopPlayback]);

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
