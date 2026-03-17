import { create } from "zustand";
import {
  type AvatarControlOverrides,
  sanitizeControlPatch,
} from "@/lib/avatar-control.types";

interface AvatarRuntimeState {
  sessionOverrides: AvatarControlOverrides;
  lastUpdatedAt: number;
  applySessionPatch: (patch: AvatarControlOverrides) => void;
  clearSessionOverrides: () => void;
  decaySessionOverrides: (factor?: number) => void;
}

// ─── Deep-merge helper ────────────────────────────────────────────────────────
// Merges two partial override sub-objects, treating `undefined` fields as
// "no change" so a partial patch never wipes existing sibling keys.
function mergeSubObject<T extends object>(
  existing: Partial<T> | undefined,
  incoming: Partial<T> | undefined
): Partial<T> | undefined {
  if (!incoming) return existing;
  if (!existing) return incoming;
  return { ...existing, ...incoming };
}

export const useAvatarRuntimeStore = create<AvatarRuntimeState>((set) => ({
  sessionOverrides: {},
  lastUpdatedAt: 0,

  // Fix R2: all sub-object merges are explicit so a partial patch
  // (e.g. only emotionIntensity) never wipes sibling fields.
  applySessionPatch: (patch) => {
    const sanitized = sanitizeControlPatch(patch);
    set((state) => ({
      sessionOverrides: {
        ...state.sessionOverrides,
        emotionControl: mergeSubObject(
          state.sessionOverrides.emotionControl,
          sanitized.emotionControl
        ),
        ocularTuning: mergeSubObject(
          state.sessionOverrides.ocularTuning,
          sanitized.ocularTuning
        ),
        meshPostProcessing: mergeSubObject(
          state.sessionOverrides.meshPostProcessing,
          sanitized.meshPostProcessing
        ),
        headDynamics: mergeSubObject(
          state.sessionOverrides.headDynamics,
          sanitized.headDynamics
        ),
        anatomicalPostProcessing: mergeSubObject(
          state.sessionOverrides.anatomicalPostProcessing,
          sanitized.anatomicalPostProcessing
        ),
        visemeOverrides: mergeSubObject(
          state.sessionOverrides.visemeOverrides,
          sanitized.visemeOverrides
        ),
        aiStyleControl: mergeSubObject(
          state.sessionOverrides.aiStyleControl,
          sanitized.aiStyleControl
        ),
        meshConfig: mergeSubObject(
          state.sessionOverrides.meshConfig,
          sanitized.meshConfig
        ),
      },
      lastUpdatedAt: Date.now(),
    }));
  },

  clearSessionOverrides: () => {
    set({ sessionOverrides: {}, lastUpdatedAt: Date.now() });
  },

  // Fix R1: decay ALL numeric intensity fields across ALL sub-objects,
  // not just emotionControl and aiStyleControl.
  // Fix R3: update lastUpdatedAt so consumers can detect decay events.
  decaySessionOverrides: (factor = 0.9) => {
    const safeFactor = Math.max(0.5, Math.min(0.98, factor));

    set((state) => {
      const current = state.sessionOverrides;

      // Nothing to decay
      if (Object.keys(current).length === 0) return state;

      const decayIntensity = (
        obj: Record<string, unknown> | undefined,
        key: string,
        floor = 0.05
      ): Record<string, unknown> | undefined => {
        if (!obj) return undefined;
        const val = obj[key];
        if (typeof val !== "number") return obj;
        const next = val * safeFactor;
        if (next < floor) {
          // Remove only the intensity key; preserve all other fields
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [key]: _removed, ...rest } = obj;
          return Object.keys(rest).length > 0 ? rest : undefined;
        }
        return { ...obj, [key]: next };
      };

      const nextEmotionControl = decayIntensity(
        current.emotionControl as Record<string, unknown> | undefined,
        "emotionIntensity"
      ) as AvatarControlOverrides["emotionControl"] | undefined;

      const nextAiStyleControl = decayIntensity(
        current.aiStyleControl as Record<string, unknown> | undefined,
        "emotionIntensity"
      ) as AvatarControlOverrides["aiStyleControl"] | undefined;

      // Fix R1: also decay saccadeStrength in ocularTuning
      const nextOcularTuning = decayIntensity(
        current.ocularTuning as Record<string, unknown> | undefined,
        "saccadeStrength",
        0.1
      ) as AvatarControlOverrides["ocularTuning"] | undefined;

      // Fix R1: decay headMotionAccelerationLimit in headDynamics
      const nextHeadDynamics = decayIntensity(
        current.headDynamics as Record<string, unknown> | undefined,
        "headMotionAccelerationLimit",
        0.05
      ) as AvatarControlOverrides["headDynamics"] | undefined;

      // Short-circuit if nothing actually changed
      if (
        nextEmotionControl === current.emotionControl &&
        nextAiStyleControl === current.aiStyleControl &&
        nextOcularTuning === current.ocularTuning &&
        nextHeadDynamics === current.headDynamics
      ) {
        return state;
      }

      // Fix R2: build next overrides without mutating the previous object
      const nextOverrides: AvatarControlOverrides = {
        ...current,
      };

      if (nextEmotionControl === undefined) {
        delete nextOverrides.emotionControl;
      } else {
        nextOverrides.emotionControl = nextEmotionControl;
      }

      if (nextAiStyleControl === undefined) {
        delete nextOverrides.aiStyleControl;
      } else {
        nextOverrides.aiStyleControl = nextAiStyleControl;
      }

      if (nextOcularTuning === undefined) {
        delete nextOverrides.ocularTuning;
      } else {
        nextOverrides.ocularTuning = nextOcularTuning;
      }

      if (nextHeadDynamics === undefined) {
        delete nextOverrides.headDynamics;
      } else {
        nextOverrides.headDynamics = nextHeadDynamics;
      }

      return {
        sessionOverrides: nextOverrides,
        lastUpdatedAt: Date.now(), // Fix R3
      };
    });
  },
}));