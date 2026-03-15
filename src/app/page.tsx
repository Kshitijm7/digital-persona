"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, memo, useRef } from "react";
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
import { findBestAnimationMatch } from "@/lib/animationMatcher";
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


// Scene Config
import { SceneConfigProvider } from "@/hooks/SceneConfigContext";

const log = createLogger("app/page");
const BASE_ANIMATION_MATCH_THRESHOLD = 0.25;
const SPEAKING_ANIMATION_MATCH_THRESHOLD = 0.32;
const ASSISTANT_SPEAKING_LEVEL_THRESHOLD = 0.06;


// 3D Scene (lazy, no SSR)
const Scene = dynamic(() => import("@/components/canvas/Scene"), {
  ssr: false,
  loading: () => <SceneLoader />,
});

// Loading component for 3D scene
function SceneLoader() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-zinc-500 text-sm">Loading 3D scene...</div>
    </div>
  );
}

// Memoized idle screen
const IdleScreen = memo(({ onStart }: { onStart: () => void }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.9 }}
    transition={{ duration: 0.4 }}
    className="absolute inset-0 flex flex-col items-center justify-center z-10"
  >
    <div className="relative mx-4 flex w-full max-w-md flex-col items-center gap-6 overflow-hidden rounded-3xl border border-white/6 bg-white/3 px-6 py-8 backdrop-blur-xl shadow-2xl sm:px-12 sm:py-10">
      {/* Glow Effect */}
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
            Grant camera & mic permissions for full interaction.
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

// Main component
function HomePage() {
  useAnimationRegistry(); // Fetch animation registry globally

  // UI State
  const isMobile = useMediaQuery("(max-width: 950px)");
  const [isChatOpen, setIsChatOpen] = useState(true);

  // Auto-collapse chat natively when window shrinks to mobile view
  useEffect(() => {
    if (isMobile) {
      setTimeout(() => setIsChatOpen(false), 0);
    } else {
      setTimeout(() => setIsChatOpen(true), 0);
    }
  }, [isMobile]);

  const [currentExpression, setCurrentExpression] = useState<string>("idle");
  const [personaMode, setPersonaMode] = useState<"focus" | "casual" | "presentation">("casual");
  // Skin state — default to warm ivory preset
  const [selectedSkin, setSelectedSkin] = useState<SkinPreset>(SKIN_PRESETS[0]);
  // Debug mode — enables OrbitControls + live camera panel
  const [debugMode, setDebugMode] = useState(false);
  const chat = useChatMessages();
  const appendAssistantMessage = chat.appendAssistantMessage;
  const addUserMessage = chat.addUserMessage;
  const expressionResetTimeoutRef = useRef<number | null>(null);
  const lastTranscriptChunkRef = useRef<{ text: string; at: number } | null>(null);
  const chatMessagesRef = useRef(chat.messages);
  const applySessionPatch = useAvatarRuntimeStore((state) => state.applySessionPatch);
  const clearSessionOverrides = useAvatarRuntimeStore((state) => state.clearSessionOverrides);


  useEffect(() => {
    chatMessagesRef.current = chat.messages;
  }, [chat.messages]);

  // Session management
  const {
    onTranscript: onTranscriptRef,
    onUserTranscript: onUserTranscriptRef,
    onToolCall: onToolCallRef,
    registerTool,
    ...session
  } = useSessionManager();
  const timer = useSessionTimer(session.isConnected);

  // (Animation Queue Auto-Progression moved inside useDynamicAnimations.ts for precise timing)

  // ── Register application-level tool handlers ──────────────────────────────
  // These run ONCE on mount so they are available before the first connect().

  useEffect(() => {
    log.info("Registering page-level tool handlers.");

    // trigger_animation - play enum-locked animation on the 3D avatar
    registerTool("trigger_animation", (args) => {
      const baseAnimation = args.base_animation as string;
      const intensity = (args.intensity as number | undefined) ?? 1.0;
      const assistantSpeakingLevel = session.assistantAudioLevelRef.current ?? 0;
      const isSpeaking = assistantSpeakingLevel >= ASSISTANT_SPEAKING_LEVEL_THRESHOLD;
      const minScore = isSpeaking
        ? SPEAKING_ANIMATION_MATCH_THRESHOLD
        : BASE_ANIMATION_MATCH_THRESHOLD;
      const disallowTypes = (isSpeaking || personaMode === "focus") ? ["dance", "misc"] : [];
      const emotionState = useEmotionStore.getState();
      const recentMessages = chatMessagesRef.current.slice(-4).map((message) => message.content);
      const contextTexts = [
        emotionState.textBuffer,
        ...recentMessages,
      ].filter((text): text is string => Boolean(text && text.trim()));
      log.info(
        {
          baseAnimation,
          intensity,
          isSpeaking,
          assistantSpeakingLevel,
          minScore,
          disallowTypes,
          sentimentScore: emotionState.currentScore,
          contextCount: contextTexts.length,
        },
        "Tool override: trigger_animation",
      );

      if (baseAnimation) {
        const state = useAnimationStore.getState();

        // Resolve the single animation using the semantic matcher.
        const resolved = findBestAnimationMatch(baseAnimation, state.registry, {
          minScore,
          disallowTypes,
          allowCategoryFallback: !isSpeaking,
          contextTexts,
          sentimentScore: emotionState.currentScore,
        });
        log.debug(
          {
            requested: baseAnimation,
            resolved,
          },
          "Resolved animation gesture.",
        );

        if (resolved !== "idle") {
          state.playSequence([
            {
              name: resolved,
              timeScale: intensity,
            },
          ]);
        } else {
          log.info(
            {
              baseAnimation,
              resolved,
              minScore,
              isSpeaking,
            },
            "Skipped trigger_animation: animation did not meet relevance threshold.",
          );
        }
      }

      return {
        acknowledged: true,
        base_animation: baseAnimation,
        intensity,
      };
    });

    // set_expression - change facial expression (transient ARKit blendshape)
    registerTool("set_expression", (args) => {
      const expr = args.expression as string;
      if (expr) {
        if (expressionResetTimeoutRef.current) {
          clearTimeout(expressionResetTimeoutRef.current);
          expressionResetTimeoutRef.current = null;
          log.debug("Cleared previous expression reset timer.");
        }

        log.info({ expression: expr }, "Tool override: set_expression");
        setCurrentExpression(expr);

        // Automatically fade out expression after 4 seconds.
        expressionResetTimeoutRef.current = window.setTimeout(() => {
          setCurrentExpression("idle");
          expressionResetTimeoutRef.current = null;
          log.info("Expression override reset to idle.");
        }, 4000);
      }
      return { acknowledged: true, expression: expr };
    });

    // display_text - push content into the chat panel as an assistant message
    registerTool("display_text", (args) => {
      const content = args.content as string;
      const format = (args.format as string) ?? "plain";
      const lang = (args.language as string | undefined) ?? "";

      // Wrap code blocks for markdown rendering.
      const displayContent =
        format === "code" && lang
          ? `\`\`\`${lang}\n${content}\n\`\`\``
          : format === "code"
            ? `\`\`\`\n${content}\n\`\`\``
            : content;

      appendAssistantMessage(displayContent);
      log.info(
        {
          contentLength: content.length,
          format,
          language: lang || null,
        },
        "Tool override: display_text",
      );
      return { acknowledged: true, characters_displayed: content.length };
    });

    // update_persona_state - unified avatar state control (replaces set_persona_mode,
    // set_emotion_state, set_ocular_state, set_avatar_controls, set_lipsync_profile,
    // and reset_avatar_controls)
    registerTool("update_persona_state", (args) => {
      const applied: Record<string, unknown> = {};

      // Mode update
      const mode = args.mode as "focus" | "casual" | "presentation" | undefined;
      if (mode) {
        setPersonaMode(mode);
        applied.mode = mode;
      }

      // Emotion + Ocular updates via a single sanitized patch
      const emotionState = args.emotionState as string | undefined;
      const emotionIntensity = typeof args.emotionIntensity === "number" ? args.emotionIntensity : undefined;
      const lookAtIK = typeof args.lookAtIK === "boolean" ? args.lookAtIK : undefined;
      const saccadeStrength = typeof args.saccadeStrength === "number" ? args.saccadeStrength : undefined;

      const hasEmotionFields = emotionState !== undefined || emotionIntensity !== undefined;
      const hasOcularFields = lookAtIK !== undefined || saccadeStrength !== undefined;

      if (hasEmotionFields || hasOcularFields) {
        const patch = sanitizeControlPatch({
          ...(hasEmotionFields
            ? {
                emotionControl: {
                  emotionState: emotionState as "neutral" | "joy" | "anger" | "sadness" | "surprised" | "fear" | "disgust" | undefined,
                  emotionIntensity,
                },
              }
            : {}),
          ...(hasOcularFields
            ? {
                ocularTuning: {
                  lookAtIK,
                  saccadeStrength,
                },
              }
            : {}),
        });
        applySessionPatch(patch);
        applied.patch = patch;
      }

      log.info({ applied }, "Tool override: update_persona_state");
      return { acknowledged: true, applied };
    });
  }, [registerTool, appendAssistantMessage, applySessionPatch, clearSessionOverrides, personaMode, session.assistantAudioLevelRef]);

  useEffect(() => {
    if (session.status === "disconnected" || session.status === "error") {
      clearSessionOverrides();
    }
  }, [session.status, clearSessionOverrides]);

  useEffect(() => {
    onToolCallRef.current = ({ name, id, args }) => {
      log.debug(
        {
          toolName: name,
          callId: id ?? null,
          argKeys: Object.keys(args ?? {}),
        },
        "Tool call surfaced to page.",
      );
    };
    return () => {
      onToolCallRef.current = null;
    };
  }, [onToolCallRef]);

  // Wire up transcript handler
  useEffect(() => {
    onTranscriptRef.current = (text) => {
      const normalized = text.trim();
      if (!normalized) return;

      const now = Date.now();
      const previous = lastTranscriptChunkRef.current;
      if (previous && previous.text === normalized && now - previous.at < 2500) {
        log.debug({ chunkLength: text.length }, "Dropped duplicate transcript chunk.");
        return;
      }

      lastTranscriptChunkRef.current = { text: normalized, at: now };

      log.debug({ chunkLength: text.length }, "Transcript chunk received.");
      chat.appendAssistantMessage(text);
      if (text.trim()) {
        useEmotionStore.getState().analyzeText(text);
      }
    };
    return () => {
      onTranscriptRef.current = null;
    };
  }, [onTranscriptRef, chat]);

  useEffect(() => {
    return () => {
      if (expressionResetTimeoutRef.current) {
        clearTimeout(expressionResetTimeoutRef.current);
        expressionResetTimeoutRef.current = null;
      }
    };
  }, []);



  // Handle User Voice Transcripts
  useEffect(() => {
    onUserTranscriptRef.current = (text: string) => {
      const normalized = text.trim();
      if (!normalized) return;

      log.debug({ length: normalized.length }, "User transcript received in UI.");
      addUserMessage(normalized);
    };
    return () => {
      onUserTranscriptRef.current = null;
    };
  }, [onUserTranscriptRef, addUserMessage]);

  // Send chat text
  const handleSendText = useCallback(
    (text: string) => {
      log.info({ textLength: text.length }, "User text sent from chat panel.");
      addUserMessage(text);
      session.sendText(text);
    },
    [addUserMessage, session]
  );

  // Error handling
  const anyError = session.errorMessage || session.micError || session.cameraError;
  if (anyError) {
    return (
      <div className="min-h-dvh bg-zinc-950 flex items-center justify-center p-4">
        <div className="glass rounded-2xl p-8 max-w-md w-full">
          <h2 className="text-xl font-semibold mb-4 text-red-500">
            Connection Error
          </h2>
          <p className="text-sm text-muted-foreground mb-4">{anyError instanceof Error ? anyError.message : String(anyError)}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full px-4 py-2 bg-cyan-500 text-primary-foreground rounded-lg font-medium hover:bg-cyan-400 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <VideoCallLayout
      isChatOpen={isChatOpen}
      chatPanel={
        <ChatPanel
          messages={chat.messages}
          onSendText={handleSendText}
          isConnected={session.isConnected}
          isTyping={chat.isTyping}
          onCollapse={() => setIsChatOpen(false)}
          selectedSkinId={selectedSkin?.id ?? null}
          onSkinChange={setSelectedSkin}
          debugMode={debugMode}
        />
      }
    >
      <div className="absolute inset-0 scan-line z-0" data-persona-mode={personaMode}>
          <Scene
            audioLevelRef={session.assistantAudioLevelRef}
            currentExpression={currentExpression}
            skinPreset={selectedSkin}
            isConnected={session.isConnected}
            debug={debugMode}
          />
      </div>

      {/* Floating Header */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 px-3 py-3 sm:px-6 sm:py-4">
        <div className="pointer-events-auto inline-block">
          <CallHeader status={session.status} sessionTime={timer.formatted} />
        </div>
      </div>

      {/* Floating Webcam (FaceTime PiP Style) */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3 }}
        className="absolute right-4 top-4 z-10 h-32 w-24 overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-black/50 sm:right-6 sm:top-6 sm:h-48 sm:w-36 sm:rounded-2xl"
      >
        <WebcamFeed
          videoRef={session.videoRef}
          isActive={session.isCameraActive}
        />
      </motion.div>

      {/* Debug mode toggle — positioned below the PiP webcam */}
      <DebugToggle debugMode={debugMode} setDebugMode={setDebugMode} />

      {/* Persona overlay (Waveform) */}
      <div className="pointer-events-none absolute bottom-24 left-4 z-10 sm:left-6">
        <PersonaOverlay
          audioLevelRef={session.assistantAudioLevelRef}
          isConnected={session.isConnected}
        />
      </div>

      {/* Idle Screen — hidden when config/debug mode is active */}
      <AnimatePresence>
        {!debugMode && !session.isConnected && session.status !== "connecting" && (
          <IdleScreen onStart={session.toggleSession} />
        )}
      </AnimatePresence>

      {/* Floating Bottom Controls */}
      <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-10 flex justify-center sm:bottom-8">
        <div className="pointer-events-auto">
          <CallControls
            isConnected={session.isConnected}
            isMicActive={session.isMicActive}
            isCameraActive={session.isCameraActive}
            isChatOpen={isChatOpen}
            onToggleConnection={session.toggleSession}
            onToggleMic={session.toggleMic}
            onToggleCamera={session.toggleCamera}
            onToggleChat={() => setIsChatOpen(!isChatOpen)}
          />
        </div>
      </div>
    </VideoCallLayout>
  );
}


// Export with error boundary
export default function Home() {
  return (
    <ErrorBoundary>
      <SceneConfigProvider>
        <HomePage />
      </SceneConfigProvider>
    </ErrorBoundary>
  );
}

