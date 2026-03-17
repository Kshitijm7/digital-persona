"use client";

import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import {
  Environment,
  ContactShadows,
} from "@react-three/drei";
import React, { Suspense, lazy } from "react";
import { Avatar } from "./Avatar";
import { SkinPreset } from "@/lib/skinConfig";
import { getAvatarUrl } from "@/lib/avatars";
import { useSceneConfig } from "@/hooks/SceneConfigContext";
import { useAvatarRuntimeStore } from "@/store/useAvatarRuntimeStore";
import { mergeAvatarControls } from "@/lib/avatar-control.types";
import { SceneLoader } from "./SceneLoader";
import { SmartCameraControls } from "./SmartCameraControls";
import { useEmotionStore } from "@/store/useEmotionStore";
import { WebGLContextGuard } from "./WebGLContextGuard";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("Scene");

const DebugCameraPanel = lazy(() => import("./DebugCameraPanel"));

/**
 * Resolve DPR range dynamically, matching Visage BaseCanvas behaviour.
 * Uses half the native DPR as a floor, capped at 1.5 max.
 * This prevents ultra-high-DPR screens from crushing the framerate
 * while keeping 1x screens at full quality.
 */
const BASE_DPR = typeof window !== "undefined" ? window.devicePixelRatio : 1;
const DPR_RANGE: [number, number] = [
  Math.max(0.5, BASE_DPR * 0.5),
  Math.min(BASE_DPR, 1.5),
];

export interface SceneProps {
  audioLevelRef: React.RefObject<number>;
  currentExpression?: string;
  skinPreset?: SkinPreset | null;
  isConnected?: boolean;
  /** When true, enables OrbitControls + live debug panel. Default: false */
  debug?: boolean;
}

/**
 * 3D canvas — video-call style 3-point lighting rig.
 * Reads all settings from SceneConfigContext for live reactivity.
 *
 * Best practices combined from:
 *  - RPM Editor: powerPreference, alpha, preserveDrawingBuffer
 *  - Visage BaseCanvas: resize debounce, dynamic DPR, key-based FOV remount
 *  - Current project: ACES tone mapping, soft shadows, ContactShadows, Environment
 */
export function SceneInner({
  audioLevelRef,
  currentExpression = "idle",
  skinPreset = null,
  isConnected = false,
  debug = false,
}: SceneProps) {
  const { config, avatarRegistry } = useSceneConfig();
  const sessionOverrides = useAvatarRuntimeStore((state) => state.sessionOverrides);
  const features = config.features;

  const effectiveControls = React.useMemo(
    () => mergeAvatarControls(
      {
        emotionControl: config.emotionControl,
        ocularTuning: config.ocularTuning,
        meshPostProcessing: config.meshPostProcessing,
        headDynamics: config.headDynamics,
        anatomicalPostProcessing: config.anatomicalPostProcessing,
        visemeOverrides: config.visemeOverrides,
        aiStyleControl: config.aiStyleControl,
        meshConfig: config.meshConfig,
      },
      isConnected ? sessionOverrides : {},
      !isConnected,
    ),
    [config, isConnected, sessionOverrides],
  );

  const avatarUrl = getAvatarUrl(config.avatar.model, avatarRegistry, effectiveControls.meshConfig);

  /* Camera controls distance limits — from config or Visage CAMERA defaults */
  const controlsMinDistance = config.camera.controlsMinDistance ?? 0.5;
  const controlsMaxDistance = config.camera.controlsMaxDistance ?? 3.2;
  const minPolarAngle = config.camera.minPolarAngle ?? 1.4;
  const maxPolarAngle = config.camera.maxPolarAngle ?? 1.4;
  const zoomTargetShift = config.camera.zoomTargetShift ?? 0.6;

  // Implementation of P1 (TTL-based decay / Hysteresis) for live sessions
  React.useEffect(() => {
    if (!isConnected) return;

    // We run a relatively smooth heartbeat at ~250ms that gently degrades active expression overrides
    const decayTimer = setInterval(() => {
      // 1. Decay explicit tool-called overrides
      const runtimeStore = useAvatarRuntimeStore.getState();
      const hasOverrides = runtimeStore.sessionOverrides.emotionControl || runtimeStore.sessionOverrides.aiStyleControl;
      
      if (hasOverrides) {
        const timeSinceUpdate = Date.now() - runtimeStore.lastUpdatedAt;
        // If the agent hasn't issued a new expression tool-call in 3.5 seconds, we start drifting back to baseline
        if (timeSinceUpdate > 3500) {
          runtimeStore.decaySessionOverrides(0.9); // ~10% intensity reduction every 250ms
        }
      }

      // 2. Decay procedural sentiment score so smiles/frowns don't get permanently stuck
      useEmotionStore.getState().decayScore();

    }, 250);

    return () => clearInterval(decayTimer);
  }, [isConnected]);

  return (
    <Canvas
      /* key={fov} forces a clean Canvas remount when FOV changes (Visage best practice) */
      key={config.camera.fov}
      camera={{
        position: [config.camera.position.x, config.camera.position.y, config.camera.position.z],
        fov: config.camera.fov || 50,
      }}
      shadows
      dpr={DPR_RANGE}
      gl={{
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.8,
      }}
      /* Visage: debounced resize prevents layout thrashing on scroll/resize */
      resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}
      style={{ background: "transparent" }}
    >
      <WebGLContextGuard
        onContextLost={() => {
          // Pause any animation loops, stop sending frames
          log.warn("Scene: WebGL context lost — pausing.");
        }}
        onContextRestored={() => {
          log.info("Scene: WebGL context restored — resuming.");
        }}
      />

      {/* Base ambient fill */}
      <ambientLight intensity={0.3} />

      {/* Key light */}
      <spotLight
        position={[config.lighting.keyLight.position.x, config.lighting.keyLight.position.y, config.lighting.keyLight.position.z]}
        angle={0.25}
        penumbra={0.8}
        intensity={config.lighting.keyLight.intensity}
        castShadow
        shadow-mapSize={1024}
        color={config.lighting.keyLight.color}
      />

      {/* Fill light */}
      <spotLight
        position={[config.lighting.fillLight.position.x, config.lighting.fillLight.position.y, config.lighting.fillLight.position.z]}
        angle={0.35}
        penumbra={1}
        intensity={config.lighting.fillLight.intensity}
        color={config.lighting.fillLight.color}
      />

      {/* Rim light */}
      <pointLight
        position={[config.lighting.rimLight.position.x, config.lighting.rimLight.position.y, config.lighting.rimLight.position.z]}
        intensity={config.lighting.rimLight.intensity}
        color={config.lighting.rimLight.color}
      />

      <Suspense fallback={<SceneLoader />}>
        <group
          position={[config.avatar.position.x, config.avatar.position.y, config.avatar.position.z]}
          rotation={[config.avatar.rotation.x, config.avatar.rotation.y, config.avatar.rotation.z]}
          scale={config.avatar.scale}
        >
          <Avatar
            audioLevelRef={audioLevelRef}
            avatarUrl={avatarUrl}
            currentExpression={currentExpression}
            skinPreset={skinPreset}
            featureToggles={features}
            emotionControl={effectiveControls.emotionControl}
            ocularTuning={effectiveControls.ocularTuning}
            meshPostProcessing={effectiveControls.meshPostProcessing}
            headDynamics={effectiveControls.headDynamics}
            anatomicalPostProcessing={effectiveControls.anatomicalPostProcessing}
            visemeOverrides={effectiveControls.visemeOverrides}
            aiStyleControl={effectiveControls.aiStyleControl}
          />
        </group>
        <Environment preset="studio" />
      </Suspense>

      <ContactShadows
        opacity={0.35}
        scale={10}
        blur={2.4}
        near={0.1}
        far={0.8}
        position={[0, 0, 0]}
        color="#22d3ee"
      />

      <SmartCameraControls
        makeDefault={debug}
        enableDamping={debug}
        dampingFactor={0.05}
        enableRotate={debug}
        enablePan={debug}
        target={[config.camera.target.x, config.camera.target.y, config.camera.target.z]}
        minDistance={controlsMinDistance}
        maxDistance={controlsMaxDistance}
        minPolarAngle={minPolarAngle}
        maxPolarAngle={maxPolarAngle}
        zoomTargetShift={zoomTargetShift}
      />

      {/* Debug mode: live camera panel */}
      {debug && (
        <Suspense fallback={null}>
          <DebugCameraPanel />
        </Suspense>
      )}
    </Canvas>
  );
}

// Re-export as default
export default function Scene(props: SceneProps) {
  return <SceneInner {...props} />;
}
