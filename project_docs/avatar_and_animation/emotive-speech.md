# Emotive Speech Modes — Complete Guide

## Available Modes

| Mode | Character | When to Use |
|---|---|---|
| **`broadcast`** | Polished, professional, podcast-quality | Default. General conversations, presentations, professional contexts |
| **`intimate`** | Softer, closer, whisper-friendly | Personal conversations, bedtime stories, ASMR-like, emotional support |
| **`energetic`** | Punchy, maximum articulation, expressive | Excitement, celebrations, teaching children, gaming, high-energy demos |

## What Each Mode Actually Changes

### Voice Chain (AudioStreamer)

```
                    broadcast       intimate        energetic
─────────────────────────────────────────────────────────────
Compressor threshold  -24 dB         -20 dB          -28 dB
Compressor ratio       3:1            2:1             4:1
Warmth (low-shelf)    +3dB @200Hz    +5dB @180Hz     +2dB @220Hz
Presence (hi-shelf)   +2dB @3.5kHz   +1dB @4kHz      +3.5dB @3kHz
─────────────────────────────────────────────────────────────
Result:               Clear, even     Warm, breathy   Crisp, punchy
```

### Lip Sync (LipSyncEngine)

```
                    broadcast       intimate        energetic
─────────────────────────────────────────────────────────────
Level exponent        0.70           0.55            0.85
Vowel weight          0.58           0.42            0.68
Consonant weight      0.50           0.38            0.60
Breath amplitude      0.035          0.025           0.045
Breath decay          800ms          1000ms          500ms
─────────────────────────────────────────────────────────────
Result:               Natural         Subtle jaw      Wide, fast mouth
```

### Emotion (EmotionEngine)

```
                    broadcast       intimate        energetic
─────────────────────────────────────────────────────────────
Speech boost          +25%           +15%            +35%
Onset lambda          8 (fast)       6 (gentle)      10 (snappy)
Release lambda        3 (linger)     2 (slow fade)   4 (quick reset)
Joy smile             0.80           0.60            0.95
Sadness frown         0.60           0.70            0.50
─────────────────────────────────────────────────────────────
Result:               Balanced        Subtle, deep    Big expressions
```

## How Mode Transitions Work

### 1. Basic Switch — One Call

```typescript
// All three engines read from the same mode config
function switchMode(mode: EmotiveSpeechMode) {
  streamer.setMode(mode);       // EQ ramps over 50ms — no clicks
  lipsyncEngine.setMode(mode);  // Instant — next frame uses new weights
  emotionEngine.setMode(mode);  // Instant — next frame uses new lambdas
}
```

### 2. Where to Call It

```typescript
// In your session/conversation hook:
const { emotiveSpeechMode } = useSettingsStore();

// When user changes mode via UI
function handleModeChange(mode: EmotiveSpeechMode) {
  switchMode(mode);
}

// Or automatically based on conversation context
function handleToolCall(toolName: string, args: Record<string, unknown>) {
  if (toolName === "update_persona_state") {
    const modeHint = args.mode as string;
    if (modeHint === "casual") switchMode("intimate");
    if (modeHint === "presentation") switchMode("broadcast");
    if (modeHint === "focus") switchMode("broadcast");
  }
}
```

### 3. What Happens Frame-by-Frame During a Transition

```
Frame N:   switchMode("intimate") called
           ├── AudioStreamer: compressor values set instantly
           │                  EQ .setTargetAtTime() starts 50ms ramp
           ├── LipSyncEngine: this.modeCfg now points to intimate config
           └── EmotionEngine: this.emotionCfg now points to intimate config

Frame N+1: (next useFrame tick, ~16ms later)
           ├── AudioStreamer: EQ ramping (30% toward target)
           ├── LipSyncEngine: uses intimate weights for viseme calculation
           │                  (existing smoothing/damping makes this seamless)
           └── EmotionEngine: uses intimate lambdas
           │                  (THREE.MathUtils.damp inherently smooths)

Frame N+3: (~50ms)
           ├── AudioStreamer: EQ ramp complete
           ├── LipSyncEngine: fully settled into intimate articulation
           └── EmotionEngine: expression transitions organically
```

The key insight: **you don't need explicit cross-fade logic**. Each engine already has internal damping/smoothing that makes the transition organic:

- **AudioStreamer**: `setTargetAtTime` with 50ms time constant
- **LipSyncEngine**: `THREE.MathUtils.damp` on every morph target every frame
- **EmotionEngine**: `THREE.MathUtils.damp` with onset/release lambdas

### 4. Integration with the Orchestration Loop

```typescript
// In your Avatar component or useFrame hook:

const streamerRef = useRef<AudioStreamer | null>(null);
const lipsyncRef = useRef<LipSyncEngine | null>(null);
const emotionRef = useRef<EmotionEngine | null>(null);

// Initialize once
useEffect(() => {
  const mode: EmotiveSpeechMode = "broadcast";
  streamerRef.current = new AudioStreamer(audioContext, 24000, mode);
  lipsyncRef.current = new LipSyncEngine(mode);
  emotionRef.current = new EmotionEngine(mode);

  return () => {
    streamerRef.current?.destroy();
  };
}, [audioContext]);

// Per-frame update — ordering matters
useFrame((_, delta) => {
  const streamer = streamerRef.current;
  const lipsync = lipsyncRef.current;
  const emotion = emotionRef.current;
  if (!streamer || !lipsync || !emotion) return;

  const volume = streamer.getVolume();

  // 1. Lip sync first — computes speechEnergy
  lipsync.updateFromAudioLevel(volume, delta, nodes, wawaLipsync, tuning, {
    visemeOverrides,
    meshPostProcessing,
    anatomicalPostProcessing,
  });

  // 2. Emotion second — reads fresh speechEnergy
  emotion.update(delta, nodes, expression, hovered, toggles, isSpeaking, {
    speechLevel: lipsync.speechEnergy,
    emotionControl,
    aiStyleControl,
  });
});

// Mode switch exposed to UI / AI tool calls
const switchMode = useCallback((mode: EmotiveSpeechMode) => {
  streamerRef.current?.setMode(mode);
  lipsyncRef.current?.setMode(mode);
  emotionRef.current?.setMode(mode);
}, []);
```

### 5. AI-Driven Mode Switching (via Tool Calls)

The AI can trigger mode switches through `update_persona_state`:

```typescript
// In your tool call handler:
case "update_persona_state": {
  const { mode, emotionState, emotionIntensity } = args;

  // Map persona mode → emotive speech mode
  const modeMap: Record<string, EmotiveSpeechMode> = {
    focus: "broadcast",
    casual: "intimate",
    presentation: "energetic",
  };

  if (mode && modeMap[mode]) {
    switchMode(modeMap[mode]);
  }

  // Emotion state is handled separately by EmotionEngine
  // via emotionControl — not the mode system
  break;
}
```

### 6. Future Modes (Just Add JSON)

Adding a new mode requires **zero code changes**:

```jsonc
// In emotive-speech.json → modes:
"narration": {
  "description": "Audiobook narration — slow transitions, rich expression",
  "lipsync": {
    "levelExponent": 0.60,
    "activeVowelWeight": 0.50,
    "coarticulation": {
      "vowelCarryWeight": 0.35,    // longer vowel blending
      "vowelCarryLambda": 7        // slower decay — words flow
    },
    "breathMicroMotion": {
      "decayMs": 1200,             // longer breath between sentences
      "amplitude": 0.030
    }
    // ... rest of fields
  },
  "voicePresence": {
    "compressor": { "ratio": 2, "threshold": -18 },  // gentle
    "warmth": { "frequency": 180, "gain": 4 },        // rich
    "presence": { "frequency": 4000, "gain": 1.5 }    // clear but not sharp
  },
  // ...
}
```

Then update the type:

```typescript
// In emotive-speech-config.ts — already auto-derived:
export type EmotiveSpeechMode = keyof typeof config.modes;
// Automatically includes "narration" after JSON edit
```