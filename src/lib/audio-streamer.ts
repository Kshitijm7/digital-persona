/**
 * Hardened AudioStreamer
 * Improvements: bounded queue, robust state transitions,
 * and precise look-ahead scheduling for smooth realtime voice playback.
 */

export class AudioStreamer {
  private readonly sampleRate: number;
  private readonly bufferSize: number = 2048;
  private readonly maxQueueLength: number = 100;

  private audioQueue: Float32Array[] = [];
  private pendingRemainder: Float32Array | null = null;

  private isPlaying = false;
  private isStreamComplete = false;
  private queueCompleteNotified = false;

  private scheduledTime = 0;
  private schedulerGeneration = 0;

  private activeSources = new Set<AudioBufferSourceNode>();
  private scheduleTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  private initialBufferTime = 0.2;
  private lookAheadTime = 0.4;

  public gainNode: GainNode;
  public analyserNode: AnalyserNode;
  public source: AudioBufferSourceNode;
  private timeDomainData: Uint8Array<ArrayBuffer>;

  public onComplete: () => void = () => {};
  public onAudioScheduled: ((startTimeMs: number, durationMs: number) => void) | null = null;

  constructor(public context: AudioContext, sampleRate: number = 24000) {
    this.sampleRate = sampleRate;
    this.gainNode = this.context.createGain();
    this.analyserNode = this.context.createAnalyser();
    this.analyserNode.fftSize = 1024;

    this.timeDomainData = new Uint8Array(this.analyserNode.fftSize) as Uint8Array<ArrayBuffer>;

    this.source = this.context.createBufferSource();
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.context.destination);

    this.addPCM16 = this.addPCM16.bind(this);
  }

  private _processPCM16Chunk(chunk: Uint8Array): Float32Array {
    const samples = Math.floor(chunk.length / 2);
    const float32 = new Float32Array(samples);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

    for (let i = 0; i < samples; i++) {
      float32[i] = view.getInt16(i * 2, true) / 32768.0;
    }

    return float32;
  }

  addPCM16(chunk: Uint8Array) {
    if (!chunk.length) return;

    if (this.audioQueue.length > this.maxQueueLength) {
      this.audioQueue.shift();
    }

    this.isStreamComplete = false;
    this.queueCompleteNotified = false;

    let processingBuffer = this._processPCM16Chunk(chunk);

    if (this.pendingRemainder && this.pendingRemainder.length > 0) {
      const merged = new Float32Array(this.pendingRemainder.length + processingBuffer.length);
      merged.set(this.pendingRemainder);
      merged.set(processingBuffer, this.pendingRemainder.length);
      processingBuffer = merged;
      this.pendingRemainder = null;
    }

    let offset = 0;
    while (processingBuffer.length - offset >= this.bufferSize) {
      this.audioQueue.push(processingBuffer.slice(offset, offset + this.bufferSize));
      offset += this.bufferSize;
    }

    if (processingBuffer.length > offset) {
      this.pendingRemainder = processingBuffer.slice(offset);
    }

    if (!this.isPlaying && this.audioQueue.length > 2) {
      this.startPlayback();
      return;
    }

    if (this.isPlaying) {
      this.scheduleNextBuffer(this.schedulerGeneration);
    }
  }

  private startPlayback() {
    this.isPlaying = true;
    this.queueCompleteNotified = false;
    this.scheduledTime = this.context.currentTime + this.initialBufferTime;
    this.scheduleNextBuffer(this.schedulerGeneration);
  }

  private scheduleNextBuffer(generation: number) {
    if (!this.isPlaying || generation !== this.schedulerGeneration) return;

    if (this.scheduleTimeout) {
      clearTimeout(this.scheduleTimeout);
      this.scheduleTimeout = null;
    }

    while (
      this.audioQueue.length > 0 &&
      this.scheduledTime < this.context.currentTime + this.lookAheadTime
    ) {
      const data = this.audioQueue.shift();
      if (!data) break;

      const buffer = this.context.createBuffer(1, data.length, this.sampleRate);
      buffer.getChannelData(0).set(data);

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gainNode);

      if (this.scheduledTime < this.context.currentTime) {
        this.scheduledTime = this.context.currentTime + 0.05;
      }

      const startTime = this.scheduledTime;
      source.start(startTime);
      this.activeSources.add(source);

      if (this.onAudioScheduled) {
        this.onAudioScheduled(startTime * 1000, buffer.duration * 1000);
      }

      source.onended = () => {
        this.activeSources.delete(source);
        if (this.isStreamComplete && this.audioQueue.length === 0 && this.activeSources.size === 0) {
          this.handlePlaybackComplete();
        }
      };

      this.scheduledTime += buffer.duration;
    }

    const nextCheck =
      this.audioQueue.length > 0
        ? (this.scheduledTime - this.context.currentTime) * 1000 - 150
        : 50;

    this.scheduleTimeout = setTimeout(
      () => this.scheduleNextBuffer(generation),
      Math.max(20, nextCheck),
    );
  }

  private handlePlaybackComplete() {
    if (this.queueCompleteNotified) return;
    this.queueCompleteNotified = true;
    this.isPlaying = false;
    this.onComplete();
  }

  stop() {
    this.schedulerGeneration += 1;
    this.isPlaying = false;
    this.isStreamComplete = true;
    this.queueCompleteNotified = false;
    this.audioQueue = [];
    this.pendingRemainder = null;

    if (this.scheduleTimeout) {
      clearTimeout(this.scheduleTimeout);
      this.scheduleTimeout = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.gainNode.gain.cancelScheduledValues(this.context.currentTime);
    this.gainNode.gain.setTargetAtTime(0, this.context.currentTime, 0.015);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;

      for (const source of this.activeSources) {
        try {
          source.stop();
        } catch {
          // source may already be stopped
        }
        source.disconnect();
      }
      this.activeSources.clear();

      this.gainNode.gain.cancelScheduledValues(this.context.currentTime);
      this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
    }, 50);
  }

  async resume() {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    this.isStreamComplete = false;
    this.pendingRemainder = null;
    this.scheduledTime = this.context.currentTime + this.initialBufferTime;
    this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
  }

  complete() {
    this.isStreamComplete = true;

    if (!this.isPlaying && this.audioQueue.length > 0) {
      this.startPlayback();
      return;
    }

    if (this.isPlaying) {
      this.scheduleNextBuffer(this.schedulerGeneration);
    }

    if (this.isPlaying && this.audioQueue.length === 0 && this.activeSources.size === 0) {
      this.handlePlaybackComplete();
    }
  }

  getVolume(): number {
    this.analyserNode.getByteTimeDomainData(this.timeDomainData);

    let sumSquares = 0;
    for (const amplitude of this.timeDomainData) {
      const normalized = (amplitude - 128) / 128;
      sumSquares += normalized * normalized;
    }

    return Math.sqrt(sumSquares / this.timeDomainData.length);
  }
}
