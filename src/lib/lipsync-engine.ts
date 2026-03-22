/**
 * LipSyncEngine — viseme-driven mouth animation
 *
 * Processes wawa-lipsync output (or audio-level fallback) into morph
 * target weights for both Oculus-native and ARKit-fallback avatar meshes.
 *
 * Scheduled viseme queue with anticipation blending · coarticulation
 * carry · adaptive noise floor · inter-word breath micro-motion
 * All tuning constants from emotive-speech.json mode config.
 *
 * Publishes `speechEnergy` for EmotionEngine consumption.
 */

import * as THREE from "three";
import { PHYSICS_SMOOTHING, VISEME_MAP } from "@/lib/constants";
import { OCULUS_VISEMES } from "./viseme-map";
import { Lipsync } from "wawa-lipsync";
import { createLogger } from "@/lib/logging/logger";
import {
  DEFAULT_LIPSYNC_TUNING,
  type LipSyncTuning,
} from "@/store/useLipSyncStore";
import {
  DEFAULT_ANATOMICAL_POST_PROCESSING,
  DEFAULT_MESH_POST_PROCESSING,
  DEFAULT_VISEME_OVERRIDES,
  type AnatomicalPostProcessing,
  type MeshPostProcessing,
  type VisemeOverrides,
} from "@/lib/avatar-control.types";
import {
  getModeTuning,
  getArkitVisemeMap,
  type LipSyncModeConfig,
  type ArkitVisemeMap,
  type EmotiveSpeechMode,
} from "@/lib/emotive-speech-config";

const log = createLogger("lipsync-engine");

// ═══════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════

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

type ArkitMouthTarget = (typeof ARKIT_MOUTH_TARGETS)[number];

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
//  VisemeQueue — O(1) amortised enqueue/dequeue
// ═══════════════════════════════════════════════════════════════════

class VisemeQueue<T> {
  private items: T[] = [];
  private headIndex = 0;
  private readonly cleanupThreshold: number;

  constructor(cleanupThreshold = 128) {
    this.cleanupThreshold = cleanupThreshold;
  }

  enqueue(item: T): void {
    this.items.push(item);
  }

  dequeue(): T | undefined {
    if (this.headIndex >= this.items.length) return undefined;
    const item = this.items[this.headIndex];
    this.headIndex += 1;
    this.compactIfNeeded();
    return item;
  }

  peek(): T | undefined {
    return this.headIndex < this.items.length
      ? this.items[this.headIndex]
      : undefined;
  }

  peekLast(): T | undefined {
    return this.length > 0
      ? this.items[this.items.length - 1]
      : undefined;
  }

  trimToMax(maxLength: number): void {
    if (maxLength < 0) return;
    while (this.length > maxLength) {
      this.headIndex += 1;
    }
    this.compactIfNeeded();
  }

  clear(): void {
    this.items = [];
    this.headIndex = 0;
  }

  get length(): number {
    return this.items.length - this.headIndex;
  }

  private compactIfNeeded(): void {
    if (this.headIndex >= this.cleanupThreshold) {
      this.items = this.items.slice(this.headIndex);
      this.headIndex = 0;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Silence viseme constant
// ═══════════════════════════════════════════════════════════════════

const SILENCE_VISEME: ScheduledViseme = {
  viseme: "viseme_sil",
  state: "silence",
  speakingGain: 0,
  capturedAtMs: 0,
  applyAtMs: 0,
};

// ═══════════════════════════════════════════════════════════════════
//  LipSyncEngine
// ═══════════════════════════════════════════════════════════════════

export class LipSyncEngine {
  /** Readable by EmotionEngine for speech-proportional modulation. */
  public speechEnergy = 0;

  /* ── Mode config ───────────────────────────────────────────────── */
  private modeCfg: LipSyncModeConfig;
  private arkitMap: ArkitVisemeMap;

  /* ── Per-frame tuning (from store) ─────────────────────────────── */
  private currentTuning: LipSyncTuning = { ...DEFAULT_LIPSYNC_TUNING };

  /* ── Viseme state ──────────────────────────────────────────────── */
  private lastViseme = "viseme_sil";
  private previousViseme = "viseme_sil";
  private transitionCarry = 0;
  private currentLipAsymmetry = 0;

  /* ── Detection state ───────────────────────────────────────────── */
  private warnedNoNativeVisemes = false;
  private consecutiveSilentDetections = 0;
  private lastDetectedViseme = "viseme_sil";
  private lastDetectedAtMs = 0;
  private lastNonSilenceAtMs = 0;

  /* ── Adaptive noise floor ──────────────────────────────────────── */
  private dynamicNoiseFloor: number;

  /* ── Scheduled viseme queue ────────────────────────────────────── */
  private pendingVisemes = new VisemeQueue<ScheduledViseme>();
  private activeScheduledViseme: ScheduledViseme = { ...SILENCE_VISEME };

  /* ── Temporal smoothing history ────────────────────────────────── */
  private morphHistory = new Map<string, number>();
  private currentRuntimeOptions: LipSyncRuntimeOptions = {};

  constructor(mode: EmotiveSpeechMode = "broadcast") {
    this.modeCfg = getModeTuning(mode).lipsync;
    this.arkitMap = getArkitVisemeMap();
    this.dynamicNoiseFloor = this.modeCfg.levelFloor;
  }

  /** Hot-swap lip sync mode config. Safe mid-frame. */
  setMode(mode: EmotiveSpeechMode): void {
    this.modeCfg = getModeTuning(mode).lipsync;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Main Update
  // ═══════════════════════════════════════════════════════════════

  updateFromAudioLevel(
    level: number,
    delta: number,
    nodes: Record<string, THREE.Object3D | undefined>,
    wawaLipsync: Lipsync | null = null,
    tuning: LipSyncTuning = DEFAULT_LIPSYNC_TUNING,
    options: LipSyncRuntimeOptions = {},
    isPlaybackMode: boolean = true,
  ): void {
    this.currentTuning = tuning;
    this.currentRuntimeOptions = options;
    const cfg = this.modeCfg;

    const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
    const teeth = nodes.Wolf3D_Teeth as THREE.SkinnedMesh;

    if (!head?.morphTargetDictionary || !head.morphTargetInfluences) return;

    if (wawaLipsync) {
      try {
        this.processWawaLipsync(
          wawaLipsync,
          level,
          delta,
          head,
          teeth,
          tuning,
          options,
          isPlaybackMode,
        );
        return;
      } catch (e) {
        log.error({ err: e }, "Wawa Lipsync evaluation failed");
      }
    }

    // Fallback path — no wawa lipsync available
    this.pendingVisemes.clear();
    if (tuning.adaptiveNoiseFloor) {
      this.computeEffectiveFloor(level, delta, tuning);
    } else {
      this.dynamicNoiseFloor = cfg.levelFloor;
    }
    this.applyVolumeFallback(head, teeth, level, delta);
  }

  // ═══════════════════════════════════════════════════════════════
  //  Wawa Lipsync Processing
  // ═══════════════════════════════════════════════════════════════

  private processWawaLipsync(
    wawaLipsync: Lipsync,
    level: number,
    delta: number,
    head: THREE.SkinnedMesh,
    teeth: THREE.SkinnedMesh | undefined,
    tuning: LipSyncTuning,
    options: LipSyncRuntimeOptions,
    isPlaybackMode: boolean,
  ): void {
    const cfg = this.modeCfg;

    wawaLipsync.processAudio();

    const state = this.normalizeState(
      (wawaLipsync as unknown as { state?: string }).state,
    );
    const { clockMs, clockCompensationMs } = this.getAudioClock(
      wawaLipsync,
      tuning,
    );
    const detectedVisemeRaw =
      (wawaLipsync.viseme as string) || "viseme_sil";
    const spectralLevel = this.getSpectralLevel(wawaLipsync);

    // ── Compute speaking gain ────────────────────────────────────
    const levelSource = Math.max(level, spectralLevel);
    const effectiveFloor = this.computeEffectiveFloor(
      levelSource,
      delta,
      tuning,
    );
    const levelNorm = THREE.MathUtils.clamp(
      (levelSource - effectiveFloor) / cfg.levelRange,
      0,
      1,
    );
    const speakingGain = Math.pow(levelNorm, cfg.levelExponent);

    // Publish for EmotionEngine
    this.speechEnergy = speakingGain;

    // ── Robust viseme detection ──────────────────────────────────
    const robustViseme = this.getRobustDetectedViseme(
      detectedVisemeRaw,
      state,
      speakingGain,
      levelSource,
      spectralLevel,
    );
    const detectedViseme = this.stabilizeDetectedViseme(
      speakingGain < 0.035 ? "viseme_sil" : robustViseme,
      state,
      speakingGain,
      clockMs,
      tuning,
    );

    const normalizedDetected = this.normalizeVisemeName(detectedViseme);

    // ── Track last non-silence ───────────────────────────────────
    if (normalizedDetected !== "viseme_sil") {
      this.lastNonSilenceAtMs = clockMs;
    } else if (clockMs - this.lastNonSilenceAtMs > tuning.resetSilenceHoldMs) {
      this.pendingVisemes.clear();
    }

    // ── Schedule or apply directly ───────────────────────────────
    if (!isPlaybackMode) {
      // Local microphone — bypass queue
      this.activeScheduledViseme = {
        viseme: normalizedDetected,
        state,
        speakingGain,
        capturedAtMs: clockMs,
        applyAtMs: clockMs,
      };
      this.pendingVisemes.clear();
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

    // ── Read active scheduled viseme ─────────────────────────────
    const scheduled = this.activeScheduledViseme;
    const activeViseme = scheduled.viseme;
    const activeState: LipState =
      scheduled.state === "silence" && activeViseme !== "viseme_sil"
        ? "vowel"
        : scheduled.state;
    const activeGain = scheduled.speakingGain;

    // ── Transition tracking ──────────────────────────────────────
    if (activeViseme !== this.lastViseme) {
      this.previousViseme = this.lastViseme;
      this.lastViseme = activeViseme;
      this.transitionCarry = 1;

      // Subtle lip asymmetry per viseme transition
      const asymMax =
        options.meshPostProcessing?.lipAsymmetryOffset ?? 0;
      this.currentLipAsymmetry =
        asymMax > 0 ? (Math.random() * 2 - 1) * asymMax : 0;
    }

    // ── Coarticulation carry decay ───────────────────────────────
    const coart = cfg.coarticulation;
    const jawHeavy = ["viseme_aa", "viseme_O", "viseme_U", "viseme_RR"];
    const carryLambda = jawHeavy.includes(this.previousViseme)
      ? coart.jawHeavyCarryLambda
      : activeState === "vowel"
        ? coart.vowelCarryLambda
        : activeState === "fricative"
          ? coart.fricativeCarryLambda
          : coart.defaultCarryLambda;
    this.transitionCarry = THREE.MathUtils.damp(
      this.transitionCarry,
      0,
      carryLambda,
      delta,
    );

    // ── Compute weights ──────────────────────────────────────────
    const baseWeight =
      activeState === "vowel"
        ? cfg.activeVowelWeight
        : cfg.activeConsonantWeight;

    const activeWeight =
      activeViseme === "viseme_sil"
        ? THREE.MathUtils.clamp(
            cfg.silenceWeightMax *
              (1 - activeGain * cfg.silenceGainDamping),
            cfg.silenceWeightMin,
            cfg.silenceWeightMax,
          )
        : THREE.MathUtils.clamp(
            baseWeight + activeGain * cfg.activeWeightBoost,
            0,
            0.9,
          );

    const carryRatio =
      activeState === "vowel"
        ? coart.vowelCarryWeight
        : coart.consonantCarryWeight;
    const carryWeight =
      this.previousViseme === "viseme_sil"
        ? 0
        : activeWeight * carryRatio * this.transitionCarry;

    const visemeLambda = this.getVisemeLambda(activeState);

    // ── Anticipation ─────────────────────────────────────────────
    const anticipation = this.getAnticipation(
      clockMs,
      activeViseme,
      tuning,
    );
    const anticipatedViseme = anticipation.viseme;
    const anticipationWeight = anticipatedViseme
      ? activeWeight * anticipation.weight
      : 0;
    const stabilizedActiveWeight = Math.max(
      0,
      activeWeight - anticipationWeight,
    );

    // ── Choose native vs ARKit path ──────────────────────────────
    const useNativeVisemes = this.hasNativeVisemes(head);
    if (!useNativeVisemes && !this.warnedNoNativeVisemes) {
      this.warnedNoNativeVisemes = true;
      log.warn(
        "Avatar has no native Oculus viseme targets; using ARKit fallback.",
      );
    }

    // ── Jaw decoupling ───────────────────────────────────────────
    const decoupleWeight =
      options.anatomicalPostProcessing?.jawDecouplingWeight ?? 0;
    const jawEnergyTarget =
      activeGain > 0.1
        ? Math.pow(activeGain, 1.2) * decoupleWeight
        : 0;

    if (useNativeVisemes) {
      this.applyNativeVisemes(
        head,
        teeth,
        delta,
        visemeLambda,
        stabilizedActiveWeight,
        carryWeight,
        anticipatedViseme,
        anticipationWeight,
        activeViseme,
        jawEnergyTarget,
        clockMs,
        options,
      );
    } else {
      this.applyArkitFromVisemes(
        head,
        this.lastViseme,
        this.previousViseme,
        stabilizedActiveWeight *
          this.getVisemeScale(this.lastViseme, options.visemeOverrides),
        carryWeight *
          this.getVisemeScale(
            this.previousViseme,
            options.visemeOverrides,
          ),
        delta,
        visemeLambda,
        anticipatedViseme,
        anticipatedViseme
          ? anticipationWeight *
              this.getVisemeScale(
                anticipatedViseme,
                options.visemeOverrides,
              )
          : anticipationWeight,
        options,
        jawEnergyTarget,
        this.currentLipAsymmetry,
        clockMs,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Native Viseme Application
  // ═══════════════════════════════════════════════════════════════

  private applyNativeVisemes(
    head: THREE.SkinnedMesh,
    teeth: THREE.SkinnedMesh | undefined,
    delta: number,
    visemeLambda: number,
    stabilizedActiveWeight: number,
    carryWeight: number,
    anticipatedViseme: string | null,
    anticipationWeight: number,
    activeViseme: string,
    jawEnergyTarget: number,
    clockMs: number,
    options: LipSyncRuntimeOptions,
  ): void {
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

    // Morph weight capping
    const weightCap =
      options.meshPostProcessing?.morphWeightCap ?? 1.0;
    const normFactor =
      totalWeight > weightCap ? weightCap / totalWeight : 1.0;

    for (const viseme of OCULUS_VISEMES) {
      let target = targetCaps[viseme] * normFactor;
      target = this.applyRegionalPostProcessing(target, viseme, options);

      // Jaw decoupling
      if (viseme === "viseme_aa" && jawEnergyTarget > 0) {
        target = THREE.MathUtils.clamp(
          target + jawEnergyTarget,
          0,
          weightCap,
        );
      }

      // Inter-word breath micro-motion
      if (viseme === "viseme_aa" && activeViseme === "viseme_sil") {
        target = this.addBreathMicroMotion(target, clockMs);
      }

      this.applyMorph(head, viseme, target, delta, visemeLambda);
      if (teeth?.morphTargetDictionary && teeth.morphTargetInfluences) {
        this.applyMorph(teeth, viseme, target * 0.95, delta, visemeLambda);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  ARKit Fallback Application
  // ═══════════════════════════════════════════════════════════════

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
    lipAsymmetry: number = 0,
    clockMs: number = performance.now(),
  ): void {
    const accum: Record<ArkitMouthTarget, number> = {} as Record<
      ArkitMouthTarget,
      number
    >;
    for (const target of ARKIT_MOUTH_TARGETS) {
      accum[target] = 0;
    }

    const blendViseme = (viseme: string, weight: number) => {
      const mapping = this.arkitMap[viseme];
      if (!mapping || weight <= 0) return;
      for (const [target, mix] of Object.entries(mapping)) {
        const key = target as ArkitMouthTarget;
        if (key in accum) {
          accum[key] += weight * (mix ?? 0);
        }
      }
    };

    blendViseme(activeViseme, activeWeight);
    blendViseme(previousViseme, carryWeight);
    if (anticipatedViseme) {
      blendViseme(anticipatedViseme, anticipatedWeight);
    }

    // Lip asymmetry
    if (lipAsymmetry !== 0) {
      accum.mouthSmileLeft = Math.max(
        0,
        accum.mouthSmileLeft + lipAsymmetry,
      );
      accum.mouthSmileRight = Math.max(
        0,
        accum.mouthSmileRight - lipAsymmetry,
      );
      accum.mouthStretchLeft = Math.max(
        0,
        accum.mouthStretchLeft + lipAsymmetry,
      );
      accum.mouthStretchRight = Math.max(
        0,
        accum.mouthStretchRight - lipAsymmetry,
      );
    }

    // Jaw decoupling
    if (jawEnergyTarget > 0) {
      accum.jawOpen += jawEnergyTarget;
    }

    // Inter-word breath micro-motion
    if (activeViseme === "viseme_sil" && this.lastNonSilenceAtMs > 0) {
      accum.jawOpen = this.addBreathMicroMotion(accum.jawOpen, clockMs);
    }

    // Morph weight capping
    let totalWeight = 0;
    for (const target of ARKIT_MOUTH_TARGETS) {
      totalWeight += accum[target];
    }
    const weightCap =
      options.meshPostProcessing?.morphWeightCap ?? 1.0;
    const normFactor =
      totalWeight > weightCap ? weightCap / totalWeight : 1.0;

    for (const target of ARKIT_MOUTH_TARGETS) {
      const cappedValue = accum[target] * normFactor;
      const processed = this.applyRegionalPostProcessing(
        cappedValue,
        target,
        options,
      );
      this.applyMorph(mesh, target, processed, delta, lambda);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Volume-Only Fallback
  // ═══════════════════════════════════════════════════════════════

  private applyVolumeFallback(
    head: THREE.SkinnedMesh,
    teeth: THREE.SkinnedMesh | undefined,
    level: number,
    delta: number,
  ): void {
    const fb = this.modeCfg.volumeFallback;
    const normalizedLevel = THREE.MathUtils.clamp(
      (level - 0.03) / 0.3,
      0,
      1,
    );
    const targetJaw = Math.min(
      fb.jawCap,
      normalizedLevel * PHYSICS_SMOOTHING.jaw_mult * fb.jawMult,
    );
    const targetMouth = Math.min(
      fb.mouthCap,
      normalizedLevel * PHYSICS_SMOOTHING.mouth_mult * fb.mouthMult,
    );

    this.applyMorph(head, VISEME_MAP.jawOpen, targetJaw, delta);
    this.applyMorph(
      head,
      VISEME_MAP.mouthFunnel,
      targetMouth * fb.funnelRatio,
      delta,
    );
    this.applyMorph(
      head,
      VISEME_MAP.mouthPucker,
      targetMouth * fb.puckerRatio,
      delta,
    );

    if (teeth?.morphTargetDictionary && teeth.morphTargetInfluences) {
      this.applyMorph(
        teeth,
        VISEME_MAP.jawOpen,
        targetJaw * fb.teethScale,
        delta,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Breath Micro-Motion
  // ═══════════════════════════════════════════════════════════════

  /**
   * Inter-word breath micro-motion — jaw doesn't snap shut between
   * words. Subtle sinusoidal oscillation decays after last speech.
   * Max amplitude is imperceptible as motion, but the absence
   * feels robotic.
   */
  private addBreathMicroMotion(
    currentTarget: number,
    clockMs: number,
  ): number {
    const breath = this.modeCfg.breathMicroMotion;
    if (!breath.enabled || this.lastNonSilenceAtMs <= 0) {
      return currentTarget;
    }

    const timeSinceSpeech = clockMs - this.lastNonSilenceAtMs;
    if (timeSinceSpeech <= 0 || timeSinceSpeech >= breath.decayMs) {
      return currentTarget;
    }

    const decay = 1 - timeSinceSpeech / breath.decayMs;
    const oscillation =
      Math.sin(clockMs * breath.frequencyHz * 0.001 * Math.PI * 2) *
      breath.amplitude *
      decay;

    return currentTarget + oscillation;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Helpers — Detection & Stabilisation
  // ═══════════════════════════════════════════════════════════════

  private hasNativeVisemes(mesh: THREE.SkinnedMesh): boolean {
    const dict = mesh.morphTargetDictionary;
    if (!dict) return false;
    return (
      dict.viseme_aa !== undefined || dict.viseme_PP !== undefined
    );
  }

  private normalizeState(state: string | undefined): LipState {
    if (
      state === "plosive" ||
      state === "fricative" ||
      state === "silence" ||
      state === "vowel"
    ) {
      return state;
    }
    return "vowel";
  }

  private getSpectralLevel(wawaLipsync: Lipsync): number {
    const features = (
      wawaLipsync as unknown as { features?: { volume?: number } | null }
    ).features;
    const volume = features?.volume;
    if (typeof volume !== "number" || !Number.isFinite(volume)) return 0;
    return THREE.MathUtils.clamp(volume, 0, 1);
  }

  private normalizeVisemeName(name: string): string {
    if (!name || name === "silence" || name === "sil") return "viseme_sil";
    if (name.startsWith("viseme_")) return name;
    return `viseme_${name}`;
  }

  private getAudioClock(
    wawaLipsync: Lipsync,
    tuning: LipSyncTuning,
  ): { clockMs: number; clockCompensationMs: number } {
    const context = (
      wawaLipsync as unknown as { audioContext?: AudioContext }
    ).audioContext;
    if (!context) {
      return { clockMs: performance.now(), clockCompensationMs: 0 };
    }

    const outputLatencyMs = Number.isFinite(context.outputLatency)
      ? THREE.MathUtils.clamp(
          context.outputLatency * 1000,
          0,
          tuning.maxClockCompensationMs,
        )
      : 0;
    const clockCompensationMs =
      outputLatencyMs * tuning.clockCompensationRatio;

    let clockMs = context.currentTime * 1000;

    // Fallback if AudioContext hasn't started yet
    if (clockMs === 0) {
      clockMs = performance.now();
    }

    // Prefer high-resolution output timestamp when available
    try {
      const withTimestamp = context as AudioContext & {
        getOutputTimestamp?: () => AudioTimestamp;
      };
      if (typeof withTimestamp.getOutputTimestamp === "function") {
        const timestamp = withTimestamp.getOutputTimestamp();
        const contextTime = timestamp?.contextTime;
        if (
          typeof contextTime === "number" &&
          Number.isFinite(contextTime) &&
          contextTime > 0
        ) {
          clockMs = contextTime * 1000;
        }
      }
    } catch {
      // Graceful fallback to context.currentTime
    }

    return { clockMs, clockCompensationMs };
  }
    // ═══════════════════════════════════════════════════════════════
  //  Helpers — Stabilisation & Queue
  // ═══════════════════════════════════════════════════════════════

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

    const allowImmediateSwitch =
      speakingGain > 0.72 || detectedViseme === "viseme_sil";

    if (elapsed < minIntervalMs && !allowImmediateSwitch) {
      return this.lastDetectedViseme;
    }

    this.lastDetectedViseme = detectedViseme;
    this.lastDetectedAtMs = clockMs;
    return detectedViseme;
  }

  private enqueueViseme(frame: ScheduledViseme): void {
    const lastQueued = this.pendingVisemes.peekLast();
    if (
      lastQueued &&
      lastQueued.viseme === frame.viseme &&
      Math.abs(lastQueued.applyAtMs - frame.applyAtMs) < 12
    ) {
      // Merge into existing — avoid queue bloat for duplicate detections
      lastQueued.state = frame.state;
      lastQueued.speakingGain = frame.speakingGain;
      lastQueued.capturedAtMs = frame.capturedAtMs;
      return;
    }

    this.pendingVisemes.enqueue(frame);
    this.pendingVisemes.trimToMax(this.modeCfg.maxPendingVisemes);
  }

  private advanceScheduledViseme(clockMs: number): void {
    while (this.pendingVisemes.length > 0) {
      const next = this.pendingVisemes.peek();
      if (!next || next.applyAtMs > clockMs) break;

      const dequeued = this.pendingVisemes.dequeue();
      if (!dequeued) break;

      this.activeScheduledViseme = dequeued;
    }
  }

  private getVisemeLambda(state: LipState): number {
    const tuning = this.currentTuning;
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
    const next = this.pendingVisemes.peek();
    if (
      !next ||
      next.viseme === activeViseme ||
      next.viseme === "viseme_sil"
    ) {
      return { viseme: null, weight: 0 };
    }

    const windowMs = Math.max(1, tuning.anticipationWindowMs);
    const timeUntilApply = next.applyAtMs - clockMs;
    if (timeUntilApply <= 0 || timeUntilApply > windowMs) {
      return { viseme: null, weight: 0 };
    }

    const blendProgress = 1 - timeUntilApply / windowMs;
    const maxWeight = THREE.MathUtils.clamp(
      tuning.anticipationWeightMax,
      0,
      0.5,
    );
    const weight = THREE.MathUtils.clamp(
      blendProgress * maxWeight,
      0,
      maxWeight,
    );
    return { viseme: next.viseme, weight };
  }

  // ═══════════════════════════════════════════════════════════════
  //  Helpers — Noise Floor & Robust Detection
  // ═══════════════════════════════════════════════════════════════

  private computeEffectiveFloor(
    levelSource: number,
    delta: number,
    tuning: LipSyncTuning,
  ): number {
    if (!tuning.adaptiveNoiseFloor) {
      this.dynamicNoiseFloor = this.modeCfg.levelFloor;
      return this.modeCfg.levelFloor;
    }

    const minFloor = tuning.noiseFloorMin;
    const maxFloor = tuning.noiseFloorMax;
    const clampedLevel = THREE.MathUtils.clamp(
      levelSource,
      minFloor,
      maxFloor,
    );
    const quietBand =
      this.dynamicNoiseFloor + tuning.speechThresholdOffset * 1.5;

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

    this.dynamicNoiseFloor = THREE.MathUtils.clamp(
      this.dynamicNoiseFloor,
      minFloor,
      maxFloor,
    );

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
    const hasAudibleSpeech =
      speakingGain > 0.12 ||
      levelSource > 0.09 ||
      spectralLevel > 0.03;

    if (
      !hasAudibleSpeech ||
      (this.lastDetectedViseme === "viseme_sil" &&
        this.consecutiveSilentDetections < 2)
    ) {
      return "viseme_sil";
    }

    // Infer a plausible viseme from context when detector returns
    // silence but audio energy is clearly present
    if (state === "fricative") return "viseme_SS";
    if (state === "plosive") return "viseme_DD";
    if (levelSource > 0.25) return "viseme_aa";
    if (levelSource > 0.16) return "viseme_E";
    return "viseme_O";
  }

  // ═══════════════════════════════════════════════════════════════
  //  Helpers — Morph Application & Post-Processing
  // ═══════════════════════════════════════════════════════════════

  private applyMorph(
    mesh: THREE.SkinnedMesh,
    name: string,
    target: number,
    delta: number,
    lambda: number = 25,
  ): void {
    const dict = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (!dict || !influences || dict[name] === undefined) return;

    const idx = dict[name];
    const smoothedTarget = this.applyTemporalSmoothing(
      name,
      target,
      this.currentRuntimeOptions,
    );
    influences[idx] = THREE.MathUtils.damp(
      influences[idx],
      smoothedTarget,
      lambda,
      delta,
    );
  }

  private isLowerFaceTarget(name: string): boolean {
    const key = name.toLowerCase();
    return (
      key.includes("jaw") ||
      key.includes("mouth") ||
      key.includes("lip") ||
      key.includes("viseme") ||
      key.includes("tongue")
    );
  }

  private applyRegionalPostProcessing(
    target: number,
    name: string,
    options: LipSyncRuntimeOptions,
  ): number {
    const meshPP = {
      ...DEFAULT_MESH_POST_PROCESSING,
      ...(options.meshPostProcessing ?? {}),
    };
    const anatPP = {
      ...DEFAULT_ANATOMICAL_POST_PROCESSING,
      ...(options.anatomicalPostProcessing ?? {}),
    };

    const isLower = this.isLowerFaceTarget(name);
    const maskLevel = THREE.MathUtils.clamp(anatPP.faceMaskLevel, 0, 1);
    const softMask = THREE.MathUtils.clamp(
      maskLevel * (1 - anatPP.faceMaskSoftness * 10),
      0,
      1,
    );
    const blendedStrength = THREE.MathUtils.lerp(
      anatPP.upperFaceStrength,
      anatPP.lowerFaceStrength,
      isLower ? softMask : 1 - softMask,
    );

    let processed = target * blendedStrength * meshPP.skinStrength;

    const nameLower = name.toLowerCase();
    if (nameLower.includes("jaw")) {
      processed =
        processed * meshPP.jawStrength * anatPP.jawStrength;
      processed += anatPP.jawHeight;
      processed += meshPP.lipOpenOffset;
    }
    if (nameLower.includes("tongue")) {
      processed =
        processed * anatPP.tongueStrength + anatPP.tongueHeight;
    }

    return THREE.MathUtils.clamp(processed, 0, 1.2);
  }

  private applyTemporalSmoothing(
    name: string,
    target: number,
    options: LipSyncRuntimeOptions,
  ): number {
    const meshPP = {
      ...DEFAULT_MESH_POST_PROCESSING,
      ...(options.meshPostProcessing ?? {}),
    };
    const previous = this.morphHistory.get(name) ?? target;
    const smoothing = this.isLowerFaceTarget(name)
      ? meshPP.lowerFaceSmoothing
      : meshPP.upperFaceSmoothing;
    const alpha = THREE.MathUtils.clamp(smoothing * 60, 0, 0.95);
    const next = previous + (target - previous) * (1 - alpha);
    this.morphHistory.set(name, next);
    return next;
  }

  private getVisemeScale(
    viseme: string,
    overrides?: VisemeOverrides,
  ): number {
    const resolved = {
      ...DEFAULT_VISEME_OVERRIDES,
      ...(overrides ?? {}),
    };
    const masterScale = resolved.drivingDataScale;

    if (viseme === "viseme_PP" || viseme === "viseme_nn") {
      return THREE.MathUtils.clamp(
        masterScale * (resolved.strengthBMP / 100),
        0,
        3,
      );
    }
    if (viseme === "viseme_FF" || viseme === "viseme_TH") {
      return THREE.MathUtils.clamp(
        masterScale * (resolved.strengthFV / 100),
        0,
        3,
      );
    }
    if (
      viseme === "viseme_O" ||
      viseme === "viseme_U" ||
      viseme === "viseme_RR"
    ) {
      return THREE.MathUtils.clamp(
        masterScale * (resolved.strengthWOo / 100),
        0,
        3,
      );
    }
    if (
      viseme === "viseme_SS" ||
      viseme === "viseme_DD" ||
      viseme === "viseme_CH" ||
      viseme === "viseme_kk"
    ) {
      return THREE.MathUtils.clamp(
        masterScale * (resolved.strengthSZTD / 100),
        0,
        3,
      );
    }

    return THREE.MathUtils.clamp(masterScale, 0, 3);
  }
}
