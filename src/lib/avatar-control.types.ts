export type EmotionState =
  | "neutral"
  | "joy"
  | "anger"
  | "sadness"
  | "surprised"
  | "fear"
  | "disgust";

const EMOTION_STATES: readonly EmotionState[] = [
  "neutral",
  "joy",
  "anger",
  "sadness",
  "surprised",
  "fear",
  "disgust",
];

export interface EmotionControl {
  emotionState: EmotionState;
  emotionIntensity: number;
  textConditioning: string;
  fineGrainedAUs: string[];
}

export interface OcularTuning {
  saccadeStrength: number;
  blinkIntervalMs: number;
  blinkDurationMs: number;
  eyelidOpenOffset: number;
  lookAtIK: boolean;
  browSpeechSync?: boolean;
  /**
   * Minimum milliseconds between saccadic eye jumps.
   * Default 800 ms. Tunable per-avatar so a focused professional avatar can
   * hold gaze longer than an expressive one.
   */
  saccadeIntervalMinMs?: number;
  /**
   * Maximum milliseconds between saccadic eye jumps.
   * Default 3200 ms.
   */
  saccadeIntervalMaxMs?: number;
}

export interface MeshPostProcessing {
  upperFaceSmoothing: number;
  lowerFaceSmoothing: number;
  skinStrength: number;
  jawStrength: number;
  lipOpenOffset: number;
  lipAsymmetryOffset?: number;
  morphWeightCap?: number;
}

export interface HeadDynamics {
  headMotionAccelerationLimit: number;
  generateIdleMotion: boolean;
  pitchRange: [number, number];
  yawRange: [number, number];
}

export interface AnatomicalPostProcessing {
  lowerFaceStrength: number;
  upperFaceStrength: number;
  faceMaskLevel: number;
  faceMaskSoftness: number;
  jawStrength: number;
  jawHeight: number;
  jawDepth: number;
  tongueStrength: number;
  tongueHeight: number;
  tongueDepth: number;
  jawDecouplingWeight?: number;
}

export interface VisemeOverrides {
  drivingDataScale: number;
  strengthBMP: number;
  strengthFV: number;
  strengthWOo: number;
  strengthSZTD: number;
}

export interface AIStyleControl {
  emotionTextPrompt: string;
  emotionIntensity: number;
  cfgScale: number;
  coarticulationWindowSize: number;
}

export interface MeshConfig {
  meshLod: 0 | 1 | 2;
  useDracoCompression: boolean;
  useMeshOptCompression: boolean;
  morphTargets: string;
  textureAtlas: "none" | "1024";
}

export interface AvatarControlBundle {
  emotionControl: EmotionControl;
  ocularTuning: OcularTuning;
  meshPostProcessing: MeshPostProcessing;
  headDynamics: HeadDynamics;
  anatomicalPostProcessing: AnatomicalPostProcessing;
  visemeOverrides: VisemeOverrides;
  aiStyleControl: AIStyleControl;
  meshConfig: MeshConfig;
}

export interface AvatarControlOverrides {
  emotionControl?: Partial<EmotionControl>;
  ocularTuning?: Partial<OcularTuning>;
  meshPostProcessing?: Partial<MeshPostProcessing>;
  headDynamics?: Partial<HeadDynamics>;
  anatomicalPostProcessing?: Partial<AnatomicalPostProcessing>;
  visemeOverrides?: Partial<VisemeOverrides>;
  aiStyleControl?: Partial<AIStyleControl>;
  meshConfig?: Partial<MeshConfig>;
}

export const DEFAULT_EMOTION_CONTROL: EmotionControl = {
  emotionState: "neutral",
  emotionIntensity: 0.25,
  textConditioning: "speaks with calm neutral expression",
  fineGrainedAUs: [],
};

export const DEFAULT_OCULAR_TUNING: OcularTuning = {
  saccadeStrength: 0.4,
  blinkIntervalMs: 3000,
  blinkDurationMs: 100,
  eyelidOpenOffset: 0.06,
  lookAtIK: true,
  browSpeechSync: false,
  saccadeIntervalMinMs: 800,
  saccadeIntervalMaxMs: 3200,
};

export const DEFAULT_MESH_POST_PROCESSING: MeshPostProcessing = {
  upperFaceSmoothing: 0.001,
  lowerFaceSmoothing: 0.0023,
  skinStrength: 1.0,
  jawStrength: 1.1,
  lipOpenOffset: 0,
  lipAsymmetryOffset: 0.0,
  morphWeightCap: 1.0,
};

export const DEFAULT_HEAD_DYNAMICS: HeadDynamics = {
  headMotionAccelerationLimit: 0.15,
  generateIdleMotion: true,
  pitchRange: [-15, 15],
  yawRange: [-20, 20],
};

export const DEFAULT_ANATOMICAL_POST_PROCESSING: AnatomicalPostProcessing = {
  lowerFaceStrength: 1.0,
  upperFaceStrength: 1.0,
  faceMaskLevel: 0.5,
  faceMaskSoftness: 0.0085,
  jawStrength: 1.0,
  jawHeight: 0.0,
  jawDepth: 0.0,
  tongueStrength: 1.0,
  tongueHeight: 0.0,
  tongueDepth: 0.0,
  jawDecouplingWeight: 0.0,
};

export const DEFAULT_VISEME_OVERRIDES: VisemeOverrides = {
  drivingDataScale: 1.0,
  strengthBMP: 100,
  strengthFV: 100,
  strengthWOo: 100,
  strengthSZTD: 100,
};

export const DEFAULT_AI_STYLE_CONTROL: AIStyleControl = {
  emotionTextPrompt: "neutral professional expression",
  emotionIntensity: 0.35,
  cfgScale: 1.2,
  coarticulationWindowSize: 5,
};

export const DEFAULT_MESH_CONFIG: MeshConfig = {
  meshLod: 1,
  useDracoCompression: true,
  useMeshOptCompression: true,
  morphTargets: "ARKit,Oculus Visemes",
  textureAtlas: "1024",
};

// ─── Sanitisation helpers ─────────────────────────────────────────────────────

function sanitizeTextureAtlas(
  value: unknown
): MeshConfig["textureAtlas"] | undefined {
  if (value === "none" || value === "1024") return value;
  if (typeof value === "boolean") return value ? "1024" : "none";
  return undefined;
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number
): number | undefined {
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    !Number.isFinite(value)
  )
    return undefined;
  return Math.max(min, Math.min(max, value));
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number
): number | undefined {
  const clamped = clampNumber(value, min, max);
  return clamped === undefined ? undefined : Math.round(clamped);
}

function sanitizeEmotionState(value: unknown): EmotionState | undefined {
  if (typeof value !== "string") return undefined;
  return (EMOTION_STATES as readonly string[]).includes(value)
    ? (value as EmotionState)
    : undefined;
}

function compactObject<T extends Record<string, unknown>>(
  value: T
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

function compactOverrides(
  overrides: AvatarControlOverrides
): AvatarControlOverrides {
  const next: AvatarControlOverrides = {};
  const fields = [
    "emotionControl",
    "ocularTuning",
    "meshPostProcessing",
    "headDynamics",
    "anatomicalPostProcessing",
    "visemeOverrides",
    "aiStyleControl",
    "meshConfig",
  ] as const;
  for (const field of fields) {
    if (overrides[field]) {
      const compact = compactObject(
        overrides[field] as Record<string, unknown>
      );
      if (Object.keys(compact).length > 0) {
        (next as Record<string, unknown>)[field] = compact;
      }
    }
  }
  return next;
}

function sanitizeRange(
  value: unknown,
  fallback: [number, number],
  min: number,
  max: number
): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  const a = clampNumber(Number(value[0]), min, max);
  const b = clampNumber(Number(value[1]), min, max);
  if (a === undefined || b === undefined) return fallback;
  return a <= b ? [a, b] : [b, a];
}

// ─── Public sanitisation API ──────────────────────────────────────────────────

export function sanitizeAvatarControlOverrides(
  input: AvatarControlOverrides
): AvatarControlOverrides {
  const patch: AvatarControlOverrides = {};

  if (input.emotionControl) {
    patch.emotionControl = {
      emotionState: sanitizeEmotionState(input.emotionControl.emotionState),
      emotionIntensity: clampNumber(input.emotionControl.emotionIntensity, 0, 1),
      textConditioning:
        typeof input.emotionControl.textConditioning === "string"
          ? input.emotionControl.textConditioning.slice(0, 240)
          : undefined,
      fineGrainedAUs: Array.isArray(input.emotionControl.fineGrainedAUs)
        ? input.emotionControl.fineGrainedAUs
            .filter((v): v is string => typeof v === "string")
            .slice(0, 12)
        : undefined,
    };
  }

  if (input.ocularTuning) {
    patch.ocularTuning = {
      saccadeStrength: clampNumber(input.ocularTuning.saccadeStrength, 0, 2),
      blinkIntervalMs: clampInteger(
        input.ocularTuning.blinkIntervalMs,
        500,
        12000
      ),
      blinkDurationMs: clampInteger(
        input.ocularTuning.blinkDurationMs,
        60,
        450
      ),
      eyelidOpenOffset: clampNumber(
        input.ocularTuning.eyelidOpenOffset,
        -0.25,
        0.25
      ),
      lookAtIK:
        typeof input.ocularTuning.lookAtIK === "boolean"
          ? input.ocularTuning.lookAtIK
          : undefined,
      browSpeechSync:
        typeof input.ocularTuning.browSpeechSync === "boolean"
          ? input.ocularTuning.browSpeechSync
          : undefined,
      // Saccade interval bounds — clamped to physiologically plausible range
      saccadeIntervalMinMs: clampInteger(
        input.ocularTuning.saccadeIntervalMinMs,
        200,
        2000
      ),
      saccadeIntervalMaxMs: clampInteger(
        input.ocularTuning.saccadeIntervalMaxMs,
        500,
        8000
      ),
    };
  }

  if (input.meshPostProcessing) {
    patch.meshPostProcessing = {
      upperFaceSmoothing: clampNumber(
        input.meshPostProcessing.upperFaceSmoothing,
        0,
        0.05
      ),
      lowerFaceSmoothing: clampNumber(
        input.meshPostProcessing.lowerFaceSmoothing,
        0,
        0.06
      ),
      skinStrength: clampNumber(input.meshPostProcessing.skinStrength, 0, 2),
      jawStrength: clampNumber(input.meshPostProcessing.jawStrength, 0, 2),
      lipOpenOffset: clampNumber(
        input.meshPostProcessing.lipOpenOffset,
        -0.08,
        0.08
      ),
      lipAsymmetryOffset: clampNumber(
        input.meshPostProcessing.lipAsymmetryOffset,
        0,
        0.1
      ),
      morphWeightCap: clampNumber(
        input.meshPostProcessing.morphWeightCap,
        0.5,
        2.0
      ),
    };
  }

  if (input.headDynamics) {
    patch.headDynamics = {
      headMotionAccelerationLimit: clampNumber(
        input.headDynamics.headMotionAccelerationLimit,
        0.01,
        0.8
      ),
      generateIdleMotion:
        typeof input.headDynamics.generateIdleMotion === "boolean"
          ? input.headDynamics.generateIdleMotion
          : undefined,
      pitchRange: input.headDynamics.pitchRange
        ? sanitizeRange(
            input.headDynamics.pitchRange,
            DEFAULT_HEAD_DYNAMICS.pitchRange,
            -45,
            45
          )
        : undefined,
      yawRange: input.headDynamics.yawRange
        ? sanitizeRange(
            input.headDynamics.yawRange,
            DEFAULT_HEAD_DYNAMICS.yawRange,
            -60,
            60
          )
        : undefined,
    };
  }

  if (input.anatomicalPostProcessing) {
    patch.anatomicalPostProcessing = {
      lowerFaceStrength: clampNumber(
        input.anatomicalPostProcessing.lowerFaceStrength,
        0.2,
        2.5
      ),
      upperFaceStrength: clampNumber(
        input.anatomicalPostProcessing.upperFaceStrength,
        0.2,
        2.5
      ),
      faceMaskLevel: clampNumber(
        input.anatomicalPostProcessing.faceMaskLevel,
        0,
        1
      ),
      faceMaskSoftness: clampNumber(
        input.anatomicalPostProcessing.faceMaskSoftness,
        0,
        0.05
      ),
      jawStrength: clampNumber(
        input.anatomicalPostProcessing.jawStrength,
        0,
        2
      ),
      jawHeight: clampNumber(
        input.anatomicalPostProcessing.jawHeight,
        -0.25,
        0.25
      ),
      jawDepth: clampNumber(
        input.anatomicalPostProcessing.jawDepth,
        -0.25,
        0.25
      ),
      tongueStrength: clampNumber(
        input.anatomicalPostProcessing.tongueStrength,
        0,
        2
      ),
      tongueHeight: clampNumber(
        input.anatomicalPostProcessing.tongueHeight,
        -0.2,
        0.2
      ),
      tongueDepth: clampNumber(
        input.anatomicalPostProcessing.tongueDepth,
        -0.2,
        0.2
      ),
      jawDecouplingWeight: clampNumber(
        input.anatomicalPostProcessing.jawDecouplingWeight,
        0,
        1.0
      ),
    };
  }

  if (input.visemeOverrides) {
    patch.visemeOverrides = {
      drivingDataScale: clampNumber(
        input.visemeOverrides.drivingDataScale,
        0,
        2
      ),
      strengthBMP: clampNumber(input.visemeOverrides.strengthBMP, 0, 300),
      strengthFV: clampNumber(input.visemeOverrides.strengthFV, 0, 300),
      strengthWOo: clampNumber(input.visemeOverrides.strengthWOo, 0, 300),
      strengthSZTD: clampNumber(input.visemeOverrides.strengthSZTD, 0, 300),
    };
  }

  if (input.aiStyleControl) {
    patch.aiStyleControl = {
      emotionTextPrompt:
        typeof input.aiStyleControl.emotionTextPrompt === "string"
          ? input.aiStyleControl.emotionTextPrompt.slice(0, 240)
          : undefined,
      emotionIntensity: clampNumber(
        input.aiStyleControl.emotionIntensity,
        0,
        1.5
      ),
      cfgScale: clampNumber(input.aiStyleControl.cfgScale, 0.5, 6),
      coarticulationWindowSize: clampInteger(
        input.aiStyleControl.coarticulationWindowSize,
        1,
        12
      ),
    };
  }

  if (input.meshConfig) {
    patch.meshConfig = {
      meshLod: clampNumber(input.meshConfig.meshLod, 0, 2) as
        | 0
        | 1
        | 2
        | undefined,
      useDracoCompression:
        typeof input.meshConfig.useDracoCompression === "boolean"
          ? input.meshConfig.useDracoCompression
          : undefined,
      useMeshOptCompression:
        typeof input.meshConfig.useMeshOptCompression === "boolean"
          ? input.meshConfig.useMeshOptCompression
          : undefined,
      morphTargets:
        typeof input.meshConfig.morphTargets === "string"
          ? input.meshConfig.morphTargets.slice(0, 120)
          : undefined,
      textureAtlas: sanitizeTextureAtlas(input.meshConfig.textureAtlas),
    };
  }

  return compactOverrides(patch);
}

export function sanitizeControlPatch(
  input: AvatarControlOverrides
): AvatarControlOverrides {
  return sanitizeAvatarControlOverrides(input);
}

export function sanitizeEffectiveControls(
  input: AvatarControlBundle
): AvatarControlBundle {
  const sanitized = sanitizeAvatarControlOverrides(input);
  return {
    emotionControl: {
      ...DEFAULT_EMOTION_CONTROL,
      ...(sanitized.emotionControl ?? {}),
    },
    ocularTuning: {
      ...DEFAULT_OCULAR_TUNING,
      ...(sanitized.ocularTuning ?? {}),
    },
    meshPostProcessing: {
      ...DEFAULT_MESH_POST_PROCESSING,
      ...(sanitized.meshPostProcessing ?? {}),
    },
    headDynamics: {
      ...DEFAULT_HEAD_DYNAMICS,
      ...(sanitized.headDynamics ?? {}),
    },
    anatomicalPostProcessing: {
      ...DEFAULT_ANATOMICAL_POST_PROCESSING,
      ...(sanitized.anatomicalPostProcessing ?? {}),
    },
    visemeOverrides: {
      ...DEFAULT_VISEME_OVERRIDES,
      ...(sanitized.visemeOverrides ?? {}),
    },
    aiStyleControl: {
      ...DEFAULT_AI_STYLE_CONTROL,
      ...(sanitized.aiStyleControl ?? {}),
    },
    meshConfig: {
      ...DEFAULT_MESH_CONFIG,
      ...(sanitized.meshConfig ?? {}),
    },
  };
}

export function getDefaultAvatarControlBundle(): AvatarControlBundle {
  return {
    emotionControl: { ...DEFAULT_EMOTION_CONTROL },
    ocularTuning: { ...DEFAULT_OCULAR_TUNING },
    meshPostProcessing: { ...DEFAULT_MESH_POST_PROCESSING },
    headDynamics: { ...DEFAULT_HEAD_DYNAMICS },
    anatomicalPostProcessing: { ...DEFAULT_ANATOMICAL_POST_PROCESSING },
    visemeOverrides: { ...DEFAULT_VISEME_OVERRIDES },
    aiStyleControl: { ...DEFAULT_AI_STYLE_CONTROL },
    meshConfig: { ...DEFAULT_MESH_CONFIG },
  };
}

export function getOfflineIdealOverrides(): AvatarControlOverrides {
  return {
    emotionControl: {
      emotionState: "neutral",
      emotionIntensity: 0.22,
    },
    ocularTuning: {
      saccadeStrength: 0.3,
      blinkIntervalMs: 3200,
      blinkDurationMs: 120,
      lookAtIK: false,
      saccadeIntervalMinMs: 1000,
      saccadeIntervalMaxMs: 4000,
    },
    headDynamics: {
      generateIdleMotion: true,
      headMotionAccelerationLimit: 0.09,
    },
    aiStyleControl: {
      emotionIntensity: 0.35,
    },
  };
}

export function mergeAvatarControls(
  baseline: AvatarControlBundle,
  sessionOverrides: AvatarControlOverrides = {},
  applyOfflineIdealProfile = false
): AvatarControlBundle {
  const sanitizedBaseline = sanitizeEffectiveControls(baseline);
  const sanitizedSession = compactOverrides(
    sanitizeAvatarControlOverrides(sessionOverrides)
  );
  const offlineProfile = applyOfflineIdealProfile
    ? compactOverrides(
        sanitizeAvatarControlOverrides(getOfflineIdealOverrides())
      )
    : {};

  return {
    emotionControl: {
      ...sanitizedBaseline.emotionControl,
      ...(offlineProfile.emotionControl ?? {}),
      ...(sanitizedSession.emotionControl ?? {}),
    },
    ocularTuning: {
      ...sanitizedBaseline.ocularTuning,
      ...(offlineProfile.ocularTuning ?? {}),
      ...(sanitizedSession.ocularTuning ?? {}),
    },
    meshPostProcessing: {
      ...sanitizedBaseline.meshPostProcessing,
      ...(offlineProfile.meshPostProcessing ?? {}),
      ...(sanitizedSession.meshPostProcessing ?? {}),
    },
    headDynamics: {
      ...sanitizedBaseline.headDynamics,
      ...(offlineProfile.headDynamics ?? {}),
      ...(sanitizedSession.headDynamics ?? {}),
    },
    anatomicalPostProcessing: {
      ...sanitizedBaseline.anatomicalPostProcessing,
      ...(offlineProfile.anatomicalPostProcessing ?? {}),
      ...(sanitizedSession.anatomicalPostProcessing ?? {}),
    },
    visemeOverrides: {
      ...sanitizedBaseline.visemeOverrides,
      ...(offlineProfile.visemeOverrides ?? {}),
      ...(sanitizedSession.visemeOverrides ?? {}),
    },
    aiStyleControl: {
      ...sanitizedBaseline.aiStyleControl,
      ...(offlineProfile.aiStyleControl ?? {}),
      ...(sanitizedSession.aiStyleControl ?? {}),
    },
    meshConfig: {
      ...sanitizedBaseline.meshConfig,
      ...(offlineProfile.meshConfig ?? {}),
      ...(sanitizedSession.meshConfig ?? {}),
    },
  };
}