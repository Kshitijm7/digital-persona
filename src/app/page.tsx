"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  memo,
  useRef,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Logo } from "@/components/ui/Logo";

// Error Boundary
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Layout
import { VideoCallLayout } from "@/components/layout/VideoCallLayout";

// Call Components
import { CallHeader } from "@/components/call/CallHeader";
import { CallControls } from "@/components/call/CallControls";
import { WebcamFeed } from "@/components/call/WebcamFeed";
import { PersonaOverlay } from "@/components/call/PersonaOverlay";
import { DebugToggle } from "@/components/call/DebugToggle";

// Utilities
import { useMediaQuery } from "usehooks-ts";

// Chat Components
import { ChatPanel } from "@/components/chat/ChatPanel";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { TextShimmer } from "@/components/ui/text-shimmer";

// Hooks
import { useAnimationStore } from "@/store/useAnimationStore";
import { useAnimationRegistry } from "@/hooks/useAnimationRegistry";
import { findAnimationSequence } from "@/lib/animationMatcher";
import { useSessionManager } from "@/hooks/useSessionManager";
import { useSessionTimer } from "@/hooks/useSessionTimer";
import { useChatMessages } from "@/hooks/useChatMessages";

// Skin
import { SkinPreset, SKIN_PRESETS } from "@/lib/skinConfig";

// Emotion
import { useEmotionStore } from "@/store/useEmotionStore";
import { createLogger } from "@/lib/logging/logger";
import { useAvatarRuntimeStore } from "@/store/useAvatarRuntimeStore";
import { sanitizeControlPatch } from "@/lib/avatar-control.types";
import type { EmotionState } from "@/lib/avatar-control.types";

// Scene Config
import { SceneConfigProvider } from "@/hooks/SceneConfigContext";

// ─── Constants ────────────────────────────────────────────────────────────────

const log = createLogger("app/page");

const BASE_ANIMATION_MATCH_THRESHOLD = 0.15;
const SPEAKING_ANIMATION_MATCH_THRESHOLD = 0.2;
const ASSISTANT_SPEAKING_LEVEL_THRESHOLD = 0.06;
const EXPRESSION_AUTO_RESET_MS = 4_000;
const END_CALL_FALLBACK_MS = 10_000;
const TRANSCRIPT_DEDUP_WINDOW_MS = 2_500;

// ─── 3D Scene (lazy, no SSR) ──────────────────────────────────────────────────

const Scene = dynamic(() => import("@/components/canvas/Scene"), {
  ssr: false,
  loading: () => <SceneLoader />,
});

function SceneLoader() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-zinc-500 text-sm">Loading 3D scene…</div>
    </div>
  );
}

// ─── Idle screen ──────────────────────────────────────────────────────────────
// Memoised so it never re-renders while the session is live.

const IdleScreen = memo(({ onStart }: { onStart: () => void }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.9 }}
    transition={{ duration: 0.4 }}
    className="absolute inset-0 flex flex-col items-center justify-center z-10"
  >
    <div className="relative mx-4 flex w-full max-w-md flex-col items-center gap-6 overflow-hidden rounded-3xl border border-white/6 bg-white/3 px-6 py-8 backdrop-blur-xl shadow-2xl sm:px-12 sm:py-10">
      {/* Ambient glow */}
      <div className="absolute top-0 right-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-cyan-400/5 blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-6 w-full">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-cyan-400/20 bg-linear-to-br from-cyan-400/20 to-emerald-400/20 shadow-xl animate-pulse-ring sm:h-20 sm:w-20">
          <Logo className="h-7 w-7 text-cyan-400 sm:h-8 sm:w-8" />
        </div>

        <div className="text-center">
          <TextShimmer
            duration={2}
            className="mb-2 text-xl font-semibold tracking-wide sm:text-2xl [--base-color:var(--color-cyan-500)] [--base-gradient-color:var(--color-emerald-300)] dark:[--base-color:var(--color-cyan-500)] dark:[--base-gradient-color:var(--color-emerald-300)]"
          >
            Digital Persona
          </TextShimmer>
          <p className="text-sm text-zinc-500 leading-relaxed mt-2">
            Start a session to activate your AI persona.
            <br />
            Grant camera &amp; mic permissions for full interaction.
          </p>
        </div>

        <LiquidButton
          onClick={onStart}
          className="w-full rounded-full border-0 bg-linear-to-r from-cyan-500 to-emerald-500 py-4 text-sm font-semibold tracking-wide text-primary-foreground transition-all duration-500 hover:scale-105 hover:opacity-100 hover:shadow-[0_0_30px_rgba(34,211,238,0.3)] sm:py-5 cursor-pointer"
        >
          INITIATE SESSION
        </LiquidButton>
      </div>
    </div>
  </motion.div>
));
IdleScreen.displayName = "IdleScreen";

// ─── Error banner ─────────────────────────────────────────────────────────────
// Fix #4: Inline error banner instead of an early-return that destroys the tree.
// The 3D scene, audio context, and all refs stay mounted.

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

const ErrorBanner = memo(({ message, onDismiss }: ErrorBannerProps) => (
  <motion.div
    initial={{ opacity: 0, y: -12 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -12 }}
    className="absolute top-16 left-1/2 z-50 -translate-x-1/2 w-full max-w-sm px-4"
  >
    <div className="rounded-2xl border border-red-500/30 bg-zinc-950/90 p-4 shadow-2xl backdrop-blur-xl">
      <p className="text-sm text-red-400 mb-3 leading-relaxed">{message}</p>
      <div className="flex gap-2">
        <button
          onClick={onDismiss}
          className="flex-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition-colors"
        >
          Dismiss
        </button>
        <button
          onClick={() => window.location.reload()}
          className="flex-1 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
        >
          Reload
        </button>
      </div>
    </div>
  </motion.div>
));
ErrorBanner.displayName = "ErrorBanner";

// ─── HomePage ─────────────────────────────────────────────────────────────────

function HomePage() {
  // Animation registry — fetched once globally
  useAnimationRegistry();

  // ── UI state ────────────────────────────────────────────────────────────────
  const isMobile = useMediaQuery("(max-width: 950px)");

  // Fix #9: drive chat panel open/closed synchronously via layout effect,
  // no setTimeout needed — avoids the extra render-cycle flicker.
  const [isChatOpen, setIsChatOpen] = useState(!isMobile);
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsChatOpen(!isMobile);
  }, [isMobile]);

  const [currentExpression, setCurrentExpression] = useState<string>("idle");
  const [personaMode, setPersonaMode] = useState<
    "focus" | "casual" | "presentation"
  >("casual");
  const [selectedSkin, setSelectedSkin] = useState<SkinPreset>(SKIN_PRESETS[0]);
  const [debugMode, setDebugMode] = useState(false);

  // Fix #4: dismissable inline error banner instead of early-return
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  // ── Chat ────────────────────────────────────────────────────────────────────
  const chat = useChatMessages();

  // Fix #5 + #11: pull stable function references out of the chat object so
  // effects that depend on them don't re-run on every new message.
  const appendAssistantMessage = chat.appendAssistantMessage;
  const addUserMessage = chat.addUserMessage;

  // ── Avatar store ────────────────────────────────────────────────────────────
  const applySessionPatch = useAvatarRuntimeStore((s) => s.applySessionPatch);
  const clearSessionOverrides = useAvatarRuntimeStore(
    (s) => s.clearSessionOverrides
  );

  // ── Misc refs ───────────────────────────────────────────────────────────────
  const expressionResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Fix #1 + #2 + #3: stable ref for toggleSession so tool handlers and
  // playback-complete callbacks always call the latest version without
  // being listed as effect dependencies (which would cause re-registration).
  const toggleSessionRef = useRef<() => void>(() => {});

  // Track end-call pending state as a ref — no render needed.
  const endCallPendingRef = useRef(false);
  // Ref for the end-call fallback timer so we can cancel it on unmount.
  const endCallFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Fix #8: shared dedup set for display_text ↔ transcript to prevent
  // the same content appearing twice in chat.
  const recentAssistantTextsRef = useRef<Map<string, number>>(new Map());

  // ── Session manager ─────────────────────────────────────────────────────────
  const {
    onTranscript: onTranscriptRef,
    onUserTranscript: onUserTranscriptRef,
    onToolCall: onToolCallRef,
    onPlaybackComplete: onPlaybackCompleteRef,
    isConnected,
    status,
    errorMessage,
    micError,
    cameraError,
    assistantAudioLevelRef,
    isMicActive,
    isCameraActive,
    facingMode,
    videoRef,
    toggleSession,
    toggleMic,
    toggleCamera,
    switchCamera,
    sendText,
    registerTool,
  } = useSessionManager();

  // Keep the ref current so closures in tool handlers always call the
  // latest version without capturing it as a dep (Fix #1, #2, #3, #12).
  useEffect(() => {
    toggleSessionRef.current = toggleSession;
  }, [toggleSession]);

  const timer = useSessionTimer(isConnected);

  // ── Error handling (Fix #4, #6) ─────────────────────────────────────────────
  // Compute the visible error string. Dismissed errors are hidden until a new
  // error supersedes them.
  const rawError = errorMessage ?? micError ?? cameraError?.message ?? null;

  const visibleError = rawError && rawError !== dismissedError ? rawError : null;

  // Reset the dismissed state whenever a new error arrives.
  const prevRawErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (rawError && rawError !== prevRawErrorRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissedError(null);
    }
    prevRawErrorRef.current = rawError ?? null;
  }, [rawError]);

  // Fix #6: only clear session overrides on intentional stops, not during
  // auto-reconnect transitions. We gate on the status having been "connected"
  // first so we don't clear on the initial mount.
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (status === "connected") {
      wasConnectedRef.current = true;
      return;
    }
    if (
      wasConnectedRef.current &&
      (status === "disconnected" || status === "error")
    ) {
      wasConnectedRef.current = false;
      clearSessionOverrides();
    }
  }, [status, clearSessionOverrides]);

  // ── Shared text-dedup helper (Fix #8) ──────────────────────────────────────
  // Returns true if the text should be shown; false if it was seen recently.
  const shouldShowAssistantText = useCallback(
    (text: string, windowMs = TRANSCRIPT_DEDUP_WINDOW_MS): boolean => {
      const normalized = text.trim();
      if (!normalized) return false;
      const now = Date.now();
      const seenAt = recentAssistantTextsRef.current.get(normalized);
      if (seenAt !== undefined && now - seenAt < windowMs) return false;
      recentAssistantTextsRef.current.set(normalized, now);
      // Prune old entries to avoid unbounded growth
      for (const [key, ts] of recentAssistantTextsRef.current) {
        if (now - ts > windowMs * 2) {
          recentAssistantTextsRef.current.delete(key);
        }
      }
      return true;
    },
    []
  );

  // ── Tool: expression helper ─────────────────────────────────────────────────
  const applyExpression = useCallback((expr: string) => {
    if (!expr) return;
    if (expressionResetTimerRef.current !== null) {
      clearTimeout(expressionResetTimerRef.current);
      expressionResetTimerRef.current = null;
    }
    setCurrentExpression(expr);
    expressionResetTimerRef.current = setTimeout(() => {
      setCurrentExpression("idle");
      expressionResetTimerRef.current = null;
      log.info("Expression override reset to idle.");
    }, EXPRESSION_AUTO_RESET_MS);
  }, []);

  // ── Register application-level tool handlers ────────────────────────────────
  //
  // Fix #1, #12: `toggleSession` is deliberately NOT in the dep array.
  // Instead we use `toggleSessionRef` (updated via a separate effect above).
  // This means the tool registry is built ONCE on mount and stays stable for
  // the entire component lifetime, eliminating all stale-handler windows.
  //
  // All other deps below (`registerTool`, `appendAssistantMessage`,
  // `applySessionPatch`, `assistantAudioLevelRef`, `switchCamera`,
  // `applyExpression`, `shouldShowAssistantText`) are genuinely stable:
  //   - `registerTool`            memoised in useGeminiLive (no deps)
  //   - `appendAssistantMessage`  stable from useChatMessages
  //   - `applySessionPatch`       zustand selector (stable)
  //   - `assistantAudioLevelRef`  ref object (stable identity)
  //   - `switchCamera`            stable from useWebcam
  //   - `applyExpression`         useCallback with no deps that change
  //   - `shouldShowAssistantText` useCallback with no deps that change
  useEffect(() => {
    log.info("Registering page-level tool handlers.");

    // ── trigger_animation ───────────────────────────────────────────────────
    registerTool("trigger_animation", (args) => {
      const baseAnimation = args.base_animation as string;
      const intensity = (args.intensity as number | undefined) ?? 1.0;

      const assistantSpeakingLevel = assistantAudioLevelRef.current ?? 0;
      const isSpeaking =
        assistantSpeakingLevel >= ASSISTANT_SPEAKING_LEVEL_THRESHOLD;
        
      const isDirectAnimationRequest = baseAnimation.includes("_");
      const minScore = isSpeaking
        ? SPEAKING_ANIMATION_MATCH_THRESHOLD
        : isDirectAnimationRequest
          ? 0.05
          : BASE_ANIMATION_MATCH_THRESHOLD;

      const emotionState = useEmotionStore.getState();
      const recentMessages = useAnimationStore
        .getState()
        .registry
        ? []
        : [];

      const contextTexts = [
        emotionState.textBuffer,
        ...recentMessages,
      ].filter((t): t is string => Boolean(t?.trim()));

      log.info(
        {
          baseAnimation,
          intensity,
          isSpeaking,
          assistantSpeakingLevel,
          minScore,
          sentimentScore: emotionState.currentScore,
          contextCount: contextTexts.length,
        },
        "Tool override: trigger_animation"
      );

      if (!baseAnimation) {
        return { acknowledged: false, reason: "missing base_animation" };
      }

      const animState = useAnimationStore.getState();

      // Build a stacked sequence using the fuzzy matcher.
      // - Generic intents ("dance") → random same-type picks for variety
      // - Specific intents ("hip hop dance") → top-N fuzzy-ranked peers
      // - Non-stackable types (gesture, etc.) → single animation
      const sequence = findAnimationSequence(
        baseAnimation,
        animState.registry,
        {
          minScore,
          disallowTypes: [],
          allowCategoryFallback: !isSpeaking,
          contextTexts,
          sentimentScore: emotionState.currentScore,
          count: 4,
        }
      );

      log.debug(
        { requested: baseAnimation, sequence },
        "Resolved animation sequence."
      );

      const validSequence = sequence.filter((name) => name !== "idle");

      if (validSequence.length > 0) {
        animState.playSequence(
          validSequence.map((name) => ({ name, timeScale: intensity }))
        );
      } else {
        log.info(
          { baseAnimation, minScore, isSpeaking },
          "Skipped trigger_animation: no animations met relevance threshold."
        );
      }

      return {
        acknowledged: true,
        base_animation: baseAnimation,
        intensity,
        sequenceLength: validSequence.length,
      };
    });

    // ── set_expression ──────────────────────────────────────────────────────
    registerTool("set_expression", (args) => {
      const expr = args.expression as string;
      log.info({ expression: expr }, "Tool override: set_expression");
      applyExpression(expr);
      return { acknowledged: true, expression: expr };
    });

    // ── display_text ────────────────────────────────────────────────────────
    // Fix #8: dedup against the transcript stream.
    registerTool("display_text", (args) => {
      const content = args.content as string;
      const format = (args.format as string) ?? "plain";
      const lang = (args.language as string | undefined) ?? "";

      const displayContent =
        format === "code" && lang
          ? `\`\`\`${lang}\n${content}\n\`\`\``
          : format === "code"
            ? `\`\`\`\n${content}\n\`\`\``
            : content;

      // Only push if the transcript stream hasn't already shown this text
      if (shouldShowAssistantText(displayContent, 3_000)) {
        appendAssistantMessage(displayContent);
      }

      log.info(
        { contentLength: content.length, format, language: lang || null },
        "Tool override: display_text"
      );
      return { acknowledged: true, characters_displayed: content.length };
    });

    // ── update_persona_state ────────────────────────────────────────────────
    registerTool("update_persona_state", (args) => {
      const applied: Record<string, unknown> = {};

      const mode = args.mode as
        | "focus"
        | "casual"
        | "presentation"
        | undefined;
      if (mode) {
        setPersonaMode(mode);
        applied.mode = mode;
      }

      const emotionStateArg = args.emotionState as string | undefined;
      const emotionIntensity =
        typeof args.emotionIntensity === "number"
          ? args.emotionIntensity
          : undefined;
      const lookAtIK =
        typeof args.lookAtIK === "boolean" ? args.lookAtIK : undefined;
      const saccadeStrength =
        typeof args.saccadeStrength === "number"
          ? args.saccadeStrength
          : undefined;

      const hasEmotionFields =
        emotionStateArg !== undefined || emotionIntensity !== undefined;
      const hasOcularFields =
        lookAtIK !== undefined || saccadeStrength !== undefined;

      if (hasEmotionFields || hasOcularFields) {
        const patch = sanitizeControlPatch({
          ...(hasEmotionFields
            ? {
                emotionControl: {
                  emotionState: emotionStateArg as EmotionState | undefined,
                  emotionIntensity,
                },
              }
            : {}),
          ...(hasOcularFields
            ? { ocularTuning: { lookAtIK, saccadeStrength } }
            : {}),
        });
        applySessionPatch(patch);
        applied.patch = patch;
      }

      log.info({ applied }, "Tool override: update_persona_state");
      return { acknowledged: true, applied };
    });

    // ── switch_camera ───────────────────────────────────────────────────────
    registerTool("switch_camera", async () => {
      log.info("Tool override: switch_camera");
      const success = await switchCamera();
      return { acknowledged: true, success };
    });

    // ── end_call ────────────────────────────────────────────────────────────
    // Fix #1 + #2: reads toggleSession through a stable ref so this handler
    // never needs to be re-registered when toggleSession recreates.
    registerTool("end_call", () => {
      log.info("Tool override: end_call");
      endCallPendingRef.current = true;

      // Cancel any previously scheduled fallback before scheduling a new one.
      if (endCallFallbackTimerRef.current !== null) {
        clearTimeout(endCallFallbackTimerRef.current);
      }

      // Fix #2: use ref so the fallback always calls the current toggleSession.
      endCallFallbackTimerRef.current = setTimeout(() => {
        endCallFallbackTimerRef.current = null;
        if (endCallPendingRef.current) {
          log.warn(
            "end_call fallback timer reached. Forcing session close."
          );
          endCallPendingRef.current = false;
          toggleSessionRef.current();
        }
      }, END_CALL_FALLBACK_MS);

      return {
        acknowledged: true,
        instruction:
          "Say bye to the user and the conversation will end.",
      };
    });
  }, [
    registerTool,
    appendAssistantMessage,
    applySessionPatch,
    assistantAudioLevelRef,
    switchCamera,
    applyExpression,
    shouldShowAssistantText,
    // toggleSession intentionally omitted — accessed via toggleSessionRef
  ]);

  // ── Wire onPlaybackComplete (Fix #3) ────────────────────────────────────────
  // Uses toggleSessionRef so this effect is never forced to re-run when
  // toggleSession recreates, eliminating the null-ref window.
  useEffect(() => {
    if (!onPlaybackCompleteRef) return;
    onPlaybackCompleteRef.current = () => {
      if (endCallPendingRef.current) {
        log.info("Playback complete — executing queued end_call.");
        endCallPendingRef.current = false;
        if (endCallFallbackTimerRef.current !== null) {
          clearTimeout(endCallFallbackTimerRef.current);
          endCallFallbackTimerRef.current = null;
        }
        toggleSessionRef.current();
      }
    };
    return () => {
      if (onPlaybackCompleteRef) onPlaybackCompleteRef.current = null;
    };
  }, [onPlaybackCompleteRef]);
  // toggleSession intentionally omitted — accessed via toggleSessionRef

  // ── Tool call observer ──────────────────────────────────────────────────────
  useEffect(() => {
    onToolCallRef.current = ({ name, id, args }) => {
      log.debug(
        {
          toolName: name,
          callId: id ?? null,
          argKeys: Object.keys(args ?? {}),
        },
        "Tool call surfaced to page."
      );
    };
    return () => {
      onToolCallRef.current = null;
    };
  }, [onToolCallRef]);

  // ── Transcript handler (Fix #5) ─────────────────────────────────────────────
  // `appendAssistantMessage` is a stable ref pulled from the chat hook above,
  // not the `chat` object itself — this effect will not re-run on new messages.
  useEffect(() => {
    onTranscriptRef.current = (text: string) => {
      const normalized = text.trim();
      if (!normalized) return;

      // Fix #8: share the dedup gate with display_text
      if (!shouldShowAssistantText(normalized)) return;

      log.debug({ chunkLength: text.length }, "Transcript chunk received.");
      appendAssistantMessage(text);

      if (normalized) {
        useEmotionStore.getState().analyzeText(normalized);
      }
    };
    return () => {
      onTranscriptRef.current = null;
    };
  }, [onTranscriptRef, appendAssistantMessage, shouldShowAssistantText]);

  // ── User transcript handler ──────────────────────────────────────────────────
  useEffect(() => {
    onUserTranscriptRef.current = (text: string) => {
      const normalized = text.trim();
      if (!normalized) return;
      log.debug({ length: normalized.length }, "User transcript received.");
      addUserMessage(normalized);
    };
    return () => {
      onUserTranscriptRef.current = null;
    };
  }, [onUserTranscriptRef, addUserMessage]);

  // ── Expression timer cleanup on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (expressionResetTimerRef.current !== null) {
        clearTimeout(expressionResetTimerRef.current);
        expressionResetTimerRef.current = null;
      }
      if (endCallFallbackTimerRef.current !== null) {
        clearTimeout(endCallFallbackTimerRef.current);
        endCallFallbackTimerRef.current = null;
      }
    };
  }, []);

  // ── Send chat text ───────────────────────────────────────────────────────────
  const handleSendText = useCallback(
    (text: string) => {
      log.info({ textLength: text.length }, "User text sent from chat panel.");
      addUserMessage(text);
      sendText(text);
    },
    [addUserMessage, sendText]
  );

  // ── Derived state ────────────────────────────────────────────────────────────
  // Fix #15: show idle screen only when truly disconnected (not error state).
  const showIdleScreen =
    !debugMode && !isConnected && status === "disconnected";

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <VideoCallLayout
      isChatOpen={isChatOpen}
      chatPanel={
        <ChatPanel
          messages={chat.messages}
          onSendText={handleSendText}
          isConnected={isConnected}
          isTyping={chat.isTyping}
          onCollapse={() => setIsChatOpen(false)}
          selectedSkinId={selectedSkin?.id ?? null}
          onSkinChange={setSelectedSkin}
          debugMode={debugMode}
        />
      }
    >
      {/* 3D Scene — always mounted so the audio context survives errors */}
      <div
        className="absolute inset-0 scan-line z-0"
        data-persona-mode={personaMode}
      >
        <Scene
          audioLevelRef={assistantAudioLevelRef}
          currentExpression={currentExpression}
          skinPreset={selectedSkin}
          isConnected={isConnected}
          debug={debugMode}
        />
      </div>

      {/* Floating header */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 px-3 py-3 sm:px-6 sm:py-4">
        <div className="pointer-events-auto inline-block">
          <CallHeader status={status} sessionTime={timer.formatted} />
        </div>
      </div>

      {/* PiP webcam */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3 }}
        className="absolute right-4 top-4 z-10 h-32 w-24 overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-black/50 sm:right-6 sm:top-6 sm:h-48 sm:w-36 sm:rounded-2xl"
      >
        <WebcamFeed
          videoRef={videoRef}
          isActive={isCameraActive}
          facingMode={facingMode}
        />
      </motion.div>

      {/* Debug toggle */}
      <DebugToggle debugMode={debugMode} setDebugMode={setDebugMode} />

      {/* Waveform overlay */}
      <div className="pointer-events-none absolute bottom-24 left-4 z-10 sm:left-6">
        <PersonaOverlay
          audioLevelRef={assistantAudioLevelRef}
          isConnected={isConnected}
        />
      </div>

      {/* Fix #4: inline error banner — does not destroy the component tree */}
      <AnimatePresence>
        {visibleError && (
          <ErrorBanner
            message={visibleError}
            onDismiss={() => setDismissedError(visibleError)}
          />
        )}
      </AnimatePresence>

      {/* Fix #15: idle screen only when genuinely disconnected */}
      <AnimatePresence>
        {showIdleScreen && <IdleScreen onStart={toggleSession} />}
      </AnimatePresence>

      {/* Floating controls */}
      <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-10 flex justify-center sm:bottom-8">
        <div className="pointer-events-auto">
          <CallControls
            isConnected={isConnected}
            isMicActive={isMicActive}
            isCameraActive={isCameraActive}
            isChatOpen={isChatOpen}
            onToggleConnection={toggleSession}
            onToggleMic={toggleMic}
            onToggleCamera={toggleCamera}
            onToggleChat={() => setIsChatOpen((prev) => !prev)}
            onSwitchCamera={switchCamera}
          />
        </div>
      </div>
    </VideoCallLayout>
  );
}

// ─── Root export (Fix #10) ────────────────────────────────────────────────────
// SceneConfigProvider sits OUTSIDE the ErrorBoundary so config context
// survives error recovery — the boundary can re-render its children
// (HomePage) without losing the provider.

export default function Home() {
  return (
    <SceneConfigProvider>
      <ErrorBoundary>
        <HomePage />
      </ErrorBoundary>
    </SceneConfigProvider>
  );
}