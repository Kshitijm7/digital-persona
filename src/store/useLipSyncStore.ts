import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Lipsync } from 'wawa-lipsync';

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


export const LIPSYNC_PRESETS: Record<LipSyncPresetKey, { label: string; values: LipSyncTuning }> = {
  lowLatency: {
    label: "Low Latency",
    values: {
      ...DEFAULT_LIPSYNC_TUNING,
      clockCompensationRatio: 0.46,
      maxClockCompensationMs: 42,
      anticipationWindowMs: 48,
      anticipationWeightMax: 0.2,
      resetSilenceHoldMs: 180,
      minSwitchMsPlosive: 10,
      minSwitchMsFricative: 16,
      minSwitchMsVowel: 24,
      minSwitchMsSilence: 32,
      lambdaPlosive: 32,
      lambdaFricative: 23,
      lambdaVowel: 17,
      lambdaSilence: 15,
      speechThresholdOffset: 0.014,
      analyserSmoothing: 0.14,
      visemePersistenceMs: 72,
    },
  },
  balanced: {
    label: "Balanced",
    values: {
      ...DEFAULT_LIPSYNC_TUNING,
    },
  },
  noisyRoom: {
    label: "Noisy Room",
    values: {
      ...DEFAULT_LIPSYNC_TUNING,
      clockCompensationRatio: 0.64,
      maxClockCompensationMs: 82,
      anticipationWindowMs: 74,
      anticipationWeightMax: 0.28,
      resetSilenceHoldMs: 300,
      minSwitchMsPlosive: 14,
      minSwitchMsFricative: 28,
      minSwitchMsVowel: 36,
      minSwitchMsSilence: 46,
      lambdaPlosive: 35,
      lambdaFricative: 25,
      lambdaVowel: 19,
      lambdaSilence: 17,
      speechThresholdOffset: 0.028,
      noiseFloorAdaptLambda: 3.4,
      noiseFloorReleaseLambda: 0.8,
      noiseFloorMin: 0.01,
      noiseFloorMax: 0.1,
      analyserSmoothing: 0.26,
      visemePersistenceMs: 95,
    },
  },
  photorealistic: {
    label: "Photorealistic",
    values: {
      ...DEFAULT_LIPSYNC_TUNING,
      clockCompensationRatio: 0.6,
      maxClockCompensationMs: 70,
      anticipationWindowMs: 65,
      anticipationWeightMax: 0.24,
      resetSilenceHoldMs: 240,
      analyserSmoothing: 0.18,
      visemePersistenceMs: 85,
      minSwitchMsPlosive: 12,
      minSwitchMsFricative: 22,
      minSwitchMsVowel: 30,
      minSwitchMsSilence: 38,
      lambdaPlosive: 34,
      lambdaFricative: 24,
      lambdaVowel: 18,
      lambdaSilence: 16,
      speechThresholdOffset: 0.018,
    },
  },
};


interface LipSyncStore {
  wawaLipsync: Lipsync | null;
  tuning: LipSyncTuning;
  activePreset: LipSyncPresetKey;
  setWawaLipsync: (wawa: Lipsync) => void;
  updateTuning: (patch: Partial<LipSyncTuning>) => void;
  resetTuning: () => void;
  setActivePreset: (preset: LipSyncPresetKey) => void;
  clear: () => void;
}

export const useLipSyncStore = create<LipSyncStore>()(
  persist(
    (set) => ({
      wawaLipsync: null,
      tuning: { ...DEFAULT_LIPSYNC_TUNING },
      activePreset: "balanced",

      setWawaLipsync: (wawa) => {
        set({ wawaLipsync: wawa });
      },

      updateTuning: (patch) => {
        set((state) => ({
          tuning: { ...state.tuning, ...patch },
        }));
      },

      resetTuning: () => {
        set({ tuning: { ...DEFAULT_LIPSYNC_TUNING }, activePreset: "balanced" });
      },

      setActivePreset: (preset) => {
        set({ activePreset: preset });
      },

      clear: () => {
        // Currently no internal timeline to clear, managed strictly by AudioStreamer
      }
    }),
    {
      name: 'lipsync-storage',
      partialize: (state) => ({ 
        tuning: state.tuning,
        activePreset: state.activePreset 
      }),
    }
  )
);

