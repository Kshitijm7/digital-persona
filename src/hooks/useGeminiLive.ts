"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GoogleGenAI,
  Modality,
  MediaResolution,
  type Session,
  type LiveServerMessage,
} from "@google/genai";
import {
  GEMINI_MODEL,
  GEMINI_TOOLS,
  GEMINI_TOOLS_NO_SEARCH,
  SYSTEM_PROMPT,
} from "@/lib/constants";
import {
  getSessionConfig,
  getModeConfig,
  degradeMode,
  isRetryableCloseCode,
  // shouldDegradeOnCloseCode is used in Wave 1 (1011 degradation logic)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shouldDegradeOnCloseCode,
  type GeminiSessionMode,
} from "@/lib/gemini-session-config";
import { createLogger } from "@/lib/logging/logger";
import { useSceneConfig } from "@/hooks/SceneConfigContext";
import { useAvatarRuntimeStore } from "@/store/useAvatarRuntimeStore";

const log = createLogger("useGeminiLive");

// ── Session config (driven by gemini-session.json) ────────────────────────────
const SESSION_CFG = getSessionConfig();
const TOOL_HANDLER_TIMEOUT_MS = SESSION_CFG.toolResponse.handlerTimeoutMs;
const DUPLICATE_AUDIO_WINDOW_MS = SESSION_CFG.deduplication.audioDuplicateWindowMs;
const AUDIO_SIGNATURE_TTL_MS = SESSION_CFG.deduplication.audioSignatureTtlMs;
const TEXT_DEDUP_WINDOW_MS = SESSION_CFG.deduplication.textDedupWindowMs;
const AUDIO_CHUNK_LOG_INTERVAL = SESSION_CFG.deduplication.audioChunkLogInterval;
const DUPLICATE_AUDIO_LOG_INTERVAL = SESSION_CFG.deduplication.duplicateAudioLogInterval;
const PREFETCH_TOKEN_MAX_AGE_MS = SESSION_CFG.stability.tokenPrefetchMaxAgeMs;
/** How often (ms) to run the audio-signature TTL sweep — keeps the hot path O(1). */
const AUDIO_SIGNATURE_SWEEP_INTERVAL_MS = SESSION_CFG.deduplication.audioSignatureSweepIntervalMs;

export type GeminiStatus = "disconnected" | "connecting" | "connected" | "error";
type LiveCompatibilityProfile = GeminiSessionMode;

export interface ToolCallPayload {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface UseGeminiLiveReturn {
  status: GeminiStatus;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  sendVideoFrame: (base64: string) => void;
  sendAudioChunk: (base64: string) => void;
  /** Signal Gemini that the audio stream has paused (mic muted/stopped). Flushes VAD buffer. */
  sendAudioStreamEnd: () => void;
  sendText: (text: string) => void;
  registerTool: (name: string, handler: ToolHandler) => void;
  onAudioData: React.RefObject<((b64: string) => void) | null>;
  onToolCall: React.RefObject<((tc: ToolCallPayload) => void) | null>;
  onTranscript: React.RefObject<((text: string) => void) | null>;
  onUserTranscript: React.RefObject<((text: string) => void) | null>;
  onInterrupted: React.RefObject<(() => void) | null>;
  onTurnComplete: React.RefObject<(() => void) | null>;
  onToolCallCancellation: React.RefObject<((ids: string[]) => void) | null>;
  lastSessionHandle: React.RefObject<string | null>;
  lastCloseCode: React.RefObject<number | null>;
  errorMessage: string | null;
}

export function useGeminiLive(): UseGeminiLiveReturn {
  const { config } = useSceneConfig();
  const clearSessionOverrides = useAvatarRuntimeStore(
    (s) => s.clearSessionOverrides
  );
  const decaySessionOverrides = useAvatarRuntimeStore(
    (s) => s.decaySessionOverrides
  );

  // ── Stable refs that never trigger re-renders ──────────────────────────────
  const sessionRef = useRef<Session | null>(null);
  const statusRef = useRef<GeminiStatus>("disconnected");
  const clientRef = useRef<GoogleGenAI | null>(null);
  const connectionCounterRef = useRef(0);
  const activeConnectionIdRef = useRef<number | null>(null);
  const toolRegistryRef = useRef<Map<string, ToolHandler>>(new Map());
  const sessionHandleRef = useRef<string | null>(null);
  const warmTokenRef = useRef<{ token: string; fetchedAt: number } | null>(null);
  const tokenPrefetchPromiseRef = useRef<Promise<void> | null>(null);
  const recentAudioSignaturesRef = useRef<Map<string, number>>(new Map());
  const audioSweepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const forwardedAudioChunkCountRef = useRef(0);
  const droppedAudioChunkCountRef = useRef(0);
  const lastTextPayloadRef = useRef<{ text: string; sentAt: number } | null>(null);
  // Profile starts at 'full' and degrades only on 1008 close codes.
  const compatibilityProfileRef = useRef<LiveCompatibilityProfile>("full");
  // Tracks whether the last disconnect was a retryable server error.
  const lastCloseCodeRef = useRef<number | null>(null);
  // Fix M1: resolver called by onopen/onerror to unblock connect()'s caller
  const pendingOpenResolverRef = useRef<((opened: boolean) => void) | null>(null);

  // Callback refs — wired by useSessionManager
  const onAudioData = useRef<((b64: string) => void) | null>(null);
  const onToolCall = useRef<((tc: ToolCallPayload) => void) | null>(null);
  const onTranscript = useRef<((text: string) => void) | null>(null);
  const onUserTranscript = useRef<((text: string) => void) | null>(null);
  const onInterrupted = useRef<(() => void) | null>(null);
  const onTurnComplete = useRef<(() => void) | null>(null);
  const onToolCallCancellation = useRef<((ids: string[]) => void) | null>(null);

  // Config snapshot ref — avoids stale system prompt (Fix #8)
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const clearSessionOverridesRef = useRef(clearSessionOverrides);
  useEffect(() => {
    clearSessionOverridesRef.current = clearSessionOverrides;
  }, [clearSessionOverrides]);

  const decaySessionOverridesRef = useRef(decaySessionOverrides);
  useEffect(() => {
    decaySessionOverridesRef.current = decaySessionOverrides;
  }, [decaySessionOverrides]);

  const [status, setStatus] = useState<GeminiStatus>("disconnected");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Audio signature sweep (Fix #6) ────────────────────────────────────────
  // Runs on an interval outside the hot audio path so the per-chunk cost is O(1).
  const startAudioSweep = useCallback(() => {
    if (audioSweepTimerRef.current) return;
    audioSweepTimerRef.current = setInterval(() => {
      const now = performance.now();
      for (const [sig, seenAt] of recentAudioSignaturesRef.current) {
        if (now - seenAt > AUDIO_SIGNATURE_TTL_MS) {
          recentAudioSignaturesRef.current.delete(sig);
        }
      }
    }, AUDIO_SIGNATURE_SWEEP_INTERVAL_MS);
  }, []);

  const stopAudioSweep = useCallback(() => {
    if (audioSweepTimerRef.current) {
      clearInterval(audioSweepTimerRef.current);
      audioSweepTimerRef.current = null;
    }
  }, []);

  // ── Token helpers ──────────────────────────────────────────────────────────
  const fetchToken = useCallback(async (): Promise<string> => {
    const res = await fetch("/api/token", { method: "POST" });
    if (!res.ok) throw new Error("Failed to fetch ephemeral token");
    const { token, error } = await res.json();
    if (error) throw new Error(error);
    return token as string;
  }, []);

  const prefetchToken = useCallback(
    async (force = false): Promise<void> => {
      const now = Date.now();
      const cached = warmTokenRef.current;
      if (
        !force &&
        cached &&
        now - cached.fetchedAt < PREFETCH_TOKEN_MAX_AGE_MS
      ) {
        return;
      }

      // Deduplicate concurrent prefetch calls
      if (tokenPrefetchPromiseRef.current) {
        return tokenPrefetchPromiseRef.current;
      }

      tokenPrefetchPromiseRef.current = (async () => {
        try {
          const token = await fetchToken();
          warmTokenRef.current = { token, fetchedAt: Date.now() };
          log.debug("Prefetched Gemini ephemeral token.");
        } catch (err) {
          log.debug(
            { err },
            "Token prefetch failed; will fetch on demand at connect time."
          );
        } finally {
          tokenPrefetchPromiseRef.current = null;
        }
      })();

      return tokenPrefetchPromiseRef.current;
    },
    [fetchToken]
  );

  // ── Tool registry ──────────────────────────────────────────────────────────
  const registerTool = useCallback((name: string, handler: ToolHandler) => {
    toolRegistryRef.current.set(name, handler);
    log.debug({ toolName: name }, "Registered tool handler.");
  }, []);

  // ── Compatibility profile ──────────────────────────────────────────────────
  const downgradeCompatibilityProfile =
    useCallback((): LiveCompatibilityProfile | null => {
      const current = compatibilityProfileRef.current;
      const next = degradeMode(current);
      if (next) {
        compatibilityProfileRef.current = next;
        log.warn(
          { previousProfile: current, nextProfile: next },
          "Downgraded Live compatibility profile."
        );
      }
      return next;
    }, []);

  // ── Session tear-down (Fix #1, #2) ────────────────────────────────────────
  // `disconnect` is now dep-free (uses refs only) so it never causes
  // `connect` to recreate.
  const disconnect = useCallback(() => {
    const connectionId = activeConnectionIdRef.current;

    stopAudioSweep();

    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch {
        // Already closed — safe to ignore
      }
      sessionRef.current = null;          // Fix #2: always clear the ref
    }

    activeConnectionIdRef.current = null;
    recentAudioSignaturesRef.current.clear();
    forwardedAudioChunkCountRef.current = 0;
    droppedAudioChunkCountRef.current = 0;
    lastTextPayloadRef.current = null;

    statusRef.current = "disconnected";
    setStatus("disconnected");
    setErrorMessage(null);
    clearSessionOverridesRef.current();

    log.info({ connectionId }, "Gemini Live disconnected.");
  }, [stopAudioSweep]);

  // ── Session establishment ──────────────────────────────────────────────────
  const connect = useCallback(async (): Promise<boolean> => {
    // Tear down any existing session cleanly (Fix #1: no circular dep)
    if (sessionRef.current || activeConnectionIdRef.current !== null) {
      log.warn(
        "Existing Gemini session found during connect; closing previous session first."
      );
      disconnect();
    }

    const connectionId = ++connectionCounterRef.current;
    activeConnectionIdRef.current = connectionId;

    statusRef.current = "connecting";
    setStatus("connecting");
    setErrorMessage(null);
    recentAudioSignaturesRef.current.clear();
    forwardedAudioChunkCountRef.current = 0;
    droppedAudioChunkCountRef.current = 0;
    lastTextPayloadRef.current = null;

    const cfg = configRef.current; // Fix #8: always read latest config

    log.info(
      {
        connectionId,
        compatibilityProfile: compatibilityProfileRef.current,
        googleSearchEnabled: cfg.features.googleSearch,
        proactiveAudioEnabled: cfg.features.proactiveAudio,
      },
      "Connecting Gemini Live session."
    );

    // ── Token acquisition (Fix #5) ───────────────────────────────────────
    let token: string;
    try {
      // If a prefetch is in-flight, await it first so we don't double-fetch
      if (tokenPrefetchPromiseRef.current) {
        await tokenPrefetchPromiseRef.current;
      }

      const cached = warmTokenRef.current;
      const now = Date.now();
      if (cached && now - cached.fetchedAt < PREFETCH_TOKEN_MAX_AGE_MS) {
        token = cached.token;
        warmTokenRef.current = null;
        // Immediately kick off the next prefetch in the background
        void prefetchToken(true);
      } else {
        token = await fetchToken();
        void prefetchToken(true);
      }
    } catch (err) {
      log.error({ err, connectionId }, "Authentication failed during token fetch.");
      setErrorMessage(
        `Authentication failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      statusRef.current = "error";
      setStatus("error");
      activeConnectionIdRef.current = null;
      return false;
    }

    clientRef.current = new GoogleGenAI({
      apiKey: token,
      httpOptions: { apiVersion: "v1alpha" },
    });

    // ── Register built-in Hybrid Search Handler (Commented for Cost Savings) ──
    /*
    // Usecase for future:
    // This hybrid handler triggers a background generateContent call for Google Search.
    // It is more stable if the Live API struggles with native googleSearch routing,
    // but consumes 2x credits (Live Session tokens + Background REST tokens).
    // Re-enable this and uncomment `WEB_SEARCH_TOOL` in constants.ts if the 
    // native search starts freezing the avatar again.
    toolRegistryRef.current.set("perform_web_search", async (args: Record<string, unknown>) => {
      const query = args.query as string;
      log.info({ query }, "Executing hybrid web search in background...");
      
      if (!clientRef.current) return { result: "Search unavailable, client offline." };
      
      try {
        const result = await clientRef.current.models.generateContent({
          model: "gemini-2.5-flash", 
          contents: [{ role: 'user', parts: [{ text: query }] }],
          config: { tools: [{ googleSearch: {} }] }
        });
        return { search_results: result.text || "No results found." };
      } catch (e) {
        log.error({ err: e }, "Hybrid search generateContent failed");
        return { error: "Search failed." };
      }
    });
    */

    // ── Message handler ──────────────────────────────────────────────────
    const handleMessage = (message: LiveServerMessage) => {
      try {
        // Discard messages from superseded connections
        if (activeConnectionIdRef.current !== connectionId) return;

        if (message.setupComplete) {
          log.debug({ connectionId }, "Setup complete.");
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resumption = (message as any).sessionResumptionUpdate;
        if (resumption?.handle) {
          sessionHandleRef.current = resumption.handle as string;
          log.info(
            { connectionId, handle: resumption.handle },
            "Session resumption handle updated."
          );
        }

        if (message.toolCallCancellation) {
          const cancelledIds = message.toolCallCancellation.ids ?? [];
          log.debug({ connectionId, cancelledIds }, "Tool calls cancelled.");
          onToolCallCancellation.current?.(cancelledIds);
          return;
        }

        if (message.serverContent) {
          const { serverContent } = message;

          if (serverContent.interrupted) {
            log.debug(
              { connectionId },
              "Interrupted by user speech; stopping playback."
            );
            onInterrupted.current?.();
            return;
          }

          if (serverContent.turnComplete) {
            log.info(
              {
                connectionId,
                forwardedAudioChunks: forwardedAudioChunkCountRef.current,
                droppedAudioDuplicates: droppedAudioChunkCountRef.current,
              },
              "Turn complete."
            );
            decaySessionOverridesRef.current();
            onTurnComplete.current?.();
          }

          if (serverContent.outputTranscription?.text) {
            onUserTranscript.current?.(serverContent.outputTranscription.text);
          }

          const parts = serverContent.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.inlineData?.mimeType?.startsWith("audio/")) {
                const audioData = part.inlineData.data as string;
                const now = performance.now();

                // Dedup check — O(1) lookup, sweep handled off the hot path
                const signature = `${audioData.length}:${audioData.slice(0, 48)}:${audioData.slice(-48)}`;
                const seenAt = recentAudioSignaturesRef.current.get(signature);

                if (
                  seenAt !== undefined &&
                  now - seenAt < DUPLICATE_AUDIO_WINDOW_MS
                ) {
                  droppedAudioChunkCountRef.current += 1;
                  if (
                    droppedAudioChunkCountRef.current === 1 ||
                    droppedAudioChunkCountRef.current %
                      DUPLICATE_AUDIO_LOG_INTERVAL ===
                      0
                  ) {
                    log.debug(
                      {
                        connectionId,
                        droppedAudioDuplicates:
                          droppedAudioChunkCountRef.current,
                      },
                      "Skipping duplicate audio chunk."
                    );
                  }
                  continue;
                }

                recentAudioSignaturesRef.current.set(signature, now);

                forwardedAudioChunkCountRef.current += 1;
                if (
                  forwardedAudioChunkCountRef.current === 1 ||
                  forwardedAudioChunkCountRef.current %
                    AUDIO_CHUNK_LOG_INTERVAL ===
                    0
                ) {
                  log.debug(
                    {
                      connectionId,
                      forwardedAudioChunks: forwardedAudioChunkCountRef.current,
                      droppedAudioDuplicates:
                        droppedAudioChunkCountRef.current,
                      audioDataLength: audioData.length,
                    },
                    "Forwarding audio chunk to playback pipeline."
                  );
                }

                onAudioData.current?.(audioData);
              }

              if (part.text) {
                onTranscript.current?.(part.text);
              }
            }
          }
        }

        if (message.toolCall) {
          const calls = message.toolCall.functionCalls;
          if (!calls?.length) return;

          for (const call of calls) {
            const callName = call.name ?? "";
            const callArgs = (call.args ?? {}) as Record<string, unknown>;
            const callId = call.id ?? "";

            log.debug({ connectionId, callName, callId }, "Tool call received.");
            onToolCall.current?.({ name: callName, args: callArgs, id: callId });

            // Capture the session at dispatch time (Fix #3)
            const sessionAtDispatch = sessionRef.current;

            void (async () => {
              const handlerStart = performance.now();
              let result: Record<string, unknown>;

              const handler = toolRegistryRef.current.get(callName);

              if (handler) {
                log.debug(
                  { connectionId, callName, callId },
                  "Tool handler execution started."
                );
                try {
                  result = await Promise.race([
                    Promise.resolve(handler(callArgs)),
                    new Promise<never>((_, reject) =>
                      setTimeout(
                        () =>
                          reject(
                            new Error(
                              `Tool handler "${callName}" timed out after ${TOOL_HANDLER_TIMEOUT_MS}ms`
                            )
                          ),
                        TOOL_HANDLER_TIMEOUT_MS
                      )
                    ),
                  ]);
                  log.debug(
                    {
                      connectionId,
                      callName,
                      callId,
                      durationMs: Math.round(performance.now() - handlerStart),
                    },
                    "Tool handler execution completed."
                  );
                } catch (handlerErr) {
                  log.error(
                    { err: handlerErr, connectionId, toolName: callName, callId },
                    "Handler for tool threw an error."
                  );
                  result = {
                    error: `Handler failed: ${
                      handlerErr instanceof Error
                        ? handlerErr.message
                        : String(handlerErr)
                    }`,
                  };
                }
              } else {
                log.warn(
                  { connectionId, toolName: callName, callId },
                  "No handler registered for tool. Returning { result: 'ok' } as fallback."
                );
                result = { result: "ok" };
              }

              // Fix #3 + #4: verify the session we captured is still the active
              // one AND that the WebSocket is still open before sending.
              const isSessionStale =
                activeConnectionIdRef.current !== connectionId ||
                sessionRef.current !== sessionAtDispatch ||
                !sessionRef.current;

              if (isSessionStale) {
                log.warn(
                  { connectionId, callName, callId },
                  "Skipping tool response — session is stale or has been replaced."
                );
                return;
              }

              try {
                const toolResponsePayload = {
                  functionResponses: [
                    { id: callId, name: callName, response: result },
                  ],
                  // Silent scheduling — controlled by gemini-session.json
                  ...(SESSION_CFG.toolResponse.silentScheduling
                    ? { scheduling: "SILENT" }
                    : {}),
                } as unknown as Parameters<Session["sendToolResponse"]>[0];
                sessionRef.current!.sendToolResponse(toolResponsePayload);

                log.debug(
                  {
                    connectionId,
                    callName,
                    callId,
                    durationMs: Math.round(performance.now() - handlerStart),
                  },
                  "Tool response sent."
                );
              } catch (sendErr) {
                // Fix #4: gracefully handle CLOSING/CLOSED WebSocket state
                log.warn(
                  { err: sendErr, connectionId, callName, callId },
                  "Failed to send tool response — WebSocket may already be closed."
                );
              }
            })();
          }
        }
      } catch (err) {
        log.warn({ err, connectionId }, "Failed to handle incoming message.");
      }
    };

    // ── Build session config ──────────────────────────────────────────────
    try {
      const avatarBaselineSummary = [
        `emotionState=${cfg.emotionControl.emotionState}`,
        `emotionIntensity=${cfg.emotionControl.emotionIntensity}`,
        `lookAtIK=${cfg.ocularTuning.lookAtIK}`,
        `saccadeStrength=${cfg.ocularTuning.saccadeStrength}`,
        `headMotionAccelerationLimit=${cfg.headDynamics.headMotionAccelerationLimit}`,
        `cfgScale=${cfg.aiStyleControl.cfgScale}`,
        `coarticulationWindowSize=${cfg.aiStyleControl.coarticulationWindowSize}`,
        "policy=Use subtle bounded updates; prefer incremental patches over abrupt changes.",
      ].join("\n");


      // Fix M1: wrap the session open in a Promise that resolves on onopen,
      // not just on SDK connect() returning. This ensures startMic() is only
      // called on a live, confirmed-open WebSocket.
      const sessionOpenPromise = new Promise<boolean>((resolveOpen) => {
        // Store the resolver so onopen can call it
        pendingOpenResolverRef.current = resolveOpen;
      });

      // ── Build session config from gemini-session.json + UI overrides ──────
      const currentMode = compatibilityProfileRef.current;
      const modeCfg = getModeConfig(currentMode);

      // UI-level overrides: SceneConfig.features takes precedence
      const useGoogleSearch = cfg.features.googleSearch && modeCfg.features.googleSearch;
      const useProactiveAudio = cfg.features.proactiveAudio && modeCfg.features.proactiveAudio;

      const session = await clientRef.current!.live.connect({
        model: GEMINI_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: modeCfg.audio.voiceName },
            },
          },
          systemInstruction: {
            parts: [
              {
                text: `${SYSTEM_PROMPT}\n\n# AVATAR_CONTROL_BASELINE\n${avatarBaselineSummary}`,
              },
            ],
          },
          tools: useGoogleSearch
            ? GEMINI_TOOLS
            : GEMINI_TOOLS_NO_SEARCH,
          temperature: modeCfg.generation.temperature,
          ...(modeCfg.generation.topP != null ? { topP: modeCfg.generation.topP } : {}),
          maxOutputTokens: modeCfg.generation.maxOutputTokens,
          // Thinking budget — 0 disables thinking for latency-sensitive conversations
          ...(modeCfg.thinking.thinkingBudget != null
            ? { thinkingConfig: { thinkingBudget: modeCfg.thinking.thinkingBudget } }
            : {}),
          // Media resolution — low reduces server-side vision processing
          ...(modeCfg.video.mediaResolution
            ? { mediaResolution: modeCfg.video.mediaResolution as MediaResolution }
            : {}),
          // Proactive audio — only in full mode, gated by UI override
          ...(useProactiveAudio
            ? { proactivity: { proactiveAudio: true } }
            : {}),
          // Affective dialog — only when mode enables it (v1alpha)
          ...(modeCfg.features.enableAffectiveDialog
            ? { enableAffectiveDialog: true }
            : {}),
          // Output transcription — only when mode enables it
          ...(modeCfg.features.outputAudioTranscription
            ? { outputAudioTranscription: {} }
            : {}),
          // Input transcription — always on for user transcript
          ...(modeCfg.features.inputAudioTranscription
            ? { inputAudioTranscription: {} }
            : {}),
          realtimeInputConfig: { automaticActivityDetection: {} },
          // Context window compression — configurable trigger threshold
          ...(modeCfg.features.contextWindowCompression
            ? {
                contextWindowCompression: {
                  slidingWindow: {},
                  ...(modeCfg.contextWindow.triggerTokens
                    ? { triggerTokens: String(modeCfg.contextWindow.triggerTokens) }
                    : {}),
                },
              }
            : {}),
          // Session resumption — reconnect with saved handle
          ...(sessionHandleRef.current && modeCfg.features.sessionResumption
            ? { sessionResumption: { handle: sessionHandleRef.current } }
            : {}),
        },
        callbacks: {
          onopen: () => {
            if (activeConnectionIdRef.current !== connectionId) return;
            log.info({ connectionId }, "Gemini Live connection opened.");
            startAudioSweep();
            statusRef.current = "connected";
            setStatus("connected");
            // Fix M1: resolve AFTER status is set so callers see "connected"
            pendingOpenResolverRef.current?.(true);
            pendingOpenResolverRef.current = null;
          },
          onmessage: handleMessage,
          onerror: (e: ErrorEvent) => {
            if (activeConnectionIdRef.current !== connectionId) return;
            log.error({ err: e, connectionId }, "SDK connection error.");
            setErrorMessage(
              `Connection error: ${e.message || "Check API key and network."}`
            );
            statusRef.current = "error";
            setStatus("error");
            // Reject the open promise so startSession() gets false
            pendingOpenResolverRef.current?.(false);
            pendingOpenResolverRef.current = null;
          },
          onclose: (e: CloseEvent) => {
            const isStale = activeConnectionIdRef.current !== connectionId;
            log.info(
              { connectionId, isStale, code: e.code, reason: e.reason },
              "Session closed."
            );
            if (isStale) return;

            // Fix #2: always clear the session ref when the WS closes
            sessionRef.current = null;
            stopAudioSweep();

            // Fix M1: if onopen never fired (e.g. immediate close),
            // resolve the open promise as failed
            if (pendingOpenResolverRef.current) {
              pendingOpenResolverRef.current(false);
              pendingOpenResolverRef.current = null;
            }

            if (statusRef.current === "disconnected") return;

            const unsupportedOperation =
              e.code === 1008 &&
              /not implemented|not supported|not enabled/i.test(e.reason ?? "");

            if (unsupportedOperation) {
              const downgraded = downgradeCompatibilityProfile();
              setErrorMessage(
                downgraded
                  ? `Live API feature mismatch (code 1008). Switched to ${downgraded.toUpperCase()} compatibility profile. Start session again.`
                  : "Live API feature mismatch (code 1008) persists even in minimal profile."
              );
              statusRef.current = "error";
              setStatus("error");
              return;
            }

            // Fix M2: distinguish retryable server errors (1011, 1012, 1013)
            // from clean closes (1000, 1001) so the auto-reconnect effect
            // knows whether to attempt recovery or stop.
            lastCloseCodeRef.current = e.code;
            const isRetryableServerError = isRetryableCloseCode(e.code);

            if (isRetryableServerError) {
              log.warn(
                { connectionId, code: e.code, reason: e.reason },
                "Retryable server-side close — marking as disconnected for auto-reconnect."
              );
            }

            statusRef.current = "disconnected";
            setStatus("disconnected");
          },
        },
      });

      // Race condition guard — another connect() may have fired while we awaited
      if (activeConnectionIdRef.current !== connectionId) {
        try { session.close(); } catch { /* ignore */ }
        log.warn(
          { connectionId, activeConnectionId: activeConnectionIdRef.current },
          "Connected stale session; closing immediately."
        );
        return false;
      }

      sessionRef.current = session;
      log.info({ connectionId }, "GeminiLive session established.");
      
      // Fix M1: wait for onopen before declaring success
      const opened = await sessionOpenPromise;
      if (!opened) {
        // onerror or immediate onclose fired before onopen
        log.warn({ connectionId }, "Session established but failed to open.");
        return false;
      }

      return true;
    } catch (err) {
      if (activeConnectionIdRef.current === connectionId) {
        // Fix M1: clear pending resolver on thrown error
        pendingOpenResolverRef.current?.(false);
        pendingOpenResolverRef.current = null;
        log.error({ err, connectionId }, "GeminiLive failed to connect.");
        setErrorMessage(
          `Failed to connect: ${err instanceof Error ? err.message : String(err)}`
        );
        statusRef.current = "error";
        setStatus("error");
      }
      return false;
    }
  }, [
    disconnect,
    fetchToken,
    prefetchToken,
    startAudioSweep,
    stopAudioSweep,
    downgradeCompatibilityProfile,
  ]);
  // Note: config is intentionally excluded — we use configRef for a stable dep array.
  // Config changes take effect on the NEXT connect() call.

  // ── Send helpers ───────────────────────────────────────────────────────────
  const sendVideoFrame = useCallback((base64Image: string) => {
    if (statusRef.current !== "connected" || !sessionRef.current) return;
    try {
      sessionRef.current.sendRealtimeInput({
        media: { data: base64Image, mimeType: "image/jpeg" },
      });
    } catch (e) {
      log.warn({ err: e }, "Failed to send video frame.");
    }
  }, []);

  const sendAudioChunk = useCallback((base64Audio: string) => {
    if (statusRef.current !== "connected" || !sessionRef.current) return;
    try {
      sessionRef.current.sendRealtimeInput({
        audio: {
          data: base64Audio,
          mimeType: `audio/pcm;rate=${getModeConfig(compatibilityProfileRef.current).audio.inputSampleRate}`,
        },
      });
    } catch (e) {
      log.warn({ err: e }, "Failed to send audio chunk.");
    }
  }, []);

  /**
   * Signal Gemini that the audio stream has paused (mic muted or stopped).
   * The API flushes its internal VAD buffer so the model can respond promptly.
   * Per docs: "send audioStreamEnd when the audio stream is paused for more than a second."
   */
  const sendAudioStreamEnd = useCallback(() => {
    if (statusRef.current !== "connected" || !sessionRef.current) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sessionRef.current as any).sendRealtimeInput({ audioStreamEnd: true });
      log.debug(
        { connectionId: activeConnectionIdRef.current },
        "Sent audioStreamEnd to flush VAD buffer."
      );
    } catch (e) {
      log.warn({ err: e }, "Failed to send audioStreamEnd.");
    }
  }, []);

  const sendText = useCallback((text: string) => {
    if (statusRef.current !== "connected" || !sessionRef.current) return;

    const normalized = text.trim();
    if (!normalized) return;

    const now = performance.now();
    const last = lastTextPayloadRef.current;
    if (last && last.text === normalized && now - last.sentAt < TEXT_DEDUP_WINDOW_MS) {
      log.warn(
        { textLength: normalized.length, dedupWindowMs: TEXT_DEDUP_WINDOW_MS },
        "Dropped duplicate text send within dedupe window."
      );
      return;
    }

    lastTextPayloadRef.current = { text: normalized, sentAt: now };

    try {
      sessionRef.current.sendClientContent({
        turns: [{ role: "user", parts: [{ text: normalized }] }],
        turnComplete: true,
      });
      log.info(
        {
          connectionId: activeConnectionIdRef.current,
          textLength: normalized.length,
        },
        "GeminiLive sent text payload."
      );
    } catch (e) {
      log.warn({ err: e }, "Failed to send text payload.");
    }
  }, []);

  // ── Mount / unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    void prefetchToken();
    return () => {
      stopAudioSweep();
      disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Intentionally empty — we only want mount/unmount semantics here.
  // `prefetchToken` and `disconnect` are stable (no deps that change).

  return {
    status,
    connect,
    disconnect,
    sendVideoFrame,
    sendAudioChunk,
    sendAudioStreamEnd,
    sendText,
    registerTool,
    onAudioData,
    onToolCall,
    onTranscript,
    onUserTranscript,
    onInterrupted,
    onTurnComplete,
    onToolCallCancellation,
    lastSessionHandle: sessionHandleRef,
    lastCloseCode: lastCloseCodeRef,
    errorMessage,
  };
}
