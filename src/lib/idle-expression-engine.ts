import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { type OcularTuning } from '@/lib/avatar-control.types';

interface IdleExpressionOptions {
  breathing?: boolean;
  blinking?: boolean;
  browTwitch?: boolean;
  isSpeaking?: boolean;
  speakingGain?: number;
  ocularTuning?: OcularTuning;
}

/**
 * The full set of blendshapes this engine writes.
 * Exported so Avatar.tsx micro-expression system and EmotionEngine can avoid
 * scheduling targets on the same shapes during the same frame.
 *
 * Coordination rule:
 *   - `cheekSquintLeft/Right` overlap with EmotionEngine (smile cheek) is
 *     acceptable: blink-squint is a brief pulse (<400 ms) while emotion-cheek
 *     is a sustained value. Both use damp — the higher target wins naturally.
 *   - `browInnerUp` is deliberately NOT in this list when browTwitch is false
 *     (which is always the case in Avatar.tsx). EmotionEngine and the
 *     micro-expression system are responsible for it in that configuration.
 */
export const IDLE_ENGINE_DRIVEN_MORPHS = [
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "cheekSquintLeft",
  "cheekSquintRight",
  "eyeWideLeft",
  "eyeWideRight",
  // brow targets only written when browTwitch: true or browSpeechSync: true
  "browInnerUp",
  "browOuterUpLeft",
  "browOuterUpRight",
] as const;

/**
 * IdleExpressionEngine
 * Handles involuntary procedural "life" movements:
 * - Asymmetric blinking (closing faster than opening, with cheek micro-squint)
 * - Eyelid open offset driven by ocularTuning
 * - Brow twitches (opt-in via browTwitch flag)
 * - Brow speech-sync (opt-in via ocularTuning.browSpeechSync)
 * - Subtle spine/hips breathing
 *
 * Eye saccades are handled entirely by GazeEngine to avoid bone write conflicts.
 */
export class IdleExpressionEngine {
  private noise2D = createNoise2D();
  private time = 0;

  // Blinking state machine
  private nextBlinkInterval = 4000;
  private timeSinceLastBlink = 0;
  private blinkState: 'idle' | 'closing' | 'opening' = 'idle';
  private blinkProgress = 0;
  private blinkCloseTime = 0.1;
  private blinkOpenTime  = 0.15;

  // Brow twitch state
  private nextBrowInterval = 3000;
  private timeSinceLastBrow = 0;
  private isBrowTwitching = false;
  private browProgress = 0;

  update(
    delta: number,
    nodes: Record<string, THREE.Object3D | undefined>,
    options: IdleExpressionOptions = {},
  ) {
    const breathing    = options.breathing    ?? true;
    const blinking     = options.blinking     ?? true;
    const browTwitch   = options.browTwitch   ?? false;
    const isSpeaking   = options.isSpeaking   ?? false;
    const speakingGain = options.speakingGain ?? 0;
    const ocularTuning = options.ocularTuning;

    const blinkDurationMs = Math.max(60, Math.min(400, ocularTuning?.blinkDurationMs ?? 100));
    this.blinkCloseTime = Math.max(0.03, (blinkDurationMs * 0.45) / 1000);
    this.blinkOpenTime  = Math.max(0.03, (blinkDurationMs * 0.55) / 1000);

    this.time += delta;

    // ── Breathing: subtle vertical hip oscillation at ~6 cycles/min ─────────
    if (breathing && nodes.Hips) {
      nodes.Hips.position.y = Math.sin(this.time * 0.628) * 0.01;
    }

    // ── Morph targets ────────────────────────────────────────────────────────
    // Eye saccades are handled by GazeEngine (bone rotations) and Avatar.tsx
    // (saccade offset timer). Nothing here touches RightEye/LeftEye bones.

    const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
    if (!head?.morphTargetDictionary || !head.morphTargetInfluences) return;

    // Blinking
    if (blinking) {
      this.updateBlinking(delta, head, ocularTuning);
    } else {
      this.setMorphDamped(head, "eyeBlinkLeft",     0, delta, 10);
      this.setMorphDamped(head, "eyeBlinkRight",    0, delta, 10);
      this.setMorphDamped(head, "cheekSquintLeft",  0, delta, 10);
      this.setMorphDamped(head, "cheekSquintRight", 0, delta, 10);
    }

    // Eyelid open offset (e.g. slightly wide eyes)
    const eyelidOpenOffset = THREE.MathUtils.clamp(ocularTuning?.eyelidOpenOffset ?? 0, -0.25, 0.25);
    this.setMorphDamped(head, "eyeWideLeft",  Math.max(0, eyelidOpenOffset), delta, 12);
    this.setMorphDamped(head, "eyeWideRight", Math.max(0, eyelidOpenOffset), delta, 12);

    // Brow layer — priority: browSpeechSync > browTwitch > rest to zero.
    // When both are false (the default in Avatar.tsx), brow targets are left
    // at zero here and EmotionEngine / micro-expression system own them.
    const doBrowSpeechSync = ocularTuning?.browSpeechSync ?? false;

    if (doBrowSpeechSync) {
      this.updateBrowSpeech(delta, head, isSpeaking, speakingGain);
    } else if (browTwitch) {
      this.updateBrowTwitch(delta, head);
    } else {
      // Reset twitch state so it restarts cleanly if browTwitch is re-enabled
      this.isBrowTwitching = false;
      this.browProgress    = 0;
      this.setMorphDamped(head, "browInnerUp",       0, delta, 10);
      this.setMorphDamped(head, "browOuterUpLeft",   0, delta, 10);
      this.setMorphDamped(head, "browOuterUpRight",  0, delta, 10);
    }
  }

  private updateBlinking(
    delta: number,
    head: THREE.SkinnedMesh,
    ocularTuning?: OcularTuning,
  ) {
    this.timeSinceLastBlink += delta;

    if (
      this.blinkState === 'idle' &&
      this.timeSinceLastBlink * 1000 > this.nextBlinkInterval
    ) {
      this.blinkState    = 'closing';
      this.blinkProgress = 0;
      this.timeSinceLastBlink = 0;

      const baseInterval = Math.max(500, Math.min(10000, ocularTuning?.blinkIntervalMs ?? 3000));
      const jitter = baseInterval * 0.2;
      this.nextBlinkInterval = baseInterval + (Math.random() * 2 - 1) * jitter;
    }

    let blinkWeight = 0;

    if (this.blinkState === 'closing') {
      this.blinkProgress += delta;
      blinkWeight = Math.min(1, this.blinkProgress / this.blinkCloseTime);
      if (this.blinkProgress >= this.blinkCloseTime) {
        this.blinkState    = 'opening';
        this.blinkProgress = 0;
      }
    } else if (this.blinkState === 'opening') {
      this.blinkProgress += delta;
      blinkWeight = Math.max(0, 1 - this.blinkProgress / this.blinkOpenTime);
      if (this.blinkProgress >= this.blinkOpenTime) {
        this.blinkState    = 'idle';
        this.blinkProgress = 0;
        blinkWeight        = 0;
      }
    }

    this.setMorphDamped(head, "eyeBlinkLeft",    blinkWeight,       delta, 18);
    this.setMorphDamped(head, "eyeBlinkRight",   blinkWeight,       delta, 18);
    // Subtle cheek squeeze during blink — brief pulse, acceptable overlap with
    // EmotionEngine smile-cheek since both use damp and the blink is <400 ms.
    this.setMorphDamped(head, "cheekSquintLeft",  blinkWeight * 0.3, delta, 16);
    this.setMorphDamped(head, "cheekSquintRight", blinkWeight * 0.3, delta, 16);
  }

  private updateBrowTwitch(delta: number, head: THREE.SkinnedMesh) {
    this.timeSinceLastBrow += delta;

    if (!this.isBrowTwitching && this.timeSinceLastBrow * 1000 > this.nextBrowInterval) {
      this.isBrowTwitching   = true;
      this.browProgress      = 0;
      this.timeSinceLastBrow = 0;
      this.nextBrowInterval  = 2000 + Math.random() * 3000;
    }

    if (this.isBrowTwitching) {
      this.browProgress += delta;
      const duration = 0.3;
      let weight = 0;

      if (this.browProgress < duration) {
        // Sine envelope: smooth up-and-down in 300 ms, max intensity 0.3
        weight = Math.sin((this.browProgress / duration) * Math.PI) * 0.3;
      } else {
        this.isBrowTwitching = false;
        weight = 0;
      }

      this.setMorphDamped(head, "browInnerUp",      weight, delta, 12);
      this.setMorphDamped(head, "browOuterUpLeft",  weight, delta, 12);
      this.setMorphDamped(head, "browOuterUpRight", weight, delta, 12);
    }
  }

  private updateBrowSpeech(
    delta: number,
    head: THREE.SkinnedMesh,
    isSpeaking: boolean,
    speakingGain: number,
  ) {
    // Slight brow raise on loud speech beats — subtle engagement cue.
    const target = (isSpeaking && speakingGain > 0.55) ? 0.08 : 0;
    this.setMorphDamped(head, "browInnerUp",      target, delta, isSpeaking ? 8 : 5);
    this.setMorphDamped(head, "browOuterUpLeft",  0,      delta, 5);
    this.setMorphDamped(head, "browOuterUpRight", 0,      delta, 5);
  }

  private setMorphDamped(
    mesh: THREE.SkinnedMesh,
    name: string,
    target: number,
    delta: number,
    lambda: number,
  ) {
    const dict      = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (dict && influences && dict[name] !== undefined) {
      const idx = dict[name];
      influences[idx] = THREE.MathUtils.damp(influences[idx], target, lambda, delta);
    }
  }
}