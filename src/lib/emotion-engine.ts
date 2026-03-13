import * as THREE from 'three';
import { useEmotionStore } from '@/store/useEmotionStore';
import { type AIStyleControl, type EmotionControl } from '@/lib/avatar-control.types';

interface EmotionRuntimeOptions {
  emotionControl?: EmotionControl;
  aiStyleControl?: AIStyleControl;
}

export class EmotionEngine {
  private smoothedScore = 0;

  update(
    delta: number, 
    nodes: Record<string, THREE.Object3D | undefined>, 
    currentExpression: string, 
    hovered: boolean, 
    featureToggles: { hoverEffect?: boolean },
    isSpeaking: boolean = false,
    options: EmotionRuntimeOptions = {},
  ) {
    const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
    if (!head || !head.morphTargetDictionary || !head.morphTargetInfluences) return;

    // Base target values determined by UI or interactions
    const allowHoverFace = !isSpeaking && hovered && featureToggles.hoverEffect;
    let targetSmile = allowHoverFace ? 0.8 : 0;
    let targetCheek = allowHoverFace ? 0.3 : 0;
    let targetBrowInnerUp = 0;
    let targetBrowDown = 0;
    let targetFrown = 0;

    // Real-time Contextual Sentiment (comparative usually -5 to +5)
    // 0 = neutral, >0 = positive, <0 = negative
    const sentimentScore = useEmotionStore.getState().currentScore;
    
    // Dampen the score so emotions drift naturally rather than snapping
    this.smoothedScore = THREE.MathUtils.damp(this.smoothedScore, sentimentScore, 2, delta);

    if (!isSpeaking && this.smoothedScore > 0.2) {
      targetSmile = Math.min(1, targetSmile + this.smoothedScore * 0.8);
      targetCheek = Math.min(1, targetCheek + this.smoothedScore * 0.5);
    } else if (!isSpeaking && this.smoothedScore < -0.2) {
      targetFrown = Math.min(1, targetFrown + Math.abs(this.smoothedScore) * 0.7);
      targetBrowDown = Math.min(1, targetBrowDown + Math.abs(this.smoothedScore) * 0.5);
    }

    const hasExplicitExpression = Boolean(currentExpression && currentExpression !== "idle");

    const emotionControl = options.emotionControl;
    const aiStyleControl = options.aiStyleControl;
    const promptInfluence = THREE.MathUtils.clamp((aiStyleControl?.cfgScale ?? 1) / 2, 0.5, 2.5);

    if (emotionControl && !hasExplicitExpression) {
      const controlIntensity = THREE.MathUtils.clamp(emotionControl.emotionIntensity, 0, 1);
      const styleIntensity = THREE.MathUtils.clamp(aiStyleControl?.emotionIntensity ?? 1, 0, 1.5);
      const blendedIntensity = THREE.MathUtils.clamp(controlIntensity * styleIntensity * promptInfluence, 0, 1.5);

      if (emotionControl.emotionState === 'joy') {
        targetSmile = Math.max(targetSmile, 0.8 * blendedIntensity);
        targetCheek = Math.max(targetCheek, 0.45 * blendedIntensity);
      } else if (emotionControl.emotionState === 'anger') {
        targetBrowDown = Math.max(targetBrowDown, 0.75 * blendedIntensity);
        targetFrown = Math.max(targetFrown, 0.35 * blendedIntensity);
      } else if (emotionControl.emotionState === 'sadness') {
        targetBrowInnerUp = Math.max(targetBrowInnerUp, 0.7 * blendedIntensity);
        targetFrown = Math.max(targetFrown, 0.6 * blendedIntensity);
      } else if (emotionControl.emotionState === 'surprised' || emotionControl.emotionState === 'fear') {
        targetBrowInnerUp = Math.max(targetBrowInnerUp, 0.85 * blendedIntensity);
      } else if (emotionControl.emotionState === 'disgust') {
        targetBrowDown = Math.max(targetBrowDown, 0.5 * blendedIntensity);
        targetFrown = Math.max(targetFrown, 0.45 * blendedIntensity);
      }

      const conditioning = `${emotionControl.textConditioning || ''} ${aiStyleControl?.emotionTextPrompt || ''}`.toLowerCase();
      if (conditioning.includes('furrow') || conditioning.includes('angry')) {
        targetBrowDown = Math.max(targetBrowDown, 0.55 * blendedIntensity);
      }
      if (conditioning.includes('smile') || conditioning.includes('joy')) {
        targetSmile = Math.max(targetSmile, 0.7 * blendedIntensity);
        targetCheek = Math.max(targetCheek, 0.35 * blendedIntensity);
      }
    }

    // UI Expression Overrides (highest priority)
    if ((currentExpression === "happy" || currentExpression === "smile") && !isSpeaking) {
      targetSmile = 1.0; targetCheek = 0.6;
    } else if (currentExpression === "sad") {
      targetBrowInnerUp = 0.8; targetFrown = 0.8;
    } else if (currentExpression === "angry") {
      targetBrowDown = 0.9; targetFrown = 0.4;
    } else if (currentExpression === "surprised") {
      targetBrowInnerUp = 1.0; targetSmile = 0.2;
    } else if (currentExpression === "fearful") {
      targetBrowInnerUp = 1.0; targetFrown = 0.5;
    } else if (currentExpression === "disgusted") {
      targetBrowDown = 0.5; targetFrown = 0.6;
    }

    if (isSpeaking && !hasExplicitExpression) {
      // Keep talking frames clean for visemes/jaw while preserving subtle affect.
      targetSmile *= 0.2;
      targetCheek *= 0.2;
      targetFrown *= 0.2;
    }

    const dict = head.morphTargetDictionary;
    const influences = head.morphTargetInfluences;

    const apply = (name: string, target: number) => {
      const idx = dict[name];
      // Note: we can safely modify morph targets because we disabled eslint for the Avatar's useFrame block
      if (idx !== undefined) {
         influences[idx] = THREE.MathUtils.damp(influences[idx], target, 5, delta);
      }
    };

    apply("mouthSmileLeft", targetSmile);
    apply("mouthSmileRight", targetSmile);
    apply("cheekSquintLeft", targetCheek);
    apply("cheekSquintRight", targetCheek);
    apply("browInnerUp", targetBrowInnerUp);
    apply("browDownLeft", targetBrowDown);
    apply("browDownRight", targetBrowDown);
    apply("mouthFrownLeft", targetFrown);
    apply("mouthFrownRight", targetFrown);

    const fineGrainedAUs = hasExplicitExpression ? [] : (options.emotionControl?.fineGrainedAUs ?? []);
    for (const actionUnit of fineGrainedAUs) {
      const intensity = THREE.MathUtils.clamp(options.emotionControl?.emotionIntensity ?? 0, 0, 1);
      apply(actionUnit, intensity);
    }
  }
}

