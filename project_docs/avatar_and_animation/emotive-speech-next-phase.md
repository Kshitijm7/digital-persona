# Current State of Implementation

## ✅ Completed

| File | Status | What's Live |
|---|---|---|
| `emotive-speech.json` | ✅ New | 3 modes (broadcast/intimate/energetic), shared ARKit viseme map, all tuning externalized |
| `emotive-speech-config.ts` | ✅ New | Typed loader, `getModeTuning()`, `getArkitVisemeMap()`, per-mode caching |
| `audio-streamer.ts` | ✅ Updated | Config-driven, `setMode()`, `isPlaying`, `destroy()`, `updateVoicePresence()` |
| `emotion-engine.ts` | ✅ Updated | Config-driven, `setMode()`, layered targets struct, data-driven states + keywords |
| `lipsync-engine.ts` | ✅ Updated | Config-driven, `setMode()`, ARKit map from config, `clockMs` fixed, breath extracted |
| `avatars.ts` | ✅ Updated | `ensureEmotiveMorphTargets`, `detectCapabilities()`, cached registry |

## ❌ Not Yet Wired — Integration Gaps

These are the places where the new capabilities exist but **nothing calls them yet**:

### 1. No Mode State Store

The three engines each have `setMode()` but nothing tracks or persists the active mode.

```typescript
// src/store/useEmotiveSpeechStore.ts — NEEDS TO EXIST

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EmotiveSpeechMode } from "@/lib/emotive-speech-config";
import { EMOTIVE_SPEECH_MODES, DEFAULT_MODE } from "@/lib/emotive-speech-config";

interface EmotiveSpeechStore {
  mode: EmotiveSpeechMode;
  setMode: (mode: EmotiveSpeechMode) => void;
}

export const useEmotiveSpeechStore = create<EmotiveSpeechStore>()(
  persist(
    (set) => ({
      mode: DEFAULT_MODE,
      setMode: (mode) => {
        if (EMOTIVE_SPEECH_MODES.includes(mode)) {
          set({ mode });
        }
      },
    }),
    {
      name: "emotive-speech-mode",
    },
  ),
);
```

### 2. Orchestration Hook Not Updated

Your `useFrame` loop (wherever it lives — likely `Avatar.tsx` or a custom hook) needs to:

```typescript
// BEFORE (what you probably have now):
const streamer = new AudioStreamer(audioContext, 24000);
const lipsyncEngine = new LipSyncEngine();
const emotionEngine = new EmotionEngine();

// AFTER (what it needs to be):
const { mode } = useEmotiveSpeechStore();

const streamer = new AudioStreamer(audioContext, 24000, mode);  // ← pass mode
const lipsyncEngine = new LipSyncEngine(mode);                  // ← pass mode
const emotionEngine = new EmotionEngine(mode);                   // ← pass mode
```

And mode changes need to propagate:

```typescript
// React to mode changes — NEEDS TO EXIST
useEffect(() => {
  streamerRef.current?.setMode(mode);
  lipsyncRef.current?.setMode(mode);
  emotionRef.current?.setMode(mode);
}, [mode]);
```

### 3. `destroy()` Not Called on Unmount

```typescript
// NEEDS TO EXIST in your Avatar cleanup:
useEffect(() => {
  return () => {
    streamerRef.current?.destroy();  // ← new, disconnects audio graph
  };
}, []);
```

### 4. `detectCapabilities()` Not Called After GLB Load

```typescript
// NEEDS TO EXIST after avatar model loads:
import { detectCapabilities } from "@/lib/avatars";

// In your GLB onLoad callback:
const head = nodes.Wolf3D_Head as THREE.SkinnedMesh;
if (head?.morphTargetDictionary) {
  const caps = detectCapabilities(head.morphTargetDictionary);
  if (!caps.hasOculusVisemes) {
    log.warn("Avatar missing Oculus visemes — using ARKit fallback lip sync");
  }
  if (!caps.hasEmotionTargets) {
    log.warn("Avatar missing emotion blendshapes — expressions will be limited");
  }
  if (caps.missingTargets.length > 0) {
    log.debug({ missing: caps.missingTargets }, "Missing morph targets");
  }
}
```

### 5. Tool Call Handler Not Mapping Modes

```typescript
// In your tool call handler — NEEDS TO BE ADDED:
case "update_persona_state": {
  const { mode } = args;
  const modeMap: Record<string, EmotiveSpeechMode> = {
    focus: "broadcast",
    casual: "intimate",
    presentation: "energetic",
  };
  if (mode && modeMap[mode as string]) {
    useEmotiveSpeechStore.getState().setMode(modeMap[mode as string]);
  }
  break;
}
```

### 6. `speechEnergy` Coupling — Verify Call Order

The lip sync engine sets `this.speechEnergy` and the emotion engine reads it via `options.speechLevel`. This works **only if lip sync runs first** in the frame loop. Verify your `useFrame`:

```typescript
// ✅ CORRECT ORDER:
useFrame((_, delta) => {
  lipsyncEngine.update(...);                    // 1. sets speechEnergy
  emotionEngine.update(..., {
    speechLevel: lipsyncEngine.speechEnergy,    // 2. reads it
  });
});

// ❌ WRONG ORDER:
useFrame((_, delta) => {
  emotionEngine.update(..., {
    speechLevel: lipsyncEngine.speechEnergy,    // stale by one frame
  });
  lipsyncEngine.update(...);
});
```

## Priority Checklist

```
Priority 1 — Wire it up (nothing works without these):
┌─────────────────────────────────────────────────────────┐
│ □ Create useEmotiveSpeechStore                          │
│ □ Pass mode to constructors in orchestration layer      │
│ □ Add useEffect for mode propagation via setMode()      │
│ □ Verify useFrame call order (lipsync → emotion)        │
│ □ Wire streamer.destroy() into unmount cleanup          │
└─────────────────────────────────────────────────────────┘

Priority 2 — Robustness:
┌─────────────────────────────────────────────────────────┐
│ □ Call detectCapabilities() after GLB load               │
│ □ Map update_persona_state tool → mode store             │
│ □ Add mode to session persistence (reconnect keeps mode) │
└─────────────────────────────────────────────────────────┘

Priority 3 — UX:
┌─────────────────────────────────────────────────────────┐
│ □ Mode selector UI (dropdown or segmented control)       │
│ □ Visual indicator of active mode                        │
│ □ Keyboard shortcut for mode cycling (dev/demo)          │
└─────────────────────────────────────────────────────────┘

Priority 4 — Expansion:
┌─────────────────────────────────────────────────────────┐
│ □ "narration" mode (audiobook, slow transitions)         │
│ □ "accessibility" mode (max clarity, exaggerated mouth)  │
│ □ Per-avatar mode overrides (some avatars suit modes)    │
│ □ Auto-mode from conversation analysis                   │
└─────────────────────────────────────────────────────────┘
```

## What I Need From You

To write the Priority 1 integration code, I need to see:

```
src/components/Avatar.tsx    (or wherever useFrame lives)
src/hooks/useGeminiSession.ts (or wherever tool calls are handled)
```

Those two files are where all the wiring happens. Everything else is self-contained and ready.