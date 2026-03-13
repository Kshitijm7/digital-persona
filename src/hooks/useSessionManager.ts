"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useGeminiLive } from "./useGeminiLive";
import { useAudioProcessor } from "./useAudioProcessor";
import { useWebcam } from "./useWebcam";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("useSessionManager");
const AMBIENT_INPUT_FLOOR = 0.02;
const ASSISTANT_ECHO_BLOCK_THRESHOLD = 0.35;
const ASSISTANT_ECHO_RELEASE_THRESHOLD = 0.6;
const ASSISTANT_HOLDOFF_MS = 900;

/**
 * Centralized session management hook.
 * Coordinates Gemini Live, audio, and webcam; wires built-in tool handlers.
 *
 * @remarks
 * **Built-in tool handlers registered here:**
 * - `get_time_date` — returns current ISO timestamp and locale string
 *
 * Application-level tools (e.g. `trigger_animation`, `set_persona_mode`,
 * `display_text`) should be registered by the page via the returned
 * `registerTool` function BEFORE calling `toggleSession`.
 */
export function useSessionManager() {
  const {
    onAudioData: onAudioDataRef,
    onInterrupted: onInterruptedRef,
    onTurnComplete: onTurnCompleteRef,
    registerTool,
    ...gemini
  } = useGeminiLive();
  const audio = useAudioProcessor();
  const { onFrameRef, ...webcam } = useWebcam();

  const [isInitialized, setIsInitialized] = useState(false);
  const isConnected = gemini.status === "connected";
  const micSuppressedChunksRef = useRef(0);
  const micForwardedChunksRef = useRef(0);
  const assistantHoldoffUntilRef = useRef(0);

  // ── Wire up built-in tool handlers ────────────────────────────────────────
  // Registered once; stable because `registerTool` is memoised with useCallback.
  useEffect(() => {
    // get_time_date: lets the persona answer time/date questions accurately
    registerTool("get_time_date", () => {
      const now = new Date();
      return {
        iso: now.toISOString(),
        formatted: now.toLocaleString(),
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString(),
      };
    });
  }, [registerTool]);

  const forwardMicChunk = useCallback((chunk: string) => {
    const inputLevel = audio.inputAudioLevelRef.current ?? 0;
    const now = performance.now();

    if (inputLevel < AMBIENT_INPUT_FLOOR) {
      micSuppressedChunksRef.current += 1;
      return;
    }

    const inAssistantHoldoff = now < assistantHoldoffUntilRef.current;
    const shouldBlockBecauseAssistantAudio =
      (audio.isAssistantSpeakingRef.current && inputLevel < ASSISTANT_ECHO_BLOCK_THRESHOLD) ||
      (inAssistantHoldoff && inputLevel < ASSISTANT_ECHO_RELEASE_THRESHOLD);

    if (shouldBlockBecauseAssistantAudio) {
      micSuppressedChunksRef.current += 1;
      if (
        micSuppressedChunksRef.current === 1 ||
        micSuppressedChunksRef.current % 80 === 0
      ) {
        log.debug(
          {
            suppressedChunks: micSuppressedChunksRef.current,
            forwardedChunks: micForwardedChunksRef.current,
            inputLevel,
            inAssistantHoldoff,
          },
          "Suppressed microphone chunk to prevent assistant self-interruption.",
        );
      }
      return;
    }

    micForwardedChunksRef.current += 1;
    if (
      micForwardedChunksRef.current === 1 ||
      micForwardedChunksRef.current % 120 === 0
    ) {
      log.debug(
        {
          forwardedChunks: micForwardedChunksRef.current,
          suppressedChunks: micSuppressedChunksRef.current,
          inputLevel,
        },
        "Forwarded microphone chunk to Gemini.",
      );
    }
    gemini.sendAudioChunk(chunk);
  }, [audio, gemini]);

  // ── Wire Gemini audio output → speaker ───────────────────────────────────
  useEffect(() => {
    if (!isInitialized) return;
    log.debug("Attached Gemini audio callback.");
    onAudioDataRef.current = (b64) => {
      assistantHoldoffUntilRef.current = performance.now() + ASSISTANT_HOLDOFF_MS;
      audio.playAudioChunk(b64);
    };
    return () => {
      if (onAudioDataRef.current) {
        onAudioDataRef.current = null;
      }
      log.debug("Detached Gemini audio callback.");
    };
  }, [onAudioDataRef, audio, isInitialized]);

  // ── Wire Gemini interruption → stop playback immediately ────────────────
  // Official docs: "stop and empty the current playback queue"
  useEffect(() => {
    if (!isInitialized) return;
    log.debug("Attached interruption callback.");
    onInterruptedRef.current = () => {
      assistantHoldoffUntilRef.current = 0;
      audio.stopPlayback();
    };
    return () => {
      if (onInterruptedRef.current) {
        onInterruptedRef.current = null;
      }
      log.debug("Detached interruption callback.");
    };
  }, [onInterruptedRef, audio, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;
    log.debug("Attached turn-complete callback.");
    onTurnCompleteRef.current = () => {
      assistantHoldoffUntilRef.current = Math.max(
        assistantHoldoffUntilRef.current,
        performance.now() + ASSISTANT_HOLDOFF_MS,
      );
      audio.markAssistantTurnComplete();
    };
    return () => {
      if (onTurnCompleteRef.current) {
        onTurnCompleteRef.current = null;
      }
      log.debug("Detached turn-complete callback.");
    };
  }, [onTurnCompleteRef, audio, isInitialized]);

  // ── Wire webcam frames → Gemini ───────────────────────────────────────────
  useEffect(() => {
    if (!isInitialized) return;
    log.debug("Attached webcam frame callback.");
    onFrameRef.current = (base64) => {
      if (isConnected) {
        gemini.sendVideoFrame(base64);
      }
    };
    return () => {
      if (onFrameRef.current) {
        onFrameRef.current = null;
      }
      log.debug("Detached webcam frame callback.");
    };
  }, [onFrameRef, isConnected, gemini, isInitialized]);

  // ── Session lifecycle ─────────────────────────────────────────────────────

  // Auto-cleanup media devices if Gemini drops connection (error or network loss)
  useEffect(() => {
    if (!isInitialized) return;
    if (gemini.status === "disconnected" || gemini.status === "error") {
      log.warn({ status: gemini.status }, "Gemini session dropped; stopping media devices.");
      audio.stopMic();
      webcam.stop();
      setTimeout(() => setIsInitialized(false), 0);
    }
  }, [gemini.status, isInitialized, audio, webcam]);

  const startSession = useCallback(async () => {
    try {
      setIsInitialized(true);
      micSuppressedChunksRef.current = 0;
      micForwardedChunksRef.current = 0;
      assistantHoldoffUntilRef.current = 0;
      log.info("Starting session.");
      
      // Proactively initialize and resume the playback AudioContext during 
      // the user gesture to satisfy browser autoplay policies.
      const streamer = audio.ensureStreamer();
      if (streamer.context.state === "suspended") {
        await streamer.context.resume();
        log.info("Playback AudioContext resumed via user gesture.");
      }

      await gemini.connect();
      audio.startMic(forwardMicChunk);
      log.info("Session started.");
    } catch (error) {
      log.error({ err: error }, "Failed to start session.");
      setIsInitialized(false);
    }
  }, [gemini, audio, forwardMicChunk]);

  const stopSession = useCallback(() => {
    log.info(
      {
        forwardedMicChunks: micForwardedChunksRef.current,
        suppressedMicChunks: micSuppressedChunksRef.current,
      },
      "Stopping session.",
    );
    gemini.disconnect();
    audio.stopPlayback();
    audio.stopMic();
    webcam.stop();
    setIsInitialized(false);
    micSuppressedChunksRef.current = 0;
    micForwardedChunksRef.current = 0;
    assistantHoldoffUntilRef.current = 0;
  }, [gemini, audio, webcam]);

  // Synchronous lock to prevent dual invocations
  const isTransitioning = useRef(false);

  const toggleSession = useCallback(() => {
    if (isTransitioning.current) {
      log.debug({ status: gemini.status }, "Session toggle ignored while transitioning.");
      return;
    }
    
    // Guard against double-start: only allow starting when strictly "disconnected".
    if (gemini.status !== "disconnected") {
      isTransitioning.current = true;
      log.info({ status: gemini.status }, "Stopping active session via toggle.");
      stopSession();
      setTimeout(() => { isTransitioning.current = false; }, 500);
    } else {
      isTransitioning.current = true;
      log.info("Starting session via toggle.");
      startSession().finally(() => {
        isTransitioning.current = false;
      });
    }
  }, [gemini.status, startSession, stopSession]);

  const toggleMic = useCallback(() => {
    if (audio.isMicActive) {
      log.info("Muting microphone.");
      audio.stopMic();
    } else {
      log.info("Unmuting microphone.");
      audio.startMic(forwardMicChunk);
    }
  }, [audio, forwardMicChunk]);

  const toggleCamera = useCallback(() => {
    if (webcam.isActive) {
      webcam.stop();
    } else {
      webcam.start();
    }
  }, [webcam]);

  return {
    // State
    isConnected,
    status: gemini.status,
    errorMessage: gemini.errorMessage,
    micError: audio.permissionError,
    cameraError: webcam.permissionError,
    audioLevelRef: audio.audioLevelRef,
    assistantAudioLevelRef: audio.outputAudioLevelRef,
    isMicActive: audio.isMicActive,
    isCameraActive: webcam.isActive,
    videoRef: webcam.videoRef,

    // Actions
    toggleSession,
    toggleMic,
    toggleCamera,
    sendText: gemini.sendText,

    // Audio Scheduling Callback
    onAudioScheduledRef: audio.onAudioScheduledRef,

    /**
     * Register an application-level tool handler.
     * Must be called before `toggleSession` / `connect`.
     *
     * @example
     * registerTool("set_persona_mode", ({ mode }) => {
     *   setPersonaMode(mode as string);
     *   return { acknowledged: true, mode };
     * });
     */
    registerTool,

    // Callback refs (for transcript and tool-call side-effects in the page)
    onToolCall: gemini.onToolCall,
    onTranscript: gemini.onTranscript,
  };
}
