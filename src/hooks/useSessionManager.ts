"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGeminiLive } from "./useGeminiLive";
import { useAudioProcessor } from "./useAudioProcessor";
import { useWebcam } from "./useWebcam";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("useSessionManager");

const AMBIENT_INPUT_FLOOR = 0.006;
const ASSISTANT_ECHO_BLOCK_THRESHOLD = 0.22;
const ASSISTANT_ECHO_RELEASE_THRESHOLD = 0.32;
const ASSISTANT_HOLDOFF_MS = 500;
const MAX_AUTO_RECONNECT_ATTEMPTS = 2;
const AUTO_RECONNECT_BASE_DELAY_MS = 800;

/**
 * Centralized session management hook.
 * Coordinates Gemini Live, audio, and webcam; wires built-in tool handlers.
 *
 * @remarks
 * **Built-in tool handlers registered here:**
 * - `get_time_date` — returns current ISO timestamp and locale string
 *
 * Application-level tools (e.g. `trigger_animation`, `update_persona_state`,
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

  const {
    status: geminiStatus,
    errorMessage,
    connect,
    disconnect,
    sendVideoFrame,
    sendAudioChunk,
    sendText,
    onToolCall,
    onTranscript,
    onUserTranscript,
    lastCloseCode,
  } = gemini;

  const {
    isMicActive,
    permissionError: micError,
    audioLevelRef,
    outputAudioLevelRef,
    inputAudioLevelRef,
    isAssistantSpeakingRef,
    startMic,
    stopMic,
    playAudioChunk,
    stopPlayback,
    markAssistantTurnComplete,
    ensureStreamer,
    onAudioScheduledRef,
    onPlaybackCompleteRef,
  } = audio;

  const {
    videoRef,
    isActive: isCameraActive,
    facingMode,
    permissionError: cameraError,
    start: startWebcam,
    stop: stopWebcam,
    switchCamera,
  } = webcam;

  // ── Session state ──────────────────────────────────────────────────────────
  const [isInitialized, setIsInitialized] = useState(false);
  const isConnected = geminiStatus === "connected";

  // ── Mic accounting ─────────────────────────────────────────────────────────
  const micSuppressedChunksRef = useRef(0);
  const micForwardedChunksRef = useRef(0);
  const micSuppressedAmbientRef = useRef(0);
  const micSuppressedEchoRef = useRef(0);

  // ── Timing / reconnect guards ──────────────────────────────────────────────
  const assistantHoldoffUntilRef = useRef(0);
  const isManualStopRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTransitioningRef = useRef(false);

  // Fix #10: keep a stable ref to forwardMicChunk so the reconnect timer
  // always uses the current closure without needing to capture it.
  const forwardMicChunkRef = useRef<(chunk: string) => void>(() => {});

  // Fix #11: use a ref-based lock instead of a boolean that React can reset.
  const dropHandledForConnectionRef = useRef<number | null>(null);

  // ── Built-in tool: get_time_date ───────────────────────────────────────────
  useEffect(() => {
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

  // ── Mic chunk forwarding (Fix #13) ────────────────────────────────────────
  // `sendAudioChunk` is now stable (no deps) so `forwardMicChunk` will not
  // recreate on reconnect — the AudioWorklet does not restart.
  const forwardMicChunk = useCallback(
    (chunk: string) => {
      const inputLevel = inputAudioLevelRef.current ?? 0;
      const now = performance.now();

      if (inputLevel < AMBIENT_INPUT_FLOOR) {
        micSuppressedChunksRef.current += 1;
        micSuppressedAmbientRef.current += 1;
        if (
          micSuppressedAmbientRef.current === 1 ||
          micSuppressedAmbientRef.current % 160 === 0
        ) {
          log.debug(
            {
              inputLevel,
              ambientFloor: AMBIENT_INPUT_FLOOR,
              suppressedAmbientChunks: micSuppressedAmbientRef.current,
              forwardedChunks: micForwardedChunksRef.current,
            },
            "Suppressed microphone chunk below ambient floor."
          );
        }
        return;
      }

      const inAssistantHoldoff = now < assistantHoldoffUntilRef.current;
      const shouldBlockEcho =
        (isAssistantSpeakingRef.current &&
          inputLevel < ASSISTANT_ECHO_BLOCK_THRESHOLD) ||
        (inAssistantHoldoff &&
          inputLevel < ASSISTANT_ECHO_RELEASE_THRESHOLD);

      if (shouldBlockEcho) {
        micSuppressedChunksRef.current += 1;
        micSuppressedEchoRef.current += 1;
        if (
          micSuppressedEchoRef.current === 1 ||
          micSuppressedEchoRef.current % 80 === 0
        ) {
          log.debug(
            {
              suppressedChunks: micSuppressedChunksRef.current,
              suppressedEchoChunks: micSuppressedEchoRef.current,
              forwardedChunks: micForwardedChunksRef.current,
              inputLevel,
              inAssistantHoldoff,
            },
            "Suppressed microphone chunk to prevent assistant self-interruption."
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
          "Forwarded microphone chunk to Gemini."
        );
      }
      sendAudioChunk(chunk);
    },
    [inputAudioLevelRef, isAssistantSpeakingRef, sendAudioChunk]
  );

  // Keep the ref current so the reconnect timer can always call the latest version
  useEffect(() => {
    forwardMicChunkRef.current = forwardMicChunk;
  }, [forwardMicChunk]);

  // ── Wire Gemini audio → speaker ────────────────────────────────────────────
  useEffect(() => {
    if (!isInitialized) return;
    log.debug("Attached Gemini audio callback.");
    onAudioDataRef.current = (b64) => {
      assistantHoldoffUntilRef.current = performance.now() + ASSISTANT_HOLDOFF_MS;
      playAudioChunk(b64);
    };
    return () => {
      onAudioDataRef.current = null;
      log.debug("Detached Gemini audio callback.");
    };
  }, [onAudioDataRef, playAudioChunk, isInitialized]);

  // ── Wire Gemini interruption → stop playback ───────────────────────────────
  useEffect(() => {
    if (!isInitialized) return;
    log.debug("Attached interruption callback.");
    onInterruptedRef.current = () => {
      assistantHoldoffUntilRef.current = 0;
      stopPlayback();
    };
    return () => {
      onInterruptedRef.current = null;
      log.debug("Detached interruption callback.");
    };
  }, [onInterruptedRef, stopPlayback, isInitialized]);

  // ── Wire turn-complete ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isInitialized) return;
    log.debug("Attached turn-complete callback.");
    onTurnCompleteRef.current = () => {
      assistantHoldoffUntilRef.current = Math.max(
        assistantHoldoffUntilRef.current,
        performance.now() + ASSISTANT_HOLDOFF_MS
      );
      markAssistantTurnComplete();
    };
    return () => {
      onTurnCompleteRef.current = null;
      log.debug("Detached turn-complete callback.");
    };
  }, [onTurnCompleteRef, markAssistantTurnComplete, isInitialized]);

  // ── Wire webcam frames → Gemini ────────────────────────────────────────────
  useEffect(() => {
    if (!isInitialized) return;
    log.debug("Attached webcam frame callback.");
    onFrameRef.current = (base64) => {
      if (isConnected) sendVideoFrame(base64);
    };
    return () => {
      onFrameRef.current = null;
      log.debug("Detached webcam frame callback.");
    };
  }, [onFrameRef, isConnected, sendVideoFrame, isInitialized]);

  // ── Auto-reconnect on unexpected drop (Fix #9, #11) ───────────────────────
  useEffect(() => {
    if (!isInitialized) return;

    if (geminiStatus !== "disconnected" && geminiStatus !== "error") {
      // Session is healthy — nothing to do
      return;
    }

    // Fix M2: do not auto-reconnect on clean client-initiated closes (1000/1001)
    // These happen when the server cancels a tool call mid-session (switch_camera)
    // and our code sends a clean close in response. Reconnect only on server
    // errors (1011+) or abnormal closes (1006).
    const closeCode = lastCloseCode?.current;
    const isCleanClose =
      closeCode === 1000 || closeCode === 1001;

    if (isCleanClose && !isManualStopRef.current) {
      log.info(
        { closeCode },
        "Clean WebSocket close — not triggering auto-reconnect."
      );
      // Still need to clean up initialized state
      stopMic();
      stopWebcam();
      setTimeout(() => setIsInitialized(false), 0);
      return;
    }

    // Fix #11: key the drop guard on the current reconnect attempt count so
    // StrictMode double-fires see the same count and both no-op after the first.
    const currentAttempt = reconnectAttemptsRef.current;
    if (dropHandledForConnectionRef.current === currentAttempt) {
      return;
    }
    dropHandledForConnectionRef.current = currentAttempt;

    if (isManualStopRef.current) {
      log.debug("Session ended manually; skipping auto-reconnect.");
      return;
    }

    if (currentAttempt >= MAX_AUTO_RECONNECT_ATTEMPTS) {
      log.warn(
        { status: geminiStatus },
        "Gemini session dropped; max reconnect attempts reached — stopping media."
      );
      stopMic();
      stopWebcam();
      setTimeout(() => setIsInitialized(false), 0);
      return;
    }

    reconnectAttemptsRef.current += 1;
    const attempt = reconnectAttemptsRef.current;
    const delayMs = AUTO_RECONNECT_BASE_DELAY_MS * attempt;

    log.warn(
      { status: geminiStatus, attempt, delayMs },
      "Gemini session dropped; attempting automatic reconnect."
    );

    stopMic();

    reconnectTimerRef.current = setTimeout(() => {
      void (async () => {
        if (isManualStopRef.current || !isInitialized) return;

        const connected = await connect();
        if (connected) {
          // Fix #9: reset AFTER successful reconnect, not before
          reconnectAttemptsRef.current = 0;
          dropHandledForConnectionRef.current = null;
          // Fix #10: call forwardMicChunk through the ref so we always use
          // the latest closure regardless of when the timer fires.
          startMic((...args) => forwardMicChunkRef.current(...args));
          log.info({ attempt }, "Gemini session recovered via automatic reconnect.");
        } else {
          // Allow the next status change to trigger another attempt
          dropHandledForConnectionRef.current = null;
          log.warn({ attempt }, "Automatic reconnect attempt failed.");
        }
      })();
    }, delayMs);
  }, [
    geminiStatus,
    isInitialized,
    stopMic,
    stopWebcam,
    connect,
    startMic,
    lastCloseCode,
  ]);

  // ── Session start / stop ───────────────────────────────────────────────────
  const resetMicCounters = useCallback(() => {
    micSuppressedChunksRef.current = 0;
    micForwardedChunksRef.current = 0;
    micSuppressedAmbientRef.current = 0;
    micSuppressedEchoRef.current = 0;
    assistantHoldoffUntilRef.current = 0;
  }, []);

  const startSession = useCallback(async () => {
    try {
      isManualStopRef.current = false;
      reconnectAttemptsRef.current = 0;
      dropHandledForConnectionRef.current = null;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      resetMicCounters();
      setIsInitialized(true);

      log.info("Starting session.");

      // Resume AudioContext during the user gesture to satisfy autoplay policy
      const streamer = ensureStreamer();
      if (streamer.context.state === "suspended") {
        await streamer.context.resume();
        log.info("Playback AudioContext resumed via user gesture.");
      }

      const connected = await connect();
      if (!connected) {
        throw new Error("Gemini session failed to connect.");
      }

      // Fix #10: wrap via ref so the AudioWorklet always calls the latest version
      startMic((...args) => forwardMicChunkRef.current(...args));
      log.info("Session started.");
    } catch (error) {
      log.error({ err: error }, "Failed to start session.");
      setIsInitialized(false);
    }
  }, [connect, ensureStreamer, startMic, resetMicCounters]);

  const stopSession = useCallback(() => {
    isManualStopRef.current = true;
    reconnectAttemptsRef.current = 0;
    dropHandledForConnectionRef.current = null;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    log.info(
      {
        forwardedMicChunks: micForwardedChunksRef.current,
        suppressedMicChunks: micSuppressedChunksRef.current,
      },
      "Stopping session."
    );

    disconnect();
    stopPlayback();
    stopMic();
    stopWebcam();
    resetMicCounters();
    setIsInitialized(false);
  }, [disconnect, stopPlayback, stopMic, stopWebcam, resetMicCounters]);

  // ── Toggle (Fix #14) ───────────────────────────────────────────────────────
  // Only allow stopping when the session is fully connected or in error state.
  // If still connecting, do nothing to avoid tearing a mid-handshake session.
  const toggleSession = useCallback(() => {
    if (isTransitioningRef.current) {
      log.debug(
        { status: geminiStatus },
        "Session toggle ignored while transitioning."
      );
      return;
    }

    if (geminiStatus === "connecting") {
      log.debug("Session toggle ignored while connecting.");
      return;
    }

    if (geminiStatus === "connected" || geminiStatus === "error") {
      isTransitioningRef.current = true;
      log.info({ status: geminiStatus }, "Stopping active session via toggle.");
      stopSession();
      setTimeout(() => {
        isTransitioningRef.current = false;
      }, 500);
    } else {
      // geminiStatus === "disconnected"
      isTransitioningRef.current = true;
      log.info("Starting session via toggle.");
      startSession().finally(() => {
        isTransitioningRef.current = false;
      });
    }
  }, [geminiStatus, startSession, stopSession]);

  // ── Mic / camera toggles ───────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    if (isMicActive) {
      log.info("Muting microphone.");
      stopMic();
    } else {
      log.info("Unmuting microphone.");
      startMic((...args) => forwardMicChunkRef.current(...args));
    }
  }, [isMicActive, stopMic, startMic]);

  const toggleCamera = useCallback(() => {
    if (isCameraActive) {
      stopWebcam();
    } else {
      startWebcam();
    }
  }, [isCameraActive, stopWebcam, startWebcam]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, []);

  return {
    // State
    isConnected,
    status: geminiStatus,
    errorMessage,
    micError,
    cameraError,
    audioLevelRef,
    assistantAudioLevelRef: outputAudioLevelRef,
    isMicActive,
    isCameraActive,
    facingMode,
    videoRef,

    // Actions
    toggleSession,
    toggleMic,
    toggleCamera,
    switchCamera,
    sendText,

    // Audio scheduling
    onAudioScheduledRef,
    onPlaybackComplete: onPlaybackCompleteRef,

    /**
     * Register an application-level tool handler.
     * Must be called before `toggleSession` / `connect`.
     */
    registerTool,

    // Callback refs
    onToolCall,
    onTranscript,
    onUserTranscript,
  };
}
