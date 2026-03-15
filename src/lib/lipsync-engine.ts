import * as THREE from 'three';
import { PHYSICS_SMOOTHING } from "@/lib/constants";
import { OCULUS_VISEMES } from './viseme-map';
import { Lipsync } from 'wawa-lipsync';
import { createLogger } from '@/lib/logging/logger';
import { DEFAULT_LIPSYNC_TUNING, type LipSyncTuning } from '@/store/useLipSyncStore';
import {
  DEFAULT_ANATOMICAL_POST_PROCESSING,
  DEFAULT_MESH_POST_PROCESSING,
  DEFAULT_VISEME_OVERRIDES,
  type AnatomicalPostProcessing,
  type MeshPostProcessing,
  type VisemeOverrides,
} from '@/lib/avatar-control.types';

const log = createLogger("lipsync-engine");

const ARKIT_MOUTH_TARGETS = [
  "jawOpen",
  "mouthClose",
  "mouthFunnel",
  "mouthPucker",
  "mouthSmileLeft",
  "mouthSmileRight",
  "mouthStretchLeft",
  "mouthStretchRight",
  "mouthPressLeft",
  "mouthPressRight",
  "mouthLowerDownLeft",
  "mouthLowerDownRight",
] as const;

const ARKIT_VISEME_MAP: Record<string, Partial<Record<(typeof ARKIT_MOUTH_TARGETS)[number], number>>> = {
  viseme_sil: { mouthClose: 0.28 },
  viseme_PP: { mouthClose: 1.0, mouthPressLeft: 0.45, mouthPressRight: 0.45 },
  viseme_FF: { mouthFunnel: 0.5, jawOpen: 0.08 },
  viseme_TH: { jawOpen: 0.22, mouthFunnel: 0.3 },
  viseme_DD: { jawOpen: 0.18, mouthClose: 0.45 },
  viseme_kk: { jawOpen: 0.28 },
  viseme_CH: { mouthPucker: 0.6, jawOpen: 0.18 },
  viseme_SS: { mouthStretchLeft: 0.65, mouthStretchRight: 0.65, jawOpen: 0.1 },
  viseme_nn: { mouthClose: 0.6, jawOpen: 0.12 },
  viseme_RR: { mouthFunnel: 0.42, mouthPucker: 0.34, jawOpen: 0.16 },
  viseme_aa: { jawOpen: 0.62 },
  viseme_E: { mouthStretchLeft: 0.55, mouthStretchRight: 0.55, jawOpen: 0.2 },
  viseme_I: { mouthSmileLeft: 0.55, mouthSmileRight: 0.55, jawOpen: 0.18 },
  viseme_O: { mouthFunnel: 0.72, jawOpen: 0.23 },
  viseme_U: { mouthPucker: 0.72, jawOpen: 0.14 },
};

const LIPSYNC_LEVEL_FLOOR = 0.02;
const LIPSYNC_LEVEL_RANGE = 0.3;
const ACTIVE_VOWEL_WEIGHT = 0.58;
const ACTIVE_CONSONANT_WEIGHT = 0.5;
const ACTIVE_WEIGHT_BOOST = 0.22;
const MAX_PENDING_VISEMES = 72;

type LipState = "vowel" | "plosive" | "fricative" | "silence";

interface ScheduledViseme {
  viseme: string;
  state: LipState;
  speakingGain: number;
  capturedAtMs: number;
  applyAtMs: number;
}

interface LipSyncRuntimeOptions {
  visemeOverrides?: VisemeOverrides;
  meshPostProcessing?: MeshPostProcessing;
  anatomicalPostProcessing?: AnatomicalPostProcessing;
}

export class LipSyncEngine {
  private currentTuning: LipSyncTuning = { ...DEFAULT_LIPSYNC_TUNING };
  private lastViseme = 'viseme_sil';
  private previousViseme = 'viseme_sil';
  private transitionCarry = 0;
  private warnedNoNativeVisemes = false;
  private consecutiveSilentDetections = 0;
  private lastDetectedViseme = 'viseme_sil';
  private lastDetectedAtMs = 0;
  private lastNonSilenceAtMs = 0;
  private dynamicNoiseFloor = LIPSYNC_LEVEL_FLOOR;
  private pendingVisemes: ScheduledViseme[] = [];
  private activeScheduledViseme: ScheduledViseme = {
    viseme: "viseme_sil",
    state: "silence",
    speakingGain: 0,
    capturedAtMs: 0,
    applyAtMs: 0,
  };
  private morphHistory = new Map<string, number>();
  private currentRuntimeOptions: LipSyncRuntimeOptions = {};
  private currentLipAsymmetry = 0;

  /**
   * Native audio fallback: Maps raw volume level to basic jaw and mouth shapes.
   * Dampens the movement for smoother "co-articulation".
   */
  updateFromAudioLevel(
    level: number,
    delta: number,
    nodes: Record<string, THREE.Object3D | undefined>,
    wawaLipsync: Lipsync | null = null,
    tuning: LipSyncTuning = DEFAULT_LIPSYNC_TUNING,
    options: LipSyncRuntimeOptions = {},
  ) {
    this.currentTuning = tuning;
    this.currentRuntimeOptions = options;
    const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
    const teeth = nodes.Wolf3D_Teeth as THREE.SkinnedMesh;

    if (!head || !head.morphTargetDictionary || !head.morphTargetInfluences) return;

    if (wawaLipsync) {
      try {
        wawaLipsync.processAudio();
        const state = this.normalizeState(
          (wawaLipsync as unknown as { state?: string }).state,
        );
        const { clockMs, clockCompensationMs } = this.getAudioClock(wawaLipsync, tuning);
        const detectedVisemeRaw = (wawaLipsync.viseme as string) || "viseme_sil";
        const spectralLevel = this.getSpectralLevel(wawaLipsync);
        
        const levelSource = Math.max(level, spectralLevel);
        const effectiveFloor = this.getEffectiveFloor(levelSource, delta, tuning);
        const levelNorm = THREE.MathUtils.clamp(
          (levelSource - effectiveFloor) / LIPSYNC_LEVEL_RANGE,
          0,
          1,
        );
        const speakingGain = Math.pow(levelNorm, 0.82);
        const robustDetectedViseme = this.getRobustDetectedViseme(
          detectedVisemeRaw,
          state,
          speakingGain,
          levelSource,
          spectralLevel,
        );

        const detectedViseme = this.stabilizeDetectedViseme(
          speakingGain < 0.035 ? "viseme_sil" : robustDetectedViseme,
          state,
          speakingGain,
          clockMs,
          tuning,
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isPlaybackMode = !!((wawaLipsync as any).audioStreamerRef?.current?.isPlaying);

        // Normalize viseme name (ensure viseme_ prefix)
        const normalizedDetected = this.normalizeVisemeName(detectedViseme);

        if (normalizedDetected !== "viseme_sil") {
          this.lastNonSilenceAtMs = clockMs;
        } else if (clockMs - this.lastNonSilenceAtMs > tuning.resetSilenceHoldMs) {
          this.pendingVisemes.length = 0;
        }

        if (!isPlaybackMode) {
          // Bypassing the queue for local microphone input
          this.activeScheduledViseme = {
            viseme: normalizedDetected,
            state,
            speakingGain,
            capturedAtMs: clockMs,
            applyAtMs: clockMs,
          };
          this.pendingVisemes.length = 0;
        } else {
          this.enqueueViseme({
            viseme: normalizedDetected,
            state,
            speakingGain,
            capturedAtMs: clockMs,
            applyAtMs: clockMs + clockCompensationMs,
          });
          this.advanceScheduledViseme(clockMs);
        }

        const scheduled = this.activeScheduledViseme;
        const activeViseme = scheduled.viseme;
        const activeState: LipState =
          scheduled.state === "silence" && activeViseme !== "viseme_sil"
            ? "vowel"
            : scheduled.state;
        const activeGain = scheduled.speakingGain;

        if (activeViseme !== this.lastViseme) {
          this.previousViseme = this.lastViseme;
          this.lastViseme = activeViseme;
          this.transitionCarry = 1;

          // Subtle Lip Asymmetry offset re-rolled per fresh viseme transition
          const asymMax = options.meshPostProcessing?.lipAsymmetryOffset ?? 0;
          this.currentLipAsymmetry = asymMax > 0 ? (Math.random() * 2 - 1) * asymMax : 0;
        }

        const jawHeavyVisemes = ["viseme_aa", "viseme_O", "viseme_U", "viseme_RR"];
        const carryLambda =
          jawHeavyVisemes.includes(this.previousViseme) ? 6 :
          activeState === "vowel" ? 10 : activeState === "fricative" ? 14 : 18;
        this.transitionCarry = THREE.MathUtils.damp(this.transitionCarry, 0, carryLambda, delta);

        const baseWeight =
          activeState === "vowel" ? ACTIVE_VOWEL_WEIGHT : ACTIVE_CONSONANT_WEIGHT;
        const activeWeight = activeViseme === "viseme_sil"
          ? THREE.MathUtils.clamp(0.22 * (1 - activeGain * 0.65), 0.08, 0.24)
          : THREE.MathUtils.clamp(
              baseWeight + activeGain * ACTIVE_WEIGHT_BOOST,
              0,
              0.9,
            );
        const carryWeight = this.previousViseme === "viseme_sil"
          ? 0
          : activeWeight * (activeState === "vowel" ? 0.24 : 0.18) * this.transitionCarry;
        const visemeLambda = this.getVisemeLambda(activeState);
        const anticipation = this.getAnticipation(clockMs, activeViseme, tuning);
        const anticipatedViseme = anticipation.viseme;
        const anticipationWeight = anticipatedViseme
          ? activeWeight * anticipation.weight
          : 0;
        const stabilizedActiveWeight = Math.max(0, activeWeight - anticipationWeight);
        

        const useNativeVisemes = this.hasNativeVisemes(head);
        if (!useNativeVisemes && !this.warnedNoNativeVisemes) {
          this.warnedNoNativeVisemes = true;
          log.warn("Avatar has no native Oculus viseme targets; using ARKit fallback mapping.");
        }

        // Jaw Decoupling: Audio-energy driven jaw opening
        const decoupleWeight = options.anatomicalPostProcessing?.jawDecouplingWeight ?? 0;
        const jawEnergyTarget = (activeGain > 0.1) ? Math.pow(activeGain, 1.2) * decoupleWeight : 0;

        if (useNativeVisemes) {
          let totalWeight = 0;
          const targetCaps: Record<string, number> = {};

          for (const viseme of OCULUS_VISEMES) {
            let target = 0;
            if (viseme === this.lastViseme) target = stabilizedActiveWeight;
            else if (viseme === this.previousViseme) target = carryWeight;
            else if (anticipatedViseme && viseme === anticipatedViseme) {
              target = anticipationWeight;
            }

            target *= this.getVisemeScale(viseme, options.visemeOverrides);
            targetCaps[viseme] = target;
            totalWeight += target;
          }

          // Morph Weight Capping (Native)
          const weightCap = options.meshPostProcessing?.morphWeightCap ?? 1.0;
          const normalizeFactor = totalWeight > weightCap ? weightCap / totalWeight : 1.0;

          for (const viseme of OCULUS_VISEMES) {
            let target = targetCaps[viseme] * normalizeFactor;
            target = this.applyRegionalPostProcessing(target, viseme, options);

            // Add decoupled jaw energy to the main jaw viseme (usually aa)
            if (viseme === "viseme_aa" && jawEnergyTarget > 0) {
              target = THREE.MathUtils.clamp(target + jawEnergyTarget, 0, weightCap);
            }

            this.applyMorph(head, viseme, target, delta, visemeLambda);
            if (teeth && teeth.morphTargetDictionary && teeth.morphTargetInfluences) {
              this.applyMorph(teeth, viseme, target * 0.95, delta, visemeLambda);
            }
          }
        } else {
          this.applyArkitFromVisemes(
            head,
            this.lastViseme,
            this.previousViseme,
            stabilizedActiveWeight * this.getVisemeScale(this.lastViseme, options.visemeOverrides),
            carryWeight * this.getVisemeScale(this.previousViseme, options.visemeOverrides),
            delta,
            visemeLambda,
            anticipatedViseme,
            anticipatedViseme
              ? anticipationWeight * this.getVisemeScale(anticipatedViseme, options.visemeOverrides)
              : anticipationWeight,
            options,
            jawEnergyTarget,
            this.currentLipAsymmetry
          );
        }
        return;
      } catch (e) {
        log.error({ err: e }, "Wawa Lipsync evaluation failed");
      }
    }

    this.pendingVisemes.length = 0;
    if (tuning.adaptiveNoiseFloor) {
      this.getEffectiveFloor(level, delta, tuning);
    } else {
      this.dynamicNoiseFloor = LIPSYNC_LEVEL_FLOOR;
    }
    this.applyVolumeFallback(head, teeth, level, delta);
  }

  private applyVolumeFallback(head: THREE.SkinnedMesh, teeth: THREE.SkinnedMesh, level: number, delta: number) {
      // Absolute fallback: Volume-based jaw/mouth (if wawa isn't ready or volume is extremely low)
      const normalizedLevel = THREE.MathUtils.clamp((level - 0.03) / 0.3, 0, 1);
      const targetJaw = Math.min(0.45, normalizedLevel * PHYSICS_SMOOTHING.jaw_mult * 0.28);
      const targetMouth = Math.min(0.4, normalizedLevel * PHYSICS_SMOOTHING.mouth_mult * 0.24);

      this.applyMorph(head, "jawOpen", targetJaw, delta);
      this.applyMorph(head, "mouthFunnel", targetMouth * 0.6, delta);
      this.applyMorph(head, "mouthPucker", targetMouth * 0.4, delta);
      
      if (teeth && teeth.morphTargetDictionary && teeth.morphTargetInfluences) {
        this.applyMorph(teeth, "jawOpen", targetJaw * 1.1, delta);
      }
  }

  private hasNativeVisemes(mesh: THREE.SkinnedMesh): boolean {
    const dict = mesh.morphTargetDictionary;
    if (!dict) return false;
    return dict.viseme_aa !== undefined || dict.viseme_PP !== undefined;
  }

  private applyArkitFromVisemes(
    mesh: THREE.SkinnedMesh,
    activeViseme: string,
    previousViseme: string,
    activeWeight: number,
    carryWeight: number,
    delta: number,
    lambda: number,
    anticipatedViseme: string | null = null,
    anticipatedWeight: number = 0,
    options: LipSyncRuntimeOptions = {},
    jawEnergyTarget: number = 0,
    lipAsymmetry: number = 0
  ) {
    const accum: Partial<Record<(typeof ARKIT_MOUTH_TARGETS)[number], number>> = {};
    for (const target of ARKIT_MOUTH_TARGETS) {
      accum[target] = 0;
    }

    const blendViseme = (viseme: string, weight: number) => {
      const mapping = ARKIT_VISEME_MAP[viseme];
      if (!mapping || weight <= 0) return;
      for (const [target, mix] of Object.entries(mapping)) {
        const key = target as (typeof ARKIT_MOUTH_TARGETS)[number];
        accum[key] = (accum[key] ?? 0) + weight * (mix ?? 0);
      }
    };

    blendViseme(activeViseme, activeWeight);
    blendViseme(previousViseme, carryWeight);
    blendViseme(anticipatedViseme ?? "", anticipatedWeight);

    // Apply Lip Asymmetry
    if (lipAsymmetry !== 0) {
      accum.mouthSmileLeft = Math.max(0, (accum.mouthSmileLeft ?? 0) + lipAsymmetry);
      accum.mouthSmileRight = Math.max(0, (accum.mouthSmileRight ?? 0) - lipAsymmetry);
      accum.mouthStretchLeft = Math.max(0, (accum.mouthStretchLeft ?? 0) + lipAsymmetry);
      accum.mouthStretchRight = Math.max(0, (accum.mouthStretchRight ?? 0) - lipAsymmetry);
    }

    // Apply Jaw Decoupling
    if (jawEnergyTarget > 0) {
      accum.jawOpen = (accum.jawOpen ?? 0) + jawEnergyTarget;
    }

    // Morph Weight Capping (ARKit)
    let totalWeight = 0;
    for (const target of ARKIT_MOUTH_TARGETS) {
      totalWeight += accum[target] ?? 0;
    }
    const weightCap = options.meshPostProcessing?.morphWeightCap ?? 1.0;
    const normalizeFactor = totalWeight > weightCap ? weightCap / totalWeight : 1.0;

    for (const target of ARKIT_MOUTH_TARGETS) {
      const cappedValue = (accum[target] ?? 0) * normalizeFactor;
      const processed = this.applyRegionalPostProcessing(cappedValue, target, options);
      this.applyMorph(mesh, target, processed, delta, lambda);
    }
  }

  private normalizeState(state: string | undefined): LipState {
    if (state === "plosive" || state === "fricative" || state === "silence" || state === "vowel") {
      return state;
    }
    return "vowel";
  }

  private getSpectralLevel(wawaLipsync: Lipsync): number {
    const features = (wawaLipsync as unknown as { features?: { volume?: number } | null }).features;
    const volume = features?.volume;
    if (typeof volume !== "number" || !Number.isFinite(volume)) {
      return 0;
    }
    return THREE.MathUtils.clamp(volume, 0, 1);
  }

  private normalizeVisemeName(name: string): string {
    if (!name || name === "silence" || name === "sil") return "viseme_sil";
    if (name.startsWith("viseme_")) return name;
    // Common mappings if wawa-lipsync returns raw phonemes
    if (name.length <= 2) {
       // Rough fallback prefixing
       return `viseme_${name}`;
    }
    return `viseme_${name}`;
  }

  private getAudioClock(
    wawaLipsync: Lipsync,
    tuning: LipSyncTuning,
  ): { clockMs: number; clockCompensationMs: number } {
    const context = (wawaLipsync as unknown as { audioContext?: AudioContext }).audioContext;
    if (!context) {
      return { clockMs: performance.now(), clockCompensationMs: 0 };
    }

    const outputLatencyMs = Number.isFinite(context.outputLatency)
      ? THREE.MathUtils.clamp(context.outputLatency * 1000, 0, tuning.maxClockCompensationMs)
      : 0;
    const clockCompensationMs = outputLatencyMs * tuning.clockCompensationRatio;

    let clockMs = context.currentTime * 1000;
    
    // ✅ Improved Clock Stalling Fix: Keep a baseline if currentTime is 0 or hasn't started.
    // Use an offset to keep performance.now() and context.currentTime in the same scale.
    if (clockMs === 0) {
      clockMs = performance.now();
    }
    try {
      const withTimestamp = context as AudioContext & {
        getOutputTimestamp?: () => AudioTimestamp;
      };
      if (typeof withTimestamp.getOutputTimestamp === "function") {
        const timestamp = withTimestamp.getOutputTimestamp();
        const contextTime = timestamp?.contextTime;
        if (typeof contextTime === "number" && Number.isFinite(contextTime) && contextTime > 0) {
          clockMs = contextTime * 1000;
        }
      }
    } catch {
      // Browsers without reliable timestamp support gracefully fall back to currentTime.
    }

    return { clockMs, clockCompensationMs };
  }

  private stabilizeDetectedViseme(
    detectedViseme: string,
    state: LipState,
    speakingGain: number,
    clockMs: number,
    tuning: LipSyncTuning,
  ): string {
    if (detectedViseme === this.lastDetectedViseme) {
      return detectedViseme;
    }

    const elapsed = clockMs - this.lastDetectedAtMs;
    const minIntervalMs =
      state === "plosive"
        ? tuning.minSwitchMsPlosive
        : state === "fricative"
          ? tuning.minSwitchMsFricative
          : state === "vowel"
            ? tuning.minSwitchMsVowel
            : tuning.minSwitchMsSilence;
    const allowImmediateSwitch = speakingGain > 0.72 || detectedViseme === "viseme_sil";
    if (elapsed < minIntervalMs && !allowImmediateSwitch) {
      return this.lastDetectedViseme;
    }

    this.lastDetectedViseme = detectedViseme;
    this.lastDetectedAtMs = clockMs;
    return detectedViseme;
  }

  private enqueueViseme(frame: ScheduledViseme) {
    const lastQueued = this.pendingVisemes[this.pendingVisemes.length - 1];
    if (
      lastQueued &&
      lastQueued.viseme === frame.viseme &&
      Math.abs(lastQueued.applyAtMs - frame.applyAtMs) < 12
    ) {
      lastQueued.state = frame.state;
      lastQueued.speakingGain = frame.speakingGain;
      lastQueued.capturedAtMs = frame.capturedAtMs;
      return;
    }

    this.pendingVisemes.push(frame);
    if (this.pendingVisemes.length > MAX_PENDING_VISEMES) {
      this.pendingVisemes.splice(0, this.pendingVisemes.length - MAX_PENDING_VISEMES);
    }
  }

  private advanceScheduledViseme(clockMs: number) {
    while (this.pendingVisemes.length > 0 && this.pendingVisemes[0].applyAtMs <= clockMs) {
      this.activeScheduledViseme = this.pendingVisemes.shift()!;
    }
  }

  private getVisemeLambda(state: LipState): number {
    const tuning = (this.currentTuning ?? DEFAULT_LIPSYNC_TUNING);
    if (state === "plosive") return tuning.lambdaPlosive;
    if (state === "fricative") return tuning.lambdaFricative;
    if (state === "vowel") return tuning.lambdaVowel;
    return tuning.lambdaSilence;
  }

  private getAnticipation(
    clockMs: number,
    activeViseme: string,
    tuning: LipSyncTuning,
  ): { viseme: string | null; weight: number } {
    const next = this.pendingVisemes[0];
    if (!next || next.viseme === activeViseme || next.viseme === "viseme_sil") {
      return { viseme: null, weight: 0 };
    }

    const windowMs = Math.max(1, tuning.anticipationWindowMs);
    const timeUntilApply = next.applyAtMs - clockMs;
    if (timeUntilApply <= 0 || timeUntilApply > windowMs) {
      return { viseme: null, weight: 0 };
    }

    const blendProgress = 1 - timeUntilApply / windowMs;
    const maxWeight = THREE.MathUtils.clamp(tuning.anticipationWeightMax, 0, 0.5);
    const weight = THREE.MathUtils.clamp(blendProgress * maxWeight, 0, maxWeight);
    return { viseme: next.viseme, weight };
  }

  private getEffectiveFloor(
    levelSource: number,
    delta: number,
    tuning: LipSyncTuning,
  ): number {
    if (!tuning.adaptiveNoiseFloor) {
      this.dynamicNoiseFloor = LIPSYNC_LEVEL_FLOOR;
      return LIPSYNC_LEVEL_FLOOR;
    }

    const minFloor = tuning.noiseFloorMin;
    const maxFloor = tuning.noiseFloorMax;
    const clampedLevel = THREE.MathUtils.clamp(levelSource, minFloor, maxFloor);
    const quietBand = this.dynamicNoiseFloor + tuning.speechThresholdOffset * 1.5;

    if (levelSource <= quietBand) {
      this.dynamicNoiseFloor = THREE.MathUtils.damp(
        this.dynamicNoiseFloor,
        clampedLevel,
        tuning.noiseFloorAdaptLambda,
        delta,
      );
    } else {
      this.dynamicNoiseFloor = THREE.MathUtils.damp(
        this.dynamicNoiseFloor,
        minFloor,
        tuning.noiseFloorReleaseLambda,
        delta,
      );
    }

    this.dynamicNoiseFloor = THREE.MathUtils.clamp(this.dynamicNoiseFloor, minFloor, maxFloor);
    return THREE.MathUtils.clamp(
      this.dynamicNoiseFloor + tuning.speechThresholdOffset,
      minFloor,
      maxFloor + tuning.speechThresholdOffset,
    );
  }

  private getRobustDetectedViseme(
    detectedVisemeRaw: string,
    state: LipState,
    speakingGain: number,
    levelSource: number,
    spectralLevel: number,
  ): string {
    if (detectedVisemeRaw !== "viseme_sil") {
      this.consecutiveSilentDetections = 0;
      return detectedVisemeRaw;
    }

    this.consecutiveSilentDetections += 1;
    const hasAudibleSpeech = speakingGain > 0.12 || levelSource > 0.09 || spectralLevel > 0.03;
    
    // Reduce onset latency: return silent only if definitely silent or we're filtering jitter
    if (!hasAudibleSpeech || (this.lastDetectedViseme === "viseme_sil" && this.consecutiveSilentDetections < 2)) {
      return "viseme_sil";
    }

    if (state === "fricative") return "viseme_SS";
    if (state === "plosive") return "viseme_DD";
    if (levelSource > 0.25) return "viseme_aa";
    if (levelSource > 0.16) return "viseme_E";
    return "viseme_O";
  }

  private applyMorph(
    mesh: THREE.SkinnedMesh,
    name: string,
    target: number,
    delta: number,
    lambda: number = 25,
  ) {
    const dict = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (dict && influences && dict[name] !== undefined) {
      const idx = dict[name];
      const smoothedTarget = this.applyTemporalSmoothing(name, target, this.currentRuntimeOptions);
      influences[idx] = THREE.MathUtils.damp(influences[idx], smoothedTarget, lambda, delta);
    }
  }

  private isLowerFaceTarget(name: string): boolean {
    const key = name.toLowerCase();
    return key.includes('jaw') || key.includes('mouth') || key.includes('lip') || key.includes('viseme') || key.includes('tongue');
  }

  private applyRegionalPostProcessing(
    target: number,
    name: string,
    options: LipSyncRuntimeOptions,
  ): number {
    const meshPostProcessing = {
      ...DEFAULT_MESH_POST_PROCESSING,
      ...(options.meshPostProcessing ?? {}),
    };
    const anatomicalPostProcessing = {
      ...DEFAULT_ANATOMICAL_POST_PROCESSING,
      ...(options.anatomicalPostProcessing ?? {}),
    };

    const isLower = this.isLowerFaceTarget(name);
    const maskLevel = THREE.MathUtils.clamp(anatomicalPostProcessing.faceMaskLevel, 0, 1);
    const softMask = THREE.MathUtils.clamp(maskLevel * (1 - anatomicalPostProcessing.faceMaskSoftness * 10), 0, 1);
    const blendedStrength = THREE.MathUtils.lerp(
      anatomicalPostProcessing.upperFaceStrength,
      anatomicalPostProcessing.lowerFaceStrength,
      isLower ? softMask : 1 - softMask,
    );

    let processed = target * blendedStrength * meshPostProcessing.skinStrength;
    if (name.toLowerCase().includes('jaw')) {
      processed = processed * meshPostProcessing.jawStrength * anatomicalPostProcessing.jawStrength;
      processed += anatomicalPostProcessing.jawHeight;
      processed += meshPostProcessing.lipOpenOffset;
    }
    if (name.toLowerCase().includes('tongue')) {
      processed = processed * anatomicalPostProcessing.tongueStrength + anatomicalPostProcessing.tongueHeight;
    }

    return THREE.MathUtils.clamp(processed, 0, 1.2);
  }

  private applyTemporalSmoothing(
    name: string,
    target: number,
    options: LipSyncRuntimeOptions,
  ): number {
    const meshPostProcessing = {
      ...DEFAULT_MESH_POST_PROCESSING,
      ...(options.meshPostProcessing ?? {}),
    };
    const previous = this.morphHistory.get(name) ?? target;
    const smoothing = this.isLowerFaceTarget(name)
      ? meshPostProcessing.lowerFaceSmoothing
      : meshPostProcessing.upperFaceSmoothing;
    const alpha = THREE.MathUtils.clamp(smoothing * 60, 0, 0.95);
    const next = previous + (target - previous) * (1 - alpha);
    this.morphHistory.set(name, next);
    return next;
  }

  private getVisemeScale(viseme: string, overrides?: VisemeOverrides): number {
    const resolvedOverrides = {
      ...DEFAULT_VISEME_OVERRIDES,
      ...(overrides ?? {}),
    };
    const masterScale = resolvedOverrides.drivingDataScale;
    if (viseme === 'viseme_PP' || viseme === 'viseme_nn') {
      return THREE.MathUtils.clamp(masterScale * (resolvedOverrides.strengthBMP / 100), 0, 3);
    }
    if (viseme === 'viseme_FF' || viseme === 'viseme_TH') {
      return THREE.MathUtils.clamp(masterScale * (resolvedOverrides.strengthFV / 100), 0, 3);
    }
    if (viseme === 'viseme_O' || viseme === 'viseme_U' || viseme === 'viseme_RR') {
      return THREE.MathUtils.clamp(masterScale * (resolvedOverrides.strengthWOo / 100), 0, 3);
    }
    if (viseme === 'viseme_SS' || viseme === 'viseme_DD' || viseme === 'viseme_CH' || viseme === 'viseme_kk') {
      return THREE.MathUtils.clamp(masterScale * (resolvedOverrides.strengthSZTD / 100), 0, 3);
    }
    return THREE.MathUtils.clamp(masterScale, 0, 3);
  }
}

