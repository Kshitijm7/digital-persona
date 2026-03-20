// File: src/lib/gemini-session-config.ts
// Typed loader for gemini-session.json — single source of truth for all Gemini
// Live API session parameters. UI-level overrides (SceneConfig.features) take
// precedence where applicable.

import rawConfig from "@/config/gemini-session.json";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GeminiSessionMode = "full" | "stable";

export interface GenerationConfig {
  temperature: number;
  topP?: number;
  maxOutputTokens: number;
}

export interface ModeFeatures {
  enableAffectiveDialog: boolean;
  proactiveAudio: boolean;
  inputAudioTranscription: boolean;
  outputAudioTranscription: boolean;
  googleSearch: boolean;
  contextWindowCompression: boolean;
  sessionResumption: boolean;
}

export interface AudioConfig {
  inputSampleRate: number;
  outputSampleRate: number;
  voiceName: string;
}

export interface VideoConfig {
  fps: number;
  quality: number;
  mediaResolution: string;
}

export interface ThinkingConfig {
  thinkingBudget: number;
}

export interface ContextWindowConfig {
  triggerTokens: number;
  slidingWindow: boolean;
}

export interface VadConfig {
  automaticActivityDetection: boolean;
  startOfSpeechSensitivity: string;
  endOfSpeechSensitivity: string;
}

export interface ModeConfig {
  description: string;
  generation: GenerationConfig;
  features: ModeFeatures;
  audio: AudioConfig;
  video: VideoConfig;
  thinking: ThinkingConfig;
  contextWindow: ContextWindowConfig;
  vad: VadConfig;
}

export interface StabilityConfig {
  maxRetriesBeforeDegrade: number;
  maxRetriesInStableMode: number;
  backoff: {
    initialMs: number;
    multiplier: number;
    maxMs: number;
    jitterMs: number;
  };
  retryableCloseCodes: number[];
  degradeOnCloseCodes: number[];
  videoSessionRolloverSec: number;
  tokenPrefetchMaxAgeMs: number;
}

export interface ToolResponseConfig {
  silentScheduling: boolean;
  handlerTimeoutMs: number;
}

export interface DeduplicationConfig {
  audioDuplicateWindowMs: number;
  audioSignatureTtlMs: number;
  audioSignatureSweepIntervalMs: number;
  textDedupWindowMs: number;
  audioChunkLogInterval: number;
  duplicateAudioLogInterval: number;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
  useAudioStreamEnd: boolean;
  precomputeZeroChunk: boolean;
  zeroChunkBytes: number;
}

export interface GeminiSessionConfig {
  model: { primary: string; apiVersion: string };
  modes: Record<GeminiSessionMode, ModeConfig>;
  stability: StabilityConfig;
  toolResponse: ToolResponseConfig;
  deduplication: DeduplicationConfig;
  heartbeat: HeartbeatConfig;
}

// ─── Validated export ─────────────────────────────────────────────────────────

const sessionConfig = rawConfig as unknown as GeminiSessionConfig;

/** Returns the full parsed session config. */
export function getSessionConfig(): GeminiSessionConfig {
  return sessionConfig;
}

/** Returns the config for a specific mode. */
export function getModeConfig(mode: GeminiSessionMode): ModeConfig {
  return sessionConfig.modes[mode];
}

/** Returns the next degraded mode, or null if already at lowest. */
export function degradeMode(current: GeminiSessionMode): GeminiSessionMode | null {
  if (current === "full") return "stable";
  return null; // already at lowest
}

/**
 * Computes exponential backoff with jitter for reconnection.
 * Uses values from the stability config.
 */
export function computeBackoff(attempt: number): number {
  const { initialMs, multiplier, maxMs, jitterMs } = sessionConfig.stability.backoff;
  const base = Math.min(initialMs * Math.pow(multiplier, attempt), maxMs);
  const jitter = Math.random() * jitterMs;
  return base + jitter;
}

/** Check if a WebSocket close code is retryable. */
export function isRetryableCloseCode(code: number): boolean {
  return sessionConfig.stability.retryableCloseCodes.includes(code);
}

/** Check if a WebSocket close code should trigger mode degradation. */
export function shouldDegradeOnCloseCode(code: number): boolean {
  return sessionConfig.stability.degradeOnCloseCodes.includes(code);
}
