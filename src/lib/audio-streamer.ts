/**
 * AudioStreamer — Real-time PCM-16 playback over WebSocket
 *
 * O(1) ring buffer · discontinuity fade-in · end-of-stream fade-out
 * Mode-switchable voice chain: compressor → warmth EQ → presence EQ
 *
 * Audio graph:
 *   gain → compressor → warmth (low-shelf) → presence (high-shelf) → analyser → destination
 *
 * The analyser sits post-chain so lip-sync and volume metering read
 * the processed signal, giving more consistent mouth movement from
 * compressed/EQ'd audio.
 *
 * Emotive speech modes (broadcast / intimate / energetic) change the
 * voice presence chain and streamer timing in one call via setMode().
 */

import {
  getModeTuning,
  type StreamerModeConfig,
  type VoicePresenceConfig,
  type EmotiveSpeechMode,
} from "@/lib/emotive-speech-config";

// ═══════════════════════════════════════════════════════════════════
//  Runtime Voice Presence Override
// ═══════════════════════════════════════════════════════════════════

export interface VoicePresenceOverride {
  compressor?: Partial<{
    threshold: number;
    knee: number;
    ratio: number;
    attack: number;
    release: number;
  }>;
  warmth?: Partial<{
    frequency: number;
    gain: number;
  }>;
  presence?: Partial<{
    frequency: number;
    gain: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════
//  AudioStreamer
// ═══════════════════════════════════════════════════════════════════

export class AudioStreamer {
  /* ── Tuning (from emotive-speech config) ───────────────────────── */
  private readonly sampleRate: number;
  private cfg: StreamerModeConfig;

  /* ── Ring buffer ───────────────────────────────────────────────── */
  private ring: (Float32Array | null)[];
  private head = 0;
  private tail = 0;
  private size = 0;

  /* ── Playback state ────────────────────────────────────────────── */
  private remainder: Float32Array | null = null;
  private playing = false;
  private streamDone = false;
  private doneFired = false;
  private scheduledTime = 0;
  private generation = 0;
  private needsFadeIn = true;

  /* ── Active resources ──────────────────────────────────────────── */
  private readonly sources = new Set<AudioBufferSourceNode>();
  private schedulerTimer: ReturnType<typeof setTimeout> | null = null;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;

  /* ── Public audio graph ────────────────────────────────────────── */
  public readonly gainNode: GainNode;
  public readonly analyserNode: AnalyserNode;
  private readonly timeDomainData: Uint8Array;

  // ── Voice presence chain ──────────────────────────────────────
  // Three zero-latency Web Audio nodes that transform flat TTS output
  // into broadcast-quality voice. The analyser (lip sync) sees the
  // processed signal, giving more consistent mouth movement.
  private readonly compressor: DynamicsCompressorNode;
  private readonly warmth: BiquadFilterNode;
  private readonly presence: BiquadFilterNode;

  /* ── Callbacks ─────────────────────────────────────────────────── */
  public onComplete: () => void = () => {};
  public onAudioScheduled:
    | ((startTimeMs: number, durationMs: number) => void)
    | null = null;

  /* ── Public state ──────────────────────────────────────────────── */

  /** Whether audio buffers are actively being scheduled and played. */
  get isPlaying(): boolean {
    return this.playing;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Constructor
  // ═══════════════════════════════════════════════════════════════

  constructor(
    public readonly context: AudioContext,
    sampleRate = 24_000,
    mode: EmotiveSpeechMode = "broadcast",
  ) {
    this.sampleRate = sampleRate;

    const modeTuning = getModeTuning(mode);
    this.cfg = modeTuning.streamer;
    const voice = modeTuning.voicePresence;

    this.ring = new Array<Float32Array | null>(this.cfg.maxQueueLength).fill(null);

    this.gainNode = this.context.createGain();

    // ── Compressor ──────────────────────────────────────────────
    // Makes quiet syllables audible and loud peaks controlled.
    // Soft knee + moderate ratio = transparent, podcast-quality feel.
    this.compressor = this.context.createDynamicsCompressor();
    this.applyCompressorValues(voice.compressor);

    // ── Low-shelf warmth ────────────────────────────────────────
    // Proximity effect — adds body without muddiness.
    this.warmth = this.context.createBiquadFilter();
    this.warmth.type = voice.warmth.type as BiquadFilterType;
    this.warmth.frequency.value = voice.warmth.frequency;
    this.warmth.gain.value = voice.warmth.gain;

    // ── High-shelf presence ─────────────────────────────────────
    // Consonant clarity — voice cuts through.
    this.presence = this.context.createBiquadFilter();
    this.presence.type = voice.presence.type as BiquadFilterType;
    this.presence.frequency.value = voice.presence.frequency;
    this.presence.gain.value = voice.presence.gain;

    // ── Analyser (lip sync + volume meter) ──────────────────────
    this.analyserNode = this.context.createAnalyser();
    this.analyserNode.fftSize = 1024;
    this.timeDomainData = new Uint8Array(this.analyserNode.fftSize);

    // ── Chain: gain → compressor → warmth → presence → analyser → destination
    this.gainNode.connect(this.compressor);
    this.compressor.connect(this.warmth);
    this.warmth.connect(this.presence);
    this.presence.connect(this.analyserNode);
    this.analyserNode.connect(this.context.destination);

    this.addPCM16 = this.addPCM16.bind(this);
  }

  // ═══════════════════════════════════════════════════════════════
  //  Mode Switching
  // ═══════════════════════════════════════════════════════════════

  /**
   * Hot-swap the entire emotive speech mode — updates voice presence
   * chain (compressor + EQ) and streamer timing in one call.
   * EQ params ramp over 50ms to avoid clicks. Safe mid-playback.
   *
   * ```ts
   * streamer.setMode("intimate"); // softer voice, subtler compression
   * streamer.setMode("energetic"); // punchy, max articulation
   * ```
   */
  setMode(mode: EmotiveSpeechMode): void {
    const modeTuning = getModeTuning(mode);
    this.cfg = modeTuning.streamer;

    const voice = modeTuning.voicePresence;
    this.applyCompressorValues(voice.compressor);

    const now = this.context.currentTime;
    const ramp = 0.05; // 50ms ramp avoids clicks

    this.warmth.type = voice.warmth.type as BiquadFilterType;
    this.warmth.frequency.setTargetAtTime(voice.warmth.frequency, now, ramp);
    this.warmth.gain.setTargetAtTime(voice.warmth.gain, now, ramp);

    this.presence.type = voice.presence.type as BiquadFilterType;
    this.presence.frequency.setTargetAtTime(voice.presence.frequency, now, ramp);
    this.presence.gain.setTargetAtTime(voice.presence.gain, now, ramp);
  }

  /**
   * Fine-grained voice presence override independent of mode.
   * Only specified fields are changed; unspecified are left as-is.
   * EQ params ramp over 50ms.
   *
   * ```ts
   * streamer.updateVoicePresence({
   *   compressor: { threshold: -20 },
   *   warmth: { gain: 5 },
   * });
   * ```
   */
  updateVoicePresence(config: VoicePresenceOverride): void {
    const now = this.context.currentTime;
    const ramp = 0.05;

    if (config.compressor) {
      const c = config.compressor;
      if (c.threshold !== undefined) this.compressor.threshold.value = c.threshold;
      if (c.knee !== undefined) this.compressor.knee.value = c.knee;
      if (c.ratio !== undefined) this.compressor.ratio.value = c.ratio;
      if (c.attack !== undefined) this.compressor.attack.value = c.attack;
      if (c.release !== undefined) this.compressor.release.value = c.release;
    }

    if (config.warmth) {
      if (config.warmth.frequency !== undefined) {
        this.warmth.frequency.setTargetAtTime(config.warmth.frequency, now, ramp);
      }
      if (config.warmth.gain !== undefined) {
        this.warmth.gain.setTargetAtTime(config.warmth.gain, now, ramp);
      }
    }

    if (config.presence) {
      if (config.presence.frequency !== undefined) {
        this.presence.frequency.setTargetAtTime(config.presence.frequency, now, ramp);
      }
      if (config.presence.gain !== undefined) {
        this.presence.gain.setTargetAtTime(config.presence.gain, now, ramp);
      }
    }
  }

  private applyCompressorValues(
    c: VoicePresenceConfig["compressor"],
  ): void {
    this.compressor.threshold.value = c.threshold;
    this.compressor.knee.value = c.knee;
    this.compressor.ratio.value = c.ratio;
    this.compressor.attack.value = c.attack;
    this.compressor.release.value = c.release;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Ring Buffer
  // ═══════════════════════════════════════════════════════════════

  private enqueue(data: Float32Array): void {
    if (this.size >= this.cfg.maxQueueLength) {
      this.ring[this.head] = null;
      this.head = (this.head + 1) % this.cfg.maxQueueLength;
      this.size--;
    }
    this.ring[this.tail] = data;
    this.tail = (this.tail + 1) % this.cfg.maxQueueLength;
    this.size++;
  }

  private dequeue(): Float32Array | null {
    if (this.size === 0) return null;
    const data = this.ring[this.head];
    this.ring[this.head] = null;
    this.head = (this.head + 1) % this.cfg.maxQueueLength;
    this.size--;
    return data;
  }

  private drainRing(): void {
    for (let i = 0; i < this.cfg.maxQueueLength; i++) this.ring[i] = null;
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Boundary Fades
  // ═══════════════════════════════════════════════════════════════

  private applyFadeIn(data: Float32Array): void {
    const n = Math.min(this.cfg.fadeSamples, data.length);
    for (let i = 0; i < n; i++) {
      data[i] *= i / n;
    }
  }

  private applyFadeOut(data: Float32Array): void {
    const n = Math.min(this.cfg.fadeSamples, data.length);
    const start = data.length - n;
    for (let i = 0; i < n; i++) {
      data[start + i] *= 1 - i / n;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  PCM-16 Decode
   * ═══════════════════════════════════════════════════════════════════ */

  private decodePCM16(raw: Uint8Array): Float32Array {
    const count = raw.length >>> 1;
    const out = new Float32Array(count);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < count; i++) {
      out[i] = view.getInt16(i << 1, true) / 32_768;
    }
    return out;
  }

  private ensureGainRestored(): void {
    const now = this.context.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(1, now);
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  Public API — Ingestion
   * ═══════════════════════════════════════════════════════════════════ */

  addPCM16(chunk: Uint8Array): void {
    if (chunk.length < 2) return;

    this.streamDone = false;
    this.doneFired = false;

    let pcm = this.decodePCM16(chunk);

    if (this.remainder !== null) {
      const merged = new Float32Array(this.remainder.length + pcm.length);
      merged.set(this.remainder);
      merged.set(pcm, this.remainder.length);
      pcm = merged;
      this.remainder = null;
    }

    let offset = 0;
    while (pcm.length - offset >= this.cfg.bufferSize) {
      this.enqueue(pcm.slice(offset, offset + this.cfg.bufferSize));
      offset += this.cfg.bufferSize;
    }
    if (offset < pcm.length) {
      this.remainder = pcm.slice(offset);
    }

    if (!this.playing && this.size > 0) {
      this.startPlayback();
    } else if (this.playing) {
      this.scheduleNextBuffer(this.generation);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  Playback Engine
   * ═══════════════════════════════════════════════════════════════════ */

  private startPlayback(): void {
    this.clearTeardownTimer();
    this.ensureGainRestored();

    this.playing = true;
    this.doneFired = false;
    this.needsFadeIn = true;
    this.scheduledTime = this.context.currentTime + this.cfg.initialBufferSec;
    this.scheduleNextBuffer(this.generation);
  }

  private scheduleNextBuffer(gen: number): void {
    if (!this.playing || gen !== this.generation) return;
    this.clearSchedulerTimer();

    const horizon = this.context.currentTime + this.cfg.lookAheadSec;

    while (this.size > 0 && this.scheduledTime < horizon) {
      const data = this.dequeue();
      if (!data) break;

      if (this.scheduledTime < this.context.currentTime) {
        this.scheduledTime = this.context.currentTime + this.cfg.recoveryOffsetSec;
        this.needsFadeIn = true;
      }

      if (this.needsFadeIn) {
        this.applyFadeIn(data);
        this.needsFadeIn = false;
      }

      // Fade-out on the last buffer of a completed stream
      if (this.streamDone && this.size === 0) {
        this.applyFadeOut(data);
      }

      const audioBuf = this.context.createBuffer(1, data.length, this.sampleRate);
      audioBuf.getChannelData(0).set(data);

      const source = this.context.createBufferSource();
      source.buffer = audioBuf;
      source.connect(this.gainNode);

      const startTime = this.scheduledTime;
      source.start(startTime);
      this.sources.add(source);

      this.onAudioScheduled?.(startTime * 1000, audioBuf.duration * 1000);

      source.onended = () => {
        this.sources.delete(source);
        if (this.streamDone && this.size === 0 && this.sources.size === 0) {
          this.handleComplete();
        }
      };

      this.scheduledTime += audioBuf.duration;
    }

    const msUntilNeeded =
      this.size > 0
        ? (this.scheduledTime - this.context.currentTime) * 1000 - 150
        : 50;

    // Cap at 500ms — defensive ceiling prevents runaway timers
    // if scheduledTime drifts far ahead under tab-backgrounding.
    this.schedulerTimer = setTimeout(
      () => this.scheduleNextBuffer(gen),
      Math.max(20, Math.min(msUntilNeeded, 500)),
    );
  }

  private handleComplete(): void {
    if (this.doneFired) return;
    this.doneFired = true;
    this.playing = false;
    this.needsFadeIn = true;
    this.onComplete();
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  Public API — Lifecycle
   * ═══════════════════════════════════════════════════════════════════ */

  complete(): void {
    this.streamDone = true;
    this.doneFired = false;

    if (this.remainder !== null && this.remainder.length > 0) {
      this.enqueue(this.remainder);
      this.remainder = null;
    }

    if (!this.playing && this.size > 0) {
      this.startPlayback();
      return;
    }

    if (this.playing) {
      this.scheduleNextBuffer(this.generation);
    }

    if (this.size === 0 && this.sources.size === 0) {
      this.handleComplete();
    }
  }

  stop(): void {
    this.generation++;
    this.playing = false;
    this.streamDone = true;
    this.doneFired = false;
    this.needsFadeIn = true;

    this.drainRing();
    this.remainder = null;

    this.clearSchedulerTimer();
    this.clearTeardownTimer();

    const now = this.context.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setTargetAtTime(0, now, this.cfg.stopRampSec);

    this.teardownTimer = setTimeout(() => {
      this.teardownTimer = null;
      for (const src of this.sources) {
        try { src.stop(); } catch { /* already stopped */ }
        src.disconnect();
      }
      this.sources.clear();
      this.ensureGainRestored();
    }, this.cfg.teardownDelayMs);
  }

  async resume(): Promise<void> {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.clearTeardownTimer();
    this.streamDone = false;
    this.remainder = null;
    this.needsFadeIn = true;
    this.scheduledTime = this.context.currentTime + this.cfg.initialBufferSec;
    this.ensureGainRestored();
  }

  /**
   * Fully tear down the audio graph and release all resources.
   * Call on component unmount. The instance is not reusable after this.
   */
  destroy(): void {
    this.stop();

    // Let the stop() teardown timer finish, then disconnect graph
    setTimeout(() => {
      this.clearSchedulerTimer();
      this.clearTeardownTimer();

      try { this.analyserNode.disconnect(); } catch { /* ok */ }
      try { this.presence.disconnect(); } catch { /* ok */ }
      try { this.warmth.disconnect(); } catch { /* ok */ }
      try { this.compressor.disconnect(); } catch { /* ok */ }
      try { this.gainNode.disconnect(); } catch { /* ok */ }
    }, this.cfg.teardownDelayMs + 20);
  }

  // ═══════════════════════════════════════════════════════════════
  //  Public API — Metering
  // ═══════════════════════════════════════════════════════════════

  /**
   * Returns RMS volume (0–1) of the post-chain audio signal.
   * Called per-frame by LipSyncEngine for audio-level input.
   *
   * Because the analyser sits after the compressor, the returned
   * value reflects the compressed dynamic range. This is intentional:
   * the compressor lifts quiet syllables, giving LipSyncEngine a
   * more consistent signal and therefore smoother mouth articulation.
   * The LipSyncEngine's LIPSYNC_LEVEL_RANGE (0.22 in broadcast mode)
   * is tuned against this post-compression signal.
   */
  getVolume(): number {
    this.analyserNode.getByteTimeDomainData(
      this.timeDomainData as Uint8Array<ArrayBuffer>,
    );
    let sumSq = 0;
    for (let i = 0; i < this.timeDomainData.length; i++) {
      const n = (this.timeDomainData[i] - 128) / 128;
      sumSq += n * n;
    }
    return Math.sqrt(sumSq / this.timeDomainData.length);
  }

  // ── Timer helpers ───────────────────────────────────────────────

  private clearSchedulerTimer(): void {
    if (this.schedulerTimer !== null) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  private clearTeardownTimer(): void {
    if (this.teardownTimer !== null) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
  }
}