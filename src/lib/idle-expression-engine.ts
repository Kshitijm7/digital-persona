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
 * IdleExpressionEngine
 * Handles involuntary procedural "life" movements:
 * - Asymmetric blinking (closing faster than opening)
 * - Eye saccades (rapid micro-movements via 1/f noise)
 * - Subtle spine/hips breathing
 * - Brow twitches
 */
export class IdleExpressionEngine {
  private noise2D = createNoise2D();
  private time = 0;
  
  // Blinking state
  private nextBlinkInterval = 4000;
  private timeSinceLastBlink = 0;
  private blinkState: 'idle' | 'closing' | 'opening' = 'idle';
  private blinkProgress = 0;
  private blinkCloseTime = 0.1;
  private blinkOpenTime = 0.15;

  // Brow state
  private nextBrowInterval = 3000;
  private timeSinceLastBrow = 0;
  private isBrowTwitching = false;
  private browProgress = 0;

  update(
    delta: number,
    nodes: Record<string, THREE.Object3D | undefined>,
    options: IdleExpressionOptions = {},
  ) {
    const breathing = options.breathing ?? true;
    const blinking = options.blinking ?? true;
    const browTwitch = options.browTwitch ?? false;
    const isSpeaking = options.isSpeaking ?? false;
    const speakingGain = options.speakingGain ?? 0;
    const ocularTuning = options.ocularTuning;

    const blinkDurationMs = Math.max(60, Math.min(400, ocularTuning?.blinkDurationMs ?? 100));
    this.blinkCloseTime = Math.max(0.03, (blinkDurationMs * 0.45) / 1000);
    this.blinkOpenTime = Math.max(0.03, (blinkDurationMs * 0.55) / 1000);

    this.time += delta;

    // 1. Spines Breathing (Hips/Spine)
    if (breathing && nodes.Hips) {
      // ~6 cycles per minute = ~0.628 rad/sec
      nodes.Hips.position.y = Math.sin(this.time * 0.628) * 0.01;
    }

    // 2. Eye Saccades (Micro-tremors on eye bones using noise)
    const rightEye = nodes.RightEye;
    const leftEye = nodes.LeftEye;
    if (rightEye && leftEye) {
      // 1/f "pink" noise simulated by adding octaves of simplex noise
      // We will let GazeEngine handle saccades directly to avoid order-of-execution conflicts.

      // Apply to existing rotation or assume starting from 0. 
      // We'll apply it as an offset. (GazeEngine will set the base rotation).
      // If Gaze engine runs after, it will overwrite, so GazeEngine needs to incorporate this noise, OR we add Euler angles. 
      // A better way is to let GazeEngine handle the saccades natively, or we handle it here by adding to whatever it was.
      // We will let GazeEngine handle saccades directly to avoid order-of-execution conflicts.
    }

    // Facial Morph Targets
    const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
    if (!head || !head.morphTargetDictionary || !head.morphTargetInfluences) return;

    if (blinking) {
      this.updateBlinking(delta, head, ocularTuning);
    } else {
      this.setMorphDamped(head, "eyeBlinkLeft", 0, delta, 10);
      this.setMorphDamped(head, "eyeBlinkRight", 0, delta, 10);
      this.setMorphDamped(head, "cheekSquintLeft", 0, delta, 10);
      this.setMorphDamped(head, "cheekSquintRight", 0, delta, 10);
    }

    const eyelidOpenOffset = THREE.MathUtils.clamp(ocularTuning?.eyelidOpenOffset ?? 0, -0.25, 0.25);
    this.setMorphDamped(head, "eyeWideLeft", Math.max(0, eyelidOpenOffset), delta, 12);
    this.setMorphDamped(head, "eyeWideRight", Math.max(0, eyelidOpenOffset), delta, 12);

    const doBrowSpeechSync = ocularTuning?.browSpeechSync ?? false;

    if (doBrowSpeechSync) {
      this.updateBrowSpeech(delta, head, isSpeaking, speakingGain);
    } else if (browTwitch) {
      this.updateBrows(delta, head);
    } else {
      this.isBrowTwitching = false;
      this.browProgress = 0;
      this.setMorphDamped(head, "browInnerUp", 0, delta, 10);
      this.setMorphDamped(head, "browOuterUpLeft", 0, delta, 10);
      this.setMorphDamped(head, "browOuterUpRight", 0, delta, 10);
    }
  }

  private updateBlinking(delta: number, head: THREE.SkinnedMesh, ocularTuning?: OcularTuning) {
    this.timeSinceLastBlink += delta;

    if (this.blinkState === 'idle' && this.timeSinceLastBlink * 1000 > this.nextBlinkInterval) {
      this.blinkState = 'closing';
      this.blinkProgress = 0;
      this.timeSinceLastBlink = 0;
      const baseInterval = Math.max(500, Math.min(10000, ocularTuning?.blinkIntervalMs ?? 3000));
      const jitterRange = baseInterval * 0.2;
      this.nextBlinkInterval = baseInterval + (Math.random() * 2 - 1) * jitterRange;
    }

    let blinkWeight = 0;

    if (this.blinkState === 'closing') {
      this.blinkProgress += delta;
      blinkWeight = Math.min(1, this.blinkProgress / this.blinkCloseTime);
      if (this.blinkProgress >= this.blinkCloseTime) {
        this.blinkState = 'opening';
        this.blinkProgress = 0;
      }
    } else if (this.blinkState === 'opening') {
      this.blinkProgress += delta;
      blinkWeight = Math.max(0, 1 - (this.blinkProgress / this.blinkOpenTime));
      if (this.blinkProgress >= this.blinkOpenTime) {
        this.blinkState = 'idle';
        this.blinkProgress = 0;
        blinkWeight = 0;
      }
    }

    this.setMorphDamped(head, "eyeBlinkLeft", blinkWeight, delta, 18);
    this.setMorphDamped(head, "eyeBlinkRight", blinkWeight, delta, 18);
    
    // Squeeze the cheeks slightly during blinks
    this.setMorphDamped(head, "cheekSquintLeft", blinkWeight * 0.3, delta, 16);
    this.setMorphDamped(head, "cheekSquintRight", blinkWeight * 0.3, delta, 16);
  }

  private updateBrows(delta: number, head: THREE.SkinnedMesh) {
    this.timeSinceLastBrow += delta;

    if (!this.isBrowTwitching && this.timeSinceLastBrow * 1000 > this.nextBrowInterval) {
      this.isBrowTwitching = true;
      this.browProgress = 0;
      this.timeSinceLastBrow = 0;
      // Randomize next interval between 2s and 5s
      this.nextBrowInterval = 2000 + Math.random() * 3000;
    }

    if (this.isBrowTwitching) {
      this.browProgress += delta;
      // Quick twitch: up and down in 0.3s
      const duration = 0.3;
      let weight = 0;
      if (this.browProgress < duration) {
        weight = Math.sin((this.browProgress / duration) * Math.PI) * 0.3; // max 0.3 intensity
      } else {
        this.isBrowTwitching = false;
        weight = 0;
      }

      this.setMorphDamped(head, "browInnerUp", weight, delta, 12);
      this.setMorphDamped(head, "browOuterUpLeft", weight, delta, 12);
      this.setMorphDamped(head, "browOuterUpRight", weight, delta, 12);
    }
  }

  private updateBrowSpeech(delta: number, head: THREE.SkinnedMesh, isSpeaking: boolean, speakingGain: number) {
    if (isSpeaking && speakingGain > 0.55) {
      this.setMorphDamped(head, "browInnerUp", 0.08, delta, 8);
    } else {
      this.setMorphDamped(head, "browInnerUp", 0, delta, 5);
    }
    
    // Clear out other brow targets
    this.setMorphDamped(head, "browOuterUpLeft", 0, delta, 5);
    this.setMorphDamped(head, "browOuterUpRight", 0, delta, 5);
  }

  private setMorph(mesh: THREE.SkinnedMesh, name: string, value: number) {
    const dict = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (dict && influences && dict[name] !== undefined) {
      influences[dict[name]] = value;
    }
  }

  private setMorphDamped(mesh: THREE.SkinnedMesh, name: string, target: number, delta: number, lambda: number) {
    const dict = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (dict && influences && dict[name] !== undefined) {
      const idx = dict[name];
      influences[idx] = THREE.MathUtils.damp(influences[idx], target, lambda, delta);
    }
  }
}

