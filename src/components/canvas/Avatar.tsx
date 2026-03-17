import * as THREE from "three";
import React, { useRef, useEffect, useState } from "react";
import { useGraph, useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { GLTF, SkeletonUtils } from "three-stdlib";
import { SkinPreset } from "@/lib/skinConfig";
import { useSkinMaterial } from "@/hooks/useSkinTexture";
import { normaliseFbxAnimations } from "@/lib/animationUtils";
import { type FeatureToggles } from "@/hooks/SceneConfigContext";
import {
  useDynamicAnimations,
  CROSSFADE_DURATION_MS,
} from "@/hooks/useDynamicAnimations";
import { useAnimationStore } from "@/store/useAnimationStore";
import { IdleExpressionEngine } from "@/lib/idle-expression-engine";
import { GazeEngine } from "@/lib/gaze-engine";
import { LipSyncEngine } from "@/lib/lipsync-engine";
import { EmotionEngine } from "@/lib/emotion-engine";
import { useLipSyncStore } from "@/store/useLipSyncStore";
import { createLogger } from "@/lib/logging/logger";
import {
  DEFAULT_AI_STYLE_CONTROL,
  DEFAULT_ANATOMICAL_POST_PROCESSING,
  DEFAULT_EMOTION_CONTROL,
  DEFAULT_HEAD_DYNAMICS,
  DEFAULT_MESH_POST_PROCESSING,
  DEFAULT_OCULAR_TUNING,
  DEFAULT_VISEME_OVERRIDES,
  type AIStyleControl,
  type AnatomicalPostProcessing,
  type EmotionControl,
  type HeadDynamics,
  type MeshPostProcessing,
  type OcularTuning,
  type VisemeOverrides,
} from "@/lib/avatar-control.types";

const log = createLogger("Avatar");

type GLTFResult = GLTF & {
  nodes: Partial<Record<string, THREE.Object3D>> & {
    Wolf3D_Hair?: THREE.SkinnedMesh;
    Wolf3D_Glasses?: THREE.SkinnedMesh;
    Wolf3D_Outfit_Top?: THREE.SkinnedMesh;
    Wolf3D_Outfit_Bottom?: THREE.SkinnedMesh;
    Wolf3D_Outfit_Footwear?: THREE.SkinnedMesh;
    Wolf3D_Body?: THREE.SkinnedMesh;
    EyeLeft?: THREE.SkinnedMesh;
    EyeRight?: THREE.SkinnedMesh;
    Wolf3D_Head?: THREE.SkinnedMesh;
    Wolf3D_Teeth?: THREE.SkinnedMesh;
    Hips?: THREE.Bone;
    Head?: THREE.Bone;
  };
  materials: Partial<Record<string, THREE.MeshStandardMaterial>> & {
    Wolf3D_Hair?: THREE.MeshStandardMaterial;
    Wolf3D_Glasses?: THREE.MeshStandardMaterial;
    Wolf3D_Outfit_Top?: THREE.MeshStandardMaterial;
    Wolf3D_Outfit_Bottom?: THREE.MeshStandardMaterial;
    Wolf3D_Outfit_Footwear?: THREE.MeshStandardMaterial;
    Wolf3D_Body?: THREE.MeshStandardMaterial;
    Wolf3D_Eye?: THREE.MeshStandardMaterial;
    Wolf3D_Skin?: THREE.MeshStandardMaterial;
    Wolf3D_Teeth?: THREE.MeshStandardMaterial;
  };
};

interface AvatarProps {
  audioLevelRef: React.RefObject<number | null>;
  avatarUrl: string;
  currentExpression?: string;
  skinPreset?: SkinPreset | null;
  featureToggles?: FeatureToggles;
  emotionControl?: EmotionControl;
  ocularTuning?: OcularTuning;
  meshPostProcessing?: MeshPostProcessing;
  headDynamics?: HeadDynamics;
  anatomicalPostProcessing?: AnatomicalPostProcessing;
  visemeOverrides?: VisemeOverrides;
  aiStyleControl?: AIStyleControl;
}

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

/**
 * Wolf3D avatar with real-time lip-sync, idle breathing,
 * MeshPhysicalMaterial skin with SSS, and gaze drift.
 */
export function Avatar({
  audioLevelRef,
  avatarUrl,
  currentExpression,
  skinPreset = null,
  featureToggles = DEFAULT_FEATURES,
  emotionControl = DEFAULT_EMOTION_CONTROL,
  ocularTuning = DEFAULT_OCULAR_TUNING,
  meshPostProcessing = DEFAULT_MESH_POST_PROCESSING,
  headDynamics = DEFAULT_HEAD_DYNAMICS,
  anatomicalPostProcessing = DEFAULT_ANATOMICAL_POST_PROCESSING,
  visemeOverrides = DEFAULT_VISEME_OVERRIDES,
  aiStyleControl = DEFAULT_AI_STYLE_CONTROL,
}: AvatarProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const { scene, animations: avatarAnimations } = useGLTF(avatarUrl);

  const currentAnimationName = useAnimationStore((s) => s.currentAnimation);
  const activeQueueItems = useAnimationStore((s) => s.animationQueue);
  const registry = useAnimationStore((s) => s.registry);
  const wawaLipsync = useLipSyncStore((s) => s.wawaLipsync);
  const lipSyncTuning = useLipSyncStore((s) => s.tuning);

  // idleClip: preloaded by useDynamicAnimations so the mixer always has a
  // ready crossfade target when the queue drains — no async wait at that moment.
  const { activeClip, idleClip } = useDynamicAnimations();

  const clone = React.useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes, materials } = useGraph(clone) as unknown as GLTFResult;

  // Visage material normalization: prevents texture pixelation and sets roughness
  React.useEffect(() => {
    Object.values(materials).forEach((material) => {
      if (!material) return;
      const mat = material as THREE.MeshStandardMaterial;
      if (mat.map) {
        mat.map.minFilter = THREE.LinearFilter;
        mat.depthWrite = true;
      }
      if (mat.name.toLowerCase().includes("hair")) {
        mat.roughness = 0.9;
      }
    });
  }, [materials]);

  const headSkinMaterial = useSkinMaterial(materials.Wolf3D_Skin, skinPreset);
  const bodySkinMaterial = useSkinMaterial(materials.Wolf3D_Body, skinPreset);

  // Combine avatar's built-in clips with the dynamically loaded activeClip and
  // the always-preloaded idleClip. Each queued clip has a unique name like
  // "dance__<uuid>" so the mixer creates a distinct AnimationAction per item,
  // enabling proper crossfades even for back-to-back identical animations.
  // normaliseFbxAnimations is applied only to the avatar's built-in clips here —
  // dynamically loaded clips are normalised once at load time in useDynamicAnimations.
  const normalizedAnimations = React.useMemo(() => {
    const baseClips = normaliseFbxAnimations([...(avatarAnimations || [])]);
    const dynamic: THREE.AnimationClip[] = [];
    if (activeClip) dynamic.push(activeClip);
    // Register idleClip separately from activeClip so the mixer always holds
    // a ready idle action regardless of what the queue is currently playing.
    if (idleClip && idleClip !== activeClip) dynamic.push(idleClip);
    return [...baseClips, ...dynamic];
  }, [avatarAnimations, activeClip, idleClip]);

  const { actions } = useAnimations(normalizedAnimations, groupRef);

  const previousActionRef = useRef<THREE.AnimationAction | null>(null);

  // activeClip.name is the unique key (e.g. "dance__<uuid>") that maps to a
  // distinct AnimationAction. Using it as a dependency ensures that even
  // repeated same-name animations trigger a new effect run and a proper crossfade.
  const activeClipName = activeClip?.name ?? null;

  useEffect(() => {
    // Resolve which action to play:
    // 1. Unique activeClip name exists in actions → use it (dynamic clip).
    // 2. Fall back to currentAnimationName for built-in avatar clips.
    const actionName =
      (activeClipName && actions[activeClipName])
        ? activeClipName
        : (currentAnimationName && actions[currentAnimationName])
          ? currentAnimationName
          : undefined;

    if (!actionName || !actions[actionName]) return;

    const currentAction = actions[actionName];
    const isIdleAction = currentAnimationName === "idle";

    const activeData = activeQueueItems.find(
      (item) => item.name === currentAnimationName
    );
    const speed = activeData?.timeScale ?? 1.0;
    currentAction.setEffectiveTimeScale(speed);

    if (isIdleAction) {
      currentAction.setLoop(THREE.LoopRepeat, Infinity);
    } else {
      // Play once — useDynamicAnimations queue timer advances to the next
      // animation or back to idle when the clip finishes.
      currentAction.setLoop(THREE.LoopOnce, 1);
    }

    currentAction.reset().play();
    log.debug({ animation: actionName, speed }, "Playing Avatar animation");

    // Resolve crossfade duration: per-animation registry override takes
    // priority, then the shared constant (200 ms — within the 100–300 ms
    // humanoid best-practice range).
    const animMeta = registry[currentAnimationName];
    const crossfadeSec =
      (animMeta?.crossfadeDurationMs ?? CROSSFADE_DURATION_MS) / 1000;

    // Because each queued clip has a unique name, previousActionRef.current
    // will always differ from currentAction — we always get a smooth crossfade
    // even when the same animation is queued back-to-back.
    if (
      previousActionRef.current &&
      previousActionRef.current !== currentAction
    ) {
      log.debug(
        {
          from: previousActionRef.current.getClip().name,
          to: actionName,
          crossfadeSec,
        },
        "Crossfading Avatar animation"
      );
      currentAction.crossFadeFrom(previousActionRef.current, crossfadeSec, true);
    } else {
      currentAction.fadeIn(crossfadeSec);
    }

    previousActionRef.current = currentAction;

    return () => {
      // Intentionally empty: crossFadeFrom handles weight dial-down automatically.
    };
  }, [activeClipName, currentAnimationName, actions, activeQueueItems, registry]);

  const idleEngine = React.useMemo(() => new IdleExpressionEngine(), []);
  const gazeEngine = React.useMemo(() => new GazeEngine(), []);
  const lipsyncEngine = React.useMemo(() => new LipSyncEngine(), []);
  const emotionEngine = React.useMemo(() => new EmotionEngine(), []);

  const coarticulationWindowMs = React.useMemo(() => {
    const coarticulationFrames = Math.max(
      1,
      aiStyleControl.coarticulationWindowSize || 1
    );
    return Math.max(8, Math.min(180, coarticulationFrames * (1000 / 60)));
  }, [aiStyleControl.coarticulationWindowSize]);

  const runtimeLipSyncTuning = React.useMemo(
    () => ({ ...lipSyncTuning, anticipationWindowMs: coarticulationWindowMs }),
    [lipSyncTuning, coarticulationWindowMs]
  );

  // Verify morph targets once on mount
  const hasLoggedMorphs = useRef(false);
  useEffect(() => {
    const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
    if (head?.morphTargetDictionary && !hasLoggedMorphs.current) {
      log.debug(
        { morphTargets: Object.keys(head.morphTargetDictionary) },
        "[Avatar] Mesh Morph Targets"
      );
      hasLoggedMorphs.current = true;
    }
  }, [nodes.Wolf3D_Head]);

  // Safeguard: reset zero/NaN bone scales to prevent mesh collapse
  React.useEffect(() => {
    Object.values(nodes).forEach((node) => {
      const obj = node as THREE.Object3D;
      if (obj?.scale) {
        if (
          obj.scale.x === 0 || Number.isNaN(obj.scale.x) ||
          obj.scale.y === 0 || Number.isNaN(obj.scale.y) ||
          obj.scale.z === 0 || Number.isNaN(obj.scale.z)
        ) {
          console.warn(`[Avatar] Resetting invalid scale on node: ${obj.name}`);
          obj.scale.set(1, 1, 1);
        }
      }
    });
  }, [nodes]);

  const smoothedLevel = useRef(0);

  useFrame((state, delta) => {
    const camera = state.camera;
    if (!nodes.Wolf3D_Head || !nodes.Wolf3D_Teeth) return;

    const rawLevel = audioLevelRef.current ?? 0;

    // Fast attack + slower release keeps onset aligned while avoiding jitter.
    const attackAlpha = 1 - Math.exp(-delta * 24);
    const releaseAlpha = 1 - Math.exp(-delta * 8);
    const smoothingAlpha =
      rawLevel > smoothedLevel.current ? attackAlpha : releaseAlpha;
    smoothedLevel.current += (rawLevel - smoothedLevel.current) * smoothingAlpha;
    const level = smoothedLevel.current;
    const lipSyncLevel = Math.max(rawLevel, level);
    const isSpeaking = level > 0.05;

    // Reduce idle body animation weight while speaking so visemes remain
    // the visual focus — then restore it when speech ends.
    const activeBodyAction = activeClipName
      ? actions[activeClipName]
      : actions[currentAnimationName];
    if (currentAnimationName === "idle" && activeBodyAction) {
      const targetWeight = isSpeaking ? 0.2 : 1;
      const targetScale = isSpeaking ? 0.25 : 1;
      activeBodyAction.setEffectiveWeight(
        THREE.MathUtils.damp(
          activeBodyAction.getEffectiveWeight(),
          targetWeight,
          8,
          delta
        )
      );
      activeBodyAction.setEffectiveTimeScale(
        THREE.MathUtils.damp(
          activeBodyAction.getEffectiveTimeScale(),
          targetScale,
          10,
          delta
        )
      );
    }

    if (featureToggles.lipSync) {
      lipsyncEngine.updateFromAudioLevel(
        lipSyncLevel,
        delta,
        nodes,
        wawaLipsync,
        runtimeLipSyncTuning,
        { visemeOverrides, meshPostProcessing, anatomicalPostProcessing }
      );
    }

    emotionEngine.update(
      delta,
      nodes,
      currentExpression || "idle",
      hovered,
      featureToggles,
      isSpeaking,
      { emotionControl, aiStyleControl }
    );

    idleEngine.update(delta, nodes, {
      breathing: featureToggles.breathing,
      blinking: featureToggles.blinking,
      browTwitch: false,
      isSpeaking,
      speakingGain: lipSyncLevel,
      ocularTuning,
    });

    if (featureToggles.gazeDrift || featureToggles.headMovement) {
      gazeEngine.update(delta, camera, nodes, state.pointer, isSpeaking, {
        eyeDrift: featureToggles.gazeDrift,
        headMovement: featureToggles.headMovement,
        ocularTuning,
        headDynamics,
      });
    }
  });

  const hasSkinnedMesh = (
    mesh: THREE.SkinnedMesh | undefined
  ): mesh is THREE.SkinnedMesh =>
    Boolean(mesh?.geometry && mesh?.skeleton);

  return (
    <group
      ref={groupRef}
      dispose={null}
      position={[0, 0, 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        if (featureToggles.hoverEffect) {
          document.body.style.cursor = "pointer";
        }
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "default";
      }}
      scale={1}
    >
      {nodes.Hips && <primitive object={nodes.Hips} />}
      {hasSkinnedMesh(nodes.Wolf3D_Hair) && materials.Wolf3D_Hair && (
        <skinnedMesh
          castShadow
          receiveShadow
          frustumCulled={false}
          geometry={nodes.Wolf3D_Hair.geometry}
          material={materials.Wolf3D_Hair}
          skeleton={nodes.Wolf3D_Hair.skeleton}
        />
      )}
      {hasSkinnedMesh(nodes.Wolf3D_Glasses) && materials.Wolf3D_Glasses && (
        <skinnedMesh
          castShadow
          receiveShadow
          frustumCulled={false}
          geometry={nodes.Wolf3D_Glasses.geometry}
          material={materials.Wolf3D_Glasses}
          skeleton={nodes.Wolf3D_Glasses.skeleton}
        />
      )}
      {hasSkinnedMesh(nodes.Wolf3D_Outfit_Top) && materials.Wolf3D_Outfit_Top && (
        <skinnedMesh
          castShadow
          receiveShadow
          frustumCulled={false}
          geometry={nodes.Wolf3D_Outfit_Top.geometry}
          material={materials.Wolf3D_Outfit_Top}
          skeleton={nodes.Wolf3D_Outfit_Top.skeleton}
        />
      )}
      {hasSkinnedMesh(nodes.Wolf3D_Outfit_Bottom) &&
        materials.Wolf3D_Outfit_Bottom && (
          <skinnedMesh
            castShadow
            receiveShadow
            frustumCulled={false}
            geometry={nodes.Wolf3D_Outfit_Bottom.geometry}
            material={materials.Wolf3D_Outfit_Bottom}
            skeleton={nodes.Wolf3D_Outfit_Bottom.skeleton}
          />
        )}
      {hasSkinnedMesh(nodes.Wolf3D_Outfit_Footwear) &&
        materials.Wolf3D_Outfit_Footwear && (
          <skinnedMesh
            castShadow
            receiveShadow
            frustumCulled={false}
            geometry={nodes.Wolf3D_Outfit_Footwear.geometry}
            material={materials.Wolf3D_Outfit_Footwear}
            skeleton={nodes.Wolf3D_Outfit_Footwear.skeleton}
          />
        )}
      {hasSkinnedMesh(nodes.Wolf3D_Body) &&
        (bodySkinMaterial || materials.Wolf3D_Body) && (
          <skinnedMesh
            castShadow
            receiveShadow
            frustumCulled={false}
            geometry={nodes.Wolf3D_Body.geometry}
            material={bodySkinMaterial || materials.Wolf3D_Body}
            skeleton={nodes.Wolf3D_Body.skeleton}
          />
        )}
      {hasSkinnedMesh(nodes.EyeLeft) && materials.Wolf3D_Eye && (
        <skinnedMesh
          castShadow
          receiveShadow
          frustumCulled={false}
          name="EyeLeft"
          geometry={nodes.EyeLeft.geometry}
          material={materials.Wolf3D_Eye}
          skeleton={nodes.EyeLeft.skeleton}
          morphTargetDictionary={nodes.EyeLeft.morphTargetDictionary}
          morphTargetInfluences={nodes.EyeLeft.morphTargetInfluences}
        />
      )}
      {hasSkinnedMesh(nodes.EyeRight) && materials.Wolf3D_Eye && (
        <skinnedMesh
          castShadow
          receiveShadow
          frustumCulled={false}
          name="EyeRight"
          geometry={nodes.EyeRight.geometry}
          material={materials.Wolf3D_Eye}
          skeleton={nodes.EyeRight.skeleton}
          morphTargetDictionary={nodes.EyeRight.morphTargetDictionary}
          morphTargetInfluences={nodes.EyeRight.morphTargetInfluences}
        />
      )}
      {hasSkinnedMesh(nodes.Wolf3D_Head) &&
        (headSkinMaterial || materials.Wolf3D_Skin) && (
          <skinnedMesh
            castShadow
            receiveShadow
            frustumCulled={false}
            name="Wolf3D_Head"
            geometry={nodes.Wolf3D_Head.geometry}
            material={headSkinMaterial || materials.Wolf3D_Skin}
            skeleton={nodes.Wolf3D_Head.skeleton}
            morphTargetDictionary={nodes.Wolf3D_Head.morphTargetDictionary}
            morphTargetInfluences={nodes.Wolf3D_Head.morphTargetInfluences}
          />
        )}
      {hasSkinnedMesh(nodes.Wolf3D_Teeth) && materials.Wolf3D_Teeth && (
        <skinnedMesh
          castShadow
          receiveShadow
          frustumCulled={false}
          name="Wolf3D_Teeth"
          geometry={nodes.Wolf3D_Teeth.geometry}
          material={materials.Wolf3D_Teeth}
          skeleton={nodes.Wolf3D_Teeth.skeleton}
          morphTargetDictionary={nodes.Wolf3D_Teeth.morphTargetDictionary}
          morphTargetInfluences={nodes.Wolf3D_Teeth.morphTargetInfluences}
        />
      )}
    </group>
  );
}

// Animations are dynamically loaded via useDynamicAnimations