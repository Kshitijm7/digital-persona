"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGeminiLive } from "./useGeminiLive";
import { useAudioProcessor } from "./useAudioProcessor";
import { useWebcam } from "./useWebcam";
import { createLogger } from "@/lib/logging/logger";
import {
  getSessionConfig,
  getModeConfig,
  computeBackoff,
} from "@/lib/gemini-session-config";
import type { GeminiSessionMode } from "@/lib/gemini-session-config";

const log = createLogger("useSessionManager");

const AMBIENT_INPUT_FLOOR = 0.006;
const ASSISTANT_ECHO_BLOCK_THRESHOLD = 0.22;
const ASSISTANT_ECHO_RELEASE_THRESHOLD = 0.32;
const ASSISTANT_HOLDOFF_MS = 500;
const SESSION_CFG = getSessionConfig();
const MAX_AUTO_RECONNECT_ATTEMPTS =
  SESSION_CFG.stability.maxRetriesInStableMode;

// ── Precomputed zero-chunk fallback (Wave 2.2) ─────────────────────────────
const BASE64_CHUNK_SIZE = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

const ZERO_CHUNK_BYTES = new Uint8Array(SESSION_CFG.heartbeat.zeroChunkBytes);
const ZERO_CHUNK_B64 = bytesToBase64(ZERO_CHUNK_BYTES);

const AUDIO_STREAM_END_DELAY_MS = SESSION_CFG.heartbeat.audioStreamEndDelayMs;
const HEARTBEAT_INTERVAL_MS = SESSION_CFG.heartbeat.intervalMs;

export function useSessionManager() {
  const {
    onAudioData: onAudioDataRef,
    onInterrupted: onInterruptedRef,
    onTurnComplete: onTurnCompleteRef,
    registerTool,
    getCompatibilityProfile,
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
    sendAudioStreamEnd,
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
  // FIX(SM4): Ref mirror of isInitialized for fresh reads in async callbacks.
  // State gives us re-renders; the ref gives us a non-stale value inside
  // setTimeout / async continuations that outlive the effect closure.
  const isInitializedRef = useRef(false);
  const isConnected = geminiStatus === "connected";

  // FIX(SM4): Keep ref in sync with state
  useEffect(() => {
    isInitializedRef.current = isInitialized;
  }, [isInitialized]);

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

  const forwardMicChunkRef = useRef<(chunk: string) => void>(() => {});

  const dropHandledForConnectionRef = useRef<number | null>(null);

  const audioStreamEndSentRef = useRef(false);
  const suppressionStartRef = useRef(0);

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
  const lastForwardedChunkAtRef = useRef(0);

  // ── Mic chunk forwarding ──────────────────────────────────────────────────
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
            "Suppressed microphone chunk below ambient floor.",
          );
        }

        if (suppressionStartRef.current === 0) {
          suppressionStartRef.current = now;
        }

        const silenceDuration = now - suppressionStartRef.current;
        const activeMode = getCompatibilityProfile() as GeminiSessionMode;
        const modeHeartbeat = getModeConfig(activeMode).heartbeat;

        if (modeHeartbeat.precomputeFallback) {
          if (now - lastForwardedChunkAtRef.current > HEARTBEAT_INTERVAL_MS) {
            micForwardedChunksRef.current += 1;
            lastForwardedChunkAtRef.current = now;
            log.debug("Sent precomputed zero-chunk heartbeat (ambient).");
            sendAudioChunk(ZERO_CHUNK_B64);
          }
        } else {
          if (
            silenceDuration > AUDIO_STREAM_END_DELAY_MS &&
            !audioStreamEndSentRef.current
          ) {
            audioStreamEndSentRef.current = true;
            log.debug("Sent audioStreamEnd after ambient silence.");
            sendAudioStreamEnd();
          }
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
            "Suppressed microphone chunk to prevent assistant self-interruption.",
          );
        }

        if (suppressionStartRef.current === 0) {
          suppressionStartRef.current = now;
        }

        const silenceDuration = now - suppressionStartRef.current;
        const activeMode = getCompatibilityProfile() as GeminiSessionMode;
        const modeHeartbeat = getModeConfig(activeMode).heartbeat;

        if (modeHeartbeat.precomputeFallback) {
          if (now - lastForwardedChunkAtRef.current > HEARTBEAT_INTERVAL_MS) {
            micForwardedChunksRef.current += 1;
            lastForwardedChunkAtRef.current = now;
            log.debug("Sent precomputed zero-chunk heartbeat (echo block).");
            sendAudioChunk(ZERO_CHUNK_B64);
          }
        } else {
          if (
            silenceDuration > AUDIO_STREAM_END_DELAY_MS &&
            !audioStreamEndSentRef.current
          ) {
            audioStreamEndSentRef.current = true;
            log.debug("Sent audioStreamEnd during echo block.");
            sendAudioStreamEnd();
          }
        }
        return;
      }

      // User is speaking — reset suppression tracking
      audioStreamEndSentRef.current = false;
      suppressionStartRef.current = 0;

      micForwardedChunksRef.current += 1;
      lastForwardedChunkAtRef.current = now;
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
      sendAudioChunk(chunk);
    },
    [
      inputAudioLevelRef,
      isAssistantSpeakingRef,
      sendAudioChunk,
      sendAudioStreamEnd,
      getCompatibilityProfile,
    ],
  );

  // Keep the ref current so timers always call the latest version
  useEffect(() => {
    forwardMicChunkRef.current = forwardMicChunk;
  }, [forwardMicChunk]);

  // ── Wire Gemini audio → speaker ────────────────────────────────────────────
  useEffect(() => {
    if (!isInitialized) return;
    log.debug("Attached Gemini audio callback.");
    onAudioDataRef.current = (b64) => {
      assistantHoldoffUntilRef.current =
        performance.now() + ASSISTANT_HOLDOFF_MS;
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
        performance.now() + ASSISTANT_HOLDOFF_MS,
      );
      markAssistantTurnComplete();
    };
    return () => {
      onTurnCompleteRef.current = null;
      log.debug("Detached turn-complete callback.");
    };
  }, [onTurnCompleteRef, markAssistantTurnComplete, isInitialized]);

  // ── Wire webcam frames → Gemini (FIX SM1) ─────────────────────────────────
  // Removed `isConnected` from deps. `sendVideoFrame` already guards on
  // statusRef internally — having isConnected here caused the callback to
  // detach→reattach on every status toggle during reconnect, producing
  // brief frame blackouts and unnecessary GC churn.
  useEffect(() => {
    if (!isInitialized) return;
    log.debug("Attached webcam frame callback.");
    onFrameRef.current = (base64) => {
      sendVideoFrame(base64);
    };
    return () => {
      onFrameRef.current = null;
      log.debug("Detached webcam frame callback.");
    };
  }, [onFrameRef, sendVideoFrame, isInitialized]);

  // ── Auto-reconnect on unexpected drop (FIX SM2, SM4, SM5) ─────────────────
  useEffect(() => {
    if (!isInitialized) return;

    if (geminiStatus !== "disconnected" && geminiStatus !== "error") {
      return;
    }

    const closeCode = lastCloseCode?.current;
    const isCleanClose = closeCode === 1000 || closeCode === 1001;

    if (isCleanClose && !isManualStopRef.current) {
      log.info(
        { closeCode },
        "Clean WebSocket close — not triggering auto-reconnect.",
      );
      // FIX(SM5): Removed sendAudioStreamEnd() — session is already
      // disconnected at this point so it's always a no-op.
      stopMic();
      stopWebcam();
      setTimeout(() => setIsInitialized(false), 0);
      return;
    }

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
        "Gemini session dropped; max reconnect attempts reached — stopping media.",
      );
      stopMic();
      stopWebcam();
      setTimeout(() => setIsInitialized(false), 0);
      return;
    }

    reconnectAttemptsRef.current += 1;
    const attempt = reconnectAttemptsRef.current;
    const delayMs = computeBackoff(attempt - 1);

    log.warn(
      { status: geminiStatus, attempt, delayMs },
      "Gemini session dropped; attempting automatic reconnect.",
    );

    sendAudioStreamEnd();
    stopMic();

    // FIX(SM2): Clear any existing reconnect timer before scheduling a new
    // one. Without this, if deps change mid-timer (e.g. StrictMode
    // double-fire or rapid disconnect→error→disconnect), two timers race
    // and both call connect() concurrently.
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;

      void (async () => {
        // FIX(SM4): Read the ref, not the stale closure value.
        // The effect closure captured `isInitialized` at schedule-time,
        // but by the time the timer fires the component may have
        // unmounted or the user may have stopped the session.
        if (isManualStopRef.current || !isInitializedRef.current) return;

        const connected = await connect();
        if (connected) {
          reconnectAttemptsRef.current = 0;
          dropHandledForConnectionRef.current = null;

          // FIX: Reset playback state for the new session.
          // Without this, the old streamer's doneFired flag leaks
          // across sessions, causing onComplete to never fire for
          // text-only turns after reconnect.
          stopPlayback();

          // FIX(SM3): Await startMic and log if it fails. Without this,
          // a denied mic permission after reconnect leaves the user with
          // a live avatar that can't hear them — and no feedback.
          const micStarted = await startMic(
            (...args) => forwardMicChunkRef.current(...args),
          );
          if (!micStarted) {
            log.warn(
              { attempt },
              "Reconnect succeeded but mic failed to start. User has no audio input.",
            );
          }
          log.info(
            { attempt, micActive: micStarted },
            "Gemini session recovered via automatic reconnect.",
          );
        } else {
          dropHandledForConnectionRef.current = null;
          log.warn({ attempt }, "Automatic reconnect attempt failed.");
        }
      })();
    }, delayMs);

    // FIX(SM2): Cleanup — if deps change before the timer fires, cancel it.
    // This prevents two concurrent connect() calls from racing.
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [
    geminiStatus,
    isInitialized,
    stopMic,
    stopWebcam,
    stopPlayback,
    connect,
    sendAudioStreamEnd,
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

  // FIX(SM3): startSession now surfaces mic failure to the user.
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

      const streamer = ensureStreamer();
      if (streamer.context.state === "suspended") {
        await streamer.context.resume();
        log.info("Playback AudioContext resumed via user gesture.");
      }

      const connected = await connect();
      if (!connected) {
        throw new Error("Gemini session failed to connect.");
      }

      // FIX(SM3): Await mic start. If permission is denied, log a clear
      // warning. We don't throw — the session is still usable for text
      // input — but the user gets feedback via micError.
      const micStarted = await startMic(
        (...args) => forwardMicChunkRef.current(...args),
      );
      if (!micStarted) {
        log.warn(
          "Session connected but microphone failed to start. " +
            "User can still interact via text.",
        );
      }
      log.info({ micActive: micStarted }, "Session started.");
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
      "Stopping session.",
    );

    sendAudioStreamEnd();
    disconnect();
    stopPlayback();
    stopMic();
    stopWebcam();
    resetMicCounters();
    setIsInitialized(false);
  }, [
    disconnect,
    stopPlayback,
    stopMic,
    stopWebcam,
    resetMicCounters,
    sendAudioStreamEnd,
  ]);

  // ── Toggle ─────────────────────────────────────────────────────────────────
  const toggleSession = useCallback(() => {
    if (isTransitioningRef.current) {
      log.debug(
        { status: geminiStatus },
        "Session toggle ignored while transitioning.",
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
      sendAudioStreamEnd();
      stopMic();
    } else {
      log.info("Unmuting microphone.");
      startMic((...args) => forwardMicChunkRef.current(...args));
    }
  }, [isMicActive, stopMic, startMic, sendAudioStreamEnd]);

  const toggleCamera = useCallback(() => {
    if (isCameraActive) {
      stopWebcam();
    } else {
      const activeMode = getCompatibilityProfile() as GeminiSessionMode;
      const modeFps = getModeConfig(activeMode).video.fps;
      startWebcam(undefined, modeFps);
    }
  }, [isCameraActive, stopWebcam, startWebcam, getCompatibilityProfile]);

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

    toggleSession,
    toggleMic,
    toggleCamera,
    switchCamera,
    sendText,
    getCompatibilityProfile,

    onAudioScheduledRef,
    onPlaybackComplete: onPlaybackCompleteRef,

    registerTool,

    onToolCall,
    onTranscript,
    onUserTranscript,
  };
}