# Latency Audit Report

Date: 2026-03-16  
Project: digital-persona  
Audit Scope: End-to-end review of Gemini Live API response latency across client session startup, function-calling loop, audio/video streaming, and deployment runtime limits.

## Executive Summary

This audit found that the largest latency contributors are not a single slow function, but the combination of:

1. deployment limits that cause queueing and cold-start spikes,
2. long tool-call blocking windows,
3. large connect-time model instruction payload,
4. high-frequency processing/logging on realtime hot paths.

Overall latency risk at scale is **high** under concurrent load and moderate under single-user load.

## Current Implementation Check (Code-Verified)

Status against the prioritized recommendations:

- ✅ **Implemented: Tool timeout reduction** — `TOOL_HANDLER_TIMEOUT_MS` is now `4000ms` in `src/hooks/useGeminiLive.ts`.
- ✅ **Implemented: Hot-path log throttling** — chunk logs are sampled (`AUDIO_CHUNK_LOG_INTERVAL`, `DUPLICATE_AUDIO_LOG_INTERVAL`) and expensive `Object.keys(...)` logging was removed from `src/hooks/useGeminiLive.ts`.
- ✅ **Implemented: Viseme queue optimization** — pointer/deque-style queue (`VisemeQueue`) replaced shift-based dequeue path in `src/lib/lipsync-engine.ts`.
- ✅ **Implemented: Token startup optimization** — server client caching in `src/app/api/token/route.ts` plus eager token prefetch with freshness guard in `src/hooks/useGeminiLive.ts`.
- ✅ **Implemented: Effect dependency refinement** — `page.tsx` no longer relies on a broad spread session object for tool registration; dependencies were narrowed to stable fields/functions.
- ✅ **Implemented: Echo holdoff tuning** — `ASSISTANT_HOLDOFF_MS` is now `500` in `src/hooks/useSessionManager.ts`.

Still pending:

- ⏳ **Cloud Run scaling policy** in `.github/workflows/deploy.yml` remains `min-instances=0`, `max-instances=1`, `concurrency=80`.
- ⏳ **SYSTEM_PROMPT full compaction** — the prompt remains large; only avatar baseline payload was compacted.
- ⏳ **Tool response size capping** — no hard response-size guard has been added yet.
- ⏳ **Model migration** — app still targets `gemini-2.5-flash-native-audio-preview-12-2025`.

---

## Audited Runtime Flow

1. Client starts session and requests ephemeral token via `/api/token`.
2. Client opens Gemini Live connection and sends model config (`systemInstruction`, tools, generation params).
3. User audio/video streams through `sendRealtimeInput`.
4. Server messages include transcript/audio/tool calls.
5. Tool handlers execute in-app, then `sendToolResponse` returns results.
6. Assistant audio gets decoded and scheduled for playback.

Key files reviewed:

- `src/lib/constants.ts`
- `src/hooks/useGeminiLive.ts`
- `src/hooks/useSessionManager.ts`
- `src/hooks/useAudioProcessor.ts`
- `src/hooks/useWebcam.ts`
- `src/app/page.tsx`
- `src/app/api/token/route.ts`
- `src/lib/audio-streamer.ts`
- `src/lib/lipsync-engine.ts`
- `.github/workflows/deploy.yml`

---

## Current Features & Settings Affecting Latency

### Model and Prompting

- Model: `gemini-2.5-flash-native-audio-preview-12-2025` (`src/lib/constants.ts`)
- `SYSTEM_PROMPT` size: ~4054 chars (~591 words)
- Function tools declared: 7
- `googleSearch` tool also enabled in tool list

### Live Session Config

From `src/hooks/useGeminiLive.ts`:

- `responseModalities: [AUDIO]`
- `maxOutputTokens: 768`
- `temperature: 0.85` (0.8 in minimal profile)
- `topP: 0.95` (full profile)
- `contextWindowCompression: slidingWindow`
- optional `proactivity.proactiveAudio`
- tool timeout window: `10_000ms`

### Media Pipeline

From `src/lib/constants.ts` and hooks:

- Mic input: 16kHz PCM
- Output: 24kHz PCM
- Webcam frame rate: `video_fps: 1`
- Webcam quality: `video_quality: 0.7`

> Note: frame capture is currently low-frequency (1 FPS), so webcam encoding is **not** a top-tier latency source in the present config.

### Deployment Runtime Limits

From `.github/workflows/deploy.yml`:

- `--cpu=1`
- `--memory=512Mi`
- `--concurrency=80`
- `--min-instances=0`
- `--max-instances=1`

This combination heavily increases tail latency under concurrent load.

---

## Bottlenecks, Impact Scores, Scale Effects, and Safe Improvements

## 1) Cloud Run Instance Limits and Cold Starts

- **Impact:** 9/10
- **Evidence:** `.github/workflows/deploy.yml` (`min-instances=0`, `max-instances=1`, `concurrency=80`)
- **Reason:** Single instance + high concurrency causes queueing. Zero min instances causes cold-start spikes after idle periods.
- **Scale Effect:** p95/p99 latency climbs sharply with traffic bursts; users experience delayed connect/token/startup.
- **Safe Improvement:**
  - Set `min-instances=1` for warm baseline.
  - Increase `max-instances` (e.g., 3 to 10).
  - Reduce per-instance concurrency for realtime-heavy workloads (e.g., 10 to 30).
  - Keep API contract unchanged.

## 2) Tool Handler Timeout Window Too Long

- **Impact:** 8/10
- **Evidence:** `TOOL_HANDLER_TIMEOUT_MS = 10_000` in `src/hooks/useGeminiLive.ts`
- **Reason:** A slow tool can block model continuation for up to 10 seconds.
- **Scale Effect:** More concurrent tool calls increase perceived stalls and audible gaps.
- **Safe Improvement:**
  - Lower timeout to 3000–5000ms.
  - Return bounded fallback on timeout.
  - Keep existing tool schemas unchanged.

## 3) Connect-Time Prompt and Baseline Payload Size

- **Impact:** 7/10
- **Evidence:** large `SYSTEM_PROMPT` in `src/lib/constants.ts`, plus baseline JSON merged into `systemInstruction` in `src/hooks/useGeminiLive.ts`
- **Reason:** Session setup sends a large instruction payload every connect.
- **Scale Effect:** Higher startup latency and increased tokenization overhead per session.
- **Safe Improvement:**
  - Compress repeated policy text and examples.
  - Move non-critical baseline details to post-connect tool state sync.
  - Preserve behavior and tool set.

## 4) Hot-Path Logging and Object Serialization

- **Impact:** 6.5/10
- **Evidence:** frequent `log.info/log.debug` and `Object.keys(...)` in `src/hooks/useGeminiLive.ts`
- **Reason:** Realtime message/tool loops perform object serialization repeatedly.
- **Scale Effect:** CPU burn and jitter increase as message/chunk rate grows.
- **Safe Improvement:**
  - Demote repetitive logs to debug/trace.
  - Guard expensive log payload assembly (`Object.keys`) behind level checks.
  - Add sampling for chunk-level logs.

## 5) Viseme Queue Uses O(n) Shift in Frame Loop

- **Impact:** 6/10
- **Evidence:** `pendingVisemes.shift()` inside `advanceScheduledViseme` in `src/lib/lipsync-engine.ts`
- **Reason:** `shift()` reindexes arrays; can become expensive in rapid update scenarios.
- **Scale Effect:** Frame-time variance rises during fast speech transitions and heavy animation.
- **Safe Improvement:**
  - Replace with pointer/deque pattern.
  - Keep same viseme semantics and public behavior.

## 6) Extra Session Start Round-Trip for Ephemeral Token

- **Impact:** 5.5/10
- **Evidence:** `/api/token` POST before connect in `src/hooks/useGeminiLive.ts`; token creation in `src/app/api/token/route.ts`
- **Reason:** Every session requires token fetch and server-side token generation.
- **Scale Effect:** Startup time increases under backend contention.
- **Safe Improvement:**
  - Reuse initialized server client where possible.
  - Keep token lifetime/uses policy if security requirements demand strict 1-use tokens.

## 7) Echo Holdoff Delays User Re-Entry

- **Impact:** 5/10
- **Evidence:** `ASSISTANT_HOLDOFF_MS = 900` and gating logic in `src/hooks/useSessionManager.ts`
- **Reason:** Post-assistant holdoff can suppress valid user speech.
- **Scale Effect:** Interaction feels laggy in rapid back-and-forth dialogue.
- **Safe Improvement:**
  - Tune holdoff down (e.g., 350–600ms) with A/B checks for interruption stability.

## 8) Broad Effect Dependencies for Tool Registration

- **Impact:** 4.5/10
- **Evidence:** `useEffect` dependency includes full `session` object in `src/app/page.tsx`
- **Reason:** Re-registration churn can happen unnecessarily.
- **Scale Effect:** More lifecycle churn under state changes.
- **Safe Improvement:**
  - Narrow dependencies to stable refs/functions used inside handlers.

---

## Function Calling Audit (Requested)

Declared function tools in `src/lib/constants.ts` and observed runtime handlers in `src/app/page.tsx`:

1. `trigger_animation` → resolves semantic match (`findBestAnimationMatch`) and plays animation.
2. `get_time_date` → lightweight built-in, returns timestamp/date/time.
3. `update_persona_state` → sanitizes and applies avatar control patches.
4. `display_text` → appends assistant content into chat panel.
5. `set_expression` → sets transient expression with timer reset.
6. `switch_camera` → async camera switch (`getUserMedia` path).
7. `end_call` → deferred disconnect after playback complete or fallback timer.

Function-calling risk notes:

- Any asynchronous handler (especially `switch_camera`) can increase per-turn latency before the model continues.
- Tool responses currently allow large arbitrary result objects; payload growth can increase send/parse costs.
- Timeout safety exists, but current 10s window is too high for conversational responsiveness.

---

## Prioritized Non-Breaking Improvement Roadmap

### P0 (Immediate)

1. Cloud Run scaling policy update:
   - `min-instances: 1`
   - `max-instances: 3+`
   - lower `concurrency` for realtime stability
2. Reduce tool timeout to 3–5s.
3. Reduce hot-path log volume and payload computation.

### P1 (Short-Term)

1. Trim connect-time instruction payload.
2. Cap tool response object size (or summarize large responses).
3. Replace viseme queue `shift()` implementation with O(1)-style dequeue index.
4. Tune assistant holdoff threshold empirically.

### P2 (Optimization)

1. Rework token path for lower startup overhead while preserving security constraints.
2. Add latency telemetry by phase (token, connect, first audio byte, tool round-trip).
3. Add performance budget alarms (p95 startup and p95 tool RTT).

---

## Suggested SLO Targets

- Session connect start to connected: **p95 < 1500ms**
- User speech/text to first assistant audio byte: **p95 < 900ms**
- Tool call round-trip: **p95 < 600ms**, **p99 < 1500ms**
- End-to-end turn completion (short answer): **p95 < 2500ms**

---

## Validation Checklist After Changes

- [ ] No regression in tool behavior or schema compatibility.
- [ ] No increase in interruption/self-echo issues.
- [ ] p95 and p99 latency improve under 10+ concurrent simulated sessions.
- [ ] Cold-start impact reduced or eliminated for normal traffic hours.
- [ ] Playback/lipsync quality remains acceptable after queue optimization.

---

## Skill-Based Evaluation (Applied)

This report was re-evaluated using:

- `backend-latency-profiler-helper`
- `logging-best-practices`
- `gemini-api-dev`

### Backend-Latency-Profiler-Helper Checklist

- [x] Slow endpoints identified (session startup, tool round-trip, token path)
- [x] Causes analyzed (runtime limits, payload size, timeout policy, hot-loop overhead)
- [x] Fix roadmap created (P0/P1/P2)
- [x] Monitoring configured (recommended telemetry and SLO alarms documented)

### Additional Findings from Skill Re-Evaluation

## 9) Legacy/Preview Model Lifecycle Risk

- **Impact:** 4/10 (latency stability risk, not direct per-turn CPU cost)
- **Evidence:** `gemini-2.5-flash-native-audio-preview-12-2025` in `src/lib/constants.ts`
- **Reason:** Preview/legacy model families can have changing availability/perf characteristics versus current production tracks.
- **Scale Effect:** unpredictable p95/p99 latency shifts over time and occasional feature compatibility fallbacks.
- **Safe Improvement:** validate current recommended Live-capable model and API version, then migrate behind a config flag/canary without changing tool contracts.

### Logging Best-Practices Compliance Delta

- Structured logging is already in place (`pino`), but high-frequency hot-path events should be sampled or demoted to reduce overhead.
- Avoid log payload construction (`Object.keys`, large context objects) unless log level requires emission.


---

## Final Conclusion

The strongest latency gains will come from deployment/runtime policy and tool-call timeout tuning first, then from reducing connect-time payload and hot-loop overhead. These can be implemented safely without breaking functional behavior or UX contracts.
