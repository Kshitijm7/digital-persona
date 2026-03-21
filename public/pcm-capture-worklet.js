/**
 * PCM-16 Capture AudioWorklet Processor
 *
 * Runs on the audio rendering thread — minimal allocations,
 * no GC pauses, no main-thread blocking.
 *
 * Posts:    ArrayBuffer (Int16 LE samples) via Transferable
 * Listens: { command: 'flush' } to drain partial buffer on mic stop
 *
 * Default chunk: 2048 samples @ 16 kHz = 128 ms per packet.
 * Override via processorOptions.chunkSize at construction time.
 *
 * Endianness: Int16Array uses platform-native byte order.
 * All modern consumer devices (x86, ARM) are little-endian,
 * matching the LE expectation in AudioStreamer.decodePCM16().
 *
 * Usage:
 *   await ctx.audioWorklet.addModule('/pcm-capture-worklet.js');
 *   const node = new AudioWorkletNode(ctx, 'pcm-capture-processor', {
 *     processorOptions: { chunkSize: 2048 },
 *   });
 *   // On mic stop — drain remaining samples:
 *   node.port.postMessage({ command: 'flush' });
 */
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const size = options?.processorOptions?.chunkSize ?? 2048;
    this._buf = new Int16Array(size);
    this._len = size;
    this._off = 0;

    this.port.onmessage = (e) => {
      if (e.data?.command === "flush") this._flush();
    };
  }

  /**
   * Flush partial buffer — posts only the filled portion.
   * Called via port message when the mic is about to stop.
   */
  _flush() {
    if (this._off === 0) return;
    // _off samples × 2 bytes each
    const copy = this._buf.buffer.slice(0, this._off << 1);
    this.port.postMessage(copy, [copy]);
    this._off = 0;
  }

  /**
   * Post a full buffer. Separate from _flush to avoid the
   * byte-length calculation on the hot path.
   */
  _post() {
    const copy = this._buf.buffer.slice(0);
    this.port.postMessage(copy, [copy]);
    this._off = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    // Hoist to locals — avoids repeated property lookups
    // on `this` inside the tight per-sample loop.
    const buf = this._buf;
    const bufLen = this._len;
    const srcLen = channel.length;
    let off = this._off;

    for (let i = 0; i < srcLen; i++) {
      // Clamp → scale to Int16 range [-32767, 32767].
      // Inline ternary avoids Math.max/Math.min property lookups.
      // Int16Array auto-truncates float → integer (no Math.round needed).
      // Symmetric formula: -1.0 maps to -32767 instead of -32768.
      // Difference is 1 LSB = -90.3 dB — completely inaudible.
      const s = channel[i];
      buf[off++] = (s > 1 ? 1 : s < -1 ? -1 : s) * 0x7FFF;

      if (off >= bufLen) {
        this._post();
        off = 0;
      }
    }

    this._off = off;
    return true;
  }
}

registerProcessor("pcm-capture-processor", PCMCaptureProcessor);