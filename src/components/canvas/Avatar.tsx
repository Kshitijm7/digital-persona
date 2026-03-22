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
import { EmotionEngine, EMOTION_ENGINE_DRIVEN_MORPHS } from "@/lib/emotion-engine";
import { useLipSyncStore } from "@/store/useLipSyncStore";
import { createLogger } from "@/lib/logging/logger";
import { detectCapabilities } from "@/lib/avatars";
import { useEmotiveSpeechStore } from "@/store/useEmotiveSpeechStore";
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

// ─── Saccade constants ────────────────────────────────────────────────────────
// Fallback values used when ocularTuning does not provide interval overrides.
// The live values are read from ocularTuning on mount and after each jump so
// they can be hot-tuned per-avatar without a page reload.
const SACCADE_INTERVAL_MIN_MS_DEFAULT = 800;
const SACCADE_INTERVAL_MAX_MS_DEFAULT = 3200;
const SACCADE_MAGNITUDE               = 0.004;

// ─── Micro-expression constants ───────────────────────────────────────────────
const MICRO_EXPR_INTERVAL_MIN_MS = 1500;
const MICRO_EXPR_INTERVAL_MAX_MS = 5000;
const MICRO_EXPR_MAX_INFLUENCE   = 0.05;

// Shapes eligible for micro-expression noise.
//
// Exclusion rules (all three must hold):
//   1. Not driven by LipSyncEngine   — no jaw/mouth/viseme shapes
//   2. Not driven by EmotionEngine   — browInnerUp excluded (sadness/surprise)
//   3. Not driven by IdleExpressionEngine blink path — no eyeBlink* shapes
const MICRO_EXPRESSION_SHAPES = [
  "eyeSquintLeft",
  "eyeSquintRight",
  "mouthDimpleLeft",
  "mouthDimpleRight",
  "noseSneerLeft",
  "noseSneerRight",
] as const;

type MicroExprShape     = (typeof MICRO_EXPRESSION_SHAPES)[number];
type EmotionDrivenShape = (typeof EMOTION_ENGINE_DRIVEN_MORPHS)[number];

// Compile-time guard: resolves to `never` if any MicroExprShape appears in
// EMOTION_ENGINE_DRIVEN_MORPHS, surfacing the conflict as a TypeScript error
// instead of a silent runtime double-driver.
type AssertNoMorphOverlap = MicroExprShape extends EmotionDrivenShape
  ? never
  : true;
const _morphOverlapCheck: AssertNoMorphOverlap = true;
void _morphOverlapCheck;

// ─── GLTF type ────────────────────────────────────────────────────────────────

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

// ─── Props ────────────────────────────────────────────────────────────────────

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
  saccades: true,
  microExpressions: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Wolf3D avatar with:
 * - Real-time phoneme-driven lip-sync (wawa-lipsync + ARKit fallback)
 * - Procedural idle breathing
 * - Asymmetric blinking with cheek micro-squint
 * - Gaze drift + head movement driven by simplex noise and pointer
 * - Saccadic eye jumps (instantaneous fixation-point snaps on a random timer)
 * - Micro-expression noise (2–5% upper-face blendshape activations)
 * - MeshPhysicalMaterial skin with subsurface scattering
 * - Emotion-driven facial blendshapes with auto-decay
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
  const activeQueueItems     = useAnimationStore((s) => s.animationQueue);
  const registry             = useAnimationStore((s) => s.registry);
  const wawaLipsync          = useLipSyncStore((s) => s.wawaLipsync);
  const lipSyncTuning        = useLipSyncStore((s) => s.tuning);

  // idleClip: preloaded independently so the mixer always has a ready idle
  // action when the queue drains — no async wait at that point.
  const { activeClip, idleClip } = useDynamicAnimations();

  const clone = React.useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes, materials } = useGraph(clone) as unknown as GLTFResult;

  // ── Stable mesh ref ───────────────────────────────────────────────────────
  // The linter treats values from useGraph as immutable hook returns. Writing
  // to morphTargetInfluences through nodes.Wolf3D_Head is flagged even though
  // Three.js requires it. Storing the resolved mesh in a plain component-owned
  // ref bypasses the immutability rule correctly.
  const headMeshRef = useRef<THREE.SkinnedMesh | null>(null);

  useEffect(() => {
    const mesh = nodes.Wolf3D_Head;
    if (mesh?.morphTargetDictionary && mesh?.morphTargetInfluences) {
      headMeshRef.current = mesh as THREE.SkinnedMesh;
    }
  }, [nodes.Wolf3D_Head]);

  // ── Material normalisation ────────────────────────────────────────────────
  React.useEffect(() => {
    Object.values(materials).forEach((material) => {
      if (!material) return;
      const mat = material as THREE.MeshStandardMaterial;
      if (mat.map) {
        mat.map.minFilter = THREE.LinearFilter;
        mat.depthWrite    = true;
      }
      if (mat.name.toLowerCase().includes("hair")) {
        mat.roughness = 0.9;
      }
    });
  }, [materials]);

  const headSkinMaterial = useSkinMaterial(materials.Wolf3D_Skin, skinPreset);
  const bodySkinMaterial = useSkinMaterial(materials.Wolf3D_Body, skinPreset);

  // ── Animation clips ───────────────────────────────────────────────────────
  // activeClip carries a unique name per queue item ("wave__<uuid>") so the
  // mixer creates a distinct AnimationAction for each, enabling crossfades for
  // back-to-back identical animations.
  // idleClip registered separately so the mixer always holds a ready idle
  // action regardless of what the queue is currently playing.
  const normalizedAnimations = React.useMemo(() => {
    const baseClips = normaliseFbxAnimations([...(avatarAnimations || [])]);
    const dynamic: THREE.AnimationClip[] = [];
    if (activeClip) dynamic.push(activeClip);
    if (idleClip && idleClip !== activeClip) dynamic.push(idleClip);
    return [...baseClips, ...dynamic];
  }, [avatarAnimations, activeClip, idleClip]);

  const { actions } = useAnimations(normalizedAnimations, groupRef);

  const previousActionRef = useRef<THREE.AnimationAction | null>(null);
  const activeClipName    = activeClip?.name ?? null;

  // ── Animation playback + crossfade ───────────────────────────────────────
  useEffect(() => {
    const actionName =
      activeClipName && actions[activeClipName]
        ? activeClipName
        : currentAnimationName && actions[currentAnimationName]
          ? currentAnimationName
          : undefined;

    if (!actionName || !actions[actionName]) return;

    const currentAction = actions[actionName];
    const isIdleAction  = currentAnimationName === "idle";

    const activeData = activeQueueItems.find(
      (item) => item.name === currentAnimationName
    );
    const speed = activeData?.timeScale ?? 1.0;
    currentAction.setEffectiveTimeScale(speed);

    if (isIdleAction) {
      currentAction.setLoop(THREE.LoopRepeat, Infinity);
    } else {
      // Play once — useDynamicAnimations queue timer advances to the next
      // item or back to idle when the clip finishes.
      currentAction.setLoop(THREE.LoopOnce, 1);
    }

    currentAction.reset().play();
    log.debug({ animation: actionName, speed }, "Playing Avatar animation");

    // Per-animation registry override → shared constant (200 ms).
    // 200 ms is mid-range of the 100–300 ms humanoid best-practice window.
    const animMeta     = registry[currentAnimationName];
    const crossfadeSec =
      (animMeta?.crossfadeDurationMs ?? CROSSFADE_DURATION_MS) / 1000;

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
      currentAction.crossFadeFrom(
        previousActionRef.current,
        crossfadeSec,
        true
      );
    } else {
      currentAction.fadeIn(crossfadeSec);
    }

    previousActionRef.current = currentAction;

    return () => {
      // Intentionally empty: crossFadeFrom handles outgoing weight automatically.
    };
  }, [
    activeClipName,
    currentAnimationName,
    actions,
    activeQueueItems,
    registry,
  ]);

  // ── Crossfade back to idle when queue drains ──────────────────────────────
  // Kept separate so it only fires on the idle transition and does not
  // interfere with the queue crossfade logic above.
  useEffect(() => {
    if (currentAnimationName !== "idle") return;
    if (!idleClip) return;

    const idleAction = actions[idleClip.name];
    if (!idleAction) return;
    if (previousActionRef.current === idleAction) return;

    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.reset().play();

    const crossfadeSec = CROSSFADE_DURATION_MS / 1000;
    if (previousActionRef.current) {
      idleAction.crossFadeFrom(
        previousActionRef.current,
        crossfadeSec,
        true
      );
      log.debug(
        {
          from: previousActionRef.current.getClip().name,
          crossfadeSec,
        },
        "Crossfading back to idle"
      );
    } else {
      idleAction.fadeIn(crossfadeSec);
    }

    previousActionRef.current = idleAction;
  }, [currentAnimationName, idleClip, actions]);

  // ── Saccade state ─────────────────────────────────────────────────────────
  // All saccade state lives in refs — mutated directly in useFrame, no
  // setState calls, keeping this entirely outside React's render cycle.
  // Avatar.tsx owns the timer logic; GazeEngine is the sole writer of eye
  // bone rotations, consuming the offset each frame.
  const saccadeOffsetRef       = useRef(new THREE.Vector2(0, 0));
  const saccadeTimerRef        = useRef(0);
  const nextSaccadeIntervalRef = useRef(0); // set to real value on mount

  // ── Micro-expression state ────────────────────────────────────────────────
  const microExprTargetsRef      = useRef<Record<string, number>>(
    Object.fromEntries(MICRO_EXPRESSION_SHAPES.map((s) => [s, 0]))
  );
  const microExprTimerRef        = useRef(0);
  const nextMicroExprIntervalRef = useRef(0); // set to real value on mount

  // ── Initialise random intervals on mount ─────────────────────────────────
  // Math.random() cannot be called during render (impure). Running it in
  // useEffect places it after the first paint, outside the render phase.
  // ocularTuning interval fields are read here so per-avatar config is
  // respected from the first saccade rather than after the first jump.
  useEffect(() => {
    const minMs =
      ocularTuning.saccadeIntervalMinMs ?? SACCADE_INTERVAL_MIN_MS_DEFAULT;
    const maxMs =
      ocularTuning.saccadeIntervalMaxMs ?? SACCADE_INTERVAL_MAX_MS_DEFAULT;
    nextSaccadeIntervalRef.current    = randomInRange(minMs, maxMs);
    nextMicroExprIntervalRef.current  = randomInRange(
      MICRO_EXPR_INTERVAL_MIN_MS,
      MICRO_EXPR_INTERVAL_MAX_MS
    );
  // ocularTuning is intentionally omitted — we only want the initial seed.
  // Subsequent saccades read the live ocularTuning values directly in useFrame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mode = useEmotiveSpeechStore((s) => s.mode);

  // ── Engines ───────────────────────────────────────────────────────────────
  const idleEngine    = React.useMemo(() => new IdleExpressionEngine(), []);
  const gazeEngine    = React.useMemo(() => new GazeEngine(), []);
  const lipsyncEngine = React.useMemo(() => new LipSyncEngine(useEmotiveSpeechStore.getState().mode), []);
  const emotionEngine = React.useMemo(() => new EmotionEngine(useEmotiveSpeechStore.getState().mode), []);

  React.useEffect(() => {
    lipsyncEngine.setMode(mode);
    emotionEngine.setMode(mode);
  }, [mode, lipsyncEngine, emotionEngine]);

  const coarticulationWindowMs = React.useMemo(() => {
    const frames = Math.max(1, aiStyleControl.coarticulationWindowSize || 1);
    return Math.max(8, Math.min(180, frames * (1000 / 60)));
  }, [aiStyleControl.coarticulationWindowSize]);

  const runtimeLipSyncTuning = React.useMemo(
    () => ({ ...lipSyncTuning, anticipationWindowMs: coarticulationWindowMs }),
    [lipSyncTuning, coarticulationWindowMs]
  );

  // ── Debug: log morph targets once on mount ────────────────────────────────
  const hasLoggedMorphs = useRef(false);
  useEffect(() => {
    const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
    if (head?.morphTargetDictionary && !hasLoggedMorphs.current) {
      log.debug(
        { morphTargets: Object.keys(head.morphTargetDictionary) },
        "[Avatar] Mesh Morph Targets"
      );

      const caps = detectCapabilities(head.morphTargetDictionary);
      if (!caps.hasOculusVisemes) {
        log.warn("Avatar missing Oculus visemes — using ARKit fallback lip sync");
      }
      if (!caps.hasEmotionTargets) {
        log.warn("Avatar missing emotion blendshapes — expressions will be limited");
      }
      if (caps.missingTargets.length > 0) {
        log.debug({ missing: caps.missingTargets }, "Missing morph targets");
      }

      hasLoggedMorphs.current = true;
    }
  }, [nodes.Wolf3D_Head]);

  // ── Safeguard: reset zero/NaN bone scales ────────────────────────────────
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

  // ── Audio level smoothing ref ─────────────────────────────────────────────
  const smoothedLevel = useRef(0);

  // ─── Per-frame update ─────────────────────────────────────────────────────
  useFrame((state, delta) => {
    const camera = state.camera;

    // Race condition guard: head and teeth must be ready before driving morphs.
    if (!nodes.Wolf3D_Head || !nodes.Wolf3D_Teeth) return;

    // ── Audio smoothing ─────────────────────────────────────────────────────
    // Fast attack (~24 Hz) keeps lip-sync onset tight.
    // Slower release (~8 Hz) prevents jitter on silence.
    const rawLevel       = audioLevelRef.current ?? 0;
    const attackAlpha    = 1 - Math.exp(-delta * 24);
    const releaseAlpha   = 1 - Math.exp(-delta * 8);
    const smoothingAlpha =
      rawLevel > smoothedLevel.current ? attackAlpha : releaseAlpha;
    smoothedLevel.current +=
      (rawLevel - smoothedLevel.current) * smoothingAlpha;

    const level        = smoothedLevel.current;
    const lipSyncLevel = Math.max(rawLevel, level);
    const isSpeaking   = level > 0.05;

    // ── Idle body weight attenuation during speech ──────────────────────────
    // Reduces idle animation visual weight while speaking so the mouth remains
    // the dominant signal. Only applied to idle — queued gestures are
    // intentional and must not be attenuated.
    const activeBodyAction = activeClipName
      ? actions[activeClipName]
      : actions[currentAnimationName];

    if (currentAnimationName === "idle" && activeBodyAction) {
      activeBodyAction.setEffectiveWeight(
        THREE.MathUtils.damp(
          activeBodyAction.getEffectiveWeight(),
          isSpeaking ? 0.2 : 1,
          8,
          delta
        )
      );
      activeBodyAction.setEffectiveTimeScale(
        THREE.MathUtils.damp(
          activeBodyAction.getEffectiveTimeScale(),
          isSpeaking ? 0.25 : 1,
          10,
          delta
        )
      );
    }

    // ── Lip sync ────────────────────────────────────────────────────────────
    if (featureToggles.lipSync) {
      lipsyncEngine.updateFromAudioLevel(
        lipSyncLevel,
        delta,
        nodes,
        wawaLipsync,
        runtimeLipSyncTuning,
        { visemeOverrides, meshPostProcessing, anatomicalPostProcessing },
        !!wawaLipsync,
      );
    }

    // ── Emotion engine ──────────────────────────────────────────────────────
    // Drives smile, cheek, brow, and frown targets from sentiment score,
    // explicit expression overrides, and emotionControl config.
    emotionEngine.update(
      delta,
      nodes,
      currentExpression || "idle",
      hovered,
      featureToggles,
      isSpeaking,
      { emotionControl, aiStyleControl, speechLevel: lipsyncEngine.speechEnergy }
    );

    // ── Idle expression engine ──────────────────────────────────────────────
    // Handles blinking, eyelid open offset, and breathing.
    // browTwitch stays false — micro-expression system owns the upper-face
    // noise layer on shapes confirmed not to overlap with EmotionEngine.
    idleEngine.update(delta, nodes, {
      breathing:    featureToggles.breathing,
      blinking:     featureToggles.blinking,
      browTwitch:   false,
      isSpeaking,
      speakingGain: lipSyncLevel,
      ocularTuning,
    });

    // ── Saccades ─────────────────────────────────────────────────────────────
    // Gaze system runs when any of the three related flags are enabled.
    // Saccade jumps are independently gated on featureToggles.saccades so
    // a focused avatar can have headMovement without darting eyes.
    if (
      featureToggles.gazeDrift ||
      featureToggles.headMovement ||
      featureToggles.saccades
    ) {
      if (featureToggles.saccades && !isSpeaking) {
        saccadeTimerRef.current += delta * 1000;

        if (saccadeTimerRef.current >= nextSaccadeIntervalRef.current) {
          // Instantaneous snap to a new fixation point — that's what makes
          // it a saccade rather than smooth pursuit.
          saccadeOffsetRef.current.set(
            (Math.random() - 0.5) * 2 * SACCADE_MAGNITUDE,
            (Math.random() - 0.5) * 2 * SACCADE_MAGNITUDE
          );
          saccadeTimerRef.current = 0;
          // Re-read ocularTuning each jump so hot-changes take effect
          const minMs =
            ocularTuning.saccadeIntervalMinMs ??
            SACCADE_INTERVAL_MIN_MS_DEFAULT;
          const maxMs =
            ocularTuning.saccadeIntervalMaxMs ??
            SACCADE_INTERVAL_MAX_MS_DEFAULT;
          nextSaccadeIntervalRef.current = randomInRange(minMs, maxMs);
        }
      } else {
        // During speech OR when saccades disabled: damp offset to zero.
        // Damping rather than hard-zero prevents a visible snap if saccades
        // are toggled off mid-session with a non-zero offset.
        saccadeOffsetRef.current.x = THREE.MathUtils.damp(
          saccadeOffsetRef.current.x,
          0,
          4,
          delta
        );
        saccadeOffsetRef.current.y = THREE.MathUtils.damp(
          saccadeOffsetRef.current.y,
          0,
          4,
          delta
        );
      }

      gazeEngine.update(delta, camera, nodes, state.pointer, isSpeaking, {
        eyeDrift:      featureToggles.gazeDrift,
        headMovement:  featureToggles.headMovement,
        ocularTuning,
        headDynamics,
        saccadeOffset: saccadeOffsetRef.current,
      });
    }

    // ── Micro-expression noise ────────────────────────────────────────────────
    // Randomly activates 1–2 upper-face blendshapes at 2–5% influence.
    // All shapes in MICRO_EXPRESSION_SHAPES are verified at compile time not
    // to overlap with EMOTION_ENGINE_DRIVEN_MORPHS.
    const headMesh = headMeshRef.current;

    if (featureToggles.microExpressions) {
      if (headMesh?.morphTargetDictionary && headMesh.morphTargetInfluences) {
        if (!isSpeaking) {
          microExprTimerRef.current += delta * 1000;

          if (microExprTimerRef.current >= nextMicroExprIntervalRef.current) {
            // Reset all targets to zero then activate 1 or 2 random shapes.
            // 40% chance of two simultaneous activations for variety.
            for (const shape of MICRO_EXPRESSION_SHAPES) {
              microExprTargetsRef.current[shape] = 0;
            }
            const count = Math.random() < 0.4 ? 2 : 1;
            const chosen = [...MICRO_EXPRESSION_SHAPES]
              .sort(() => Math.random() - 0.5)
              .slice(0, count);
            for (const shape of chosen) {
              microExprTargetsRef.current[shape] =
                Math.random() * MICRO_EXPR_MAX_INFLUENCE;
            }

            microExprTimerRef.current = 0;
            nextMicroExprIntervalRef.current = randomInRange(
              MICRO_EXPR_INTERVAL_MIN_MS,
              MICRO_EXPR_INTERVAL_MAX_MS
            );
          }

          // Smoothly interpolate each shape toward its target each frame.
          // damp is frame-rate independent and prevents popping on tab restore.
          for (const shape of MICRO_EXPRESSION_SHAPES) {
            const idx = headMesh.morphTargetDictionary[shape];
            if (idx === undefined) continue;
            headMesh.morphTargetInfluences[idx] = THREE.MathUtils.damp(
              headMesh.morphTargetInfluences[idx] ?? 0,
              microExprTargetsRef.current[shape] ?? 0,
              6,
              delta
            );
          }
        } else {
          // Speaking: damp all micro-expression influences to zero.
          // Speed 12 (faster than activation speed 6) clears the face quickly
          // so there is no residual squint visible during speech.
          for (const shape of MICRO_EXPRESSION_SHAPES) {
            const idx = headMesh.morphTargetDictionary[shape];
            if (idx === undefined) continue;
            const current = headMesh.morphTargetInfluences[idx] ?? 0;
            if (current > 0.001) {
              headMesh.morphTargetInfluences[idx] = THREE.MathUtils.damp(
                current,
                0,
                12,
                delta
              );
            }
          }
        }
      }
    } else {
      // microExpressions toggled off — damp any lingering influences to zero
      // so the face doesn't freeze with residual values if toggled mid-session.
      if (headMesh?.morphTargetDictionary && headMesh.morphTargetInfluences) {
        for (const shape of MICRO_EXPRESSION_SHAPES) {
          const idx = headMesh.morphTargetDictionary[shape];
          if (idx === undefined) continue;
          const current = headMesh.morphTargetInfluences[idx] ?? 0;
          if (current > 0.001) {
            headMesh.morphTargetInfluences[idx] = THREE.MathUtils.damp(
              current,
              0,
              12,
              delta
            );
          }
        }
      }
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const hasSkinnedMesh = (
    mesh: THREE.SkinnedMesh | undefined
  ): mesh is THREE.SkinnedMesh =>
    Boolean(mesh?.geometry && mesh?.skeleton);

  // ── JSX ───────────────────────────────────────────────────────────────────

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

      {hasSkinnedMesh(nodes.Wolf3D_Outfit_Top) &&
        materials.Wolf3D_Outfit_Top && (
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

      {/* Body — PBR skin preserves unique body normal/AO maps */}
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

      {/* Head — full PBR MeshPhysicalMaterial with SSS */}
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