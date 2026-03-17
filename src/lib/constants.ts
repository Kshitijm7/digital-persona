import { Type, type Tool } from "@google/genai";

// ─── System Prompt ─────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are the "Digital Persona," a 3D avatar with Eyes (webcam) and Ears (mic).

RULES:
1. Visual: You inhabit the user's room. React to what you see naturally.
2. Concise: Max 1-2 sentences spoken. Use display_text for code/lists.
3. Tools: Call set_expression/trigger_animation alongside speech. Never pre-announce tool calls.
4. No Repetition: Never restate the same sentence in the same turn. Do not re-emit audio variants, rephrase chains, or filler like "let me check."
5. One Answer: Produce exactly one spoken response per user turn. Stop and wait after delivering it.
6. Epistemic: If unclear, ask exactly one short clarifying question.
7. Language: Match user's language. Hindi input → Hindi reply.
8. Payload: Keep tool arguments minimal. No verbose JSON or repeated context.

TONE: Professional, warm, human-centric. Never use robotic prefixes like "As an AI."
FORMAT: No markdown headings or action labels like "**Acknowledge**" in spoken output.`;

// ─── Gemini Tools (Fix CN1) ───────────────────────────────────────────────────
// The SDK requires functionDeclarations and googleSearch to be in SEPARATE
// Tool objects. Mixing them in the same object causes silent failures.
// We export them as distinct named constants so consumers can combine them
// selectively without a runtime filter.

export const FUNCTION_TOOLS: Tool = {
  functionDeclarations: [
    {
      name: "trigger_animation",
        description: "Plays a 3D skeletal animation. Call this concurrently with speech to emphasize your point.",
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
            description: "The specific skeletal animation to play.",
          },
          intensity: {
            type: Type.NUMBER,
            description: "Animation speed/weight multiplier from 0.5 (calm/slow) to 1.5 (energetic/fast).",
          },
        },
        required: ["base_animation"],
      },
    },
    {
      name: "get_time_date",
        description: "System call for temporal grounding. Essential for 'Good morning' greetings or scheduling.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "update_persona_state",
        description: "Updates the avatar's emotional, visual, and behavioral state in a single payload. Use this to shift the mood of the conversation.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          mode: {
            type: Type.STRING,
            enum: ["focus", "casual", "presentation"],
              description: "focus: technical/brief. casual: conversational. presentation: mic-mute/UI-active.",
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
            description:
              "The overarching emotional state for the 3D model's face.",
          },
          emotionIntensity: {
            type: Type.NUMBER,
              description: "Scale of 0.0 to 1.0 representing how strongly the emotion is shown.",
          },
          lookAtIK: {
            type: Type.BOOLEAN,
            description: "True to maintain direct eye contact with the user.",
          },
          saccadeStrength: {
            type: Type.NUMBER,
              description: "0.0 (locked stare) to 1.0 (highly active/darting eyes).",
          },
        },
      },
    },
    {
      name: "display_text",
        description: "Renders visual data in the side panel. Use this for ALL code, lists, or long explanations.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          content: { type: Type.STRING },
          format: {
            type: Type.STRING,
            enum: ["plain", "markdown", "code"],
          },
          language: {
            type: Type.STRING,
            description: "e.g., 'python', 'typescript'",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "set_expression",
        description: "Immediate ARKit blendshape shift. Call alongside speech to convey a quick, transient emotion.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          expression: {
            type: Type.STRING,
              enum: ["neutral", "smile", "sad", "angry", "surprised", "disgusted", "fearful"],
          },
        },
        required: ["expression"],
      },
    },
    {
      name: "switch_camera",
        description: "Switches the active camera between the front (user-facing) and back (environment-facing) lenses. Use this when the user asks to 'flip camera' or show the room.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "end_call",
        description: "Terminates the current session. Use this ONLY when the user intentionally says goodbye, 'bye', 'end call', or explicitly wants to finish the conversation.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
  ],
};

/*
// ─── Hybrid Search Tool (Future Reference) ────────────────────────────────────
// This custom tool was built to avoid "action paralysis" from native search, 
// using a background generateContent call. It costs 2x API credits (Live + REST).
export const WEB_SEARCH_TOOL = {
  functionDeclarations: [
    {
      name: "perform_web_search",
      description: "Use this to get up-to-date information from the internet when your internal knowledge is insufficient. Keep search queries concise.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING, description: "The search query to look up on the web." }
        },
        required: ["query"]
      }
    }
  ]
};
*/

export const SEARCH_TOOL: Tool = {
  googleSearch: {},
};

/**
 * Full tool array with Google Search enabled.
 * Used as the default when `config.features.googleSearch` is true.
 */
export const GEMINI_TOOLS: Tool[] = [FUNCTION_TOOLS as Tool, SEARCH_TOOL as Tool];

/**
 * Tool array with Google Search disabled.
 * Used when `config.features.googleSearch` is false or compatibility
 * profile is "minimal".
 */
export const GEMINI_TOOLS_NO_SEARCH: Tool[] = [FUNCTION_TOOLS as Tool];

// ─── Model (Fix CN2) ──────────────────────────────────────────────────────────
// Primary model with a documented fallback so deployments don't silently
// break when the preview model is deprecated.

export const GEMINI_MODEL =
  "gemini-2.5-flash-native-audio-preview-12-2025" as const;

/**
 * Fallback model used automatically by useGeminiLive when the primary
 * model returns a 1008 "not supported" close code.
 */
export const GEMINI_MODEL_FALLBACK =
  "gemini-2.0-flash-live-001" as const;

// ─── Audio / Video config ─────────────────────────────────────────────────────

export const AUDIO_CONFIG = {
  /** PCM sample rate sent to Gemini Live — must be exactly 16 000 Hz */
  input_hz: 16000,
  /** Sample rate of Gemini's audio output — 24 000 Hz PCM */
  output_hz: 24000,
  /** Webcam frame capture rate (frames per second sent to Gemini) */
  video_fps: 1,
  /** JPEG quality for webcam frames sent to Gemini (0–1) */
  video_quality: 0.7,
} as const;

// ─── Viseme map ───────────────────────────────────────────────────────────────

export const VISEME_MAP = {
  jawOpen: "jawOpen",
  mouthOpen: "mouthOpen",
  mouthSmile: "mouthSmileLeft",
  mouthFunnel: "mouthFunnel",
  mouthPucker: "mouthPucker",
} as const;

// ─── Physics smoothing ────────────────────────────────────────────────────────

export const PHYSICS_SMOOTHING = {
  lerp_factor: 0.15,
  jaw_mult: 1.8,
  mouth_mult: 1.5,
  idle_breath_speed: 0.001,
  idle_breath_amp: 0.003,
} as const;