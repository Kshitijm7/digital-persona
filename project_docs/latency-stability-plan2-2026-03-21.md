# Latency & Stability Plan v2

Date: 2026-03-21
Project: `digital-persona`
Supersedes: `native-audio-stability-plan-2026-03-21.md`
Primary goal: make the Gemini Live connection feel like a fast, stable, real call — without killing emotion sync, avatar expressions, or Google Search.

## Core Principles

1. **Same model always.** `gemini-2.5-flash-native-audio-preview-12-2025` in all modes. Never fallback to `gemini-2.0-flash-live-001`.
2. **Two modes only.** `full` and `stable`. No `safe`, no `minimal`.
3. **Emotion and avatar sync are sacred.** `set_expression`, `trigger_animation`, `update_persona_state`, lip-sync — untouched in all modes.
4. **Google Search stays.** Both modes keep `SEARCH_TOOL` enabled.
5. **Config wins before code refactors.** Ship measurable latency improvements before any architecture changes.

---

## Success Metrics

| Metric | Current Signal | Target |
|---|---|---|
| Connect → `onopen` | 149ms–484ms | p95 < 500ms |
| User speech → first audio byte | 1515ms–timeout | p95 < 1200ms |
| Local tool round-trip | 1457ms–3313ms | common tools < 1800ms |
| Multi-turn Turn 2 vs Turn 1 | +46% (2624ms → 3829ms) | < +20% degradation |
| Repeated 1011 loops | possible today | max 1 retry before degrade |
| Video session hard drops | not handled | clean rollover before 2-min limit |
| Transcript correctness | broken (roles crossed) | zero misrouting |

---

## Wave 0 — Immediate Config-Only Wins ✅ IMPLEMENTED

> **All Wave 0 changes are now driven by `src/config/gemini-session.json`.**
> The config is loaded by `src/lib/gemini-session-config.ts` and consumed by `useGeminiLive.ts`.
> UI-level overrides (`features.googleSearch`, `features.proactiveAudio`) still take precedence.
> To tweak latency/stability settings, edit `gemini-session.json` and restart — no code changes needed.

### 0.1 `src/lib/constants.ts`

| Change | Line(s) | Before | After | Why |
|---|---|---|---|---|
| Lower `maxOutputTokens` | `useGeminiLive.ts:650` | `768` | `384` | 768 tokens = ~30s of speech. A persona speaking "1–2 sentences" needs ≤384. Reduces generation time. |
| Remove `GEMINI_MODEL_FALLBACK` | `constants.ts:227` | `"gemini-2.0-flash-live-001"` | Delete export entirely | Benchmark: tool call **Timeout/Failed**. Keeping it is a liability. |
| Trim `trigger_animation` enum | `constants.ts:45–57` | 11 values incl. `dance`, `expression` | Remove `dance`, `expression` (9 values) | Smaller tool declaration = faster tool routing. |
| **Delete `TOOL_SILENCE_POLICY`** | `useGeminiLive.ts:34–41` + `constants.ts` | Separate 6-rule constant (~280 chars) concatenated at connect time | **Delete the constant entirely.** Merge 2 essential rules into `SYSTEM_PROMPT`'s TOOLS section. | Eliminates a concatenation step at connect. Keeps prompt under 1500-char safety ceiling. |

**Updated `SYSTEM_PROMPT` (TOOLS section becomes):**
```
TOOLS:
Use tools as natural extensions of yourself. Call tools immediately without filler speech — never say "let me check" before a tool call. Speak only after tool results are available. Never announce tool usage aloud.
```

The `TOOL_SILENCE_POLICY` constant and `TOOL_SILENCE_POLICY` variable in `useGeminiLive.ts` (lines 34–41) are **deleted**. The connect-time `systemInstruction` no longer concatenates `TOOL_SILENCE_POLICY` — the rules live inside `SYSTEM_PROMPT` itself.

### 0.2 `src/hooks/useGeminiLive.ts` — Session Config Only

| Change | Line(s) | Before | After | Why |
|---|---|---|---|---|
| Add `thinkingConfig` | new field at ~650 | not present | `thinkingConfig: { thinkingBudget: 0 }` | Native audio model has thinking enabled by default. Disabling saves ~200–500ms per turn for real-time conversation. |
| Add `mediaResolution` | new field at ~665 | not present | `mediaResolution: 'MEDIA_RESOLUTION_LOW'` | Reduce server-side vision processing cost. |
| Set `triggerTokens` | line 667 | `{ slidingWindow: {} }` | `{ slidingWindow: {}, triggerTokens: 40000 }` | Default is 80% of 128k = ~102k. Earlier compression prevents multi-turn latency explosion. |
| Move avatar baseline | line 640 | In `systemInstruction` | Send via `sendClientContent` after connect | Saves ~250 chars from setup payload, well below 1500 ceiling. |
| Remove `SILENT` scheduling | line 570–573 | `scheduling: "SILENT"` in full mode | Remove entirely | Undocumented field. Could be causing 1011 closes. |
| Simplify `systemInstruction` concat | line 640 | `${SYSTEM_PROMPT}\n\n${TOOL_SILENCE_POLICY}\n\n...` | `${SYSTEM_PROMPT}\n\n# AVATAR_CONTROL_BASELINE\n...` | `TOOL_SILENCE_POLICY` no longer exists — rules are already inside `SYSTEM_PROMPT`. |

### 0.3 Expected Impact

- First-audio latency: **-300 to -600ms** (thinking disabled + smaller prompt + lower maxOutputTokens)
- Multi-turn degradation: **-30 to -50%** (earlier context compression)
- Connection stability: **improved** (SILENT removed, smaller setup payload)

---

## Wave 1 — Stability-Critical Fixes

> Fix the bugs and failure modes that cause session drops.

### 1.1 Fix Transcript Routing — `useGeminiLive.ts`

**Current (line 408–409):**
```typescript
if (serverContent.outputTranscription?.text) {
  onUserTranscript.current?.(serverContent.outputTranscription.text);
}
```

**Fixed:**
```typescript
if (serverContent.inputTranscription?.text) {
  onUserTranscript.current?.(serverContent.inputTranscription.text);
}
if (serverContent.outputTranscription?.text) {
  onTranscript.current?.(serverContent.outputTranscription.text);
}
```

Per API docs: `inputTranscription` = user speech, `outputTranscription` = model speech.

### 1.2 Collapse to 2-Mode Profile — `useGeminiLive.ts`

**Changes:**
- Replace `type LiveCompatibilityProfile = "full" | "safe" | "minimal"` → `"full" | "stable"`
- Remove all `GEMINI_MODEL_FALLBACK` references
- `model` is always `GEMINI_MODEL` regardless of mode
- `downgradeCompatibilityProfile()` returns `"stable"` from `"full"`, `null` from `"stable"`
- In `stable` mode:
  - `proactivity` removed (no `proactiveAudio`)
  - `enableAffectiveDialog` removed
  - `outputAudioTranscription` removed
  - `temperature: 0.8` (vs 0.85 in full)
  - `topP` removed
- In both modes:
  - Google Search stays
  - All function tools stay
  - `inputAudioTranscription` stays (for user transcript)
  - Context compression stays
  - Session resumption stays

### 1.3 1011/1012/1013 Degradation — `useGeminiLive.ts` + `useSessionManager.ts`

**In `useGeminiLive.ts` `onclose`:**
- On 1011/1012/1013: set `lastCloseCodeRef.current = e.code`
- On repeated 1011 while in `full`: call `downgradeCompatibilityProfile()` → switch to `stable`
- On repeated 1011 while already in `stable`: refresh token, bounded retry (max 3)

**In `useSessionManager.ts`:**
- Replace linear backoff: `800ms * attempt` → exponential backoff with jitter: `min(800 * 2^attempt + random(0,400), 8000)`
- Track session health state: `healthy` | `recovering` | `degraded`
- After successful reconnect in `stable`, stay in `stable` for the rest of the session (don't auto-promote back to `full`)

### 1.4 Add `goAway` Handler — `useGeminiLive.ts`

In `handleMessage`, add:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const goAway = (message as any).goAway;
if (goAway) {
  log.warn({ connectionId, timeLeft: goAway.timeLeft }, "Server sent goAway — initiating proactive reconnect.");
  // Trigger a clean reconnect: save handle, disconnect, reconnect
  // The reconnect will use sessionResumption with the saved handle
}
```

### 1.5 Video Session Rollover — `useSessionManager.ts`

- Add a `videoSessionTimerRef` that starts when camera is active
- At **1 minute 45 seconds** (15s before 2-min hard limit): initiate proactive rollover
- Rollover sequence:
  1. Request fresh token
  2. Save current `sessionHandleRef`
  3. Disconnect cleanly
  4. Reconnect with `sessionResumption: { handle: savedHandle }`
  5. Restart mic/camera

### 1.6 Reset `lastCloseCodeRef` — `useGeminiLive.ts`

- In `connect()` at line ~272: add `lastCloseCodeRef.current = null`
- In `disconnect()` at line ~246: add `lastCloseCodeRef.current = null`

### 1.7 Gate v1alpha Features Behind Mode

In connect config:
```typescript
// Only enable in 'full' mode
...(isFull ? { enableAffectiveDialog: true } : {}),
...(isFull ? { proactivity: { proactiveAudio: cfg.features.proactiveAudio } } : {}),
...(isFull ? { outputAudioTranscription: {} } : {}),
```

### 1.8 Capture `usageMetadata`

In `handleMessage`, add:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const usage = (message as any).usageMetadata;
if (usage) {
  log.info({ connectionId, totalTokens: usage.totalTokenCount, promptTokens: usage.promptTokenCount }, "Usage metadata received.");
}
```

---

## Wave 2 — Hot-Path Latency Reduction

> Remove browser-side CPU/GC cost from the audio and video paths.

### 2.1 Replace Heartbeat with `audioStreamEnd` — `useSessionManager.ts`

**Current (lines 148–154, 184–193):** Sends a chunk every 3 seconds during suppression, including atob/btoa zero-chunk generation.

**New behavior:**
- When mic is suppressed for >1 second: call `sendAudioStreamEnd()` once
- Stop sending any heartbeat chunks
- When user speaks again: real audio resumes the stream automatically (per API docs)
- Remove the `atob`/`btoa` zero-chunk construction at line 190–191 entirely

**Keep:** The echo-block logic (lines 158–195) remains for preventing self-interruption, but it suppresses by dropping chunks, not by sending silence.

### 2.2 Precompute Zero-Audio Chunk — `useSessionManager.ts`

If testing reveals that `audioStreamEnd` alone causes disconnects (some WebSocket servers need periodic traffic), precompute one zero chunk at module scope:

```typescript
const ZERO_CHUNK_BYTES = new Uint8Array(3200); // 100ms of 16kHz 16-bit silent PCM
const ZERO_CHUNK_B64 = bytesToBase64(ZERO_CHUNK_BYTES); // compute ONCE
```

Use `ZERO_CHUNK_B64` instead of the per-heartbeat `atob`/`btoa` construction.

### 2.3 Ring Buffer for `AudioStreamer` — `audio-streamer.ts`

**Current (line 68, 123):** `this.audioQueue.shift()` — O(n) array operation.

**Replace with indexed ring buffer:**
```typescript
private audioQueue: (Float32Array | null)[] = new Array(this.maxQueueLength).fill(null);
private queueHead = 0;
private queueTail = 0;
private queueSize = 0;

private enqueue(data: Float32Array) {
  if (this.queueSize >= this.maxQueueLength) {
    this.queueHead = (this.queueHead + 1) % this.maxQueueLength; // drop oldest
    this.queueSize--;
  }
  this.audioQueue[this.queueTail] = data;
  this.queueTail = (this.queueTail + 1) % this.maxQueueLength;
  this.queueSize++;
}

private dequeue(): Float32Array | null {
  if (this.queueSize === 0) return null;
  const data = this.audioQueue[this.queueHead];
  this.audioQueue[this.queueHead] = null;
  this.queueHead = (this.queueHead + 1) % this.maxQueueLength;
  this.queueSize--;
  return data;
}
```

Benefits: O(1) enqueue/dequeue, no array resizing, no GC pressure.

### 2.4 Adaptive Webcam FPS — `useWebcam.ts`

**Current (line 108–123):** Fixed interval at `1000 / AUDIO_CONFIG.video_fps` = 1000ms.

**New:** Accept a `fpsMultiplier` parameter:
- `full` mode: `fpsMultiplier = 1.0` → 1fps
- `stable` mode: `fpsMultiplier = 0.5` → 0.5fps (2-second interval)
- During reconnect/recovery: pause frame sending entirely

---

## Wave 3 — Maintainability & Observability

### 3.1 Extract Tool Bindings — `page.tsx`

Move from `page.tsx` into:
- `src/hooks/usePersonaToolBindings.ts` — registers `trigger_animation`, `set_expression`, `update_persona_state`, `display_text`, `switch_camera`, `end_call`
- `src/hooks/useTranscriptBridge.ts` — wires `onTranscript` and `onUserTranscript` to chat state

### 3.2 Structured Token Route Logging — `api/token/route.ts`

Replace `console.error` with structured logger. Add:
- Request duration measurement
- Error classification (missing env, upstream auth, quota, unexpected)

### 3.3 Typed Env Validation — `lib/env.ts`

Replace the current trim-and-return helper with Zod-based validation at server boot. Fail fast on missing `GEMINI_API_KEY`.

### 3.4 Split Test Commands — `package.json` + `vitest.config.ts`

```json
{
  "test:unit": "vitest run --reporter=verbose --testPathPattern=unit",
  "test:integration": "vitest run --testPathPattern=integration",
  "test:live": "vitest run --testPathPattern=e2e/gemini-api",
  "bench:live": "vitest run --testPathPattern=e2e/gemini-latency"
}
```

Keep `test:run` as `test:unit` + `test:integration` for deterministic CI.

---

## Execution Order

### Deploy immediately (Wave 0)
1. `constants.ts` — remove fallback model, trim animation enum, **delete `TOOL_SILENCE_POLICY` constant**, merge its rules into `SYSTEM_PROMPT`
2. `useGeminiLive.ts` — config changes only (thinking, maxOutput, mediaRes, triggerTokens, remove SILENT scheduling, move avatar baseline, **remove `TOOL_SILENCE_POLICY` concatenation from `systemInstruction`**)
3. Deploy, measure latency before vs after

### Week 1 (Wave 1)
1. `useGeminiLive.ts` — transcript fix, 2-mode profile, goAway, 1011 degrade, usageMetadata, reset lastCloseCode, gate v1alpha features
2. `useSessionManager.ts` — exponential backoff, video rollover
3. `constants.ts` — typed profile config object
4. Unit tests for transcript routing, degradation flow, goAway handling

### Week 2 (Wave 2)
1. `useSessionManager.ts` — heartbeat → audioStreamEnd, precompute zero chunk
2. `audio-streamer.ts` — ring buffer
3. `useWebcam.ts` — adaptive FPS
4. Benchmark: full vs stable latency comparison

### Week 3 (Wave 3)
1. `page.tsx` — extract tool bindings
2. `api/token/route.ts` — structured logging
3. `lib/env.ts` — Zod validation
4. `package.json` + `vitest.config.ts` — split test commands

---

## What Changes In Each Mode

| Feature | `full` | `stable` |
|---------|--------|----------|
| Model | native-audio | native-audio |
| Google Search | ✅ | ✅ |
| Function tools (all) | ✅ | ✅ |
| `enableAffectiveDialog` | ✅ | ❌ |
| `proactiveAudio` | ✅ | ❌ |
| `outputAudioTranscription` | ✅ | ❌ |
| `inputAudioTranscription` | ✅ | ✅ |
| `topP: 0.95` | ✅ | ❌ |
| `temperature` | 0.85 | 0.8 |
| `SILENT` scheduling | ❌ (removed) | ❌ |
| `contextWindowCompression` | ✅ | ✅ |
| `sessionResumption` | ✅ | ✅ |
| Video FPS | 1fps | 0.5fps |
| `maxOutputTokens` | 384 | 384 |
| `thinkingBudget` | 0 | 0 |
| `mediaResolution` | LOW | LOW |

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| `thinkingBudget: 0` degrades response quality | Monitor quality. If needed, set to 128 instead of 0. |
| Video rollover causes audio gap | Use `sessionResumption`. Gap should be <500ms. |
| Removing `SILENT` causes filler speech | Tool rules are now baked into `SYSTEM_PROMPT`'s TOOLS section — compensates. |
| `audioStreamEnd` causes disconnects | Keep precomputed zero chunk ready as fallback. |
| `triggerTokens: 40000` causes frequent compression latency spikes | If noticed, increase to 60000. |

---

## References

- `src/hooks/useGeminiLive.ts` — session lifecycle, message handler, connect config
- `src/hooks/useSessionManager.ts` — reconnect, heartbeat, mic forwarding
- `src/hooks/useAudioProcessor.ts` — mic capture, playback
- `src/hooks/useWebcam.ts` — video capture and frame sending
- `src/lib/audio-streamer.ts` — audio queue and playback scheduling
- `src/lib/constants.ts` — models, tools, prompts, config
- `src/__tests__/e2e/latency_results.md` — benchmark data
- `project_docs/gemini_api/gemin_live_api_doc.md` — Live API reference (goAway, transcription, usageMetadata)
- `project_docs/gemini_api/official_docs.md` — session limits, thinking, mediaResolution, VAD
- `project_docs/gemini_api/best_practice.md` — ephemeral tokens, architecture patterns
