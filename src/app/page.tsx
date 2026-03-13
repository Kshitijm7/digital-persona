"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, memo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";

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
import { sanitizeAvatarControlOverrides, type AvatarControlOverrides } from "@/lib/avatar-control.types";
import { useLipSyncStore } from "@/store/useLipSyncStore";

// Scene Config
import { SceneConfigProvider } from "@/hooks/SceneConfigContext";

const log = createLogger("app/page");


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
    <div className="relative overflow-hidden rounded-3xl border border-white/6 bg-white/3 px-12 py-10 flex flex-col items-center gap-6 max-w-md backdrop-blur-xl shadow-2xl">
      {/* Glow Effect */}
      <div className="absolute top-0 right-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-cyan-400/5 blur-3xl pointer-events-none" />
      
      <div className="relative z-10 flex flex-col items-center gap-6 w-full">
        <div className="w-20 h-20 rounded-full bg-linear-to-br from-cyan-400/20 to-emerald-400/20 border border-cyan-400/20 flex items-center justify-center animate-pulse-ring shadow-xl">
          <Sparkles className="w-8 h-8 text-cyan-400" />
        </div>
        
        <div className="text-center">
          <TextShimmer 
            duration={2}
            className="text-2xl font-semibold tracking-wide mb-2 [--base-color:var(--color-cyan-500)] [--base-gradient-color:var(--color-emerald-300)] dark:[--base-color:var(--color-cyan-500)] dark:[--base-gradient-color:var(--color-emerald-300)]"
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
          className="w-full py-5 rounded-full bg-linear-to-r from-cyan-500 to-emerald-500 text-primary-foreground font-semibold text-sm tracking-wide hover:shadow-[0_0_30px_rgba(34,211,238,0.3)] hover:opacity-100 transition-all duration-500 hover:scale-105 border-0 cursor-pointer"
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
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [currentExpression, setCurrentExpression] = useState<string>("idle");
  const [personaMode, setPersonaMode] = useState<"focus" | "casual" | "presentation">("casual");
  // Skin state — default to warm ivory preset
  const [selectedSkin, setSelectedSkin] = useState<SkinPreset>(SKIN_PRESETS[0]);
  // Debug mode — enables OrbitControls + live camera panel
  const [debugMode, setDebugMode] = useState(false);
  const expressionResetTimeoutRef = useRef<number | null>(null);
  const applySessionPatch = useAvatarRuntimeStore((state) => state.applySessionPatch);
  const clearSessionOverrides = useAvatarRuntimeStore((state) => state.clearSessionOverrides);
  const updateLipSyncTuning = useLipSyncStore((state) => state.updateTuning);

  // Session management
  const {
    onTranscript: onTranscriptRef,
    onToolCall: onToolCallRef,
    registerTool,
    ...session
  } = useSessionManager();
  const timer = useSessionTimer(session.isConnected);
  const chat = useChatMessages();

  // (Animation Queue Auto-Progression moved inside useDynamicAnimations.ts for precise timing)

  // ── Register application-level tool handlers ──────────────────────────────
  // These run ONCE on mount so they are available before the first connect().

  useEffect(() => {
    log.info("Registering page-level tool handlers.");

    // trigger_animation - play a sequence of gestures on the 3D avatar
    registerTool("trigger_animation", (args) => {
      const gestures = (args.gesture_sequence as string[]) || [];
      const durationPerGesture = args.duration_per_gesture_ms as number | undefined;
      const timeScale = args.time_scale as number | undefined;
      log.info(
        {
          requestedGestures: gestures,
          durationPerGesture,
          timeScale,
        },
        "Tool override: trigger_animation",
      );

      if (gestures.length > 0) {
        const state = useAnimationStore.getState();

        // Resolve all gestures using the advanced semantic matcher.
        const resolvedSequence = gestures.map((g) => findBestAnimationMatch(g, state.registry));
        log.debug(
          {
            requested: gestures,
            resolved: resolvedSequence,
          },
          "Resolved animation gestures.",
        );

        // Dispatch to the chronological queue.
        state.playSequence(
          resolvedSequence.map((name) => ({
            name,
            durationMs: durationPerGesture,
            timeScale,
          })),
        );
      }

      return {
        acknowledged: true,
        gesture_sequence: gestures,
        duration_per_gesture_ms: durationPerGesture,
        time_scale: timeScale,
      };
    });

    // set_persona_mode - switch interaction style
    registerTool("set_persona_mode", (args) => {
      const mode = args.mode as "focus" | "casual" | "presentation";
      log.info({ mode }, "Tool override: set_persona_mode");
      setPersonaMode(mode);
      return { acknowledged: true, active_mode: mode };
    });

    // set_expression - change facial expression
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

      chat.appendAssistantMessage(displayContent);
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

    registerTool("set_avatar_controls", (args) => {
      const rawPatch = (args.patch as AvatarControlOverrides | undefined) ?? {};
      const sanitized = sanitizeAvatarControlOverrides(rawPatch);
      applySessionPatch(sanitized);
      log.info({ patchKeys: Object.keys(sanitized) }, "Tool override: set_avatar_controls");
      return { acknowledged: true, applied: sanitized };
    });

    registerTool("set_emotion_state", (args) => {
      const patch = sanitizeAvatarControlOverrides({
        emotionControl: {
          emotionState: args.emotionState as "neutral" | "joy" | "anger" | "sadness" | "surprised" | "fear" | "disgust" | undefined,
          emotionIntensity: typeof args.emotionIntensity === "number" ? args.emotionIntensity : undefined,
          textConditioning: typeof args.textConditioning === "string" ? args.textConditioning : undefined,
        },
      });
      applySessionPatch(patch);
      return { acknowledged: true, applied: patch };
    });

    registerTool("set_ocular_state", (args) => {
      const patch = sanitizeAvatarControlOverrides({
        ocularTuning: {
          saccadeStrength: typeof args.saccadeStrength === "number" ? args.saccadeStrength : undefined,
          blinkIntervalMs: typeof args.blinkIntervalMs === "number" ? args.blinkIntervalMs : undefined,
          blinkDurationMs: typeof args.blinkDurationMs === "number" ? args.blinkDurationMs : undefined,
          eyelidOpenOffset: typeof args.eyelidOpenOffset === "number" ? args.eyelidOpenOffset : undefined,
          lookAtIK: typeof args.lookAtIK === "boolean" ? args.lookAtIK : undefined,
        },
      });
      applySessionPatch(patch);
      return { acknowledged: true, applied: patch };
    });

    registerTool("set_lipsync_profile", (args) => {
      const visemeOverrides = args.visemeOverrides as AvatarControlOverrides["visemeOverrides"] | undefined;
      const aiStyleControl = args.aiStyleControl as AvatarControlOverrides["aiStyleControl"] | undefined;
      const patch = sanitizeAvatarControlOverrides({ visemeOverrides, aiStyleControl });
      applySessionPatch(patch);

      if (aiStyleControl?.coarticulationWindowSize !== undefined) {
        updateLipSyncTuning({
          anticipationWindowMs: Math.max(8, Math.min(180, aiStyleControl.coarticulationWindowSize * (1000 / 60))),
        });
      }

      return { acknowledged: true, applied: patch };
    });

    registerTool("reset_avatar_controls", () => {
      clearSessionOverrides();
      return { acknowledged: true, cleared: true };
    });
  }, [registerTool, chat, applySessionPatch, clearSessionOverrides, updateLipSyncTuning]);

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




  // Send chat text
  const handleSendText = useCallback(
    (text: string) => {
      log.info({ textLength: text.length }, "User text sent from chat panel.");
      chat.addUserMessage(text);
      session.sendText(text);
    },
    [chat, session]
  );

  // Error handling
  const anyError = session.errorMessage || session.micError || session.cameraError;
  if (anyError) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
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
      <div className="absolute top-0 left-0 right-0 z-10 px-6 py-4 pointer-events-none">
        <div className="pointer-events-auto inline-block">
          <CallHeader status={session.status} sessionTime={timer.formatted} />
        </div>
      </div>

      {/* Floating Webcam (FaceTime PiP Style) */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3 }}
        className="absolute top-6 right-6 w-36 h-48 rounded-2xl overflow-hidden shadow-2xl shadow-black/50 border border-white/10 z-10"
      >
        <WebcamFeed
          videoRef={session.videoRef}
          isActive={session.isCameraActive}
        />
      </motion.div>

      {/* Debug mode toggle — positioned below the PiP webcam */}
      <DebugToggle debugMode={debugMode} setDebugMode={setDebugMode} />

      {/* Persona overlay (Waveform) */}
      <div className="absolute bottom-24 left-6 z-10 pointer-events-none">
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
      <div className="absolute bottom-8 left-0 right-0 z-10 flex justify-center pointer-events-none">
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

