/**
 * Typed loader for emotive-speech.json
 *
 * Provides a single function `getModeTuning(mode)` that returns
 * fully-typed config for all three engines. Falls back to "broadcast"
 * for unknown mode keys. Each subsystem reads only its own slice,
 * keeping the coupling one-directional.
 */

import config from "@/config/emotive-speech.json";

// ═══════════════════════════════════════════════════════════════════
//  Types — derived from the JSON structure
// ═══════════════════════════════════════════════════════════════════

export interface CoarticulationConfig {
  vowelCarryWeight: number;
  consonantCarryWeight: number;
  jawHeavyCarryLambda: number;
  vowelCarryLambda: number;
  fricativeCarryLambda: number;
  defaultCarryLambda: number;
}

export interface BreathMicroMotionConfig {
  enabled: boolean;
  decayMs: number;
  frequencyHz: number;
  amplitude: number;
}

export interface VolumeFallbackConfig {
  jawMult: number;
  mouthMult: number;
  jawCap: number;
  mouthCap: number;
  funnelRatio: number;
  puckerRatio: number;
  teethScale: number;
}

export interface LipSyncModeConfig {
  levelFloor: number;
  levelRange: number;
  levelExponent: number;
  activeVowelWeight: number;
  activeConsonantWeight: number;
  activeWeightBoost: number;
  silenceWeightMin: number;
  silenceWeightMax: number;
  silenceGainDamping: number;
  maxPendingVisemes: number;
  coarticulation: CoarticulationConfig;
  breathMicroMotion: BreathMicroMotionConfig;
  volumeFallback: VolumeFallbackConfig;
}

export interface CompressorConfig {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

export interface EQBandConfig {
  type: string;
  frequency: number;
  gain: number;
}

export interface VoicePresenceConfig {
  compressor: CompressorConfig;
  warmth: EQBandConfig;
  presence: EQBandConfig;
}

export interface StreamerModeConfig {
  bufferSize: number;
  maxQueueLength: number;
  initialBufferSec: number;
  lookAheadSec: number;
  recoveryOffsetSec: number;
  fadeSamples: number;
  stopRampSec: number;
  teardownDelayMs: number;
}

export interface EmotionStateTargets {
  smile: number;
  cheek: number;
  browInnerUp: number;
  browDown: number;
  frown: number;
}

export interface EmotionModeConfig {
  speechLevelLambda: number;
  speechExpressionBoost: number;
  sentimentLambda: number;
  onsetLambda: number;
  releaseLambda: number;
  hoverSmile: number;
  hoverCheek: number;
  states: Record<string, Partial<EmotionStateTargets>>;
  textConditioningKeywords: Record<string, Partial<EmotionStateTargets>>;
}

export type ArkitVisemeMap = Record<string, Record<string, number>>;

export interface EmotiveSpeechModeTuning {
  description: string;
  lipsync: LipSyncModeConfig;
  voicePresence: VoicePresenceConfig;
  streamer: StreamerModeConfig;
  emotion: EmotionModeConfig;
  arkitVisemeMap: ArkitVisemeMap;
}

// ═══════════════════════════════════════════════════════════════════
//  Mode keys
// ═══════════════════════════════════════════════════════════════════

export type EmotiveSpeechMode = keyof typeof config.modes;

export const EMOTIVE_SPEECH_MODES = Object.keys(config.modes) as EmotiveSpeechMode[];

export const DEFAULT_MODE: EmotiveSpeechMode =
  (config.defaultMode as EmotiveSpeechMode) ?? "broadcast";

// ═══════════════════════════════════════════════════════════════════
//  Loader
// ═══════════════════════════════════════════════════════════════════

const cache = new Map<string, EmotiveSpeechModeTuning>();

/**
 * Returns fully-typed config for the given mode. Falls back to
 * "broadcast" for unknown keys. Cached per mode key.
 */
export function getModeTuning(
  mode: EmotiveSpeechMode = DEFAULT_MODE,
): EmotiveSpeechModeTuning {
  const key = mode in config.modes ? mode : DEFAULT_MODE;
  const cached = cache.get(key);
  if (cached) return cached;

  const raw = config.modes[key as keyof typeof config.modes] as Record<string, unknown>;
  if (!raw) {
    throw new Error(`[emotive-speech-config] Unknown mode: ${key}`);
  }

  const result: EmotiveSpeechModeTuning = {
    description: (raw.description as string) ?? "",
    lipsync: raw.lipsync as LipSyncModeConfig,
    voicePresence: raw.voicePresence as VoicePresenceConfig,
    streamer: raw.streamer as StreamerModeConfig,
    emotion: raw.emotion as EmotionModeConfig,
    arkitVisemeMap: config.arkitVisemeMap as ArkitVisemeMap,
  };

  cache.set(key, result);
  return result;
}

/**
 * Returns just the ARKit viseme map (shared across all modes).
 */
export function getArkitVisemeMap(): ArkitVisemeMap {
  return config.arkitVisemeMap as ArkitVisemeMap;
}