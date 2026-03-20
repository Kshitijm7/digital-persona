# Native Audio Stability And Latency Implementation Plan

Date: 2026-03-21
Project: `digital-persona`
Primary goal: make the Gemini Live connection feel like a fast, stable, real call.

## Core Decision

Degradation will stay on native audio.

- Keep `GEMINI_MODEL` on the native-audio model.
- Do not switch to `gemini-2.0-flash-live-001` or any non-native-audio fallback.
- Use only two runtime modes: `full` and `stable`.
- `stable` must preserve core intelligence:
  - keep Google Search
  - keep function/tool calling
  - keep the same native-audio model
  - keep standard conversational/VAD behavior
- Recovery should focus on trimming non-essential session overhead and fixing latency sources, not stripping the product's core capabilities.

## What "Stable" Means In This Plan

The app should move between two native-audio modes, not models:

- `full`: current premium behavior
- `stable`: same native audio + same core tools/intelligence, but with non-essential extras reduced

Allowed reductions in `stable`:

1. disable `proactiveAudio`
2. disable `enableAffectiveDialog`
3. reduce or disable non-essential transcriptions only if measurement shows they materially affect latency or stability
4. reduce video frame frequency / pause video during recovery windows
5. shorten generation limits and connect-time payload size

What `stable` should not remove:

1. Google Search
2. primary function/tool calling
3. native-audio mode

## Success Metrics

These are target outcomes after the plan is implemented and measured over repeated runs, not single-run promises.

| Metric | Current Signal | Target |
|---|---|---|
| Connect start -> `onopen` | observed `149ms` to `484ms` in current benchmark artifact | stable p95 under `900ms` |
| User speech/text -> first audio byte | observed `1515ms` to timeout depending on config | stable p95 under `1400ms` |
| Local tool round-trip | observed `1457ms` to `3313ms` | common tools under `2000ms`, best tools near `1200ms-1600ms` |
| Repeated 1011 reconnect loops | possible today | no repeated same-config loop beyond one retry |
| Video session hard drops at 2 minutes | not proactively handled today | session rollover before hard limit |
| Transcript correctness | currently wrong for user vs assistant roles | zero role-misrouting |

## Phase 1: Stabilize The Connection First

### 1. `src/hooks/useGeminiLive.ts`

Proposed changes:

- Replace `LiveCompatibilityProfile = "full" | "safe" | "minimal"` with a native-audio-only mode such as:
  - `"full"`
  - `"stable"`
- Stop using `GEMINI_MODEL_FALLBACK` in the reconnect path.
- Keep `model: GEMINI_MODEL` for both modes.
- Keep Google Search and function/tool calling enabled in both modes.
- Fix transcript routing:
  - `serverContent.inputTranscription` -> `onUserTranscript`
  - `serverContent.outputTranscription` -> `onTranscript`
- Reset `lastCloseCodeRef` on new `connect()` and on manual `disconnect()`.
- Handle `goAway` explicitly and expose a callback or internal flag to trigger controlled reconnect.
- Add `usageMetadata` capture for logging/telemetry.
- Change 1011/1012/1013 behavior:
  - first failure: retry once with short backoff
  - repeated failure while in `full`: reconnect in `stable`
  - repeated failure while already in `stable`: refresh token, use bounded retries, surface recovery state, and avoid progressively stripping core tools
- Keep 1008 handling, but make the recovery path native-audio-only and two-mode only.

Expected outcome:

- No model breakage during degradation.
- No loss of core search/tool intelligence during recovery.
- Fewer repeated internal-error reconnect loops.
- Correct transcript ownership in chat/UI.
- Better visibility into whether failures correlate with proactivity, transcriptions, video, or reconnect timing.

### 2. `src/hooks/useSessionManager.ts`

Proposed changes:

- Replace the current reconnect policy with a two-mode recovery loop:
  - attempt 1: retry current profile
  - attempt 2: reconnect in `stable` if currently in `full`
  - attempt 3+: stay in `stable`, refresh token/session state when needed, and use bounded exponential backoff rather than further feature stripping
- Add exponential backoff with jitter instead of `800ms * attempt` only.
- Track whether the session is in `recovering`, `degraded`, or `healthy`.
- Add a session rollover timer for camera-on sessions before the 2-minute Live API hard limit.
- On rollover:
  - request a fresh token
  - reconnect with `sessionResumption`
  - restart mic/camera with minimal user-visible disruption

Expected outcome:

- Recovery becomes intentional instead of blind retry.
- Video sessions stop dying at predictable hard limits.
- Better "real call" feel because reconnects become shorter and less chaotic.

### 3. `src/lib/constants.ts`

Proposed changes:

- Remove practical dependence on `GEMINI_MODEL_FALLBACK`.
- Introduce a typed native-audio feature-profile config object, for example:
  - mode name
  - search always on
  - tool calling always on
  - proactivity on/off
  - affective dialog on/off
  - transcription policy
  - video fps multiplier
- Lower `maxOutputTokens` from `768` to a more conversational ceiling such as `384` or `512`.
- Trim the connect-time prompt payload:
  - compact `SYSTEM_PROMPT`
  - shrink `TOOL_SILENCE_POLICY`
  - move non-essential avatar baseline text out of the connect-time instruction when possible

Expected outcome:

- Less setup-time payload.
- Faster first response.
- Lower risk that heavy configuration contributes to 1011-style failures.

## Phase 2: Remove Latency Sources That Do Not Improve Call Quality

### 4. `src/hooks/useSessionManager.ts`

Proposed changes:

- Replace the current heartbeat behavior with a pause/resume strategy:
  - when the mic is effectively paused for >1 second, send `audioStreamEnd()` once
  - do not keep sending suppressed chunks every 3 seconds
  - resume by sending real audio once the user speaks again
- If a keepalive is still required after testing, use one precomputed zero chunk, not repeated `atob`/`btoa` work.
- Keep the assistant echo-block logic, but separate it from connection keepalive logic.

Expected outcome:

- Less unnecessary upstream audio traffic.
- Lower VAD confusion risk.
- Lower quota/resource pressure.
- Cleaner "assistant stops / user starts" turn behavior.

### 5. `src/lib/audio-streamer.ts`

Proposed changes:

- Replace `shift()`-based queue operations with an indexed queue or ring buffer.
- Add internal counters for:
  - queue depth
  - underruns
  - dropped chunks
- Expose those counters to debug logs or telemetry.

Expected outcome:

- Lower client-side playback jitter.
- Less array churn during audio playback.
- Easier diagnosis of whether latency is server-side or browser-side.

### 6. `src/hooks/useAudioProcessor.ts`

Proposed changes:

- Keep AudioWorklet as the preferred path.
- Treat `ScriptProcessorNode` as legacy fallback only, and consider gating/removing it if target browsers allow.
- Precompute or pool common silence/PCM conversion buffers.
- Add lightweight timing telemetry:
  - chunk captured
  - chunk forwarded
  - chunk scheduled for playback
  - playback complete

Expected outcome:

- Lower CPU and GC churn on the client.
- Better evidence when tuning audio latency.

### 7. `src/hooks/useWebcam.ts`

Proposed changes:

- Make video sending adaptive by native-audio profile:
  - `full`: current 1 FPS
  - `stable`: 0.5 to 1 FPS, with short pauses allowed during recovery windows only
- Allow temporary camera-stream pause during reconnect/recovery windows.
- Keep canvas reuse, but add basic telemetry for send rate and skipped frames.

Expected outcome:

- Better survival under multimodal load.
- Lower chance of resource-exhaustion-driven instability.
- More predictable behavior during reconnects.

## Phase 3: Make The Changes Safe To Maintain

### 8. `src/app/page.tsx`

Proposed changes:

- Extract tool bindings into dedicated hooks/modules:
  - `usePersonaToolBindings`
  - `useTranscriptBridge`
  - `useEndCallCoordinator`
- Keep the page focused on layout and orchestration.
- Add a tiny internal status indicator for:
  - current native-audio feature profile
  - recovering/degraded state

Expected outcome:

- Safer future edits to stability logic.
- Easier debugging without digging through a 699-line page.

### 9. `src/app/api/token/route.ts`

Proposed changes:

- Replace `console.error` with structured logging.
- Add request duration logging for token issuance.
- Add error classification:
  - missing env
  - upstream auth/token failure
  - quota/rate failure
  - unexpected server error
- Keep token semantics the same unless measurement shows token TTL is a real startup bottleneck.

Expected outcome:

- Faster diagnosis of startup failures.
- Clear separation between token-path issues and websocket-path issues.

### 10. `src/lib/env.ts`

Proposed changes:

- Add typed env validation rather than returning raw string/null only.
- Fail early on missing or malformed env in server boot paths.

Expected outcome:

- Fewer ambiguous startup failures.
- Cleaner operational behavior in deployment.

## Testing And Measurement Plan

### 11. `src/__tests__/unit/useGeminiLive.test.ts`

Add tests for:

- correct transcript routing for `inputTranscription` and `outputTranscription`
- no model switch during degradation
- 1011 -> retry current mode -> stable flow with no tool/search removal
- `goAway` handling
- reset of `lastCloseCodeRef` on fresh session

Also fix:

- current React `act(...)` warnings by wrapping async connect/open transitions correctly

Expected outcome:

- stability logic becomes regression-resistant
- test output becomes cleaner and easier to trust

### 12. `src/__tests__/unit/useSessionManager.test.ts`

Add tests for:

- `audioStreamEnd()` pause/resume behavior replacing repeated heartbeat chunks
- reconnect backoff + `full` -> `stable` flow
- video-session rollover behavior

Expected outcome:

- reconnect and call-feel logic become testable without live API dependency

### 13. `src/__tests__/e2e/gemini-latency.test.ts`

Proposed changes:

- Keep this suite, but make it opt-in.
- Benchmark `full` versus `stable` instead of model fallback.
- Run multiple samples and summarize median/p95 instead of relying on one run.
- Record:
  - connect latency
  - first audio latency
  - local tool RTT
  - reconnect recovery time
  - camera-on session rollover time

Expected outcome:

- latency tuning becomes actionable instead of anecdotal
- measurements align with the actual production strategy

### 14. `package.json` and `vitest.config.ts`

Proposed changes:

- Split test commands:
  - `test:unit`
  - `test:integration`
  - `test:live`
  - `bench:live`
- Keep `test:run` deterministic by default.

Expected outcome:

- developers can run fast local checks without accidentally hitting live Gemini
- live benchmarking remains available when intentionally requested

### 15. `src/__tests__/integration/system-health.test.ts` and `src/__tests__/setup.ts`

Proposed changes:

- Stop presenting mocked checks as true integration tests.
- Either:
  - rename them as mocked health checks, or
  - rewrite them to validate real runtime wiring

Expected outcome:

- clearer confidence level from the test suite
- less false assurance

## Recommended Execution Order

### Wave 1: stability-critical

1. `src/hooks/useGeminiLive.ts`
2. `src/hooks/useSessionManager.ts`
3. `src/lib/constants.ts`
4. `src/__tests__/unit/useGeminiLive.test.ts`
5. `src/__tests__/unit/useSessionManager.test.ts`

Goal of Wave 1:

- same model always
- same core tools always
- no transcript bug
- no naive 1011 retry loop
- only `full` and `stable`
- camera sessions recover/rotate cleanly

### Wave 2: latency-critical

1. `src/lib/audio-streamer.ts`
2. `src/hooks/useAudioProcessor.ts`
3. `src/hooks/useSessionManager.ts`
4. `src/hooks/useWebcam.ts`
5. `src/__tests__/e2e/gemini-latency.test.ts`

Goal of Wave 2:

- lower CPU overhead
- lower first-audio variance
- less multimodal resource pressure

### Wave 3: maintainability and ops

1. `src/app/page.tsx`
2. `src/app/api/token/route.ts`
3. `src/lib/env.ts`
4. `package.json`
5. `vitest.config.ts`
6. `src/__tests__/integration/system-health.test.ts`

Goal of Wave 3:

- easier future iteration
- cleaner test and observability story

## Expected End State

If this plan is executed well, the user-visible behavior should change in these ways:

- faster connect and faster first reply
- fewer "random" websocket drops
- fewer reconnect loops after 1011-style failures
- cleaner interruption behavior
- no model downgrade away from native audio
- no recovery path that guts core search/tool intelligence
- camera sessions feel deliberate rather than fragile
- benchmark numbers become easier to trust and compare over time

## Practical Recommendation

Do not start by refactoring everything.

Start with the smallest set of changes that directly change call feel:

1. fix transcript routing
2. keep the model fixed to native audio in both modes
3. make 1011 recovery `full` -> `stable`, not model-based and not tool-stripping
4. replace heartbeat traffic with `audioStreamEnd()` pause/resume behavior
5. trim connect-time config and prompt size
6. add proactive video-session rollover

Those changes should produce the biggest stability and latency wins before any broader cleanup.
