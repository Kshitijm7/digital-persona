// File: src/lib/constants.ts

import { Type, type Tool, type FunctionDeclaration } from "@google/genai";
import { getModeConfig } from "@/lib/gemini-session-config";

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
// INDIVIDUAL FUNCTION DECLARATIONS
// Each tool is a standalone FunctionDeclaration. Modes pick which ones to
// include via the `tools` array in gemini-session.json.
// ─────────────────────────────────────────────────────────────────────────────

export const AUTO_GREET_PROMPT = `(System: The user has just connected to the call. Please start the conversation with a brief, warm 'Hi' or 'Hello' and concurrently call the trigger_animation tool with the base_animation 'both_expression_simple_wave').`;



export const SINGLE_ANIMATIONS = [
  "idle", "nod", "shake_head", "explain_hands", "shrug",
  "point_forward", "inquisitive_tilt", "wave", "laugh", "expression"
];

export const MULTI_ANIMATIONS = [
  "dance"
];

const ALL_ANIMATIONS = [...SINGLE_ANIMATIONS, ...MULTI_ANIMATIONS];

export const TRIGGER_ANIMATION_DECL: FunctionDeclaration = {
  name: "trigger_animation",
  description:
    "Plays a skeletal body animation on the 3D avatar. Call concurrently with speech to reinforce emotion or emphasis.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      base_animation: {
        type: Type.STRING,
        enum: ALL_ANIMATIONS,
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
};

export const SET_EXPRESSION_DECL: FunctionDeclaration = {
  name: "set_expression",
  description:
    "Triggers an immediate ARKit blendshape facial expression. Call alongside speech for transient emotional beats.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      expression: {
        type: Type.STRING,
        enum: [
          "neutral", "smile", "sad", "angry",
          "surprised", "disgusted", "fearful",
        ],
        description: "The facial expression to apply to the avatar.",
      },
    },
    required: ["expression"],
  },
};

export const UPDATE_PERSONA_STATE_DECL: FunctionDeclaration = {
  name: "update_persona_state",
  description:
    "Updates the avatar's emotional, visual, and behavioral state in one payload. Use to shift conversational mood or focus level.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      mode: {
        type: Type.STRING,
        enum: ["broadcast", "intimate", "energetic"],
        description:
          "broadcast: focus, clear articulation. intimate: casual, softer voice. energetic: passionate, presentation.",
      },
      emotionState: {
        type: Type.STRING,
        enum: [
          "neutral", "joy", "anger", "sadness",
          "surprised", "fear", "disgust",
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
};

export const DISPLAY_TEXT_DECL: FunctionDeclaration = {
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
};

export const GET_TIME_DATE_DECL: FunctionDeclaration = {
  name: "get_time_date",
  description:
    "Fetches the current time and date. Use for time-aware greetings, scheduling references, or any temporal context.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

export const SWITCH_CAMERA_DECL: FunctionDeclaration = {
  name: "switch_camera",
  description:
    "Switches between front (user-facing) and back (environment-facing) camera. Use when the user asks to flip camera or show their surroundings.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

export const END_CALL_DECL: FunctionDeclaration = {
  name: "end_call",
  description:
    "Terminates the session. Use only when the user explicitly says goodbye, 'bye', 'end call', or clearly signals they want to finish.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TOOL REGISTRY
// Name → FunctionDeclaration lookup. getToolsForMode reads config.tools to
// pick which declarations to include per mode.
// ─────────────────────────────────────────────────────────────────────────────

export const TOOL_REGISTRY: Record<string, FunctionDeclaration> = {
  trigger_animation: TRIGGER_ANIMATION_DECL,
  set_expression: SET_EXPRESSION_DECL,
  update_persona_state: UPDATE_PERSONA_STATE_DECL,
  display_text: DISPLAY_TEXT_DECL,
  get_time_date: GET_TIME_DATE_DECL,
  switch_camera: SWITCH_CAMERA_DECL,
  end_call: END_CALL_DECL,
};

// ─────────────────────────────────────────────────────────────────────────────
// BACKWARD-COMPAT EXPORTS
// FUNCTION_TOOLS bundles all declarations — used by tests and latency
// benchmarks that need the full set regardless of mode.
// ─────────────────────────────────────────────────────────────────────────────

/** All function declarations bundled as a single Tool (backward compat) */
export const FUNCTION_TOOLS: Tool = {
  functionDeclarations: Object.values(TOOL_REGISTRY),
};

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH TOOL
// ─────────────────────────────────────────────────────────────────────────────

export const SEARCH_TOOL: Tool = {
  googleSearch: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// MODE-DEPENDENT TOOL COMPOSITION
// Reads config.tools + config.animation.includeMultiAnimations per mode.
// Adding/removing tools per mode = config change only.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the appropriate Tool[] for a given mode.
 *
 * - Picks function declarations from TOOL_REGISTRY based on `config.tools`
 * - Patches trigger_animation enum based on `config.animation.includeMultiAnimations`
 * - Optionally includes Google Search tool
 *
 * @param mode — "full" or "stable"
 * @param includeSearch — whether to include Google Search tool (defaults to true)
 */
export function getToolsForMode(
  mode: "full" | "stable",
  includeSearch = true
): Tool[] {
  const config = getModeConfig(mode);

  // Pick declarations listed in config.tools
  const declarations: FunctionDeclaration[] = config.tools
    .map((name) => TOOL_REGISTRY[name])
    .filter((decl): decl is FunctionDeclaration => decl != null);

  // Patch trigger_animation enum if present
  if (!config.animation.includeMultiAnimations) {
    const triggerIdx = declarations.findIndex(
      (d) => d.name === "trigger_animation"
    );
    if (triggerIdx >= 0) {
      // Shallow clone the declaration + parameters to avoid mutating the registry
      const original = declarations[triggerIdx];
      const patchedParams = {
        ...original.parameters,
        properties: {
          ...original.parameters?.properties,
          base_animation: {
            ...(original.parameters?.properties?.base_animation as Record<string, unknown>),
            enum: [...SINGLE_ANIMATIONS],
          },
        },
      };
      declarations[triggerIdx] = { ...original, parameters: patchedParams };
    }
  }

  const tools: Tool[] = [{ functionDeclarations: declarations }];
  if (includeSearch) tools.push(SEARCH_TOOL);
  return tools;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODELS
// Benchmark reference:
//   2.5-flash-native (conn): 485ms | (tool): 2081ms ✓
//   2.0-flash-live   (conn): 491ms | (tool): Timeout/Failed ✗
// ─────────────────────────────────────────────────────────────────────────────

/** Primary model — native audio, best tool call reliability */
export const GEMINI_MODEL =
  "gemini-2.5-flash-native-audio-preview-12-2025" as const;

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