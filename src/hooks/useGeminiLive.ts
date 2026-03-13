"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GoogleGenAI,
  Modality,
  type Session,
  type LiveServerMessage,
} from "@google/genai";
import { GEMINI_MODEL, GEMINI_TOOLS, SYSTEM_PROMPT } from "@/lib/constants";
import { createLogger } from "@/lib/logging/logger";
import { useSceneConfig } from "@/hooks/SceneConfigContext";
import { useAvatarRuntimeStore } from "@/store/useAvatarRuntimeStore";

const log = createLogger("useGeminiLive");

/** Maximum time (ms) to wait for a tool handler before returning a timeout error. */
const TOOL_HANDLER_TIMEOUT_MS = 10_000;
const DUPLICATE_AUDIO_WINDOW_MS = 2500;
const AUDIO_SIGNATURE_TTL_MS = 10_000;

export type GeminiStatus = "disconnected" | "connecting" | "connected" | "error";

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
  connect: () => void;
  disconnect: () => void;
  sendVideoFrame: (base64: string) => void;
  sendAudioChunk: (base64: string) => void;
  sendText: (text: string) => void;
  registerTool: (name: string, handler: ToolHandler) => void;
  onAudioData: React.RefObject<((b64: string) => void) | null>;
  onToolCall: React.RefObject<((tc: ToolCallPayload) => void) | null>;
  onTranscript: React.RefObject<((text: string) => void) | null>;
  onInterrupted: React.RefObject<(() => void) | null>;
  onTurnComplete: React.RefObject<(() => void) | null>;
  onToolCallCancellation: React.RefObject<((ids: string[]) => void) | null>;
  lastSessionHandle: React.RefObject<string | null>;
  errorMessage: string | null;
}

export function useGeminiLive(): UseGeminiLiveReturn {
  const { config } = useSceneConfig();
  const clearSessionOverrides = useAvatarRuntimeStore((state) => state.clearSessionOverrides);
  const decaySessionOverrides = useAvatarRuntimeStore((state) => state.decaySessionOverrides);
  const sessionRef = useRef<Session | null>(null);
  const [status, setStatus] = useState<GeminiStatus>("disconnected");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const statusRef = useRef<GeminiStatus>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const onAudioData = useRef<((b64: string) => void) | null>(null);
  const onToolCall = useRef<((tc: ToolCallPayload) => void) | null>(null);
  const onTranscript = useRef<((text: string) => void) | null>(null);
  const onInterrupted = useRef<(() => void) | null>(null);
  const onTurnComplete = useRef<(() => void) | null>(null);
  const onToolCallCancellation = useRef<((ids: string[]) => void) | null>(null);

  const recentAudioSignaturesRef = useRef<Map<string, number>>(new Map());
  const toolRegistryRef = useRef<Map<string, ToolHandler>>(new Map());
  const sessionHandleRef = useRef<string | null>(null);
  const clientRef = useRef<GoogleGenAI | null>(null);

  const connectionCounterRef = useRef(0);
  const activeConnectionIdRef = useRef<number | null>(null);
  const forwardedAudioChunkCountRef = useRef(0);
  const droppedAudioChunkCountRef = useRef(0);
  const turnGuardRef = useRef<{
    inTurn: boolean;
    suppressCurrentTurn: boolean;
    currentSignatures: string[];
    previousSignatures: string[];
    previousCompletedAt: number;
  }>({
    inTurn: false,
    suppressCurrentTurn: false,
    currentSignatures: [],
    previousSignatures: [],
    previousCompletedAt: 0,
  });

  const registerTool = useCallback((name: string, handler: ToolHandler) => {
    toolRegistryRef.current.set(name, handler);
    log.debug({ toolName: name }, "Registered tool handler.");
  }, []);

  const disconnect = useCallback(() => {
    const connectionId = activeConnectionIdRef.current;
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }

    activeConnectionIdRef.current = null;
    recentAudioSignaturesRef.current.clear();
    forwardedAudioChunkCountRef.current = 0;
    droppedAudioChunkCountRef.current = 0;
    turnGuardRef.current.inTurn = false;
    turnGuardRef.current.suppressCurrentTurn = false;
    turnGuardRef.current.currentSignatures = [];
    turnGuardRef.current.previousSignatures = [];
    turnGuardRef.current.previousCompletedAt = 0;

    statusRef.current = "disconnected";
    setStatus("disconnected");
    clearSessionOverrides();
    log.info({ connectionId }, "Gemini Live disconnected.");
  }, [clearSessionOverrides]);

  const connect = useCallback(async () => {
    if (sessionRef.current) {
      log.warn("Existing Gemini session found during connect; closing previous session first.");
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
    turnGuardRef.current.inTurn = false;
    turnGuardRef.current.suppressCurrentTurn = false;
    turnGuardRef.current.currentSignatures = [];

    log.info(
      {
        connectionId,
        googleSearchEnabled: config.features.googleSearch,
        proactiveAudioEnabled: config.features.proactiveAudio,
      },
      "Connecting Gemini Live session.",
    );

    try {
      const tokenRes = await fetch("/api/token", { method: "POST" });
      if (!tokenRes.ok) {
        throw new Error("Failed to fetch Ephemeral Token");
      }
      const { token, error } = await tokenRes.json();
      if (error) {
        throw new Error(error);
      }

      clientRef.current = new GoogleGenAI({
        apiKey: token,
        httpOptions: { apiVersion: "v1alpha" },
      });
    } catch (err) {
      log.error({ err, connectionId }, "Authentication failed during token fetch");
      setErrorMessage(
        `Authentication failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      statusRef.current = "error";
      setStatus("error");
      return;
    }

    if (!clientRef.current) {
      return;
    }
    const ai = clientRef.current;

    const handleMessage = (message: LiveServerMessage) => {
      try {
        if (activeConnectionIdRef.current !== connectionId) {
          log.debug(
            { connectionId, activeConnectionId: activeConnectionIdRef.current },
            "Ignoring message from stale Gemini session.",
          );
          return;
        }

        if (message.setupComplete) {
          log.info({ connectionId }, "Setup complete.");
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resumption = (message as any).sessionResumptionUpdate;
        if (resumption?.handle) {
          sessionHandleRef.current = resumption.handle as string;
          log.info(
            { connectionId, handle: resumption.handle },
            "Session resumption handle updated.",
          );
        }

        if (message.toolCallCancellation) {
          const cancelledIds = message.toolCallCancellation.ids ?? [];
          log.info({ connectionId, cancelledIds }, "Tool calls cancelled.");
          onToolCallCancellation.current?.(cancelledIds);
          return;
        }

        if (message.serverContent) {
          if (message.serverContent.interrupted) {
            log.info({ connectionId }, "Interrupted by user speech; stopping playback.");
            turnGuardRef.current.inTurn = false;
            turnGuardRef.current.suppressCurrentTurn = false;
            turnGuardRef.current.currentSignatures = [];
            onInterrupted.current?.();
            return;
          }

          if (message.serverContent.turnComplete) {
            const guard = turnGuardRef.current;
            if (guard.inTurn) {
              guard.previousSignatures = guard.currentSignatures.slice();
              guard.previousCompletedAt = performance.now();
              guard.inTurn = false;
              guard.suppressCurrentTurn = false;
              guard.currentSignatures = [];
            }

            log.info(
              {
                connectionId,
                forwardedAudioChunks: forwardedAudioChunkCountRef.current,
                droppedAudioDuplicates: droppedAudioChunkCountRef.current,
                previousTurnSignatureCount: turnGuardRef.current.previousSignatures.length,
              },
              "Turn complete.",
            );
            decaySessionOverrides();
            onTurnComplete.current?.();
          }

          if (message.serverContent.outputTranscription?.text) {
            log.debug(
              {
                connectionId,
                transcript: message.serverContent.outputTranscription.text,
              },
              "Official transcript received (ignored for UI).",
            );
          }

          const parts = message.serverContent.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.inlineData?.mimeType?.startsWith("audio/")) {
                const audioData = part.inlineData.data as string;
                const now = performance.now();
                const signature = `${audioData.length}:${audioData.slice(0, 48)}:${audioData.slice(-48)}`;
                const seenAt = recentAudioSignaturesRef.current.get(signature);

                const guard = turnGuardRef.current;
                if (!guard.inTurn) {
                  guard.inTurn = true;
                  guard.suppressCurrentTurn = false;
                  guard.currentSignatures = [];
                }

                if (seenAt !== undefined && now - seenAt < DUPLICATE_AUDIO_WINDOW_MS) {
                  droppedAudioChunkCountRef.current += 1;
                  log.debug(
                    {
                      connectionId,
                      droppedAudioDuplicates: droppedAudioChunkCountRef.current,
                      duplicateWindowMs: DUPLICATE_AUDIO_WINDOW_MS,
                    },
                    "Skipping duplicate audio chunk from Live API stream.",
                  );
                  continue;
                }

                const MAX_TRACKED_SIGNATURES = 24;
                const MIN_PREFIX_MATCH_CHUNKS = 3;
                const DUPLICATE_TURN_WINDOW_MS = 12_000;

                if (guard.currentSignatures.length < MAX_TRACKED_SIGNATURES) {
                  guard.currentSignatures.push(signature);
                }

                if (
                  !guard.suppressCurrentTurn &&
                  guard.previousSignatures.length >= MIN_PREFIX_MATCH_CHUNKS &&
                  guard.currentSignatures.length >= MIN_PREFIX_MATCH_CHUNKS &&
                  now - guard.previousCompletedAt < DUPLICATE_TURN_WINDOW_MS
                ) {
                  let prefixMatch = true;
                  for (let i = 0; i < guard.currentSignatures.length; i++) {
                    if (guard.currentSignatures[i] !== guard.previousSignatures[i]) {
                      prefixMatch = false;
                      break;
                    }
                  }

                  if (prefixMatch) {
                    guard.suppressCurrentTurn = true;
                    droppedAudioChunkCountRef.current += 1;
                    log.warn(
                      {
                        connectionId,
                        duplicateTurnWindowMs: DUPLICATE_TURN_WINDOW_MS,
                        matchedPrefixChunks: guard.currentSignatures.length,
                        previousTurnSignatureCount: guard.previousSignatures.length,
                      },
                      "Detected repeated audio-turn prefix. Dropping duplicated turn audio.",
                    );
                    onInterrupted.current?.();
                    continue;
                  }
                }

                if (guard.suppressCurrentTurn) {
                  droppedAudioChunkCountRef.current += 1;
                  continue;
                }

                recentAudioSignaturesRef.current.set(signature, now);
                for (const [seenSignature, seenTime] of recentAudioSignaturesRef.current) {
                  if (now - seenTime > AUDIO_SIGNATURE_TTL_MS) {
                    recentAudioSignaturesRef.current.delete(seenSignature);
                  }
                }

                forwardedAudioChunkCountRef.current += 1;
                if (
                  forwardedAudioChunkCountRef.current === 1 ||
                  forwardedAudioChunkCountRef.current % 20 === 0
                ) {
                  log.debug(
                    {
                      connectionId,
                      forwardedAudioChunks: forwardedAudioChunkCountRef.current,
                      droppedAudioDuplicates: droppedAudioChunkCountRef.current,
                      audioDataLength: audioData.length,
                    },
                    "Forwarding audio chunk to playback pipeline.",
                  );
                }

                onAudioData.current?.(audioData);
              }

              if (part.text) {
                log.debug({ connectionId, transcript: part.text }, "Part transcript.");
                onTranscript.current?.(part.text);
              }
            }
          }
        }

        if (message.toolCall) {
          const calls = message.toolCall.functionCalls;
          if (!calls) {
            return;
          }

          for (const call of calls) {
            const callName = call.name ?? "";
            const callArgs = (call.args ?? {}) as Record<string, unknown>;
            const callId = call.id ?? "";

            log.info(
              {
                connectionId,
                callName,
                callId,
                argKeys: Object.keys(callArgs),
              },
              "Tool call received.",
            );

            onToolCall.current?.({ name: callName, args: callArgs, id: callId });

            const handler = toolRegistryRef.current.get(callName);

            const dispatchResult = async () => {
              let result: Record<string, unknown>;
              const handlerStart = performance.now();
              log.debug({ connectionId, callName, callId }, "Tool handler execution started.");

              if (handler) {
                try {
                  const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(
                      () =>
                        reject(
                          new Error(
                            `Tool handler \"${callName}\" timed out after ${TOOL_HANDLER_TIMEOUT_MS}ms`,
                          ),
                        ),
                      TOOL_HANDLER_TIMEOUT_MS,
                    ),
                  );

                  result = await Promise.race([
                    Promise.resolve(handler(callArgs)),
                    timeoutPromise,
                  ]);

                  log.debug(
                    {
                      connectionId,
                      callName,
                      callId,
                      durationMs: Math.round(performance.now() - handlerStart),
                    },
                    "Tool handler execution completed.",
                  );
                } catch (handlerErr) {
                  log.error(
                    { err: handlerErr, connectionId, toolName: callName, callId },
                    "Handler for tool threw an error.",
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
                  "No handler registered for tool. Returning { result: 'ok' } as fallback.",
                );
                result = { result: "ok" };
              }

              if (activeConnectionIdRef.current !== connectionId || !sessionRef.current) {
                log.warn(
                  {
                    connectionId,
                    callName,
                    callId,
                    activeConnectionId: activeConnectionIdRef.current,
                  },
                  "Skipping tool response because session is stale or closed.",
                );
                return;
              }

              sessionRef.current.sendToolResponse({
                functionResponses: [
                  {
                    id: callId,
                    name: callName,
                    response: result,
                  },
                ],
              });

              log.info(
                {
                  connectionId,
                  callName,
                  callId,
                  durationMs: Math.round(performance.now() - handlerStart),
                  resultKeys: Object.keys(result),
                },
                "Tool response sent.",
              );
            };

            void dispatchResult();
          }
        }
      } catch (err) {
        log.warn({ err, connectionId }, "Failed to handle incoming message.");
      }
    };

    try {
      const avatarBaselineSummary = JSON.stringify({
        emotionControl: config.emotionControl,
        ocularTuning: config.ocularTuning,
        headDynamics: config.headDynamics,
        visemeOverrides: config.visemeOverrides,
        aiStyleControl: config.aiStyleControl,
        policy: "Use subtle, bounded, natural updates. Prefer small incremental patches over abrupt changes.",
      });

      const session = await ai.live.connect({
        model: GEMINI_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Aoede",
              },
            },
          },
          systemInstruction: `${SYSTEM_PROMPT}\n\n# AVATAR_CONTROL_BASELINE\n${avatarBaselineSummary}`,
          tools: config.features.googleSearch
            ? GEMINI_TOOLS
            : GEMINI_TOOLS.filter(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (t: any) => !t.googleSearch,
              ),
          // SDK warning indicates generationConfig is deprecated.
          temperature: 0.7,
          maxOutputTokens: 2048,
          proactivity: {
            proactiveAudio: config.features.proactiveAudio,
          },
          realtimeInputConfig: {
            automaticActivityDetection: {},
          },
          contextWindowCompression: { slidingWindow: {} },
          ...(sessionHandleRef.current
            ? { sessionResumption: { handle: sessionHandleRef.current } }
            : {}),
        },
        callbacks: {
          onopen: () => {
            if (activeConnectionIdRef.current !== connectionId) {
              return;
            }
            log.info({ connectionId }, "Gemini Live connection opened.");
            statusRef.current = "connected";
            setStatus("connected");
          },
          onmessage: handleMessage,
          onerror: (e: ErrorEvent) => {
            if (activeConnectionIdRef.current !== connectionId) {
              return;
            }
            log.error({ err: e, connectionId }, "SDK connection error.");
            setErrorMessage(
              `Connection error: ${e.message || "Check API Key and network."}`,
            );
            statusRef.current = "error";
            setStatus("error");
          },
          onclose: (e: CloseEvent) => {
            const isStale = activeConnectionIdRef.current !== connectionId;
            log.info(
              {
                connectionId,
                isStale,
                code: e.code,
                reason: e.reason,
              },
              "Session closed.",
            );
            if (isStale) {
              return;
            }
            if (statusRef.current !== "disconnected") {
              statusRef.current = "disconnected";
              setStatus("disconnected");
            }
          },
        },
      });

      if (activeConnectionIdRef.current !== connectionId) {
        session.close();
        log.warn(
          { connectionId, activeConnectionId: activeConnectionIdRef.current },
          "Connected stale session; closing immediately.",
        );
        return;
      }

      sessionRef.current = session;
      log.info({ connectionId }, "GeminiLive session established.");
    } catch (err) {
      log.error({ err, connectionId }, "GeminiLive failed to connect");
      setErrorMessage(
        `Failed to connect: ${err instanceof Error ? err.message : String(err)}`,
      );
      statusRef.current = "error";
      setStatus("error");
    }
  }, [
    disconnect,
    decaySessionOverrides,
    config.features.googleSearch,
    config.features.proactiveAudio,
    config.emotionControl,
    config.ocularTuning,
    config.headDynamics,
    config.visemeOverrides,
    config.aiStyleControl,
  ]);

  const sendVideoFrame = useCallback((base64Image: string) => {
    if (statusRef.current !== "connected") {
      return;
    }

    try {
      sessionRef.current?.sendRealtimeInput({
        media: {
          data: base64Image,
          mimeType: "image/jpeg",
        },
      });
      log.trace(
        { connectionId: activeConnectionIdRef.current },
        "GeminiLive sent video frame.",
      );
    } catch (e) {
      log.warn({ err: e }, "Failed to send video frame");
    }
  }, []);

  const sendAudioChunk = useCallback((base64Audio: string) => {
    if (statusRef.current !== "connected") {
      return;
    }

    try {
      sessionRef.current?.sendRealtimeInput({
        audio: {
          data: base64Audio,
          mimeType: "audio/pcm;rate=16000",
        },
      });
      log.trace(
        {
          connectionId: activeConnectionIdRef.current,
          bytes: base64Audio.length,
        },
        "GeminiLive sent audio chunk.",
      );
    } catch (e) {
      log.warn({ err: e }, "Failed to send audio chunk");
    }
  }, []);

  const sendText = useCallback((text: string) => {
    if (statusRef.current !== "connected") {
      return;
    }

    try {
      sessionRef.current?.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
      log.info(
        {
          connectionId: activeConnectionIdRef.current,
          textLength: text.length,
        },
        "GeminiLive sent text payload.",
      );
    } catch (e) {
      log.warn({ err: e }, "Failed to send text payload");
    }
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    connect,
    disconnect,
    sendVideoFrame,
    sendAudioChunk,
    sendText,
    registerTool,
    onAudioData,
    onToolCall,
    onTranscript,
    onInterrupted,
    onTurnComplete,
    onToolCallCancellation,
    lastSessionHandle: sessionHandleRef,
    errorMessage,
  };
}
