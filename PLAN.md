# Dynamic Avatar Realism Plan (Live API + Idle Baselines)

## 1) Why this plan exists

The project goal is not a static avatar with fixed tuning. The goal is a **smart, adaptive digital persona** that:

- looks alive when disconnected,
- reacts to model intent during live sessions,
- and remains stable/realistic under latency + noisy inputs.

Current status: we now have rich config blocks wired into runtime, but they are mostly baseline-driven (`scene.json` + context). This plan upgrades the system to **API-driven control loops** while keeping safe defaults.

---

## 2) Current implementation snapshot

### Implemented foundation

- Extended config surface is available in runtime:
  - `emotionControl`, `ocularTuning`, `meshPostProcessing`, `headDynamics`
  - `anatomicalPostProcessing`, `visemeOverrides`, `aiStyleControl`, `meshConfig`
- Blocks are loaded from `scene.json`, propagated through `SceneConfigContext`, and applied in `Avatar` engines.
- Persistence/merge supports new blocks via `/api/scene` route.

### Remaining architectural gap

- Live model does not yet steer these blocks directly.
- Tool-calling currently controls expression/animation/persona/text, but not control blocks.
- No formal two-layer control state (`baseline + sessionOverrides`).

---

## 3) Target architecture (what “best” looks like)

### Control Layers

1. **Baseline Layer (persistent)**
   - Source: `scene.json`
   - Purpose: startup defaults + safe fallback
   - Scope: always available (including no websocket session)

2. **Session Layer (ephemeral, live-controlled)**
   - Source: Live API tool-calls + runtime heuristics
   - Purpose: per-turn behavioral adaptation (emotion intensity, blink behavior, viseme emphasis, head dynamics)
   - Scope: active only while connected

3. **Effective Layer (computed)**
   - `effective = clamp(merge(baseline, sessionOverrides))`
   - Read by `Avatar` each frame

### Runtime state model

- Add transient store for session overrides (do not persist to `scene.json`):
  - `sessionAvatarOverrides`
  - `overrideTTLms` and decay logic
- Reset policy:
  - on disconnect → clear overrides
  - on turn complete → decay selected fields gradually

---

## 4) Non-session “ideal alive” behavior

When websocket is disconnected, avatar should not freeze or look dead.

### Offline ideal profile (default behavior)

- Breathing: enabled, subtle
- Blink: biologically plausible interval + slight jitter
- Saccades: low-to-moderate amplitude
- Head idle: subtle bounded motion
- Emotion: neutral-to-warm baseline (low intensity)
- Lip posture: slightly closed rest state (no speaking artifacts)

### Implementation rule

- If `session.status !== "connected"`:
  - use baseline `scene.json` + offline profile adjustments
  - no model-driven overrides
- If connected:
  - activate session override pipeline

---

## 5) Live API alignment plan

## 5.1 Add control tools to Gemini toolset

Introduce tool declarations:

- `set_avatar_controls`
- `set_emotion_state`
- `set_ocular_state`
- `set_lipsync_profile`
- `reset_avatar_controls`

Each tool accepts **partial patch payloads** only (no full config replacement).

### Tool payload constraints

- Enforce numeric bounds server/client side
- Reject invalid enum values
- Normalize arrays (`pitchRange`, `yawRange`) and enforce min <= max
- Ignore unknown keys

## 5.2 Register handlers in app orchestration

- Register these handlers in page-level tool registry (`page.tsx`)
- Write handlers to session override store/context (not directly to persistent baseline)
- Return sanitized applied payload in `sendToolResponse`

## 5.3 Bootstrap model with current avatar state on connect

At session connect, send a compact initial state message to model:

- selected avatar profile
- effective baseline constraints
- allowed adjustment ranges
- realism policy (avoid extreme/unreal motions)

This can be injected as:

- dynamic session instruction segment, and/or
- first-turn `sendClientContent` context packet

Goal: the model knows the avatar’s biomechanical envelope before generating tool calls.

---

## 6) File-by-file implementation plan

## Phase A — State architecture (Completed)

1. `src/hooks/SceneConfigContext.tsx`
- [x] Keep persistent baseline config as-is
- [x] Add `getEffectiveAvatarControls(sessionOverrides)` helper

2. `src/store` (new)
- [x] Add `useAvatarRuntimeStore.ts`:
  - `sessionOverrides`
  - `applySessionPatch`
  - `clearSessionOverrides`
  - `decayOverrides`

3. `src/components/canvas/Scene.tsx`
- [x] Compute effective controls from baseline + runtime overrides
- [x] Pass effective values to `Avatar`

## Phase B — Live API bridge (Completed)

4. `src/lib/constants.ts`
- [x] Add tool declarations and parameter schemas for new control tools

5. `src/app/page.tsx`
- [x] Register new tool handlers
- [x] Route patches to runtime override store
- [x] Keep existing expression/animation tools intact

6. `src/hooks/useGeminiLive.ts`
- [x] On connect, send initial avatar state packet
- [x] On disconnect/interruption, enforce cleanup hooks for ephemeral control state

## Phase C — Safety and realism guardrails

7. `src/lib/avatar-control.types.ts`
- Add clamp helpers and schema guards:
  - `sanitizeControlPatch`
  - `sanitizeEffectiveControls`

8. `src/lib/*engine.ts`
- Read effective controls only
- Apply smooth transitions (damp/lerp) for overrides to avoid snapping

## Phase D — Persistence boundaries

9. `src/app/api/scene/route.ts`
- Persist baseline only
- Explicitly exclude session-only override payloads

---

## 7) Priority order (no overkill)

## P0 (must-have) - Completed

- [x] Runtime override store
- [x] New tool declarations + handlers
- [x] Effective merge layer in `Scene`
- [x] Connect bootstrap state packet
- [x] Disconnect cleanup

## P1 (strong realism gains) - Completed

- [x] TTL/decay for emotion and style fields
- [x] Adaptive heuristics from audio confidence (speaking speed/noise)
- [x] Hysteresis for control switching

## P2 (advanced)

- Per-speaker adaptation profiles (fast talker, soft speaker, noisy room)
- Auto-suggested control profiles from telemetry

---

## 8) Testing and validation plan

## Unit

- Payload sanitization and clamp bounds
- Merge precedence: baseline < sessionOverrides
- TTL decay behavior

## Integration

- Tool call -> handler -> runtime store -> avatar receives effective controls
- Disconnect resets session overrides while preserving baseline

## Visual regression checklist

- No session: avatar remains alive (blink/saccade/idle head)
- Connected: model tool call visibly changes behavior within one turn
- Turn complete: controls settle smoothly, no snapping/jitter

---

## 9) Observability and debuggability

- Structured logs for:
  - incoming control tool payload
  - sanitized payload
  - applied effective controls
  - override reset/expiry events
- Optional debug panel section:
  - baseline vs runtime override vs effective values

---

## 10) Rollout strategy

1. Ship behind feature flag: `ENABLE_DYNAMIC_AVATAR_CONTROLS`
2. Start with `set_emotion_state` + `set_avatar_controls` only
3. Validate stability and latency impact
4. Expand to ocular/lipsync fine controls

---

## 11) Definition of done

- Avatar remains convincingly alive when disconnected.
- During live session, model can adjust controls via tool-calls in real time.
- Adjustments are bounded, smooth, and reversible.
- Baseline config remains stable and persistent; session overrides are ephemeral.
- No regressions in session connection, interruption, or lip-sync timing.

---

## 12) Immediate next implementation step

Implement **Phase C + Phase D**:

- `sanitizeControlPatch` and bounds handling in `avatar-control.types.ts`
- Read effective controls in engines and apply damp/lerp transitions.
- Ensure API routes ignore session-only overrides when saving to persistent JSON.
