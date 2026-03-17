import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { type HeadDynamics, type OcularTuning } from '@/lib/avatar-control.types';

interface GazeOptions {
  eyeDrift?: boolean;
  headMovement?: boolean;
  ocularTuning?: OcularTuning;
  headDynamics?: HeadDynamics;
  /**
   * Instantaneous saccade offset provided by Avatar.tsx.
   * The offset is computed externally (random fixation point jump on a timer)
   * and passed here so GazeEngine can apply and clamp it alongside the
   * continuous noise drift. Keeping the jump logic in Avatar.tsx and the
   * application logic here means GazeEngine owns all eye rotation writes —
   * no two systems ever write to the same bone on the same frame.
   */
  saccadeOffset?: THREE.Vector2;
}

/**
 * GazeEngine
 * Handles head orientation and eye movement for lifelike gaze behaviour.
 *
 * Eye motion is composed of three layers applied in order:
 *   1. Pointer-following base position (currentPos)
 *   2. Continuous simplex-noise drift (eyeJitterX/Y) — smooth micro-tremor
 *   3. Saccade offset from Avatar.tsx — instantaneous fixation-point jump
 *
 * lookAtIK (if enabled) is applied AFTER drift and saccade so it acts as a
 * soft constraint rather than overwriting the procedural motion.
 */
export class GazeEngine {
  private noise2D = createNoise2D();
  private time = 0;
  private currentPos = new THREE.Vector2(0, 0);
  private targetPos = new THREE.Vector2(0, 0);
  private lastHeadRotation = new THREE.Vector2(0, 0);

  // Reusable vector — avoids allocating `new THREE.Vector2(0,0)` every frame
  // in the saccade lerp path.
  private readonly zero2 = new THREE.Vector2(0, 0);

  update(
    delta: number,
    camera: THREE.Camera,
    nodes: Record<string, THREE.Object3D | undefined>,
    pointer: THREE.Vector2,
    isSpeaking: boolean,
    options: GazeOptions = {},
  ) {
    this.time += delta;

    const eyeDrift    = options.eyeDrift    ?? true;
    const headMovement = options.headMovement ?? true;
    const saccadeStrength = THREE.MathUtils.clamp(
      options.ocularTuning?.saccadeStrength ?? 0.4, 0, 2
    );
    const headDynamics  = options.headDynamics;
    const saccadeOffset = options.saccadeOffset;

    const head     = nodes.Head     as THREE.Bone | undefined;
    const neck     = nodes.Neck     as THREE.Bone | undefined;
    const rightEye = nodes.RightEye as THREE.Bone | undefined;
    const leftEye  = nodes.LeftEye  as THREE.Bone | undefined;

    if (!head || !neck || !rightEye || !leftEye) return;

    // ── Continuous noise drift ──────────────────────────────────────────────
    // 1/f approximation: two octaves of simplex noise at different frequencies.
    // This is smooth micro-tremor, not saccadic — variable names updated to
    // reflect that so they don't conflict conceptually with the saccade system.
    const eyeDriftX = eyeDrift
      ? (this.noise2D(this.time * 2, 0) * 0.5 + this.noise2D(this.time * 5, 10) * 0.1)
        * 0.03 * saccadeStrength
      : 0;
    const eyeDriftY = eyeDrift
      ? (this.noise2D(10, this.time * 2) * 0.5 + this.noise2D(0, this.time * 5) * 0.1)
        * 0.03 * saccadeStrength
      : 0;

    // ── Head motion ─────────────────────────────────────────────────────────
    let speechHeadMotionX = 0;
    let speechHeadMotionY = 0;
    if (isSpeaking && headMovement) {
      speechHeadMotionX = Math.sin(this.time * 2)   * 0.01;
      speechHeadMotionY = Math.sin(this.time * 1.5) * 0.015;
    } else if (headMovement && (headDynamics?.generateIdleMotion ?? true)) {
      speechHeadMotionX = Math.sin(this.time * 0.65) * 0.004;
      speechHeadMotionY = Math.sin(this.time * 0.52) * 0.006;
    }

    // ── Pointer following ───────────────────────────────────────────────────
    const rad = Math.PI / 180;
    const rotationMargin = new THREE.Vector2(5, 10);

    if (eyeDrift || headMovement) {
      this.targetPos.x = THREE.MathUtils.clamp(pointer.y, -0.5, 1)   * (-rotationMargin.x * rad);
      this.targetPos.y = THREE.MathUtils.clamp(pointer.x, -0.5, 0.5) *  (rotationMargin.y * rad);
    } else {
      this.targetPos.set(0, 0);
    }

    this.currentPos.x = THREE.MathUtils.damp(this.currentPos.x, this.targetPos.x, 3, delta);
    this.currentPos.y = THREE.MathUtils.damp(this.currentPos.y, this.targetPos.y, 3, delta);

    // ── Head and neck bones ─────────────────────────────────────────────────
    const neckBoneRotationOffsetX = 10 * rad;

    if (headMovement) {
      const accelLimit = Math.max(0.01, headDynamics?.headMotionAccelerationLimit ?? 0.15);
      const pitchRange = headDynamics?.pitchRange ?? [-15, 15];
      const yawRange   = headDynamics?.yawRange   ?? [-20, 20];
      const minPitch = THREE.MathUtils.degToRad(Math.min(pitchRange[0], pitchRange[1]));
      const maxPitch = THREE.MathUtils.degToRad(Math.max(pitchRange[0], pitchRange[1]));
      const minYaw   = THREE.MathUtils.degToRad(Math.min(yawRange[0],   yawRange[1]));
      const maxYaw   = THREE.MathUtils.degToRad(Math.max(yawRange[0],   yawRange[1]));

      const targetHeadX = THREE.MathUtils.clamp(this.currentPos.x + speechHeadMotionX, minPitch, maxPitch);
      const targetHeadY = THREE.MathUtils.clamp(this.currentPos.y + speechHeadMotionY, minYaw,   maxYaw);
      const maxStep = accelLimit * Math.max(delta, 1 / 120);

      const nextHeadX = this.lastHeadRotation.x +
        THREE.MathUtils.clamp(targetHeadX - this.lastHeadRotation.x, -maxStep, maxStep);
      const nextHeadY = this.lastHeadRotation.y +
        THREE.MathUtils.clamp(targetHeadY - this.lastHeadRotation.y, -maxStep, maxStep);
      this.lastHeadRotation.set(nextHeadX, nextHeadY);

      neck.rotation.x = THREE.MathUtils.clamp(
        this.currentPos.x + neckBoneRotationOffsetX,
        minPitch + neckBoneRotationOffsetX,
        maxPitch + neckBoneRotationOffsetX,
      );
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

    // ── Eye rotations ───────────────────────────────────────────────────────
    // Layer order matters:
    //   1. Drift + saccade offset written to rotation
    //   2. lookAtIK blended on top as a soft pull toward camera
    //
    // Previously lookAtIK ran first and eyeDrift overwrote it entirely —
    // now lookAtIK is a lerp applied after drift so both contribute.

    // Max eye rotation in radians — prevents eyes from rolling out of their
    // sockets when pointer is at screen edge.
    const EYE_CLAMP = 0.25;

    if (eyeDrift) {
      const sx = saccadeOffset?.x ?? 0;
      const sy = saccadeOffset?.y ?? 0;

      const eyeX = THREE.MathUtils.clamp(this.currentPos.x + eyeDriftX + sx, -EYE_CLAMP, EYE_CLAMP);
      const eyeY = THREE.MathUtils.clamp(this.currentPos.y * 2 + eyeDriftY + sy, -EYE_CLAMP, EYE_CLAMP);

      rightEye.rotation.x = eyeX;
      rightEye.rotation.y = eyeY;
      leftEye.rotation.x  = eyeX;
      leftEye.rotation.y  = eyeY;

      // lookAtIK as a soft additive pull — does not overwrite drift/saccade
      if (options.ocularTuning?.lookAtIK) {
        const lookAtStrength = 0.15; // blend factor: 0 = full drift, 1 = full lookAt
        const tmpRight = rightEye.rotation.clone();
        const tmpLeft  = leftEye.rotation.clone();
        rightEye.lookAt(camera.position);
        leftEye.lookAt(camera.position);
        rightEye.rotation.x = THREE.MathUtils.lerp(tmpRight.x, rightEye.rotation.x, lookAtStrength);
        rightEye.rotation.y = THREE.MathUtils.lerp(tmpRight.y, rightEye.rotation.y, lookAtStrength);
        leftEye.rotation.x  = THREE.MathUtils.lerp(tmpLeft.x,  leftEye.rotation.x,  lookAtStrength);
        leftEye.rotation.y  = THREE.MathUtils.lerp(tmpLeft.y,  leftEye.rotation.y,  lookAtStrength);
      }
    } else {
      rightEye.rotation.x = THREE.MathUtils.damp(rightEye.rotation.x, 0, 8, delta);
      rightEye.rotation.y = THREE.MathUtils.damp(rightEye.rotation.y, 0, 8, delta);
      leftEye.rotation.x  = THREE.MathUtils.damp(leftEye.rotation.x,  0, 8, delta);
      leftEye.rotation.y  = THREE.MathUtils.damp(leftEye.rotation.y,  0, 8, delta);

      // When drift is off, lookAtIK takes full control
      if (options.ocularTuning?.lookAtIK) {
        rightEye.lookAt(camera.position);
        leftEye.lookAt(camera.position);
      }
    }
  }
}