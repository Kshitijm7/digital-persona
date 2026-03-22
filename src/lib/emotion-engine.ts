/**
 * EmotionEngine — facial expression driver
 *
 * Drives 9 ARKit blendshapes from three layered sources:
 *   1. Sentiment analysis (text → score → face)
 *   2. Emotion control (API / tool calls → state + intensity)
 *   3. UI expression overrides (highest priority)
 *
 * Speech-proportional modulation: louder speech → more expressive.
 * Asymmetric damping: fast onset, slow release (organic transitions).
 * All tuning constants from emotive-speech.json mode config.
 */

import * as THREE from "three";
import { useEmotionStore } from "@/store/useEmotionStore";
import {
  type AIStyleControl,
  type EmotionControl,
} from "@/lib/avatar-control.types";
import emotionTuning from "@/config/emotion-tuning.json";
import {
  getModeTuning,
  type EmotionModeConfig,
  type EmotiveSpeechMode,
} from "@/lib/emotive-speech-config";

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════

interface EmotionRuntimeOptions {
  emotionControl?: EmotionControl;
  aiStyleControl?: AIStyleControl;
  /**
   * 0–1 speech energy from LipSyncEngine.speechEnergy.
   * Drives proportional expression modulation — louder speech
   * produces more expressive face, whisper is subtler.
   */
  speechLevel?: number;
}

/** The five target channels this engine computes per frame. */
interface EmotionTargets {
  smile: number;
  cheek: number;
  browInnerUp: number;
  browDown: number;
  frown: number;
}

// ═══════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════

export const EMOTION_ENGINE_DRIVEN_MORPHS = [
  "mouthSmileLeft",
  "mouthSmileRight",
  "cheekSquintLeft",
  "cheekSquintRight",
  "browInnerUp",
  "browDownLeft",
  "browDownRight",
  "mouthFrownLeft",
  "mouthFrownRight",
] as const;

const ZERO_TARGETS: Readonly<EmotionTargets> = {
  smile: 0,
  cheek: 0,
  browInnerUp: 0,
  browDown: 0,
  frown: 0,
};

// ═══════════════════════════════════════════════════════════════════
//  Engine
// ═══════════════════════════════════════════════════════════════════

export class EmotionEngine {
  private smoothedScore = 0;
  private smoothedSpeechLevel = 0;
  private emotionCfg: EmotionModeConfig;

  constructor(mode: EmotiveSpeechMode = "broadcast") {
    this.emotionCfg = getModeTuning(mode).emotion;
  }

  /** Hot-swap emotion tuning. Safe mid-frame. */
  setMode(mode: EmotiveSpeechMode): void {
    this.emotionCfg = getModeTuning(mode).emotion;
  }

  update(
    delta: number,
    nodes: Record<string, THREE.Object3D | undefined>,
    currentExpression: string,
    hovered: boolean,
    featureToggles: { hoverEffect?: boolean },
    isSpeaking = false,
    options: EmotionRuntimeOptions = {},
  ): void {
    const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
    if (!head?.morphTargetDictionary || !head.morphTargetInfluences) return;

    const cfg = this.emotionCfg;

    // ── Smooth speech level ──────────────────────────────────────
    const rawSpeechLevel = THREE.MathUtils.clamp(
      options.speechLevel ?? 0,
      0,
      1,
    );
    this.smoothedSpeechLevel = THREE.MathUtils.damp(
      this.smoothedSpeechLevel,
      rawSpeechLevel,
      cfg.speechLevelLambda,
      delta,
    );

    // Speech-proportional expression multiplier.
    // At full speech energy: +boost% more expressive.
    // At silence: 1.0 (no change).
    const speechExprMult = isSpeaking
      ? 1 + this.smoothedSpeechLevel * cfg.speechExpressionBoost
      : 1;

    // ── Layer 1: Hover target ────────────────────────────────────
    const allowHoverFace =
      !isSpeaking && hovered && featureToggles.hoverEffect;
    const targets: EmotionTargets = {
      smile: allowHoverFace ? cfg.hoverSmile : 0,
      cheek: allowHoverFace ? cfg.hoverCheek : 0,
      browInnerUp: 0,
      browDown: 0,
      frown: 0,
    };

    // ── Layer 2: Sentiment analysis ──────────────────────────────
    const sentimentScore = useEmotionStore.getState().currentScore;
    this.smoothedScore = THREE.MathUtils.damp(
      this.smoothedScore,
      sentimentScore,
      cfg.sentimentLambda,
      delta,
    );
    this.applySentiment(targets, isSpeaking, speechExprMult);

    // ── Layer 3: Emotion control (API / tool calls) ──────────────
    const hasExplicitExpression = Boolean(
      currentExpression && currentExpression !== "idle",
    );
    if (!hasExplicitExpression) {
      this.applyEmotionControl(targets, options, speechExprMult);
    }

    // ── Layer 4: UI expression overrides (highest priority) ──────
    this.applyExpressionOverride(targets, currentExpression, isSpeaking);

    // ── Apply to mesh ────────────────────────────────────────────
    const dict = head.morphTargetDictionary;
    const influences = head.morphTargetInfluences;

    const apply = (name: string, target: number) => {
      const idx = dict[name];
      if (idx === undefined) return;
      const current = influences[idx];
      // Asymmetric: fast onset, slow release — smiles appear
      // naturally and linger instead of toggling robotically.
      const lambda =
        target > current ? cfg.onsetLambda : cfg.releaseLambda;
      influences[idx] = THREE.MathUtils.damp(current, target, lambda, delta);
    };

    apply("mouthSmileLeft", targets.smile);
    apply("mouthSmileRight", targets.smile);
    apply("cheekSquintLeft", targets.cheek);
    apply("cheekSquintRight", targets.cheek);
    apply("browInnerUp", targets.browInnerUp);
    apply("browDownLeft", targets.browDown);
    apply("browDownRight", targets.browDown);
    apply("mouthFrownLeft", targets.frown);
    apply("mouthFrownRight", targets.frown);

    // ── Fine-grained action units (additive) ─────────────────────
    if (!hasExplicitExpression) {
      const fineGrainedAUs = options.emotionControl?.fineGrainedAUs ?? [];
      const auIntensity = THREE.MathUtils.clamp(
        options.emotionControl?.emotionIntensity ?? 0,
        0,
        1,
      );
      for (const actionUnit of fineGrainedAUs) {
        apply(actionUnit, auIntensity);
      }
    }
  }

  // ─── Private: Sentiment layer ──────────────────────────────────

  private applySentiment(
    targets: EmotionTargets,
    isSpeaking: boolean,
    speechExprMult: number,
  ): void {
    const { sentiment } = emotionTuning;
    const score = this.smoothedScore;

    if (score > sentiment.positiveThreshold) {
      const mult = isSpeaking ? sentiment.speechMultiplier : 1.0;
      targets.smile = Math.min(
        1,
        targets.smile +
          score * sentiment.smileWeight * mult * speechExprMult,
      );
      targets.cheek = Math.min(
        1,
        targets.cheek +
          score * sentiment.cheekWeight * mult * speechExprMult,
      );
    } else if (score < sentiment.negativeThreshold) {
      const absScore = Math.abs(score);
      const mult = isSpeaking ? sentiment.speechMultiplier : 1.0;
      targets.frown = Math.min(
        1,
        targets.frown +
          absScore * sentiment.frownWeight * mult * speechExprMult,
      );
      targets.browDown = Math.min(
        1,
        targets.browDown +
          absScore * sentiment.browDownWeight * mult * speechExprMult,
      );
    }
  }

  // ─── Private: Emotion control layer ────────────────────────────

  private applyEmotionControl(
    targets: EmotionTargets,
    options: EmotionRuntimeOptions,
    speechExprMult: number,
  ): void {
    const { emotionControl, aiStyleControl } = options;
    if (!emotionControl) return;

    const cfg = this.emotionCfg;
    const promptInfluence = THREE.MathUtils.clamp(
      (aiStyleControl?.cfgScale ?? 1) / 2,
      0.5,
      2.5,
    );

    const controlIntensity = THREE.MathUtils.clamp(
      emotionControl.emotionIntensity,
      0,
      1,
    );
    const styleIntensity = THREE.MathUtils.clamp(
      aiStyleControl?.emotionIntensity ?? 1,
      0,
      1.5,
    );
    const blendedIntensity = THREE.MathUtils.clamp(
      controlIntensity * styleIntensity * promptInfluence * speechExprMult,
      0,
      1.5,
    );

    // State-driven targets from config
    const stateTargets =
      cfg.states[emotionControl.emotionState] ?? ZERO_TARGETS;
    for (const [key, value] of Object.entries(stateTargets)) {
      const k = key as keyof EmotionTargets;
      if (typeof value === "number" && value > 0) {
        targets[k] = Math.max(targets[k], value * blendedIntensity);
      }
    }

    // Text conditioning keywords from config
    const conditioning =
      `${emotionControl.textConditioning || ""} ${aiStyleControl?.emotionTextPrompt || ""}`.toLowerCase();
    for (const [keyword, keyTargets] of Object.entries(
      cfg.textConditioningKeywords,
    )) {
      if (conditioning.includes(keyword)) {
        for (const [key, value] of Object.entries(keyTargets)) {
          const k = key as keyof EmotionTargets;
          if (typeof value === "number" && value > 0) {
            targets[k] = Math.max(targets[k], value * blendedIntensity);
          }
        }
      }
    }
  }

  // ─── Private: Expression override layer ────────────────────────

  private applyExpressionOverride(
    targets: EmotionTargets,
    currentExpression: string,
    isSpeaking: boolean,
  ): void {
    const activeExpr =
      emotionTuning.expressions[
        currentExpression as keyof typeof emotionTuning.expressions
      ];
    if (!activeExpr) return;

    const stateIdx = isSpeaking ? 1 : 0;
    targets.smile = Math.max(targets.smile, activeExpr.smile[stateIdx]);
    targets.cheek = Math.max(targets.cheek, activeExpr.cheek[stateIdx]);
    targets.browInnerUp = Math.max(
      targets.browInnerUp,
      activeExpr.browInnerUp[stateIdx],
    );
    targets.browDown = Math.max(
      targets.browDown,
      activeExpr.browDown[stateIdx],
    );
    targets.frown = Math.max(targets.frown, activeExpr.frown[stateIdx]);
  }
}