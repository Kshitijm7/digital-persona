import { create } from "zustand";

import {
  type AvatarControlOverrides,
  sanitizeAvatarControlOverrides,
} from "@/lib/avatar-control.types";

interface AvatarRuntimeState {
  sessionOverrides: AvatarControlOverrides;
  lastUpdatedAt: number;
  applySessionPatch: (patch: AvatarControlOverrides) => void;
  clearSessionOverrides: () => void;
  decaySessionOverrides: (factor?: number) => void;
}

export const useAvatarRuntimeStore = create<AvatarRuntimeState>((set) => ({
  sessionOverrides: {},
  lastUpdatedAt: 0,

  applySessionPatch: (patch) => {
    const sanitized = sanitizeAvatarControlOverrides(patch);
    set((state) => ({
      sessionOverrides: {
        ...state.sessionOverrides,
        ...sanitized,
        emotionControl: {
          ...(state.sessionOverrides.emotionControl ?? {}),
          ...(sanitized.emotionControl ?? {}),
        },
        ocularTuning: {
          ...(state.sessionOverrides.ocularTuning ?? {}),
          ...(sanitized.ocularTuning ?? {}),
        },
        meshPostProcessing: {
          ...(state.sessionOverrides.meshPostProcessing ?? {}),
          ...(sanitized.meshPostProcessing ?? {}),
        },
        headDynamics: {
          ...(state.sessionOverrides.headDynamics ?? {}),
          ...(sanitized.headDynamics ?? {}),
        },
        anatomicalPostProcessing: {
          ...(state.sessionOverrides.anatomicalPostProcessing ?? {}),
          ...(sanitized.anatomicalPostProcessing ?? {}),
        },
        visemeOverrides: {
          ...(state.sessionOverrides.visemeOverrides ?? {}),
          ...(sanitized.visemeOverrides ?? {}),
        },
        aiStyleControl: {
          ...(state.sessionOverrides.aiStyleControl ?? {}),
          ...(sanitized.aiStyleControl ?? {}),
        },
        meshConfig: {
          ...(state.sessionOverrides.meshConfig ?? {}),
          ...(sanitized.meshConfig ?? {}),
        },
      },
      lastUpdatedAt: Date.now(),
    }));
  },

  clearSessionOverrides: () => {
    set({ sessionOverrides: {}, lastUpdatedAt: Date.now() });
  },

  decaySessionOverrides: (factor = 0.86) => {
    const safeFactor = Math.max(0.5, Math.min(0.98, factor));
    set((state) => {
      const current = state.sessionOverrides;
      if (!current.emotionControl && !current.aiStyleControl) {
        return state;
      }

      return {
        sessionOverrides: {
          ...current,
          emotionControl: current.emotionControl
            ? {
                ...current.emotionControl,
                emotionIntensity:
                  typeof current.emotionControl.emotionIntensity === "number"
                    ? current.emotionControl.emotionIntensity * safeFactor
                    : current.emotionControl.emotionIntensity,
              }
            : current.emotionControl,
          aiStyleControl: current.aiStyleControl
            ? {
                ...current.aiStyleControl,
                emotionIntensity:
                  typeof current.aiStyleControl.emotionIntensity === "number"
                    ? current.aiStyleControl.emotionIntensity * safeFactor
                    : current.aiStyleControl.emotionIntensity,
              }
            : current.aiStyleControl,
        },
        lastUpdatedAt: Date.now(),
      };
    });
  },
}));
