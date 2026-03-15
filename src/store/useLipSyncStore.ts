import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lipsync } from 'wawa-lipsync';
import presetsConfig from '@/config/lipsync-presets.json';

export interface LipSyncTuning {
  clockCompensationRatio: number;
  maxClockCompensationMs: number;
  anticipationWindowMs: number;
  anticipationWeightMax: number;
  resetSilenceHoldMs: number;
  minSwitchMsPlosive: number;
  minSwitchMsFricative: number;
  minSwitchMsVowel: number;
  minSwitchMsSilence: number;
  lambdaPlosive: number;
  lambdaFricative: number;
  lambdaVowel: number;
  lambdaSilence: number;
  adaptiveNoiseFloor: boolean;
  speechThresholdOffset: number;
  noiseFloorAdaptLambda: number;
  noiseFloorReleaseLambda: number;
  noiseFloorMin: number;
  noiseFloorMax: number;
  analyserSmoothing: number;
  visemePersistenceMs: number;
}

/**
 * Compile-time fallback defaults — used when individual keys are missing from
 * the JSON config. Editing src/config/lipsync-presets.json is the preferred
 * way to change preset values; these constants are the last resort safety net.
 */
export const DEFAULT_LIPSYNC_TUNING: LipSyncTuning = {
  clockCompensationRatio: 0.6,
  maxClockCompensationMs: 70,
  anticipationWindowMs: 65,
  anticipationWeightMax: 0.24,
  resetSilenceHoldMs: 240,
  minSwitchMsPlosive: 12,
  minSwitchMsFricative: 22,
  minSwitchMsVowel: 30,
  minSwitchMsSilence: 38,
  lambdaPlosive: 34,
  lambdaFricative: 24,
  lambdaVowel: 18,
  lambdaSilence: 16,
  adaptiveNoiseFloor: true,
  speechThresholdOffset: 0.018,
  noiseFloorAdaptLambda: 2.6,
  noiseFloorReleaseLambda: 0.55,
  noiseFloorMin: 0.006,
  noiseFloorMax: 0.08,
  analyserSmoothing: 0.18,
  visemePersistenceMs: 85,
};

export type LipSyncPresetKey = "lowLatency" | "balanced" | "noisyRoom" | "photorealistic";

/* ─── Config-file loader ──────────────────────────────────────────────────── */

/**
 * Coerce a raw JSON preset object into a fully-typed LipSyncTuning, filling
 * any missing keys from DEFAULT_LIPSYNC_TUNING so the engine always sees a
 * complete object even if the JSON was only partially edited.
 */
function loadPresetFromConfig(raw: Record<string, unknown>): LipSyncTuning {
  const d = DEFAULT_LIPSYNC_TUNING;
  const n = (key: keyof LipSyncTuning, fallback: number) =>
    typeof raw[key] === 'number' ? (raw[key] as number) : fallback;
  const b = (key: keyof LipSyncTuning, fallback: boolean) =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : fallback;

  return {
    clockCompensationRatio: n('clockCompensationRatio', d.clockCompensationRatio),
    maxClockCompensationMs: n('maxClockCompensationMs', d.maxClockCompensationMs),
    anticipationWindowMs: n('anticipationWindowMs', d.anticipationWindowMs),
    anticipationWeightMax: n('anticipationWeightMax', d.anticipationWeightMax),
    resetSilenceHoldMs: n('resetSilenceHoldMs', d.resetSilenceHoldMs),
    minSwitchMsPlosive: n('minSwitchMsPlosive', d.minSwitchMsPlosive),
    minSwitchMsFricative: n('minSwitchMsFricative', d.minSwitchMsFricative),
    minSwitchMsVowel: n('minSwitchMsVowel', d.minSwitchMsVowel),
    minSwitchMsSilence: n('minSwitchMsSilence', d.minSwitchMsSilence),
    lambdaPlosive: n('lambdaPlosive', d.lambdaPlosive),
    lambdaFricative: n('lambdaFricative', d.lambdaFricative),
    lambdaVowel: n('lambdaVowel', d.lambdaVowel),
    lambdaSilence: n('lambdaSilence', d.lambdaSilence),
    adaptiveNoiseFloor: b('adaptiveNoiseFloor', d.adaptiveNoiseFloor),
    speechThresholdOffset: n('speechThresholdOffset', d.speechThresholdOffset),
    noiseFloorAdaptLambda: n('noiseFloorAdaptLambda', d.noiseFloorAdaptLambda),
    noiseFloorReleaseLambda: n('noiseFloorReleaseLambda', d.noiseFloorReleaseLambda),
    noiseFloorMin: n('noiseFloorMin', d.noiseFloorMin),
    noiseFloorMax: n('noiseFloorMax', d.noiseFloorMax),
    analyserSmoothing: n('analyserSmoothing', d.analyserSmoothing),
    visemePersistenceMs: n('visemePersistenceMs', d.visemePersistenceMs),
  };
}

const rawPresets = (presetsConfig as { presets: Record<string, Record<string, unknown>> }).presets;

/**
 * LIPSYNC_PRESETS — derived from src/config/lipsync-presets.json at build time.
 * To change a preset value, edit the JSON file and reload the page.
 */
export const LIPSYNC_PRESETS: Record<LipSyncPresetKey, { label: string; values: LipSyncTuning }> = {
  lowLatency: {
    label: (rawPresets.lowLatency?.label as string) ?? 'Low Latency',
    values: loadPresetFromConfig(rawPresets.lowLatency ?? {}),
  },
  balanced: {
    label: (rawPresets.balanced?.label as string) ?? 'Balanced',
    values: loadPresetFromConfig(rawPresets.balanced ?? {}),
  },
  noisyRoom: {
    label: (rawPresets.noisyRoom?.label as string) ?? 'Noisy Room',
    values: loadPresetFromConfig(rawPresets.noisyRoom ?? {}),
  },
  photorealistic: {
    label: (rawPresets.photorealistic?.label as string) ?? 'Photorealistic',
    values: loadPresetFromConfig(rawPresets.photorealistic ?? {}),
  },
};

/* ─── Store ───────────────────────────────────────────────────────────────── */

interface LipSyncStore {
  wawaLipsync: Lipsync | null;
  tuning: LipSyncTuning;
  activePreset: LipSyncPresetKey;
  setWawaLipsync: (wawa: Lipsync) => void;
  updateTuning: (patch: Partial<LipSyncTuning>) => void;
  resetTuning: () => void;
  setActivePreset: (preset: LipSyncPresetKey) => void;
  applyPreset: (preset: LipSyncPresetKey) => void;
  clear: () => void;
}

export const useLipSyncStore = create<LipSyncStore>()(
  persist(
    (set) => ({
      wawaLipsync: null,
      tuning: { ...LIPSYNC_PRESETS.balanced.values },
      activePreset: "balanced",

      setWawaLipsync: (wawa) => set({ wawaLipsync: wawa }),

      updateTuning: (patch) =>
        set((state) => ({ tuning: { ...state.tuning, ...patch } })),

      resetTuning: () =>
        set({ tuning: { ...LIPSYNC_PRESETS.balanced.values }, activePreset: 'balanced' }),

      setActivePreset: (preset) => set({ activePreset: preset }),

      /** Apply a preset — loads values from the JSON config and updates both
       *  the active preset name and the live tuning object. */
      applyPreset: (preset) =>
        set({
          activePreset: preset,
          tuning: { ...LIPSYNC_PRESETS[preset].values },
        }),

      clear: () => {
        // Currently no internal timeline to clear, managed strictly by AudioStreamer
      },
    }),
    {
      name: 'lipsync-storage',
      partialize: (state) => ({
        tuning: state.tuning,
        activePreset: state.activePreset,
      }),
    }
  )
);
