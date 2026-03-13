/*
  Avatar Component — loads the Ready Player Me GLB model
  and drives lip-sync via morph targets based on audio level.
  Auto-generated mesh structure from gltfjsx, enhanced with:
  - MeshPhysicalMaterial + subsurface scattering for photorealistic skin
  - SkinPreset system for hot-swappable skin tones
  - Gaze drift (realistic look-around when listening)
*/

import * as THREE from "three";
import React, { useRef, useEffect, useState } from "react";
import { useGraph, useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { GLTF, SkeletonUtils } from "three-stdlib";
import { SkinPreset } from "@/lib/skinConfig";
import { useSkinTexture } from "@/hooks/useSkinTexture";
import { normaliseFbxAnimations } from "@/lib/animationUtils";
import { type FeatureToggles } from "@/hooks/SceneConfigContext";
import { useDynamicAnimations } from "@/hooks/useDynamicAnimations";
import { useAnimationStore } from "@/store/useAnimationStore";
import { IdleExpressionEngine } from "@/lib/idle-expression-engine";
import { GazeEngine } from "@/lib/gaze-engine";
import { LipSyncEngine } from "@/lib/lipsync-engine";
import { EmotionEngine } from "@/lib/emotion-engine";
import { useLipSyncStore } from "@/store/useLipSyncStore";
import { createLogger } from "@/lib/logging/logger";

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
  currentAnimation?: string;
  currentExpression?: string;
  skinPreset?: SkinPreset | null;
  featureToggles?: FeatureToggles;
}

const DEFAULT_FEATURES: FeatureToggles = {
  lipSync: true,
  breathing: true,
  gazeDrift: false,
  blinking: true,
  hoverEffect: false,
  headMovement: false,
  googleSearch: true,
  proactiveAudio: true,
};

/**
 * Wolf3D avatar with real-time lip-sync, idle breathing,
 * MeshPhysicalMaterial skin with SSS, and gaze drift.
 */
export function Avatar({ audioLevelRef, avatarUrl, currentExpression, skinPreset = null, featureToggles = DEFAULT_FEATURES }: AvatarProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const { scene, animations: avatarAnimations } = useGLTF(avatarUrl);

  const currentAnimationName = useAnimationStore((state) => state.currentAnimation);
  const activeQueueItems = useAnimationStore((state) => state.animationQueue);
  const { activeClip } = useDynamicAnimations();

  const clone = React.useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes, materials } = useGraph(clone) as unknown as GLTFResult;

  // Visage material normalization: Prevents texture pixelation and sets specific roughness
  React.useEffect(() => {
    Object.values(materials).forEach((material) => {
      if (!material) return;
      const mat = material as THREE.MeshStandardMaterial;
      if (mat.map) {
        mat.map.minFilter = THREE.LinearFilter;
        mat.depthWrite = true;
      }
      if (mat.name.toLowerCase().includes("hair")) {
        mat.roughness = 0.9; // Standard Visage hair roughness
      }
    });
  }, [materials]);

  // Get the PBR skin material with SSS
  const skinMaterial = useSkinTexture(skinPreset);

  // Combine animations and bind them to the groupRef
  // Apply Mixamo FBX normalization best practice from Visage
  const normalizedAnimations = React.useMemo(() => {
    const allAnimations = [
      ...(avatarAnimations || []),
      ...(activeClip ? [activeClip] : []),
    ];
    return normaliseFbxAnimations(allAnimations);
  }, [avatarAnimations, activeClip]);

  const { actions } = useAnimations(normalizedAnimations, groupRef);

  const previousActionRef = useRef<THREE.AnimationAction | null>(null);

  useEffect(() => {
    const actionName = currentAnimationName && actions[currentAnimationName]
      ? currentAnimationName
      : undefined;

    if (!actionName || !actions[actionName]) return;

    const currentAction = actions[actionName];
    const isIdleAction = actionName === "idle";

    // Retrieve custom scaling from Gemini logic
    const activeData = activeQueueItems.find(item => item.name === currentAnimationName);
    const speed = activeData?.timeScale || 1.0;
    currentAction.setEffectiveTimeScale(speed);

    if (isIdleAction) {
      currentAction.setLoop(THREE.LoopRepeat, Infinity);
    } else {
      // Stop non-idle actions from snapping back to frame 0 at completion.
      currentAction.setLoop(THREE.LoopOnce, 1);
    }

    currentAction.reset().play();
    log.debug({ animation: actionName, speed }, "Playing Avatar animation");

    // If there is an active animation currently playing, cross-fade to the new one!
    // The `true` flag enables time-warping so mismatched length loops don't warp scale.
    if (previousActionRef.current && previousActionRef.current !== currentAction) {
      log.debug({ from: previousActionRef.current.getClip().name, to: actionName }, "Crossfading Avatar animation");
      currentAction.crossFadeFrom(previousActionRef.current, 0.5, true);
    } else {
      currentAction.fadeIn(0.5);
    }

    // Keep track of what is playing so the NEXT animation can fade from it
    previousActionRef.current = currentAction;

    return () => {
       // We intentionally DO NOT fadeOut here anymore, because the incoming 
       // `crossFadeFrom` handles the weight dialing down automatically!
    };
  }, [currentAnimationName, actions, activeQueueItems]);

  const idleEngine = React.useMemo(() => new IdleExpressionEngine(), []);
  const gazeEngine = React.useMemo(() => new GazeEngine(), []);
  const lipsyncEngine = React.useMemo(() => new LipSyncEngine(), []);
  const emotionEngine = React.useMemo(() => new EmotionEngine(), []);
  
  // Verify morph targets once
  const hasLoggedMorphs = useRef(false);
  useEffect(() => {
    const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
    if (head?.morphTargetDictionary && !hasLoggedMorphs.current) {
      console.log("[Avatar] Mesh Morph Targets:", Object.keys(head.morphTargetDictionary));
      hasLoggedMorphs.current = true;
    }
  }, [nodes.Wolf3D_Head]);


  // Safeguard: Reset zero/NaN scales on bones to prevent mesh collapse
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

  // Smoothed value for lip-sync
  const smoothedLevel = useRef(0);

  useFrame((state, delta) => {
    const camera = state.camera;
    // Race Condition Guard: wait for the head mesh to be ready
    if (!nodes.Wolf3D_Head || !nodes.Wolf3D_Teeth) return;

    const rawLevel = audioLevelRef.current ?? 0;

    // Fast attack + slower release keeps onset aligned while avoiding jitter.
    const attackAlpha = 1 - Math.exp(-delta * 24);
    const releaseAlpha = 1 - Math.exp(-delta * 8);
    const smoothingAlpha = rawLevel > smoothedLevel.current ? attackAlpha : releaseAlpha;
    smoothedLevel.current +=
      (rawLevel - smoothedLevel.current) * smoothingAlpha;
    const level = smoothedLevel.current;
    const lipSyncLevel = Math.max(rawLevel, level);
    const isSpeaking = level > 0.05;

    // Keep body idle subtle while speaking so visemes remain the visual focus.
    const activeBodyAction = actions[currentAnimationName];
    if (currentAnimationName === "idle" && activeBodyAction) {
      const targetWeight = isSpeaking ? 0.2 : 1;
      const targetScale = isSpeaking ? 0.25 : 1;
      activeBodyAction.setEffectiveWeight(
        THREE.MathUtils.damp(activeBodyAction.getEffectiveWeight(), targetWeight, 8, delta),
      );
      activeBodyAction.setEffectiveTimeScale(
        THREE.MathUtils.damp(activeBodyAction.getEffectiveTimeScale(), targetScale, 10, delta),
      );
    }

    // Drive jaw/mouth morph targets for lip-sync using LipSyncEngine
    if (featureToggles.lipSync) {
      const { wawaLipsync, tuning } = useLipSyncStore.getState();
      lipsyncEngine.updateFromAudioLevel(
        lipSyncLevel,
        delta,
        nodes,
        wawaLipsync,
        tuning,
      );
    }

    // Execute Emotion Engine (handles UI override, sentiments, and hover effects)
    /* eslint-disable */
    emotionEngine.update(delta, nodes, currentExpression || "idle", hovered, featureToggles as any, isSpeaking);
    /* eslint-enable */

    // Execute procedural idle engines only for enabled channels.
    idleEngine.update(delta, nodes, {
      breathing: featureToggles.breathing,
      blinking: featureToggles.blinking,
      browTwitch: false,
    });
    
    if (featureToggles.gazeDrift || featureToggles.headMovement) {
      gazeEngine.update(delta, camera, nodes, state.pointer, isSpeaking, {
        eyeDrift: featureToggles.gazeDrift,
        headMovement: featureToggles.headMovement,
      });
    }

  });

  const hasSkinnedMesh = (
    mesh: THREE.SkinnedMesh | undefined,
  ): mesh is THREE.SkinnedMesh => Boolean(mesh?.geometry && mesh?.skeleton);

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
      {hasSkinnedMesh(nodes.Wolf3D_Outfit_Bottom) && materials.Wolf3D_Outfit_Bottom && (
        <skinnedMesh
          castShadow
          receiveShadow
          frustumCulled={false}
          geometry={nodes.Wolf3D_Outfit_Bottom.geometry}
          material={materials.Wolf3D_Outfit_Bottom}
          skeleton={nodes.Wolf3D_Outfit_Bottom.skeleton}
        />
      )}
      {hasSkinnedMesh(nodes.Wolf3D_Outfit_Footwear) && materials.Wolf3D_Outfit_Footwear && (
        <skinnedMesh
          castShadow
          receiveShadow
          frustumCulled={false}
          geometry={nodes.Wolf3D_Outfit_Footwear.geometry}
          material={materials.Wolf3D_Outfit_Footwear}
          skeleton={nodes.Wolf3D_Outfit_Footwear.skeleton}
        />
      )}
      {/* Body — uses same PBR skin material for consistency */}
      {hasSkinnedMesh(nodes.Wolf3D_Body) && (skinMaterial || materials.Wolf3D_Body) && (
        <skinnedMesh
          castShadow
          receiveShadow
          frustumCulled={false}
          geometry={nodes.Wolf3D_Body.geometry}
          material={skinMaterial || materials.Wolf3D_Body}
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
      {/* Head — receives the full PBR MeshPhysicalMaterial with SSS (if not raw) */}
      {hasSkinnedMesh(nodes.Wolf3D_Head) && (skinMaterial || materials.Wolf3D_Skin) && (
        <skinnedMesh
          castShadow
          receiveShadow
          frustumCulled={false}
          name="Wolf3D_Head"
          geometry={nodes.Wolf3D_Head.geometry}
          material={skinMaterial || materials.Wolf3D_Skin}
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
