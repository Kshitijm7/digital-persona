import * as THREE from 'three';
import { useEmotionStore } from '@/store/useEmotionStore';
import { type AIStyleControl, type EmotionControl } from '@/lib/avatar-control.types';
import emotionTuning from '@/config/emotion-tuning.json';

interface EmotionRuntimeOptions {
  emotionControl?: EmotionControl;
  aiStyleControl?: AIStyleControl;
}

/**
 * The full set of blendshapes this engine writes each frame.
 * Exported so Avatar.tsx micro-expression system can skip these shapes —
 * both systems use damp toward their own targets, and conflicting targets
 * on the same shape produce visible fighting (the value oscillates between
 * two attractors rather than settling).
 *
 * `cheekSquintLeft/Right` is intentionally omitted from the micro-expression
 * exclusion list in Avatar.tsx because IdleExpressionEngine's blink-squint
 * and EmotionEngine's smile-cheek both contribute to natural cheek behaviour
 * and their damp targets are complementary rather than conflicting.
 */
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

    const allowHoverFace = !isSpeaking && hovered && featureToggles.hoverEffect;
    let targetSmile      = allowHoverFace ? 0.8 : 0;
    let targetCheek      = allowHoverFace ? 0.3 : 0;
    let targetBrowInnerUp = 0;
    let targetBrowDown    = 0;
    let targetFrown       = 0;

    // Contextual sentiment score from store — read via getState() so this
    // engine has no React dependency and can be instantiated outside a component.
    const sentimentScore = useEmotionStore.getState().currentScore;
    this.smoothedScore = THREE.MathUtils.damp(this.smoothedScore, sentimentScore, 2, delta);

    const { sentiment } = emotionTuning;

    if (this.smoothedScore > sentiment.positiveThreshold) {
      const multiplier = isSpeaking ? sentiment.speechMultiplier : 1.0;
      targetSmile = Math.min(1, targetSmile + this.smoothedScore * sentiment.smileWeight * multiplier);
      targetCheek = Math.min(1, targetCheek + this.smoothedScore * sentiment.cheekWeight * multiplier);
    } else if (this.smoothedScore < sentiment.negativeThreshold) {
      const multiplier = isSpeaking ? sentiment.speechMultiplier : 1.0;
      targetFrown    = Math.min(1, targetFrown    + Math.abs(this.smoothedScore) * sentiment.frownWeight    * multiplier);
      targetBrowDown = Math.min(1, targetBrowDown + Math.abs(this.smoothedScore) * sentiment.browDownWeight * multiplier);
    }

    const hasExplicitExpression = Boolean(currentExpression && currentExpression !== "idle");

    const emotionControl  = options.emotionControl;
    const aiStyleControl  = options.aiStyleControl;
    const promptInfluence = THREE.MathUtils.clamp((aiStyleControl?.cfgScale ?? 1) / 2, 0.5, 2.5);

    if (emotionControl && !hasExplicitExpression) {
      const controlIntensity = THREE.MathUtils.clamp(emotionControl.emotionIntensity, 0, 1);
      const styleIntensity   = THREE.MathUtils.clamp(aiStyleControl?.emotionIntensity ?? 1, 0, 1.5);
      const blendedIntensity = THREE.MathUtils.clamp(
        controlIntensity * styleIntensity * promptInfluence, 0, 1.5
      );

      switch (emotionControl.emotionState) {
        case 'joy':
          targetSmile = Math.max(targetSmile, 0.8  * blendedIntensity);
          targetCheek = Math.max(targetCheek, 0.45 * blendedIntensity);
          break;
        case 'anger':
          targetBrowDown = Math.max(targetBrowDown, 0.75 * blendedIntensity);
          targetFrown    = Math.max(targetFrown,    0.35 * blendedIntensity);
          break;
        case 'sadness':
          targetBrowInnerUp = Math.max(targetBrowInnerUp, 0.7  * blendedIntensity);
          targetFrown       = Math.max(targetFrown,       0.6  * blendedIntensity);
          break;
        case 'surprised':
        case 'fear':
          targetBrowInnerUp = Math.max(targetBrowInnerUp, 0.85 * blendedIntensity);
          break;
        case 'disgust':
          targetBrowDown = Math.max(targetBrowDown, 0.5  * blendedIntensity);
          targetFrown    = Math.max(targetFrown,    0.45 * blendedIntensity);
          break;
      }

      const conditioning = `${emotionControl.textConditioning || ''} ${aiStyleControl?.emotionTextPrompt || ''}`.toLowerCase();
      if (conditioning.includes('furrow') || conditioning.includes('angry')) {
        targetBrowDown = Math.max(targetBrowDown, 0.55 * blendedIntensity);
      }
      if (conditioning.includes('smile') || conditioning.includes('joy')) {
        targetSmile = Math.max(targetSmile, 0.7  * blendedIntensity);
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

    const apply = (name: string, target: number) => {
      const idx = dict[name];
      if (idx !== undefined) {
        influences[idx] = THREE.MathUtils.damp(influences[idx], target, 5, delta);
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