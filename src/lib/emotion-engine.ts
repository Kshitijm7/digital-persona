import * as THREE from "three";
import { useEmotionStore } from "@/store/useEmotionStore";
import {
  type AIStyleControl,
  type EmotionControl,
} from "@/lib/avatar-control.types";
import emotionTuning from "@/config/emotion-tuning.json";

interface EmotionRuntimeOptions {
  emotionControl?: EmotionControl;
  aiStyleControl?: AIStyleControl;
  // 0–1 speech energy from LipSyncEngine.speechEnergy.
  // Drives proportional expression modulation — louder speech
  // produces more expressive face, whisper is subtler.
  speechLevel?: number;
}

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

export class EmotionEngine {
  private smoothedScore = 0;
  // Smoothed speech level for proportional modulation.
  // Raw speechLevel from lip sync can be jittery frame-to-frame;
  // smoothing gives organic expression transitions.
  private smoothedSpeechLevel = 0;

  update(
    delta: number,
    nodes: Record<string, THREE.Object3D | undefined>,
    currentExpression: string,
    hovered: boolean,
    featureToggles: { hoverEffect?: boolean },
    isSpeaking = false,
    options: EmotionRuntimeOptions = {},
  ) {
    const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
    if (!head?.morphTargetDictionary || !head.morphTargetInfluences) return;

    // Smooth the speech level for organic modulation.
    // Lambda 8 = responsive but not jittery (~60ms settling).
    const rawSpeechLevel = THREE.MathUtils.clamp(options.speechLevel ?? 0, 0, 1);
    this.smoothedSpeechLevel = THREE.MathUtils.damp(
      this.smoothedSpeechLevel,
      rawSpeechLevel,
      8,
      delta,
    );

    // Speech-proportional expression multiplier.
    // At full speech energy: +25% more expressive.
    // At silence: 1.0 (no change). Subtle but sells "alive".
    const speechExprMult = isSpeaking
      ? 1 + this.smoothedSpeechLevel * 0.25
      : 1;

    const allowHoverFace = !isSpeaking && hovered && featureToggles.hoverEffect;
    let targetSmile = allowHoverFace ? 0.8 : 0;
    let targetCheek = allowHoverFace ? 0.3 : 0;
    let targetBrowInnerUp = 0;
    let targetBrowDown = 0;
    let targetFrown = 0;

    const sentimentScore = useEmotionStore.getState().currentScore;
    this.smoothedScore = THREE.MathUtils.damp(
      this.smoothedScore,
      sentimentScore,
      2,
      delta,
    );

    const { sentiment } = emotionTuning;

    if (this.smoothedScore > sentiment.positiveThreshold) {
      const multiplier = isSpeaking ? sentiment.speechMultiplier : 1.0;
      targetSmile = Math.min(
        1,
        targetSmile +
          this.smoothedScore * sentiment.smileWeight * multiplier * speechExprMult,
      );
      targetCheek = Math.min(
        1,
        targetCheek +
          this.smoothedScore * sentiment.cheekWeight * multiplier * speechExprMult,
      );
    } else if (this.smoothedScore < sentiment.negativeThreshold) {
      const multiplier = isSpeaking ? sentiment.speechMultiplier : 1.0;
      targetFrown = Math.min(
        1,
        targetFrown +
          Math.abs(this.smoothedScore) *
            sentiment.frownWeight *
            multiplier *
            speechExprMult,
      );
      targetBrowDown = Math.min(
        1,
        targetBrowDown +
          Math.abs(this.smoothedScore) *
            sentiment.browDownWeight *
            multiplier *
            speechExprMult,
      );
    }

    const hasExplicitExpression = Boolean(
      currentExpression && currentExpression !== "idle",
    );

    const emotionControl = options.emotionControl;
    const aiStyleControl = options.aiStyleControl;
    const promptInfluence = THREE.MathUtils.clamp(
      (aiStyleControl?.cfgScale ?? 1) / 2,
      0.5,
      2.5,
    );

    if (emotionControl && !hasExplicitExpression) {
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

      switch (emotionControl.emotionState) {
        case "joy":
          targetSmile = Math.max(targetSmile, 0.8 * blendedIntensity);
          targetCheek = Math.max(targetCheek, 0.45 * blendedIntensity);
          break;
        case "anger":
          targetBrowDown = Math.max(targetBrowDown, 0.75 * blendedIntensity);
          targetFrown = Math.max(targetFrown, 0.35 * blendedIntensity);
          break;
        case "sadness":
          targetBrowInnerUp = Math.max(
            targetBrowInnerUp,
            0.7 * blendedIntensity,
          );
          targetFrown = Math.max(targetFrown, 0.6 * blendedIntensity);
          break;
        case "surprised":
        case "fear":
          targetBrowInnerUp = Math.max(
            targetBrowInnerUp,
            0.85 * blendedIntensity,
          );
          break;
        case "disgust":
          targetBrowDown = Math.max(targetBrowDown, 0.5 * blendedIntensity);
          targetFrown = Math.max(targetFrown, 0.45 * blendedIntensity);
          break;
      }

      const conditioning =
        `${emotionControl.textConditioning || ""} ${aiStyleControl?.emotionTextPrompt || ""}`.toLowerCase();
      if (conditioning.includes("furrow") || conditioning.includes("angry")) {
        targetBrowDown = Math.max(targetBrowDown, 0.55 * blendedIntensity);
      }
      if (conditioning.includes("smile") || conditioning.includes("joy")) {
        targetSmile = Math.max(targetSmile, 0.7 * blendedIntensity);
        targetCheek = Math.max(targetCheek, 0.35 * blendedIntensity);
      }
    }

    // UI expression overrides — highest priority
    const activeExpr =
      emotionTuning.expressions[currentExpression as keyof typeof emotionTuning.expressions];
    if (activeExpr) {
      const stateIdx = isSpeaking ? 1 : 0;
      targetSmile       = Math.max(targetSmile,       activeExpr.smile[stateIdx]);
      targetCheek       = Math.max(targetCheek,       activeExpr.cheek[stateIdx]);
      targetBrowInnerUp = Math.max(targetBrowInnerUp, activeExpr.browInnerUp[stateIdx]);
      targetBrowDown    = Math.max(targetBrowDown,    activeExpr.browDown[stateIdx]);
      targetFrown       = Math.max(targetFrown,       activeExpr.frown[stateIdx]);
    }

    const dict       = head.morphTargetDictionary;
    const influences = head.morphTargetInfluences;

    // Asymmetric damping — fast onset (lambda 8), slow release (lambda 3).
    // Smiles appear naturally and linger instead of robotic toggle.
    const apply = (name: string, target: number) => {
      const idx = dict[name];
      if (idx !== undefined) {
        const current = influences[idx];
        const lambda = target > current ? 8 : 3;
        influences[idx] = THREE.MathUtils.damp(current, target, lambda, delta);
      }
    };

    apply("mouthSmileLeft",   targetSmile);
    apply("mouthSmileRight",  targetSmile);
    apply("cheekSquintLeft",  targetCheek);
    apply("cheekSquintRight", targetCheek);
    apply("browInnerUp",      targetBrowInnerUp);
    apply("browDownLeft",     targetBrowDown);
    apply("browDownRight",    targetBrowDown);
    apply("mouthFrownLeft",   targetFrown);
    apply("mouthFrownRight",  targetFrown);

    // Fine-grained action units from emotionControl (additive, not exclusive)
    const fineGrainedAUs = hasExplicitExpression
      ? []
      : (emotionControl?.fineGrainedAUs ?? []);
    for (const actionUnit of fineGrainedAUs) {
      const intensity = THREE.MathUtils.clamp(emotionControl?.emotionIntensity ?? 0, 0, 1);
      apply(actionUnit, intensity);
    }
  }
}