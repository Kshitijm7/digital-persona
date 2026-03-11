# Realistic Viseme Lip-Sync Alignment Guide (March 2026)

## Goal
Reduce "mouth not matching audio" artifacts in realtime avatar playback by combining:
- audio-clock alignment
- state-aware viseme stabilization
- short-window coarticulation
- faster onset response

## Research Snapshot (What Matters in Practice)

1. **Audio clock alignment is required for A/V sync**
- Web Audio `AnalyserNode` data and render timing are not the same as what the user hears on speakers.
- MDN + Web Audio spec recommend using `outputLatency` and `getOutputTimestamp()` when synchronizing non-audio visuals.
- Practical implication: compensate viseme timing against output-device latency, not only render-frame timing.

2. **Context-dependent viseme prediction improves realism**
- Interspeech 2025 (Phonetic Context-Dependent Viseme work) reports better lip-sync and realism using short temporal context and multiscale features.
- Reported gains include improvements on common sync/naturalness metrics (LSE-C, LSE-D, FVD) over strong baselines.
- Practical implication: blend neighboring visemes (coarticulation) instead of hard one-viseme-at-a-time switching.

3. **Realtime systems must budget latency explicitly**
- A 2024 realtime speech-driven avatar paper reports stable realtime behavior with explicit frame scheduling and bounded per-frame latency.
- Practical implication: use a deterministic timing path (scheduled queue + monotonic audio clock), then keep morph transitions state-aware (vowel/plosive/fricative).

4. **Industry TTS pipelines use timestamped events**
- Amazon Polly speech marks and Google Cloud timepoints expose time metadata for precise animation triggers.
- Practical implication: when native phoneme/viseme timestamps are unavailable, emulate that behavior with an audio-time queued viseme scheduler.

5. **RPM integration details still matter**
- Ready Player Me expects Oculus viseme blendshapes and supports generated lip-sync sequences in OVR-compatible workflows.
- Practical implication: ensure native viseme names exist and run ARKit fallback only when visemes are missing.

## Changes Implemented In This Repository

### 1) `src/lib/audio-streamer.ts`
- Switched playback level signal from frequency-bin average to **time-domain RMS**, which reacts faster to speech onset.
- Tuned analyser smoothing (`smoothingTimeConstant = 0.2`) for lower lag.

### 2) `src/hooks/useAudioProcessor.ts`
- Tuned playback analyser for viseme responsiveness:
  - `smoothingTimeConstant = 0.18`
  - tighter dB window (`minDecibels = -90`, `maxDecibels = -10`)
- Initialized `wawa-lipsync` with lower history latency (`historySize = 6`) and shorter viseme persistence (`maxVisemeDuration = 85ms`).
- Kept analyzer/context patching so viseme detection uses the exact playback graph.

### 3) `src/lib/lipsync-engine.ts`
- Added **audio-clock-aware viseme scheduler**:
  - reads `AudioContext.getOutputTimestamp()` when available
  - falls back to `currentTime`
  - applies clamped output-latency compensation (ratio-based)
- Added **viseme stabilization/hysteresis** by speech state (vowel/plosive/fricative/silence).
- Added **pending viseme queue + anticipation window** for short coarticulation before transitions.
- Kept RPM-native viseme path first; ARKit mouth mapping fallback remains supported.

### 4) `src/components/canvas/Avatar.tsx`
- Replaced single lerp with **fast attack / slower release** smoothing for audio level.
- Lip-sync now uses `max(rawLevel, smoothedLevel)` to preserve quick consonant onsets while remaining stable.

### 5) `src/components/chat/ConfigPanel.tsx` + `src/store/useLipSyncStore.ts`
- Added runtime **Lip Sync Tuning** controls for:
  - clock compensation ratio / clamp
  - anticipation window
  - anticipation weight
  - silence hold
  - state-specific switch intervals
  - state-specific viseme lambdas
  - analyser smoothing + viseme persistence
  - adaptive noise-floor thresholding
- Added one-click presets: **Low Latency**, **Balanced**, **Noisy Room**.
- Added persistent in-memory tuning store so values apply instantly during live sessions.
- Persisted settings in `src/config/camera.json` under `lipSyncTuning`.

## Tuning Guide

If mouth moves **too early**:
- decrease `CLOCK_COMPENSATION_RATIO` in `lipsync-engine.ts`
- or lower `MAX_CLOCK_COMPENSATION_MS`

If mouth moves **too late**:
- increase `CLOCK_COMPENSATION_RATIO` modestly (small increments)
- reduce analyzer smoothing and/or viseme persistence

If motion is **jittery**:
- increase minimum switch intervals in `stabilizeDetectedViseme`
- increase anticipation window slightly

If motion is **robotic/snap-like**:
- increase anticipation weight/window a bit
- reduce plosive lambda only if closures look too abrupt

## Validation Checklist

1. Capture 60fps screen + reference audio output.
2. Test short words with hard plosives (`p`, `b`, `m`), fricatives (`f`, `s`, `sh`), and open vowels.
3. Compare before/after on:
- onset alignment
- plosive closure timing
- vowel continuity
- end-of-phrase decay
4. Run at least one noisy/low-level audio case to confirm stability.

## Sources

- MDN: AudioContext `outputLatency`  
  https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency
- MDN: AudioContext `getOutputTimestamp()`  
  https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp
- Web Audio API Spec (timing note around output latency usage)  
  https://webaudio.github.io/web-audio-api/
- Interspeech 2025 paper (phonetic context-dependent viseme generation)  
  https://arxiv.org/abs/2507.20568
- Interspeech 2025 project page (metrics/examples)  
  https://yileiliang.github.io/LPCV/
- ACL/ICNLSP 2024 realtime avatar paper PDF  
  https://aclanthology.org/2024.icnlsp-1.13.pdf
- Ready Player Me blendshapes docs  
  https://docs.readyplayer.me/ready-player-me/api-reference/avatars/morph-targets/apple-arkit
- Ready Player Me OVR LipSync sequence docs  
  https://docs.readyplayer.me/ready-player-me/integration-guides/unity/setup-for-xr-beta/setup-oculus-lipsync
- Amazon Polly speech marks (viseme timestamps)  
  https://docs.aws.amazon.com/polly/latest/dg/using-speechmarks.html
- Google Cloud TTS timepoints  
  https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
