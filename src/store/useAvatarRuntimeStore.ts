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

  decaySessionOverrides: (factor = 0.9) => {
    const safeFactor = Math.max(0.5, Math.min(0.98, factor));
    set((state) => {
      const current = state.sessionOverrides;
      if (!current.emotionControl && !current.aiStyleControl) {
        return state;
      }

      let newEmotionControl = current.emotionControl;
      if (newEmotionControl) {
        const intensity = typeof newEmotionControl.emotionIntensity === "number" ? newEmotionControl.emotionIntensity : 1.0;
        const nextIntensity = intensity * safeFactor;
        
        if (nextIntensity < 0.05) {
          // Drop it completely so we cleanly return to baseline
          newEmotionControl = undefined;
        } else {
          newEmotionControl = { ...newEmotionControl, emotionIntensity: nextIntensity };
        }
      }

      let newAiStyleControl = current.aiStyleControl;
      if (newAiStyleControl) {
         const intensity = typeof newAiStyleControl.emotionIntensity === "number" ? newAiStyleControl.emotionIntensity : 1.0;
         const nextIntensity = intensity * safeFactor;
         
         if (nextIntensity < 0.05) {
            newAiStyleControl = undefined;
         } else {
            newAiStyleControl = { ...newAiStyleControl, emotionIntensity: nextIntensity };
         }
      }
      
      const newOverrides = { ...current };
      if (newEmotionControl === undefined) delete newOverrides.emotionControl;
      else newOverrides.emotionControl = newEmotionControl;
      
      if (newAiStyleControl === undefined) delete newOverrides.aiStyleControl;
      else newOverrides.aiStyleControl = newAiStyleControl;

      // We explicitly DO NOT update lastUpdatedAt here.
      // This ensures 'time since agent intervention' continues tracking cleanly for the interval loop.
      return {
        sessionOverrides: newOverrides,
      };
    });
  },
}));
