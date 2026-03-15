import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { type HeadDynamics, type OcularTuning } from '@/lib/avatar-control.types';

interface GazeOptions {
  eyeDrift?: boolean;
  headMovement?: boolean;
  ocularTuning?: OcularTuning;
  headDynamics?: HeadDynamics;
}

/**
 * GazeEngine
 * Replaces the old useHeadMovement hook.
 * Handles head orientation and eye saccades with noise for lifelike motion.
 */
export class GazeEngine {
  private noise2D = createNoise2D();
  private time = 0;
  private currentPos = new THREE.Vector2(0, 0);
  private targetPos = new THREE.Vector2(0, 0);
  private lastHeadRotation = new THREE.Vector2(0, 0);

  update(
    delta: number,
    camera: THREE.Camera,
    nodes: Record<string, THREE.Object3D | undefined>,
    pointer: THREE.Vector2,
    isSpeaking: boolean,
    options: GazeOptions = {},
  ) {
    this.time += delta;
    const eyeDrift = options.eyeDrift ?? true;
    const headMovement = options.headMovement ?? true;
    const saccadeStrength = THREE.MathUtils.clamp(options.ocularTuning?.saccadeStrength ?? 0.4, 0, 2);
    const headDynamics = options.headDynamics;

    const head = nodes.Head as THREE.Bone;
    const neck = nodes.Neck as THREE.Bone;
    const rightEye = nodes.RightEye as THREE.Bone;
    const leftEye = nodes.LeftEye as THREE.Bone;

    if (!head || !neck || !rightEye || !leftEye) return;

    // Saccade noise for eyes (1/f simulated)
    const eyeJitterX = eyeDrift
      ? (this.noise2D(this.time * 2, 0) * 0.5 + this.noise2D(this.time * 5, 10) * 0.1) * 0.03 * saccadeStrength
      : 0;
    const eyeJitterY = eyeDrift
      ? (this.noise2D(10, this.time * 2) * 0.5 + this.noise2D(0, this.time * 5) * 0.1) * 0.03 * saccadeStrength
      : 0;

    // Head movement driven by noise during speech
    let speechHeadMotionX = 0;
    let speechHeadMotionY = 0;
    if (isSpeaking && headMovement) {
      speechHeadMotionX = Math.sin(this.time * 2) * 0.01;
      speechHeadMotionY = Math.sin(this.time * 1.5) * 0.015;
    } else if (headMovement && (headDynamics?.generateIdleMotion ?? true)) {
      speechHeadMotionX = Math.sin(this.time * 0.65) * 0.004;
      speechHeadMotionY = Math.sin(this.time * 0.52) * 0.006;
    }

    // Determine target based on pointer
    const rad = Math.PI / 180;
    const rotationMargin = new THREE.Vector2(5, 10);

    // Follow pointer slightly
    if (eyeDrift || headMovement) {
      this.targetPos.x = THREE.MathUtils.clamp(pointer.y, -0.5, 1) * (-rotationMargin.x * rad);
      this.targetPos.y = THREE.MathUtils.clamp(pointer.x, -0.5, 0.5) * (rotationMargin.y * rad);
    } else {
      this.targetPos.set(0, 0);
    }

    // Smoothly interpolate current head rotation towards target
    this.currentPos.x = THREE.MathUtils.damp(this.currentPos.x, this.targetPos.x, 3, delta);
    this.currentPos.y = THREE.MathUtils.damp(this.currentPos.y, this.targetPos.y, 3, delta);

    // Apply rotations
    const neckBoneRotationOffsetX = 10 * rad;

    if (headMovement) {
      const accelLimit = Math.max(0.01, headDynamics?.headMotionAccelerationLimit ?? 0.15);
      const pitchRange = headDynamics?.pitchRange ?? [-15, 15];
      const yawRange = headDynamics?.yawRange ?? [-20, 20];
      const minPitch = THREE.MathUtils.degToRad(Math.min(pitchRange[0], pitchRange[1]));
      const maxPitch = THREE.MathUtils.degToRad(Math.max(pitchRange[0], pitchRange[1]));
      const minYaw = THREE.MathUtils.degToRad(Math.min(yawRange[0], yawRange[1]));
      const maxYaw = THREE.MathUtils.degToRad(Math.max(yawRange[0], yawRange[1]));

      const targetHeadX = THREE.MathUtils.clamp(this.currentPos.x + speechHeadMotionX, minPitch, maxPitch);
      const targetHeadY = THREE.MathUtils.clamp(this.currentPos.y + speechHeadMotionY, minYaw, maxYaw);
      const maxStep = accelLimit * Math.max(delta, 1 / 120);

      const nextHeadX = this.lastHeadRotation.x + THREE.MathUtils.clamp(targetHeadX - this.lastHeadRotation.x, -maxStep, maxStep);
      const nextHeadY = this.lastHeadRotation.y + THREE.MathUtils.clamp(targetHeadY - this.lastHeadRotation.y, -maxStep, maxStep);
      this.lastHeadRotation.set(nextHeadX, nextHeadY);

      neck.rotation.x = THREE.MathUtils.clamp(this.currentPos.x + neckBoneRotationOffsetX, minPitch + neckBoneRotationOffsetX, maxPitch + neckBoneRotationOffsetX);
      neck.rotation.y = THREE.MathUtils.clamp(this.currentPos.y, minYaw, maxYaw);

      head.rotation.x = nextHeadX;
      head.rotation.y = nextHeadY;
    } else {
      neck.rotation.x = THREE.MathUtils.damp(neck.rotation.x, neckBoneRotationOffsetX, 6, delta);
      neck.rotation.y = THREE.MathUtils.damp(neck.rotation.y, 0, 6, delta);
      head.rotation.x = THREE.MathUtils.damp(head.rotation.x, 0, 6, delta);
      head.rotation.y = THREE.MathUtils.damp(head.rotation.y, 0, 6, delta);
      this.lastHeadRotation.set(head.rotation.x, head.rotation.y);
    }

    if (options.ocularTuning?.lookAtIK) {
      rightEye.lookAt(camera.position);
      leftEye.lookAt(camera.position);
    }

    if (eyeDrift) {
      // Eyes follow head but have independent jitter.
      rightEye.rotation.x = this.currentPos.x + eyeJitterX;
      rightEye.rotation.y = this.currentPos.y * 2 + eyeJitterY;

      leftEye.rotation.x = this.currentPos.x + eyeJitterX;
      leftEye.rotation.y = this.currentPos.y * 2 + eyeJitterY;
    } else {
      rightEye.rotation.x = THREE.MathUtils.damp(rightEye.rotation.x, 0, 8, delta);
      rightEye.rotation.y = THREE.MathUtils.damp(rightEye.rotation.y, 0, 8, delta);
      leftEye.rotation.x = THREE.MathUtils.damp(leftEye.rotation.x, 0, 8, delta);
      leftEye.rotation.y = THREE.MathUtils.damp(leftEye.rotation.y, 0, 8, delta);
    }
  }
}

