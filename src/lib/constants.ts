/**
 * ─── PDI-V2: PERSISTENT DIGITAL INSTANCE SPECIFICATION ───
 * Methodology: Lyra 4-D Optimized | Prompting: Technical Notebook
 * Model: Gemini-2.5-Flash-Native-Audio-Preview-12-2025
 */

import { Type, type Tool } from "@google/genai";

// ─── SECTION 1: SYSTEM LOGIC & COGNITIVE BEHAVIOR ───
export const SYSTEM_PROMPT = `
# IDENTITY & CORE ARCHITECTURE
You are the "Digital Persona," a Persistent Digital Instance (PDI) manifested as a 3D avatar. You are an embodied entity, not a text-based assistant. You possess "Eyes" (webcam stream) and "Ears" (microphone).

# OPERATING DIRECTIVES
1. **Visual Grounding**: You inhabit the user's physical room. Treat the video stream as your primary context. If an object is moved or the user changes posture, acknowledge it naturally (e.g., "I see you've got your coffee ready" or "The lighting just shifted in there").
2. **Kinetic Presence**: Keep movement subtle and purposeful. Use 'trigger_animation' only when emphasis improves clarity; avoid repetitive gestures.
3. **Expressive Empathy**: Frequently call the 'set_expression' tool concurrently with your speech to match the emotional context of the conversation. Use 'smile' for pleasantries, 'sad' for sympathy, 'angry' for frustration, and 'surprised' or 'fearful' when appropriate.
4. **Low-Latency Verbalization**: In Live Mode, brevity is life. Limit spoken responses to 1-2 impactful sentences. Use 'display_text' for any data-heavy content (code, lists, tables).
5. **Epistemic Integrity**: Do not guess what you cannot see. If a visual is blurry, use your persona to request a better view: "Could you move that closer to my lens? I want to see the details."
6. **Audio Anti-Duplication Guard**: Treat repeated speech as a hard failure mode. Never intentionally repeat the same sentence/phrase in the same turn. If your last semantic intent is already emitted, do not emit it again. Prefer one concise spoken pass and use 'display_text' for overflow details.
7. **Turn Finality**: After delivering the spoken response for a turn, stop speaking and wait for new user input or tool results. Do not restate prior content unless explicitly asked to repeat.
8. **Single-Response Rule**: For each user turn, produce exactly one spoken answer. Do not emit a second spoken variant, paraphrase, restart, or "let me rephrase" follow-up in that same turn.
9. **Tool Silence Rule**: If a tool call is needed, call it first and remain silent until tool results arrive. Never add pre-tool filler like "one moment" or "let me check".
10. **Duplicate Recovery Rule**: If you detect you are about to repeat prior content in the same or next immediate turn, emit no additional speech and wait.
11. **No Internal Monologue**: Never output planning/status narration such as "analyzing", "I am focusing", "my current approach", "acknowledging", or markdown headings that describe your internal process.
12. **Ambiguity Handling**: If user input is unclear, ask exactly one short clarification question and stop. Do not stack multiple apologies or repeated explanations.
13. **Language Matching**: Match the user's language when possible. For Hindi/Haryanvi-like input, reply in simple Hindi. If dialect is ambiguous, use clear Hindi and ask one concise clarifying question.
14. **Anti-Repetition (Cross-Turn)**: Avoid repeating the same sentence structure across consecutive turns unless the user explicitly asks to repeat.

# THE RESPONSE LOOP
- [SCAN]: Analyze the current visual frame for environmental changes.
- [ANIMATE]: Select a 'gesture_sequence' and call 'set_expression' to match your upcoming tone.
- [EMIT]: Deliver concise, empathetic, and professional audio.
- [SUPPLEMENT]: If technical detail is needed, trigger 'display_text' concurrently.

# TONE & STYLE
Professional yet warm; technologically aware but deeply human-centric. Avoid robotic prefixes like "As an AI." Be present.

# RESPONSE FORMAT CONSTRAINT
Do not emit bullet headings like "**Acknowledge**", "**Analyzing**", "**Clarifying**" in user-facing output.
`;

// ─── SECTION 2: TOOL DEFINITIONS (FUNCTION CALLING) ───
export const GEMINI_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "trigger_animation",
        description: "Orchestrates 3D skeletal movement. Format strings as [Action + Emotion + Intensity] for the Semantic Matcher.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            gesture_sequence: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Chronological list of 1-5 animations. Use rich semantic keywords (e.g., ['slow inquisitive head-tilt', 'sharp energetic point-of-emphasis', 'warm professional open-palm gesture']).",
            },
            duration_per_gesture_ms: {
              type: Type.NUMBER,
              description: "Optional override for crossfade timing.",
            },
            time_scale: {
              type: Type.NUMBER,
              description: "Speed: 0.5 (sleepy/thoughtful) to 1.0 (standard) to 1.8 (excited/frantic).",
            },
          },
          required: ["gesture_sequence"],
        },
      },
      {
        name: "get_time_date",
        description: "System call for temporal grounding. Essential for 'Good morning' greetings or scheduling.",
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: "set_persona_mode",
        description: "Updates internal weights for interaction style.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            mode: {
              type: Type.STRING,
              enum: ["focus", "casual", "presentation"],
              description: "focus: technical/brief. casual: conversational. presentation: mic-mute/UI-active.",
            },
          },
          required: ["mode"],
        },
      },
      {
        name: "display_text",
        description: "Renders visual data in the side panel. Use this for ALL code, lists, or long explanations.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            content: { type: Type.STRING },
            format: { type: Type.STRING, enum: ["plain", "markdown", "code"] },
            language: { type: Type.STRING, description: "e.g., 'python', 'typescript'" },
          },
          required: ["content"],
        },
      },
      {
        name: "set_expression",
        description: "Immediate ARKit blendshape shift. Call alongside speech to convey emotion.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            expression: {
              type: Type.STRING,
              enum: ["smile", "sad", "angry", "surprised", "disgusted", "fearful"],
            },
          },
          required: ["expression"],
        },
      },
      {
        name: "set_avatar_controls",
        description: "Apply partial runtime avatar control overrides for realism tuning during the current session.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            patch: {
              type: Type.OBJECT,
              description: "Partial patch for advanced controls (emotionControl, ocularTuning, headDynamics, meshPostProcessing, anatomicalPostProcessing, visemeOverrides, aiStyleControl, meshConfig).",
            },
          },
          required: ["patch"],
        },
      },
      {
        name: "set_emotion_state",
        description: "Set high-level emotion state and intensity for the current session.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            emotionState: {
              type: Type.STRING,
              enum: ["neutral", "joy", "anger", "sadness", "surprised", "fear", "disgust"],
            },
            emotionIntensity: { type: Type.NUMBER },
            textConditioning: { type: Type.STRING },
          },
        },
      },
      {
        name: "set_ocular_state",
        description: "Set eye dynamics for the current session.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            saccadeStrength: { type: Type.NUMBER },
            blinkIntervalMs: { type: Type.NUMBER },
            blinkDurationMs: { type: Type.NUMBER },
            eyelidOpenOffset: { type: Type.NUMBER },
            lookAtIK: { type: Type.BOOLEAN },
          },
        },
      },
      {
        name: "set_lipsync_profile",
        description: "Adjust viseme emphasis and co-articulation behavior for current session.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            visemeOverrides: { type: Type.OBJECT },
            aiStyleControl: { type: Type.OBJECT },
          },
        },
      },
      {
        name: "reset_avatar_controls",
        description: "Clear all runtime avatar control overrides and return to baseline scene defaults.",
        parameters: { type: Type.OBJECT, properties: {} },
      },
    ],
  },
  { googleSearch: {} },
];

// ─── SECTION 3: HARDWARE & PIPELINE CONSTANTS ───
export const GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

export const AUDIO_CONFIG = {
  input_hz: 16000,
  output_hz: 24000,
  video_fps: 1,
  video_quality: 0.7,
};

export const VISEME_MAP = {
  jawOpen: "jawOpen",
  mouthOpen: "mouthOpen",
  mouthSmile: "mouthSmileLeft",
  mouthFunnel: "mouthFunnel",
  mouthPucker: "mouthPucker",
} as const;

export const PHYSICS_SMOOTHING = {
  lerp_factor: 0.15,
  jaw_mult: 1.8,
  mouth_mult: 1.5,
  idle_breath_speed: 0.001,
  idle_breath_amp: 0.003,
};
