export type EmotionState = "neutral" | "joy" | "anger" | "sadness" | "surprised" | "fear" | "disgust";

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
}

export interface MeshPostProcessing {
  upperFaceSmoothing: number;
  lowerFaceSmoothing: number;
  skinStrength: number;
  jawStrength: number;
  lipOpenOffset: number;
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
  textureAtlas: boolean;
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
};

export const DEFAULT_MESH_POST_PROCESSING: MeshPostProcessing = {
  upperFaceSmoothing: 0.001,
  lowerFaceSmoothing: 0.0023,
  skinStrength: 1.0,
  jawStrength: 1.1,
  lipOpenOffset: 0,
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
  textureAtlas: true,
};

function clampNumber(value: number | undefined, min: number, max: number): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(min, Math.min(max, value));
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  const entries = Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined);
  return Object.fromEntries(entries) as Partial<T>;
}

function compactOverrides(overrides: AvatarControlOverrides): AvatarControlOverrides {
  const next: AvatarControlOverrides = {};

  if (overrides.emotionControl) {
    const compact = compactObject(overrides.emotionControl);
    if (Object.keys(compact).length > 0) next.emotionControl = compact;
  }
  if (overrides.ocularTuning) {
    const compact = compactObject(overrides.ocularTuning);
    if (Object.keys(compact).length > 0) next.ocularTuning = compact;
  }
  if (overrides.meshPostProcessing) {
    const compact = compactObject(overrides.meshPostProcessing);
    if (Object.keys(compact).length > 0) next.meshPostProcessing = compact;
  }
  if (overrides.headDynamics) {
    const compact = compactObject(overrides.headDynamics);
    if (Object.keys(compact).length > 0) next.headDynamics = compact;
  }
  if (overrides.anatomicalPostProcessing) {
    const compact = compactObject(overrides.anatomicalPostProcessing);
    if (Object.keys(compact).length > 0) next.anatomicalPostProcessing = compact;
  }
  if (overrides.visemeOverrides) {
    const compact = compactObject(overrides.visemeOverrides);
    if (Object.keys(compact).length > 0) next.visemeOverrides = compact;
  }
  if (overrides.aiStyleControl) {
    const compact = compactObject(overrides.aiStyleControl);
    if (Object.keys(compact).length > 0) next.aiStyleControl = compact;
  }
  if (overrides.meshConfig) {
    const compact = compactObject(overrides.meshConfig);
    if (Object.keys(compact).length > 0) next.meshConfig = compact;
  }

  return next;
}

function sanitizeRange(value: unknown, fallback: [number, number], min: number, max: number): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  const a = clampNumber(Number(value[0]), min, max);
  const b = clampNumber(Number(value[1]), min, max);
  if (a === undefined || b === undefined) return fallback;
  return a <= b ? [a, b] : [b, a];
}

export function sanitizeAvatarControlOverrides(input: AvatarControlOverrides): AvatarControlOverrides {
  const patch: AvatarControlOverrides = {};

  if (input.emotionControl) {
    patch.emotionControl = {
      emotionState: input.emotionControl.emotionState,
      emotionIntensity: clampNumber(input.emotionControl.emotionIntensity, 0, 1),
      textConditioning: typeof input.emotionControl.textConditioning === "string"
        ? input.emotionControl.textConditioning.slice(0, 240)
        : undefined,
      fineGrainedAUs: Array.isArray(input.emotionControl.fineGrainedAUs)
        ? input.emotionControl.fineGrainedAUs.filter((v): v is string => typeof v === "string").slice(0, 12)
        : undefined,
    };
  }

  if (input.ocularTuning) {
    patch.ocularTuning = {
      saccadeStrength: clampNumber(input.ocularTuning.saccadeStrength, 0, 2),
      blinkIntervalMs: clampNumber(input.ocularTuning.blinkIntervalMs, 500, 12000),
      blinkDurationMs: clampNumber(input.ocularTuning.blinkDurationMs, 60, 450),
      eyelidOpenOffset: clampNumber(input.ocularTuning.eyelidOpenOffset, -0.25, 0.25),
      lookAtIK: typeof input.ocularTuning.lookAtIK === "boolean" ? input.ocularTuning.lookAtIK : undefined,
    };
  }

  if (input.meshPostProcessing) {
    patch.meshPostProcessing = {
      upperFaceSmoothing: clampNumber(input.meshPostProcessing.upperFaceSmoothing, 0, 0.05),
      lowerFaceSmoothing: clampNumber(input.meshPostProcessing.lowerFaceSmoothing, 0, 0.06),
      skinStrength: clampNumber(input.meshPostProcessing.skinStrength, 0, 2),
      jawStrength: clampNumber(input.meshPostProcessing.jawStrength, 0, 2),
      lipOpenOffset: clampNumber(input.meshPostProcessing.lipOpenOffset, -0.08, 0.08),
    };
  }

  if (input.headDynamics) {
    patch.headDynamics = {
      headMotionAccelerationLimit: clampNumber(input.headDynamics.headMotionAccelerationLimit, 0.01, 0.8),
      generateIdleMotion: typeof input.headDynamics.generateIdleMotion === "boolean"
        ? input.headDynamics.generateIdleMotion
        : undefined,
      pitchRange: input.headDynamics.pitchRange
        ? sanitizeRange(input.headDynamics.pitchRange, DEFAULT_HEAD_DYNAMICS.pitchRange, -45, 45)
        : undefined,
      yawRange: input.headDynamics.yawRange
        ? sanitizeRange(input.headDynamics.yawRange, DEFAULT_HEAD_DYNAMICS.yawRange, -60, 60)
        : undefined,
    };
  }

  if (input.anatomicalPostProcessing) {
    patch.anatomicalPostProcessing = {
      lowerFaceStrength: clampNumber(input.anatomicalPostProcessing.lowerFaceStrength, 0.2, 2.5),
      upperFaceStrength: clampNumber(input.anatomicalPostProcessing.upperFaceStrength, 0.2, 2.5),
      faceMaskLevel: clampNumber(input.anatomicalPostProcessing.faceMaskLevel, 0, 1),
      faceMaskSoftness: clampNumber(input.anatomicalPostProcessing.faceMaskSoftness, 0, 0.05),
      jawStrength: clampNumber(input.anatomicalPostProcessing.jawStrength, 0, 2),
      jawHeight: clampNumber(input.anatomicalPostProcessing.jawHeight, -0.25, 0.25),
      jawDepth: clampNumber(input.anatomicalPostProcessing.jawDepth, -0.25, 0.25),
      tongueStrength: clampNumber(input.anatomicalPostProcessing.tongueStrength, 0, 2),
      tongueHeight: clampNumber(input.anatomicalPostProcessing.tongueHeight, -0.2, 0.2),
      tongueDepth: clampNumber(input.anatomicalPostProcessing.tongueDepth, -0.2, 0.2),
    };
  }

  if (input.visemeOverrides) {
    patch.visemeOverrides = {
      drivingDataScale: clampNumber(input.visemeOverrides.drivingDataScale, 0, 2),
      strengthBMP: clampNumber(input.visemeOverrides.strengthBMP, 0, 300),
      strengthFV: clampNumber(input.visemeOverrides.strengthFV, 0, 300),
      strengthWOo: clampNumber(input.visemeOverrides.strengthWOo, 0, 300),
      strengthSZTD: clampNumber(input.visemeOverrides.strengthSZTD, 0, 300),
    };
  }

  if (input.aiStyleControl) {
    patch.aiStyleControl = {
      emotionTextPrompt: typeof input.aiStyleControl.emotionTextPrompt === "string"
        ? input.aiStyleControl.emotionTextPrompt.slice(0, 240)
        : undefined,
      emotionIntensity: clampNumber(input.aiStyleControl.emotionIntensity, 0, 1.5),
      cfgScale: clampNumber(input.aiStyleControl.cfgScale, 0.5, 6),
      coarticulationWindowSize: clampNumber(input.aiStyleControl.coarticulationWindowSize, 1, 12),
    };
  }

  if (input.meshConfig) {
    patch.meshConfig = {
      meshLod: clampNumber(input.meshConfig.meshLod, 0, 2) as 0 | 1 | 2 | undefined,
      useDracoCompression: typeof input.meshConfig.useDracoCompression === "boolean" ? input.meshConfig.useDracoCompression : undefined,
      useMeshOptCompression: typeof input.meshConfig.useMeshOptCompression === "boolean" ? input.meshConfig.useMeshOptCompression : undefined,
      morphTargets: typeof input.meshConfig.morphTargets === "string" ? input.meshConfig.morphTargets.slice(0, 120) : undefined,
      textureAtlas: typeof input.meshConfig.textureAtlas === "boolean" ? input.meshConfig.textureAtlas : undefined,
    };
  }

  return compactOverrides(patch);
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
  applyOfflineIdealProfile: boolean = false,
): AvatarControlBundle {
  const sanitizedSession = compactOverrides(sanitizeAvatarControlOverrides(sessionOverrides));
  const offlineProfile = applyOfflineIdealProfile
    ? compactOverrides(sanitizeAvatarControlOverrides(getOfflineIdealOverrides()))
    : {};

  return {
    emotionControl: {
      ...baseline.emotionControl,
      ...(offlineProfile.emotionControl ?? {}),
      ...(sanitizedSession.emotionControl ?? {}),
    },
    ocularTuning: {
      ...baseline.ocularTuning,
      ...(offlineProfile.ocularTuning ?? {}),
      ...(sanitizedSession.ocularTuning ?? {}),
    },
    meshPostProcessing: {
      ...baseline.meshPostProcessing,
      ...(offlineProfile.meshPostProcessing ?? {}),
      ...(sanitizedSession.meshPostProcessing ?? {}),
    },
    headDynamics: {
      ...baseline.headDynamics,
      ...(offlineProfile.headDynamics ?? {}),
      ...(sanitizedSession.headDynamics ?? {}),
    },
    anatomicalPostProcessing: {
      ...baseline.anatomicalPostProcessing,
      ...(offlineProfile.anatomicalPostProcessing ?? {}),
      ...(sanitizedSession.anatomicalPostProcessing ?? {}),
    },
    visemeOverrides: {
      ...baseline.visemeOverrides,
      ...(offlineProfile.visemeOverrides ?? {}),
      ...(sanitizedSession.visemeOverrides ?? {}),
    },
    aiStyleControl: {
      ...baseline.aiStyleControl,
      ...(offlineProfile.aiStyleControl ?? {}),
      ...(sanitizedSession.aiStyleControl ?? {}),
    },
    meshConfig: {
      ...baseline.meshConfig,
      ...(offlineProfile.meshConfig ?? {}),
      ...(sanitizedSession.meshConfig ?? {}),
    },
  };
}
