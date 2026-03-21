/**
 * Gold-Standard AudioStreamer
 *
 * Real-time PCM-16 playback over WebSocket.
 *
 * O(1) ring buffer · discontinuity fade-in · remainder flush
 * 100 ms initial latency · 250 ms look-ahead · 30 ms recovery
 */
export class AudioStreamer {
  /* ── Tuning constants ──────────────────────────────────────────── */
  private readonly sampleRate: number;
  private readonly bufferSize = 2048;
  private readonly maxQueueLength = 100;
  private readonly initialBufferSec = 0.1;
  private readonly lookAheadSec = 0.25;
  private readonly recoveryOffsetSec = 0.03;
  private readonly fadeSamples = 64;
  private readonly stopRampSec = 0.015;
  private readonly teardownDelayMs = 50;

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

  /* ── Callbacks ─────────────────────────────────────────────────── */
  public onComplete: () => void = () => {};
  public onAudioScheduled:
    | ((startTimeMs: number, durationMs: number) => void)
    | null = null;

  constructor(
    public readonly context: AudioContext,
    sampleRate = 24_000,
  ) {
    this.sampleRate = sampleRate;
    this.ring = new Array<Float32Array | null>(this.maxQueueLength).fill(null);

    this.gainNode = this.context.createGain();
    this.analyserNode = this.context.createAnalyser();
    this.analyserNode.fftSize = 1024;
    this.timeDomainData = new Uint8Array(this.analyserNode.fftSize);

    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.context.destination);

    this.addPCM16 = this.addPCM16.bind(this);
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  Ring Buffer — O(1), GC-friendly null-on-dequeue
   * ═══════════════════════════════════════════════════════════════════ */

  private enqueue(data: Float32Array): void {
    if (this.size >= this.maxQueueLength) {
      this.ring[this.head] = null;
      this.head = (this.head + 1) % this.maxQueueLength;
      this.size--;
    }
    this.ring[this.tail] = data;
    this.tail = (this.tail + 1) % this.maxQueueLength;
    this.size++;
  }

  private dequeue(): Float32Array | null {
    if (this.size === 0) return null;
    const data = this.ring[this.head];
    this.ring[this.head] = null;
    this.head = (this.head + 1) % this.maxQueueLength;
    this.size--;
    return data;
  }

  private drainRing(): void {
    for (let i = 0; i < this.maxQueueLength; i++) this.ring[i] = null;
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  Discontinuity Fade-In
   *
   *  Web Audio schedules buffers sample-accurately, so contiguous
   *  buffers need zero processing.  A fade-in is only applied at
   *  real discontinuities (first play / underrun recovery).
   *
   *  The previous crossfade approach blended tail[N] into head[N+1],
   *  causing those samples to be heard twice (phase artifact).
   * ═══════════════════════════════════════════════════════════════════ */

  private applyFadeIn(data: Float32Array): void {
    const n = Math.min(this.fadeSamples, data.length);
    for (let i = 0; i < n; i++) {
      data[i] *= i / n;
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

  /* ═══════════════════════════════════════════════════════════════════
   *  Gain helper — idempotent, safe to call from any state
   * ═══════════════════════════════════════════════════════════════════ */

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
    while (pcm.length - offset >= this.bufferSize) {
      this.enqueue(pcm.slice(offset, offset + this.bufferSize));
      offset += this.bufferSize;
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
    // FIX(1): If stop() was just called, its teardown timer may still
    // be pending and gain is ramping to zero.  Cancel both before we
    // schedule new sources, or the teardown kills our fresh playback.
    this.clearTeardownTimer();
    this.ensureGainRestored();

    this.playing = true;
    this.doneFired = false;
    this.needsFadeIn = true;
    this.scheduledTime = this.context.currentTime + this.initialBufferSec;
    this.scheduleNextBuffer(this.generation);
  }

  private scheduleNextBuffer(gen: number): void {
    if (!this.playing || gen !== this.generation) return;
    this.clearSchedulerTimer();

    const horizon = this.context.currentTime + this.lookAheadSec;

    while (this.size > 0 && this.scheduledTime < horizon) {
      const data = this.dequeue();
      if (!data) break;

      // Underrun recovery — snap forward
      if (this.scheduledTime < this.context.currentTime) {
        this.scheduledTime = this.context.currentTime + this.recoveryOffsetSec;
        this.needsFadeIn = true;
      }

      // Fade-in at discontinuities only
      if (this.needsFadeIn) {
        this.applyFadeIn(data);
        this.needsFadeIn = false;
      }

      // Create & schedule source
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

    // Re-arm the scheduler
    const msUntilNeeded =
      this.size > 0
        ? (this.scheduledTime - this.context.currentTime) * 1000 - 150
        : 50;

    this.schedulerTimer = setTimeout(
      () => this.scheduleNextBuffer(gen),
      Math.max(20, msUntilNeeded),
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

  /**
   * Signal that no more PCM data will arrive.
   * Flushes any sub-buffer remainder and waits for all scheduled
   * sources to finish before firing `onComplete`.
   */
  complete(): void {
    this.streamDone = true;
    // FIX: Reset so each complete() call can fire the callback.
    // Without this, calling complete() on a streamer that already
    // completed a previous turn (without new addPCM16 data in between)
    // silently swallows the onComplete callback.
    this.doneFired = false;

    // Flush leftover samples that never filled a complete buffer
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

    // FIX(3): Fire onComplete even if playback already drained or
    // was never started (e.g. complete() called with an empty stream).
    if (this.size === 0 && this.sources.size === 0) {
      this.handleComplete();
    }
  }

  /**
   * Immediately halt playback.  Ramps gain to zero, then tears down
   * all sources after a short delay to avoid clicks.
   */
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

    // Smooth gain ramp → 0
    const now = this.context.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setTargetAtTime(0, now, this.stopRampSec);

    // Deferred source cleanup (after gain reaches ~0)
    this.teardownTimer = setTimeout(() => {
      this.teardownTimer = null;

      for (const src of this.sources) {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
        src.disconnect();
      }
      this.sources.clear();

      this.ensureGainRestored();
    }, this.teardownDelayMs);
  }

  /**
   * Resume the AudioContext (if suspended by autoplay policy)
   * and prepare for a new stream.
   */
  async resume(): Promise<void> {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    // FIX(2): Cancel any pending teardown from a prior stop(),
    //         clear stale remainder from the old stream.
    this.clearTeardownTimer();
    this.streamDone = false;
    this.remainder = null;
    this.needsFadeIn = true;
    this.scheduledTime = this.context.currentTime + this.initialBufferSec;
    this.ensureGainRestored();
  }

  /**
   * RMS volume (0–1) from the analyser node.
   * Suitable for driving a visual level meter.
   */
  getVolume(): number {
    this.analyserNode.getByteTimeDomainData(this.timeDomainData as Uint8Array<ArrayBuffer>);
    let sumSq = 0;
    for (let i = 0; i < this.timeDomainData.length; i++) {
      const n = (this.timeDomainData[i] - 128) / 128;
      sumSq += n * n;
    }
    return Math.sqrt(sumSq / this.timeDomainData.length);
  }

  /* ── Timer helpers ─────────────────────────────────────────────── */

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