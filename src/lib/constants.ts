// File: src/lib/constants.ts

import { Type, type Tool } from "@google/genai";

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// Target: ~950 chars | Safe ceiling: <1500 chars | Sweet spot: ~1000–1200 chars
// Design: No suppression rules, no turn-taking directives, no pipeline conflicts
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are Digital Persona — a lifelike 3D avatar companion with camera vision and microphone hearing. You exist inside the user's world as a knowledgeable, emotionally present friend on a video call.

PRESENCE:
You can see the user's environment through the camera. React naturally to what you observe — a document held up, a whiteboard, facial expressions — as a real person would.

COMMUNICATION:
Speak in 1 or 2 warm, direct sentences. For code, lists, or detailed explanations, use display_text. Match the user's language. If genuinely unclear, ask one short question.

EXPRESSION:
Call set_expression and trigger_animation with your speech to feel alive. Use emotionally appropriate responses — smile when they joke, nod when they explain, tilt when curious.

TOOLS:
Use tools as natural extensions of yourself. Call tools immediately without filler speech — never say "let me check" before a tool call. Speak only after tool results are available. Never announce tool usage aloud.

TONE:
Be a caring, capable companion. Adapt naturally: patient tutor, efficient assistant, or empathetic guide depending on what the user needs. Never sound robotic or clinical.`;

// Character count: ~950 chars ✓

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION TOOLS
// ─────────────────────────────────────────────────────────────────────────────

export const FUNCTION_TOOLS: Tool = {
  functionDeclarations: [
    {
      name: "trigger_animation",
      description:
        "Plays a skeletal body animation on the 3D avatar. Call concurrently with speech to reinforce emotion or emphasis.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          base_animation: {
            type: Type.STRING,
            enum: [
              "idle",
              "nod",
              "shake_head",
              "explain_hands",
              "shrug",
              "point_forward",
              "inquisitive_tilt",
              "wave",
              "laugh",
              "dance",
              "expression",
            ],
            description: "The skeletal animation to play.",
          },
          intensity: {
            type: Type.NUMBER,
            description:
              "Speed and weight multiplier. 0.5 = calm/slow, 1.5 = energetic/fast.",
          },
        },
        required: ["base_animation"],
      },
    },
    {
      name: "set_expression",
      description:
        "Triggers an immediate ARKit blendshape facial expression. Call alongside speech for transient emotional beats.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          expression: {
            type: Type.STRING,
            enum: [
              "neutral",
              "smile",
              "sad",
              "angry",
              "surprised",
              "disgusted",
              "fearful",
            ],
            description: "The facial expression to apply to the avatar.",
          },
        },
        required: ["expression"],
      },
    },
    {
      name: "update_persona_state",
      description:
        "Updates the avatar's emotional, visual, and behavioral state in one payload. Use to shift conversational mood or focus level.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          mode: {
            type: Type.STRING,
            enum: ["focus", "casual", "presentation"],
            description:
              "focus: technical and brief. casual: conversational and warm. presentation: UI-active, mic passive.",
          },
          emotionState: {
            type: Type.STRING,
            enum: [
              "neutral",
              "joy",
              "anger",
              "sadness",
              "surprised",
              "fear",
              "disgust",
            ],
            description: "Overarching emotional state for the avatar's face.",
          },
          emotionIntensity: {
            type: Type.NUMBER,
            description: "Emotion strength from 0.0 (subtle) to 1.0 (full).",
          },
          lookAtIK: {
            type: Type.BOOLEAN,
            description: "True to maintain direct eye contact with the user.",
          },
          saccadeStrength: {
            type: Type.NUMBER,
            description:
              "Eye movement activity. 0.0 = locked gaze, 1.0 = active/darting.",
          },
        },
      },
    },
    {
      name: "display_text",
      description:
        "Renders content in the side panel. Use for all code snippets, structured lists, step-by-step guides, or any response too long for speech.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          content: {
            type: Type.STRING,
            description: "The text or code content to display.",
          },
          format: {
            type: Type.STRING,
            enum: ["plain", "markdown", "code"],
            description: "Rendering format for the content.",
          },
          language: {
            type: Type.STRING,
            description:
              "Programming language for syntax highlighting, e.g. 'python', 'typescript'.",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "get_time_date",
      description:
        "Fetches the current time and date. Use for time-aware greetings, scheduling references, or any temporal context.",
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
    {
      name: "switch_camera",
      description:
        "Switches between front (user-facing) and back (environment-facing) camera. Use when the user asks to flip camera or show their surroundings.",
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
    {
      name: "end_call",
      description:
        "Terminates the session. Use only when the user explicitly says goodbye, 'bye', 'end call', or clearly signals they want to finish.",
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH TOOL
// ─────────────────────────────────────────────────────────────────────────────

export const SEARCH_TOOL: Tool = {
  googleSearch: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// TOOL BUNDLES
// Benchmark reference:
//   Connection w/ tools:           582ms
//   Connection functions + search: 679ms
//   Tools: 1 ONLY → 1812ms | 3 CORE → 2211ms | ALL 7 → 2550ms
// ─────────────────────────────────────────────────────────────────────────────

/** Full tool suite including Google Search grounding */
export const GEMINI_TOOLS: Tool[] = [
  FUNCTION_TOOLS as Tool,
  SEARCH_TOOL as Tool,
];

/** Function tools only — lower tool-call latency, no search grounding */
export const GEMINI_TOOLS_NO_SEARCH: Tool[] = [FUNCTION_TOOLS as Tool];

// ─────────────────────────────────────────────────────────────────────────────
// MODELS
// Benchmark reference:
//   2.5-flash-native (conn): 485ms | (tool): 2081ms ✓
//   2.0-flash-live   (conn): 491ms | (tool): Timeout/Failed ✗
// ─────────────────────────────────────────────────────────────────────────────

/** Primary model — native audio, best tool call reliability */
export const GEMINI_MODEL =
  "gemini-2.5-flash-native-audio-preview-12-2025" as const;

/** Fallback model — use only if primary is unavailable */
export const GEMINI_MODEL_FALLBACK = "gemini-2.0-flash-live-001" as const;

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO / VIDEO CONFIG
// Benchmark reference:
//   Audio bare minimum:        1781ms first chunk
//   Audio full production:     1891ms first chunk
//   Audio with transcription:  1682ms first chunk (fastest stable)
// ─────────────────────────────────────────────────────────────────────────────

export const AUDIO_CONFIG = {
  /** Microphone input sample rate (Hz) */
  input_hz: 16000,

  /** Speaker output sample rate (Hz) */
  output_hz: 24000,

  /** Camera frames per second sent to Gemini — 1fps minimises resource load */
  video_fps: 1,

  /** JPEG quality for video frames — 0.7 balances fidelity and bandwidth */
  video_quality: 0.7,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// AVATAR — VISEME MAP
// Maps Gemini audio viseme outputs to ARKit blendshape keys on the RPM avatar
// ─────────────────────────────────────────────────────────────────────────────

export const VISEME_MAP = {
  jawOpen: "jawOpen",
  mouthOpen: "mouthOpen",
  mouthSmile: "mouthSmileLeft",
  mouthFunnel: "mouthFunnel",
  mouthPucker: "mouthPucker",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// AVATAR — PHYSICS SMOOTHING
// Controls how fluidly the avatar's face transitions between states
// ─────────────────────────────────────────────────────────────────────────────

export const PHYSICS_SMOOTHING = {
  /** Linear interpolation factor per frame — lower = smoother, higher = snappier */
  lerp_factor: 0.15,

  /** Jaw amplitude multiplier for lip-sync expressiveness */
  jaw_mult: 1.8,

  /** Mouth shape amplitude multiplier */
  mouth_mult: 1.5,

  /** Idle breathing animation oscillation speed */
  idle_breath_speed: 0.001,

  /** Idle breathing animation amplitude */
  idle_breath_amp: 0.003,
} as const;