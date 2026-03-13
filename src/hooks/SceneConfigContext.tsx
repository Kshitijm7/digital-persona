"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import initialConfig from "@/config/scene.json";
import { DEFAULT_LIPSYNC_TUNING, type LipSyncTuning, useLipSyncStore } from "@/store/useLipSyncStore";
import {
  type AvatarEntry,
  DEFAULT_AVATARS,
  fetchAvatarRegistry,
  loadClientAvatars,
  upsertClientAvatar,
  removeClientAvatar as removeClientAvatarFromStorage,
} from "@/lib/avatars";

/* ─── Types ────────────────────────────────────────────────────────────────── */

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

/* ─── Defaults ─────────────────────────────────────────────────────────────── */

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

const SceneConfigCtx = createContext<SceneConfigContextValue | null>(null);

/* ─── Provider ─────────────────────────────────────────────────────────────── */

export function SceneConfigProvider({ children }: { children: ReactNode }) {
  const setLipSyncTuning = useLipSyncStore((state) => state.updateTuning);
  // Ensure default features exist if loading from older JSON without them
  const initial: SceneConfig = {
    ...initialConfig,
    features: {
      ...DEFAULT_FEATURES,
      ...((initialConfig as Record<string, unknown>).features as Partial<FeatureToggles> || {}),
    },
    lipSyncTuning: {
      ...DEFAULT_LIPSYNC_TUNING,
      ...((initialConfig as Record<string, unknown>).lipSyncTuning as Partial<LipSyncTuning> || {}),
    },
  } as SceneConfig;

  const [config, _setConfig] = useState<SceneConfig>(initial);

  const updateConfig = useCallback((patch: Partial<SceneConfig>) => {
    _setConfig((prev) => ({
      ...prev,
      ...patch,
      camera: patch.camera ? { ...prev.camera, ...patch.camera } : prev.camera,
      avatar: patch.avatar ? { ...prev.avatar, ...patch.avatar } : prev.avatar,
      lighting: patch.lighting ? { ...prev.lighting, ...patch.lighting } : prev.lighting,
      features: patch.features ? { ...prev.features, ...patch.features } : prev.features,
      lipSyncTuning: patch.lipSyncTuning
        ? { ...prev.lipSyncTuning, ...patch.lipSyncTuning }
        : prev.lipSyncTuning,
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

  // Load base avatar registry from public/avatars/index.json
  const [baseAvatarRegistry, setBaseAvatarRegistry] = useState<AvatarEntry[]>(DEFAULT_AVATARS);
  useEffect(() => {
    fetchAvatarRegistry().then(setBaseAvatarRegistry);
  }, []);

  // Load client-imported avatars from localStorage
  const [clientAvatarRegistry, setClientAvatarRegistry] = useState<AvatarEntry[]>(
    () => loadClientAvatars(),
  );

  const avatarRegistry = useMemo(() => {
    const byId = new Map<string, AvatarEntry>();
    for (const avatar of baseAvatarRegistry) {
      byId.set(avatar.id, avatar);
    }
    for (const avatar of clientAvatarRegistry) {
      byId.set(avatar.id, { ...avatar, isCustom: true });
    }
    return Array.from(byId.values());
  }, [baseAvatarRegistry, clientAvatarRegistry]);

  const addClientAvatar = useCallback((entry: AvatarEntry) => {
    const saved = upsertClientAvatar({ ...entry, isCustom: true });
    setClientAvatarRegistry(saved);
  }, []);

  const removeClientAvatar = useCallback((id: string) => {
    const saved = removeClientAvatarFromStorage(id);
    setClientAvatarRegistry(saved);
  }, []);

  useEffect(() => {
    setLipSyncTuning(config.lipSyncTuning);
  }, [config.lipSyncTuning, setLipSyncTuning]);

  return (
    <SceneConfigCtx.Provider
      value={{
        config,
        updateConfig,
        setConfig,
        toggleFeature,
        avatarRegistry,
        addClientAvatar,
        removeClientAvatar,
      }}
    >
      {children}
    </SceneConfigCtx.Provider>
  );
}

/* ─── Hook ─────────────────────────────────────────────────────────────────── */

export function useSceneConfig() {
  const ctx = useContext(SceneConfigCtx);
  if (!ctx) throw new Error("useSceneConfig must be used within <SceneConfigProvider>");
  return ctx;
}
