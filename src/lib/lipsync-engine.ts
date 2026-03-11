import * as THREE from 'three';
import { PHYSICS_SMOOTHING } from "@/lib/constants";
import { OCULUS_VISEMES } from './viseme-map';
import { Lipsync } from 'wawa-lipsync';
import { createLogger } from '@/lib/logging/logger';

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
const MAX_CLOCK_COMPENSATION_MS = 70;
const CLOCK_COMPENSATION_RATIO = 0.6;
const ANTICIPATION_WINDOW_MS = 65;
const RESET_SILENCE_HOLD_MS = 240;

type LipState = "vowel" | "plosive" | "fricative" | "silence";

interface ScheduledViseme {
  viseme: string;
  state: LipState;
  speakingGain: number;
  capturedAtMs: number;
  applyAtMs: number;
}

export class LipSyncEngine {
  private lastViseme = 'viseme_sil';
  private previousViseme = 'viseme_sil';
  private transitionCarry = 0;
  private warnedNoNativeVisemes = false;
  private lastDetectedViseme = 'viseme_sil';
  private lastDetectedAtMs = 0;
  private lastNonSilenceAtMs = 0;
  private pendingVisemes: ScheduledViseme[] = [];
  private activeScheduledViseme: ScheduledViseme = {
    viseme: "viseme_sil",
    state: "silence",
    speakingGain: 0,
    capturedAtMs: 0,
    applyAtMs: 0,
  };

  /**
   * Native audio fallback: Maps raw volume level to basic jaw and mouth shapes.
   * Dampens the movement for smoother "co-articulation".
   */
  updateFromAudioLevel(
    level: number,
    delta: number,
    nodes: Record<string, THREE.Object3D | undefined>,
    wawaLipsync: Lipsync | null = null,
  ) {
    const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
    const teeth = nodes.Wolf3D_Teeth as THREE.SkinnedMesh;

    if (!head || !head.morphTargetDictionary || !head.morphTargetInfluences) return;

    if (wawaLipsync) {
      try {
        wawaLipsync.processAudio();
        const state = this.normalizeState(
          (wawaLipsync as unknown as { state?: string }).state,
        );
        const { clockMs, clockCompensationMs } = this.getAudioClock(wawaLipsync);
        const detectedVisemeRaw = (wawaLipsync.viseme as string) || "viseme_sil";
        const spectralLevel = this.getSpectralLevel(wawaLipsync);
        const levelSource = Math.max(level, spectralLevel);
        const levelNorm = THREE.MathUtils.clamp(
          (levelSource - LIPSYNC_LEVEL_FLOOR) / LIPSYNC_LEVEL_RANGE,
          0,
          1,
        );
        const speakingGain = Math.pow(levelNorm, 0.82);
        const detectedViseme = this.stabilizeDetectedViseme(
          speakingGain < 0.035 ? "viseme_sil" : detectedVisemeRaw,
          state,
          speakingGain,
          clockMs,
        );

        this.enqueueViseme({
          viseme: detectedViseme,
          state,
          speakingGain,
          capturedAtMs: clockMs,
          applyAtMs: clockMs + clockCompensationMs,
        });
        this.advanceScheduledViseme(clockMs);

        const scheduled = this.activeScheduledViseme;
        const activeViseme = scheduled.viseme;
        const activeState = scheduled.state;
        const activeGain = scheduled.speakingGain;
        if (activeViseme !== "viseme_sil") {
          this.lastNonSilenceAtMs = clockMs;
        } else if (clockMs - this.lastNonSilenceAtMs > RESET_SILENCE_HOLD_MS) {
          this.pendingVisemes.length = 0;
        }

        if (activeViseme !== this.lastViseme) {
          this.previousViseme = this.lastViseme;
          this.lastViseme = activeViseme;
          this.transitionCarry = 1;
        }

        const carryLambda =
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
        const anticipation = this.getAnticipation(clockMs, activeViseme);
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

        if (useNativeVisemes) {
          for (const viseme of OCULUS_VISEMES) {
            let target = 0;
            if (viseme === this.lastViseme) target = stabilizedActiveWeight;
            else if (viseme === this.previousViseme) target = carryWeight;
            else if (anticipatedViseme && viseme === anticipatedViseme) {
              target = anticipationWeight;
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
            stabilizedActiveWeight,
            carryWeight,
            delta,
            visemeLambda,
            anticipatedViseme,
            anticipationWeight,
          );
        }
        return;
      } catch (e) {
        log.error({ err: e }, "Wawa Lipsync evaluation failed");
      }
    }

    this.pendingVisemes.length = 0;
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
        accum[key] = Math.min(1, (accum[key] ?? 0) + weight * (mix ?? 0));
      }
    };

    blendViseme(activeViseme, activeWeight);
    blendViseme(previousViseme, carryWeight);
    blendViseme(anticipatedViseme ?? "", anticipatedWeight);

    for (const target of ARKIT_MOUTH_TARGETS) {
      this.applyMorph(mesh, target, accum[target] ?? 0, delta, lambda);
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

  private getAudioClock(wawaLipsync: Lipsync): { clockMs: number; clockCompensationMs: number } {
    const context = (wawaLipsync as unknown as { audioContext?: AudioContext }).audioContext;
    if (!context) {
      return { clockMs: performance.now(), clockCompensationMs: 0 };
    }

    const outputLatencyMs = Number.isFinite(context.outputLatency)
      ? THREE.MathUtils.clamp(context.outputLatency * 1000, 0, MAX_CLOCK_COMPENSATION_MS)
      : 0;
    const clockCompensationMs = outputLatencyMs * CLOCK_COMPENSATION_RATIO;

    let clockMs = context.currentTime * 1000;
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
  ): string {
    if (detectedViseme === this.lastDetectedViseme) {
      return detectedViseme;
    }

    const elapsed = clockMs - this.lastDetectedAtMs;
    const minIntervalMs =
      state === "plosive"
        ? 12
        : state === "fricative"
          ? 22
          : state === "vowel"
            ? 30
            : 38;
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
    if (state === "plosive") return 34;
    if (state === "fricative") return 24;
    if (state === "vowel") return 18;
    return 16;
  }

  private getAnticipation(
    clockMs: number,
    activeViseme: string,
  ): { viseme: string | null; weight: number } {
    const next = this.pendingVisemes[0];
    if (!next || next.viseme === activeViseme || next.viseme === "viseme_sil") {
      return { viseme: null, weight: 0 };
    }

    const timeUntilApply = next.applyAtMs - clockMs;
    if (timeUntilApply <= 0 || timeUntilApply > ANTICIPATION_WINDOW_MS) {
      return { viseme: null, weight: 0 };
    }

    const blendProgress = 1 - timeUntilApply / ANTICIPATION_WINDOW_MS;
    const weight = THREE.MathUtils.clamp(blendProgress * 0.24, 0, 0.24);
    return { viseme: next.viseme, weight };
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
      influences[idx] = THREE.MathUtils.damp(influences[idx], target, lambda, delta);
    }
  }
}

