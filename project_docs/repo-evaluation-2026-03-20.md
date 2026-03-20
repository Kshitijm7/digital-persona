# Repo Evaluation Report

Date: 2026-03-20
Project: `digital-persona`
Scope: repo-wide evaluation with emphasis on architecture quality, maintainability, latency, Gemini Live API reliability, and WebSocket close/error handling including 1011-class failures.

## Method

- Read the main runtime path: `src/app/page.tsx`, `src/hooks/useGeminiLive.ts`, `src/hooks/useSessionManager.ts`, `src/hooks/useAudioProcessor.ts`, `src/hooks/useWebcam.ts`, `src/lib/audio-streamer.ts`, `src/app/api/token/route.ts`, `src/lib/constants.ts`.
- Reviewed bundled Gemini protocol/reference docs in `project_docs/gemini_api/`.
- Spawned two explorer subagents: one for repo architecture and one for Gemini Live/WebSocket/latency/error paths.
- Ran verification commands locally:
  - `npm.cmd run typecheck`
  - `npm.cmd run lint`
  - `npm.cmd run test:run`

## Verification Snapshot

- `typecheck`: pass
- `lint`: pass
- `test:run`: pass, `10` files / `130` tests / about `205.7s`
- Important caveat: the default Vitest run executes live Gemini E2E and latency benchmarks when a real `GEMINI_API_KEY` is present in `.env.local` (`src/__tests__/e2e/gemini-api.test.ts:28-35`, `src/__tests__/e2e/gemini-latency.test.ts:235-243`).
- Test output also produced quality warnings:
  - repeated React `act(...)` warnings from `src/__tests__/unit/useGeminiLive.test.ts`
  - `THREE.WARNING: Multiple instances of Three.js being imported`
- The test run refreshed `src/__tests__/e2e/latency_results.md` with current live-benchmark data.

## Executive Summary

This project has a strong core idea and a fundamentally correct latency-oriented architecture: the browser gets an ephemeral token from a small Next.js route and then connects directly to Gemini Live, while the avatar, audio, webcam, and rendering stack remain client-side (`src/app/api/token/route.ts:38-72`, `src/hooks/useGeminiLive.ts:625-751`).

The main problems are no longer basic plumbing problems. They are now production-hardening problems:

1. transcript correctness is broken in the Live message handler
2. 1011/1012/1013 recovery is too optimistic and can loop on the same bad config
3. video-session lifecycle limits are not handled proactively
4. the default session config is too feature-heavy for a stable "baseline"
5. too much protocol, UI, and media logic is concentrated in a few very large files
6. the current test strategy gives both good signal and false confidence at the same time
7. internal docs and benchmark docs have already drifted away from the code

The repo is in a good state for continued development, but not yet at the point where low-latency Gemini Live behavior can be called robust under real-world failure conditions.

## What Is Strong

- Architecture direction is good. Browser -> ephemeral token -> direct Gemini Live WebSocket is the right shape for latency-sensitive realtime UX (`README.md:39-58`, `src/app/api/token/route.ts:38-72`, `src/hooks/useGeminiLive.ts:625-751`).
- Deployment settings are materially better than older docs suggest. Cloud Run is already configured with `--memory=1Gi`, `--concurrency=25`, `--min-instances=1`, `--max-instances=10`, `--cpu-boost`, and `--no-cpu-throttling` (`.github/workflows/deploy.yml:103-110`).
- The codebase has meaningful resilience work already in place: token prefetch, session resumption handle capture, compatibility downgrade on 1008, tool timeouts, reconnect attempts, hot-path log throttling, and cleanup guards (`src/hooks/useGeminiLive.ts`, `src/hooks/useSessionManager.ts`, `src/hooks/useAudioProcessor.ts`).
- Static quality gates are passing today: TypeScript and ESLint are clean.
- The repo contains real benchmark infrastructure, not just claims. The latency suite is expensive and noisy, but it does generate current numbers (`src/__tests__/e2e/gemini-latency.test.ts`, `src/__tests__/e2e/latency_results.md`).

## Highest-Priority Findings

### P0. Transcript routing is incorrect

Evidence:

- `src/hooks/useGeminiLive.ts:408-409` sends `serverContent.outputTranscription.text` to `onUserTranscript`
- bundled protocol docs separate `inputTranscription` and `outputTranscription` (`project_docs/gemini_api/gemin_live_api_doc.md:191-192`)
- the session enables both `outputAudioTranscription` and `inputAudioTranscription` (`src/hooks/useGeminiLive.ts:663-664`)

Impact:

- user and assistant transcript streams are crossed
- chat history can become semantically wrong
- any future summarization, memory, analytics, or moderation built on transcript roles will be corrupted

Recommendation:

- map `serverContent.inputTranscription` to the user transcript callback
- map `serverContent.outputTranscription` to the assistant transcript callback
- add a dedicated protocol-shape unit test for both fields

### P0. 1011/1012/1013 failures are retried with the same heavy config

Evidence:

- unsupported-operation downgrade only happens on `1008` in `src/hooks/useGeminiLive.ts:717-730`
- `1011`, `1012`, and `1013` are only marked "retryable" in `src/hooks/useGeminiLive.ts:733-748`
- the reconnect loop in `src/hooks/useSessionManager.ts:280-376` reconnects without degrading feature flags

Why this matters for 1011:

- a 1011 close generally means the server hit an internal condition and closed the session
- in this repo, reconnecting with the exact same feature-heavy setup can recreate the same failure
- this is especially risky because the session config turns on search, proactivity, affective dialog, dual transcription, compression, and resumption simultaneously (`src/hooks/useGeminiLive.ts:630-670`)

Recommendation:

- treat repeated `1011/1012/1013` as a degradation signal, not only a retry signal
- use a staged fallback policy such as:
  - retry 1: disable search
  - retry 2: disable proactivity + affective dialog + output transcription
  - retry 3: drop to minimal profile / alternate model
- add exponential backoff with jitter and a circuit breaker after repeated internal-error closes

### P0. Video session limits and server shutdown signals are not handled proactively

Evidence:

- webcam frames stream continuously at `1 FPS` from `src/hooks/useWebcam.ts:108-123`
- the UI only tracks elapsed time via `useSessionTimer` (`src/hooks/useSessionTimer.ts:9-48`)
- bundled docs state: audio-only sessions are limited to 15 minutes, audio+video sessions to 2 minutes (`project_docs/gemini_api/official_docs.md:998-1002`)
- bundled docs also list a `goAway` server message (`project_docs/gemini_api/gemin_live_api_doc.md:208`)
- there is no `goAway` branch in `src/hooks/useGeminiLive.ts`

Impact:

- long webcam sessions can hit predictable server-side disconnects
- reconnects happen reactively instead of cleanly rotating before expiry
- this raises the chance of 1011/1006-style user-visible session drops

Recommendation:

- add a proactive rollover timer for video sessions before the 2-minute limit
- preserve session state through session resumption
- handle `goAway` explicitly and reconnect before the hard drop

### P0. Observability is not yet good enough for realtime failure analysis

Evidence:

- token route is minimal and uses `console.error` on failure (`src/app/api/token/route.ts:67-72`)
- env validation is only a trim-and-return helper (`src/lib/env.ts:1-7`)
- no request/session metrics are emitted for token issuance, connect latency, first audio byte, tool RTT, close-code frequencies, or quota usage
- bundled docs note `usageMetadata` can be present on server messages (`project_docs/gemini_api/gemin_live_api_doc.md:202-209`), but the client ignores it

Impact:

- hard to distinguish malformed client traffic from quota issues from server instability
- hard to know whether 1011 spikes correlate with search, video, prompt size, or tool usage

Recommendation:

- add structured metrics for:
  - token issuance duration and failure count
  - connect start -> open latency
  - first user input -> first assistant audio latency
  - tool call receive -> tool response send latency
  - close code counts and reasons
  - retry/degrade path taken
  - optional usage/quota metadata when available

## Major Improvement Areas

### 1. Default session config is too heavy for a stable baseline

Evidence:

- session config enables audio response, voice config, search tools, proactivity, affective dialog, both transcriptions, automatic VAD, context compression, and resumption in one connect (`src/hooks/useGeminiLive.ts:630-670`)
- tool bundle defaults are full functions plus Google Search (`src/lib/constants.ts:206-213`)
- official docs note proactivity and affective dialog require `v1alpha` (`project_docs/gemini_api/official_docs.md:537-567`)

Measured impact from the latest benchmark artifact:

- connection with tools: `484ms` (`src/__tests__/e2e/latency_results.md:9-12`)
- connection with functions + search: `186ms` in this single run, but still a heavier configuration (`src/__tests__/e2e/latency_results.md:9-12`)
- full production audio config: `Timeout/Failed` (`src/__tests__/e2e/latency_results.md:34-41`)
- tool call with all 7 tools: `2397ms` vs `2040ms` with 1 tool (`src/__tests__/e2e/latency_results.md:26-32`)

Assessment:

- the app should have a "safe baseline" profile and then opt into advanced features
- this will reduce both latency variance and 1011-class instability

### 2. Hot-path browser work still contains avoidable cost

Evidence:

- webcam capture is interval-driven canvas draw + JPEG encode + base64 split (`src/hooks/useWebcam.ts:108-123`)
- mic forwarding sends a 3-second heartbeat during suppression (`src/hooks/useSessionManager.ts:148-154`, `src/hooks/useSessionManager.ts:184-193`)
- synthesized silence is rebuilt with `atob`/`btoa` per heartbeat path (`src/hooks/useSessionManager.ts:190-191`)
- audio queue maintenance still uses `shift()` in `AudioStreamer` (`src/lib/audio-streamer.ts:67-69`, `src/lib/audio-streamer.ts:123-124`)
- audio capture still has a `ScriptProcessorNode` fallback (`src/hooks/useAudioProcessor.ts:155-225`)

Impact:

- extra CPU and GC pressure on the main thread
- higher frame-time jitter during speech/video
- more work during the exact paths where latency matters most

Recommendation:

- precompute and reuse a zero-audio heartbeat chunk
- reconsider whether heartbeat chunks are needed at all versus explicit activity/end signals
- move more encoding work off the main thread where possible
- replace `shift()` queue operations with an indexed ring buffer / deque pattern
- keep webcam/video "off" unless needed for a current task

### 3. Maintainability suffers from oversized, mixed-responsibility files

Approximate file sizes:

- `src/hooks/useGeminiLive.ts`: `821` lines
- `src/app/page.tsx`: `699` lines
- `src/hooks/useAudioProcessor.ts`: `531` lines
- `src/hooks/useSessionManager.ts`: `499` lines

Assessment:

- protocol handling, lifecycle, retry policy, state propagation, UI tool registration, media scheduling, and chat concerns are too entangled
- the code works, but future changes will be riskier and slower

Recommendation:

- extract explicit layers:
  - `live-session-machine`
  - `live-message-parser`
  - `tool-response-orchestrator`
  - `mic-forwarding-policy`
  - `assistant-playback-engine`
  - `page-level tool bindings`

### 4. Test strategy mixes useful signal with false confidence

Strengths:

- `useGeminiLive` unit coverage is meaningful (`src/__tests__/unit/useGeminiLive.test.ts`)
- the repo has real Live API smoke and latency tests (`src/__tests__/e2e`)

Problems:

- the "integration" health test is mostly mocked, not real integration
- `src/__tests__/setup.ts:20-21` injects placeholder env vars
- `src/__tests__/setup.ts:71-86` mocks fetch for `/avatar-transformed.glb`
- `src/__tests__/integration/system-health.test.ts:10-14` only checks the mocked key looks like `AIza...`
- default `vitest run` will hit live Gemini when a real key exists (`src/__tests__/e2e/gemini-api.test.ts:28-35`, `src/__tests__/e2e/gemini-latency.test.ts:235-243`)

Impact:

- local/CI runs can become slow, expensive, and flaky
- some tests validate the harness more than the product
- live benchmarks are useful, but they should not be mixed into a default deterministic suite

Recommendation:

- split tests into:
  - deterministic unit/protocol tests
  - mocked integration tests
  - opt-in live smoke tests
  - opt-in benchmark suite
- fix the React `act(...)` warnings in `useGeminiLive` tests
- move live benchmarks to a separate script/job gated by an explicit env var

### 5. Internal docs and reports have already drifted

Evidence:

- existing audit says `TOOL_HANDLER_TIMEOUT_MS` is `4000ms`, but code is `8000ms` (`project_docs/latency-audit-report.md:22`, `src/hooks/useGeminiLive.ts:24`)
- existing audit says Cloud Run still has `min-instances=0`, `max-instances=1`, `concurrency=80`, but deployment now uses `min-instances=1`, `max-instances=10`, `concurrency=25` (`project_docs/latency-audit-report.md:31`, `.github/workflows/deploy.yml:103-108`)
- the benchmark report in `src/__tests__/e2e/latency_results.md` is updated by test execution, but internal docs are not synchronized

Impact:

- internal decision-making can be based on obsolete assumptions
- developers may optimize or debug the wrong thing

Recommendation:

- keep one canonical architecture doc
- keep one canonical performance report
- regenerate performance docs from scripts instead of editing them manually

### 6. Server-side hardening is still thin

Evidence:

- token route is functionally correct but minimal (`src/app/api/token/route.ts:38-72`)
- env helper only returns a string or null (`src/lib/env.ts:1-7`)
- failures use raw `console.error` rather than the structured logger (`src/app/api/token/route.ts:68`)

Recommendation:

- add typed env validation at boot
- use structured server logging in the route
- capture token creation failures by class: auth, quota, transient upstream, malformed request
- add abuse/rate guardrails if this route will be public

## Latency Observations From Latest Live Run

These are useful directional signals, not stable p95 values.

- Best observed connection latency in the refreshed artifact was `149ms` with transcription enabled (`src/__tests__/e2e/latency_results.md:9-12`)
- Full prompt and ~1500-char prompt tool-call tests timed out/failed (`src/__tests__/e2e/latency_results.md:18-19`)
- Full production audio config timed out/failed (`src/__tests__/e2e/latency_results.md:38`)
- Per-tool latency is currently non-trivial even for local handlers:
  - `end_call`: `1457ms`
  - `set_expression`: `2030ms`
  - `switch_camera`: `2304ms`
  - `trigger_animation`: `2314ms`
  - `display_text`: `3313ms`
  - evidence: `src/__tests__/e2e/latency_results.md:43-51`
- Multi-turn performance degrades from turn 1 (`2624ms`) to turn 2 (`3829ms`) (`src/__tests__/e2e/latency_results.md:71-76`)
- `gemini-2.0-flash-live-001` tool-call benchmark timed out/failed, while the current native-audio model produced a `2307ms` tool-call result (`src/__tests__/e2e/latency_results.md:62-69`)

## Recommended Roadmap

### Immediate

1. Fix transcript routing.
2. Add 1011/1012/1013 degradation logic plus exponential backoff and a retry budget.
3. Implement proactive video-session rollover and `goAway` handling.
4. Add structured metrics for close codes, connect/open latency, first audio, tool RTT, and token failures.

### Near Term

1. Introduce a "safe baseline" Live config and gate advanced features behind progressive enablement.
2. Refactor the session lifecycle into a reducer/state machine.
3. Remove hot-path inefficiencies: precomputed silence, queue index instead of `shift()`, less base64 churn, less always-on webcam work.
4. Separate live E2E/benchmark runs from default unit/integration runs.

### Medium Term

1. Consolidate architecture and benchmark docs into generated or canonical sources.
2. Add server-side typed config/env validation and structured token-route logging.
3. Track quota/usage metadata and close-code trends over time to correlate 1011s with feature mixes.

## Final Assessment

The project is promising and technically ambitious. The direction is correct, the deployment posture is improving, and the repo is already instrumented enough to iterate. The next phase should not be "add more capabilities first." It should be "stabilize the Gemini Live protocol layer and simplify the hot path." That is where the biggest gains are now: lower latency variance, fewer 1011/internal-error drops, cleaner maintainability, and more trustworthy test signal.

## References

- `src/app/api/token/route.ts`
- `src/hooks/useGeminiLive.ts`
- `src/hooks/useSessionManager.ts`
- `src/hooks/useAudioProcessor.ts`
- `src/hooks/useWebcam.ts`
- `src/lib/audio-streamer.ts`
- `src/lib/constants.ts`
- `src/__tests__/e2e/latency_results.md`
- `src/__tests__/e2e/gemini-api.test.ts`
- `src/__tests__/e2e/gemini-latency.test.ts`
- `src/__tests__/integration/system-health.test.ts`
- `src/__tests__/setup.ts`
- `project_docs/gemini_api/gemin_live_api_doc.md`
- `project_docs/gemini_api/official_docs.md`
- Official Google doc: https://ai.google.dev/gemini-api/docs/live-tools
