"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import initialConfig from "@/config/scene.json";
import avatarTuningConfig from "@/config/avatar-tuning.json";
import {
  DEFAULT_LIPSYNC_TUNING,
  type LipSyncTuning,
  useLipSyncStore,
} from "@/store/useLipSyncStore";
import {
  DEFAULT_AI_STYLE_CONTROL,
  DEFAULT_ANATOMICAL_POST_PROCESSING,
  DEFAULT_EMOTION_CONTROL,
  DEFAULT_HEAD_DYNAMICS,
  DEFAULT_MESH_CONFIG,
  DEFAULT_MESH_POST_PROCESSING,
  DEFAULT_OCULAR_TUNING,
  DEFAULT_VISEME_OVERRIDES,
  type AIStyleControl,
  type AnatomicalPostProcessing,
  type EmotionControl,
  type HeadDynamics,
  type MeshConfig,
  type MeshPostProcessing,
  type OcularTuning,
  type VisemeOverrides,
  sanitizeControlPatch,
  sanitizeEffectiveControls,
} from "@/lib/avatar-control.types";
import {
  type AvatarEntry,
  DEFAULT_AVATARS,
  fetchAvatarRegistry,
  loadClientAvatars,
  upsertClientAvatar,
  removeClientAvatar as removeClientAvatarFromStorage,
} from "@/lib/avatars";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Vector3D = { x: number; y: number; z: number };

export interface LightConfig {
  position: Vector3D;
  intensity: number;
  color: string;
}

export interface SceneConfig {
  camera: {
    position: Vector3D;
    fov: number;
    target: Vector3D;
    controlsMinDistance?: number;
    controlsMaxDistance?: number;
    minPolarAngle?: number;
    maxPolarAngle?: number;
    zoomTargetShift?: number;
  };
  avatar: {
    position: Vector3D;
    rotation: Vector3D;
    scale: number;
    model: string;
    idleAnimation: string;
  };
  lighting: {
    keyLight: LightConfig;
    fillLight: LightConfig;
    rimLight: LightConfig;
  };
  features: FeatureToggles;
  lipSyncTuning: LipSyncTuning;
  emotionControl: EmotionControl;
  ocularTuning: OcularTuning;
  meshPostProcessing: MeshPostProcessing;
  headDynamics: HeadDynamics;
  anatomicalPostProcessing: AnatomicalPostProcessing;
  visemeOverrides: VisemeOverrides;
  aiStyleControl: AIStyleControl;
  meshConfig: MeshConfig;
}

export interface FeatureToggles {
  lipSync: boolean;
  breathing: boolean;
  gazeDrift: boolean;
  blinking: boolean;
  hoverEffect: boolean;
  headMovement: boolean;
  googleSearch: boolean;
  proactiveAudio: boolean;
}

interface SceneConfigContextValue {
  config: SceneConfig;
  updateConfig: (patch: Partial<SceneConfig>) => void;
  setConfig: (full: SceneConfig) => void;
  toggleFeature: (key: keyof FeatureToggles) => void;
  avatarRegistry: AvatarEntry[];
  addClientAvatar: (entry: AvatarEntry) => void;
  removeClientAvatar: (id: string) => void;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_FEATURES: FeatureToggles = {
  lipSync: true,
  breathing: true,
  gazeDrift: false,
  blinking: true,
  hoverEffect: false,
  headMovement: true,
  googleSearch: true,
  proactiveAudio: true,
};

// ─── Fix SC1: compute initial config ONCE outside the component ───────────────
// This runs at module load time, not on every render.
function buildInitialConfig(): SceneConfig {
  const cfg = avatarTuningConfig as Record<string, unknown>;
  const sceneCfg = initialConfig as Record<string, unknown>;

  const sanitized = sanitizeEffectiveControls({
    emotionControl: {
      ...DEFAULT_EMOTION_CONTROL,
      ...((cfg.emotionControl as Partial<EmotionControl>) ?? {}),
      ...((sceneCfg.emotionControl as Partial<EmotionControl>) ?? {}),
    },
    ocularTuning: {
      ...DEFAULT_OCULAR_TUNING,
      ...((cfg.ocularTuning as Partial<OcularTuning>) ?? {}),
      ...((sceneCfg.ocularTuning as Partial<OcularTuning>) ?? {}),
    },
    meshPostProcessing: {
      ...DEFAULT_MESH_POST_PROCESSING,
      ...((cfg.meshPostProcessing as Partial<MeshPostProcessing>) ?? {}),
      ...((sceneCfg.meshPostProcessing as Partial<MeshPostProcessing>) ?? {}),
    },
    headDynamics: {
      ...DEFAULT_HEAD_DYNAMICS,
      ...((cfg.headDynamics as Partial<HeadDynamics>) ?? {}),
      ...((sceneCfg.headDynamics as Partial<HeadDynamics>) ?? {}),
    },
    anatomicalPostProcessing: {
      ...DEFAULT_ANATOMICAL_POST_PROCESSING,
      ...((cfg.anatomicalPostProcessing as Partial<AnatomicalPostProcessing>) ?? {}),
      ...((sceneCfg.anatomicalPostProcessing as Partial<AnatomicalPostProcessing>) ?? {}),
    },
    visemeOverrides: {
      ...DEFAULT_VISEME_OVERRIDES,
      ...((cfg.visemeOverrides as Partial<VisemeOverrides>) ?? {}),
      ...((sceneCfg.visemeOverrides as Partial<VisemeOverrides>) ?? {}),
    },
    aiStyleControl: {
      ...DEFAULT_AI_STYLE_CONTROL,
      ...((cfg.aiStyleControl as Partial<AIStyleControl>) ?? {}),
      ...((sceneCfg.aiStyleControl as Partial<AIStyleControl>) ?? {}),
    },
    meshConfig: {
      ...DEFAULT_MESH_CONFIG,
      ...((sceneCfg.meshConfig as Partial<MeshConfig>) ?? {}),
    },
  });

  const baseConfig = initialConfig as unknown as Omit<
    SceneConfig,
    | "features"
    | "lipSyncTuning"
    | "emotionControl"
    | "ocularTuning"
    | "meshPostProcessing"
    | "headDynamics"
    | "anatomicalPostProcessing"
    | "visemeOverrides"
    | "aiStyleControl"
    | "meshConfig"
  >;

  return {
    ...baseConfig,
    features: {
      ...DEFAULT_FEATURES,
      ...((sceneCfg.features as Partial<FeatureToggles>) ?? {}),
    },
    lipSyncTuning: {
      ...DEFAULT_LIPSYNC_TUNING,
      ...((sceneCfg.lipSyncTuning as Partial<LipSyncTuning>) ?? {}),
    },
    ...sanitized,
  } as SceneConfig;
}

// Fix SC4: load client avatars with try/catch for Safari private mode
function safeLoadClientAvatars(): AvatarEntry[] {
  try {
    return loadClientAvatars();
  } catch (err) {
    // localStorage unavailable (Safari private, quota exceeded, etc.)
    console.warn("[SceneConfig] Could not load client avatars:", err);
    return [];
  }
}

const INITIAL_CONFIG = buildInitialConfig();

const SceneConfigCtx = createContext<SceneConfigContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────────────────────

export function SceneConfigProvider({ children }: { children: ReactNode }) {
  const setLipSyncTuning = useLipSyncStore((s) => s.updateTuning);

  // Fix SC1: use the module-level constant as initial state
  const [config, _setConfig] = useState<SceneConfig>(INITIAL_CONFIG);

  // ── Config actions ──────────────────────────────────────────────────────────

  const updateConfig = useCallback((patch: Partial<SceneConfig>) => {
    const sanitizedControlPatch = sanitizeControlPatch({
      emotionControl: patch.emotionControl,
      ocularTuning: patch.ocularTuning,
      meshPostProcessing: patch.meshPostProcessing,
      headDynamics: patch.headDynamics,
      anatomicalPostProcessing: patch.anatomicalPostProcessing,
      visemeOverrides: patch.visemeOverrides,
      aiStyleControl: patch.aiStyleControl,
      meshConfig: patch.meshConfig,
    });

    _setConfig((prev) => ({
      ...prev,
      ...patch,
      // Deep-merge structural fields so partial patches don't wipe siblings
      camera: patch.camera ? { ...prev.camera, ...patch.camera } : prev.camera,
      avatar: patch.avatar ? { ...prev.avatar, ...patch.avatar } : prev.avatar,
      lighting: patch.lighting
        ? { ...prev.lighting, ...patch.lighting }
        : prev.lighting,
      features: patch.features
        ? { ...prev.features, ...patch.features }
        : prev.features,
      lipSyncTuning: patch.lipSyncTuning
        ? { ...prev.lipSyncTuning, ...patch.lipSyncTuning }
        : prev.lipSyncTuning,
      // Sanitized control fields
      emotionControl: sanitizedControlPatch.emotionControl
        ? { ...prev.emotionControl, ...sanitizedControlPatch.emotionControl }
        : prev.emotionControl,
      ocularTuning: sanitizedControlPatch.ocularTuning
        ? { ...prev.ocularTuning, ...sanitizedControlPatch.ocularTuning }
        : prev.ocularTuning,
      meshPostProcessing: sanitizedControlPatch.meshPostProcessing
        ? {
            ...prev.meshPostProcessing,
            ...sanitizedControlPatch.meshPostProcessing,
          }
        : prev.meshPostProcessing,
      headDynamics: sanitizedControlPatch.headDynamics
        ? { ...prev.headDynamics, ...sanitizedControlPatch.headDynamics }
        : prev.headDynamics,
      anatomicalPostProcessing: sanitizedControlPatch.anatomicalPostProcessing
        ? {
            ...prev.anatomicalPostProcessing,
            ...sanitizedControlPatch.anatomicalPostProcessing,
          }
        : prev.anatomicalPostProcessing,
      visemeOverrides: sanitizedControlPatch.visemeOverrides
        ? {
            ...prev.visemeOverrides,
            ...sanitizedControlPatch.visemeOverrides,
          }
        : prev.visemeOverrides,
      aiStyleControl: sanitizedControlPatch.aiStyleControl
        ? { ...prev.aiStyleControl, ...sanitizedControlPatch.aiStyleControl }
        : prev.aiStyleControl,
      meshConfig: sanitizedControlPatch.meshConfig
        ? { ...prev.meshConfig, ...sanitizedControlPatch.meshConfig }
        : prev.meshConfig,
    }));
  }, []);

  const setConfig = useCallback((full: SceneConfig) => {
    _setConfig(full);
  }, []);

  const toggleFeature = useCallback((key: keyof FeatureToggles) => {
    _setConfig((prev) => ({
      ...prev,
      features: { ...prev.features, [key]: !prev.features[key] },
    }));
  }, []);

  // ── Avatar registry ─────────────────────────────────────────────────────────

  const [baseAvatarRegistry, setBaseAvatarRegistry] =
    useState<AvatarEntry[]>(DEFAULT_AVATARS);

  // Fix SC3: error handling for avatar registry fetch
  useEffect(() => {
    fetchAvatarRegistry()
      .then(setBaseAvatarRegistry)
      .catch((err) => {
        console.warn(
          "[SceneConfig] Failed to fetch avatar registry; using defaults.",
          err
        );
        // Keep DEFAULT_AVATARS — already set as initial state
      });
  }, []);

  // Fix SC4: safe localStorage read
  const [clientAvatarRegistry, setClientAvatarRegistry] = useState<
    AvatarEntry[]
  >(() => safeLoadClientAvatars());

  const avatarRegistry = useMemo(() => {
    const byId = new Map<string, AvatarEntry>();
    for (const avatar of baseAvatarRegistry) byId.set(avatar.id, avatar);
    for (const avatar of clientAvatarRegistry)
      byId.set(avatar.id, { ...avatar, isCustom: true });
    return Array.from(byId.values());
  }, [baseAvatarRegistry, clientAvatarRegistry]);

  const addClientAvatar = useCallback((entry: AvatarEntry) => {
    try {
      const saved = upsertClientAvatar({ ...entry, isCustom: true });
      setClientAvatarRegistry(saved);
    } catch (err) {
      console.warn("[SceneConfig] Failed to persist client avatar:", err);
    }
  }, []);

  const removeClientAvatar = useCallback((id: string) => {
    try {
      const saved = removeClientAvatarFromStorage(id);
      setClientAvatarRegistry(saved);
    } catch (err) {
      console.warn("[SceneConfig] Failed to remove client avatar:", err);
    }
  }, []);

  // ── LipSync tuning sync (Fix SC5) ───────────────────────────────────────────
  // Use a ref to track the last synced value so we only call setLipSyncTuning
  // when lipSyncTuning actually changes identity, not on every config render.
  const lastLipSyncTuningRef = useRef(config.lipSyncTuning);
  useEffect(() => {
    if (config.lipSyncTuning !== lastLipSyncTuningRef.current) {
      lastLipSyncTuningRef.current = config.lipSyncTuning;
      setLipSyncTuning(config.lipSyncTuning);
    }
  }, [config.lipSyncTuning, setLipSyncTuning]);

  // ── Fix SC2: memoize context value so consumers don't re-render on every
  // unrelated state change (e.g. avatarRegistry loading).
  // This is the root fix for `connect` recreating on every render.
  const contextValue = useMemo<SceneConfigContextValue>(
    () => ({
      config,
      updateConfig,
      setConfig,
      toggleFeature,
      avatarRegistry,
      addClientAvatar,
      removeClientAvatar,
    }),
    [
      config,
      updateConfig,
      setConfig,
      toggleFeature,
      avatarRegistry,
      addClientAvatar,
      removeClientAvatar,
    ]
  );

  return (
    <SceneConfigCtx.Provider value={contextValue}>
      {children}
    </SceneConfigCtx.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useSceneConfig() {
  const ctx = useContext(SceneConfigCtx);
  if (!ctx) {
    throw new Error(
      "useSceneConfig must be used within <SceneConfigProvider>"
    );
  }
  return ctx;
}