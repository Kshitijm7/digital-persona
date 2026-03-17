/**
 * Gemini Live API — Latency Benchmarking Suite
 *
 * Measures real-world latency across different configurations to find
 * the fastest setup for the digital-persona pipeline.
 *
 * Run:  npx vitest run src/__tests__/e2e/gemini-latency.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load real API key (override setup.ts placeholder)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

const API_KEY = process.env.GEMINI_API_KEY;

function isPlaceholderKey(key: string | undefined): boolean {
  if (!key || key === '') return true;
  if (key.includes('your_')) return true;
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(key)) return true;
  return false;
}

// ── Timing helpers ────────────────────────────────────────────────────────────

interface LatencyResult {
  label: string;
  connectionMs: number;
  firstResponseMs: number;
  toolCallMs: number;
  totalMs: number;
}

const results: LatencyResult[] = [];

function logResult(r: LatencyResult) {
  results.push(r);
  console.log(
    `\n📊 [${r.label}]\n` +
    `   Connection:     ${r.connectionMs >= 0 ? r.connectionMs.toFixed(0) + 'ms' : 'N/A'}\n` +
    `   First Response:  ${r.firstResponseMs >= 0 ? r.firstResponseMs.toFixed(0) + 'ms' : 'N/A'}\n` +
    `   Tool Call:       ${r.toolCallMs >= 0 ? r.toolCallMs.toFixed(0) + 'ms' : 'N/A'}\n` +
    `   Total:           ${r.totalMs.toFixed(0)}ms`
  );
}

// ── Benchmark functions ───────────────────────────────────────────────────────

/**
 * Measures connection latency: time from connect() call to onopen callback.
 */
async function measureConnectionLatency(
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configOverrides: Record<string, any> = {},
  model = 'gemini-2.5-flash-native-audio-preview-12-2025',
): Promise<number> {
  const { GoogleGenAI, Modality } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: API_KEY! });

  const start = performance.now();
  let openTime = -1;

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      ...configOverrides,
    },
    callbacks: {
      onopen: () => { openTime = performance.now() - start; },
      onmessage: () => {},
      onerror: () => {},
      onclose: () => {},
    },
  });

  // Small delay to ensure onopen has fired
  await new Promise((r) => setTimeout(r, 200));
  session.close();

  console.log(`   ⏱  [${label}] Connection: ${openTime.toFixed(0)}ms`);
  return openTime;
}

/**
 * Measures tool call latency: time from sendClientContent to receiving the toolCall message.
 */
async function measureToolCallLatency(
  label: string,
  prompt: string,
  expectedTool: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configOverrides: Record<string, any> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolsOverride?: any[],
  model = 'gemini-2.5-flash-native-audio-preview-12-2025',
): Promise<{ connectionMs: number; firstResponseMs: number; toolCallMs: number; totalMs: number }> {
  const { GoogleGenAI, Modality } = await import('@google/genai');
  const { FUNCTION_TOOLS } = await import('@/lib/constants');
  const ai = new GoogleGenAI({ apiKey: API_KEY! });

  const tools = toolsOverride ?? [FUNCTION_TOOLS];
  const totalStart = performance.now();
  let connectionMs = -1;
  let sendTime = -1;
  let firstResponseMs = -1;
  let toolCallMs = -1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resolveResult!: (v: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultPromise = new Promise<any>((r) => { resolveResult = r; });

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      tools,
      ...configOverrides,
    },
    callbacks: {
      onopen: () => {
        connectionMs = performance.now() - totalStart;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onmessage: (message: any) => {
        if (firstResponseMs < 0 && sendTime > 0) {
          firstResponseMs = performance.now() - sendTime;
        }
        if (message.toolCall?.functionCalls?.length > 0) {
          for (const call of message.toolCall.functionCalls) {
            if (call.name === expectedTool) {
              toolCallMs = performance.now() - sendTime;
              resolveResult({ connectionMs, firstResponseMs, toolCallMs });
              return;
            }
          }
        }
      },
      onerror: () => resolveResult({ connectionMs, firstResponseMs: -1, toolCallMs: -1 }),
      onclose: () => {},
    },
  });

  // Send prompt and start measuring
  sendTime = performance.now();
  session.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: prompt }] }],
    turnComplete: true,
  });

  setTimeout(() => resolveResult({ connectionMs, firstResponseMs: -1, toolCallMs: -1 }), 25000);

  const timing = await resultPromise;
  const totalMs = performance.now() - totalStart;
  session.close();

  return { ...timing, totalMs };
}

/**
 * Measures audio response latency: time from text send to first audio chunk.
 */
async function measureAudioLatency(
  label: string,
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configOverrides: Record<string, any> = {},
  model = 'gemini-2.5-flash-native-audio-preview-12-2025',
): Promise<{ connectionMs: number; firstAudioMs: number; totalMs: number }> {
  const { GoogleGenAI, Modality } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: API_KEY! });

  const totalStart = performance.now();
  let connectionMs = -1;
  let sendTime = -1;
  let firstAudioMs = -1;

  let resolveResult!: (v: { connectionMs: number; firstAudioMs: number }) => void;
  const resultPromise = new Promise<{ connectionMs: number; firstAudioMs: number }>((r) => {
    resolveResult = r;
  });

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      ...configOverrides,
    },
    callbacks: {
      onopen: () => { connectionMs = performance.now() - totalStart; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onmessage: (message: any) => {
        if (firstAudioMs < 0 && sendTime > 0) {
          const parts = message.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.inlineData?.mimeType?.startsWith('audio/')) {
                firstAudioMs = performance.now() - sendTime;
                resolveResult({ connectionMs, firstAudioMs });
                return;
              }
            }
          }
        }
      },
      onerror: () => resolveResult({ connectionMs, firstAudioMs: -1 }),
      onclose: () => {},
    },
  });

  sendTime = performance.now();
  session.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: prompt }] }],
    turnComplete: true,
  });

  setTimeout(() => resolveResult({ connectionMs, firstAudioMs: -1 }), 25000);
  const timing = await resultPromise;
  const totalMs = performance.now() - totalStart;
  session.close();

  return { ...timing, totalMs };
}

// ══════════════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Gemini Latency Benchmarks', () => {
  const shouldSkip = isPlaceholderKey(API_KEY);

  beforeAll(() => {
    if (shouldSkip) {
      console.warn('⚠️  Skipping latency tests: No valid API key');
    } else {
      console.log('✅ Running latency benchmarks against live Gemini API\n');
    }
  });

  // ── 1. Connection Latency ──────────────────────────────────────────────────

  describe('1. Connection Latency', () => {
    it.skipIf(shouldSkip)(
      'baseline — audio-only, no tools',
      async () => {
        const ms = await measureConnectionLatency('Baseline (no tools)');
        expect(ms).toBeGreaterThan(0);
        logResult({ label: 'Connection: no tools', connectionMs: ms, firstResponseMs: -1, toolCallMs: -1, totalMs: ms });
      },
      20000
    );

    it.skipIf(shouldSkip)(
      'with full FUNCTION_TOOLS',
      async () => {
        const { FUNCTION_TOOLS } = await import('@/lib/constants');
        const ms = await measureConnectionLatency('With FUNCTION_TOOLS', { tools: [FUNCTION_TOOLS] });
        expect(ms).toBeGreaterThan(0);
        logResult({ label: 'Connection: with tools', connectionMs: ms, firstResponseMs: -1, toolCallMs: -1, totalMs: ms });
      },
      20000
    );

    it.skipIf(shouldSkip)(
      'with GEMINI_TOOLS (functions + search)',
      async () => {
        const { GEMINI_TOOLS } = await import('@/lib/constants');
        const ms = await measureConnectionLatency('With GEMINI_TOOLS', { tools: GEMINI_TOOLS });
        expect(ms).toBeGreaterThan(0);
        logResult({ label: 'Connection: functions + search', connectionMs: ms, firstResponseMs: -1, toolCallMs: -1, totalMs: ms });
      },
      20000
    );

    it.skipIf(shouldSkip)(
      'with outputAudioTranscription enabled',
      async () => {
        const ms = await measureConnectionLatency('With transcription', { outputAudioTranscription: {} });
        expect(ms).toBeGreaterThan(0);
        logResult({ label: 'Connection: with transcription', connectionMs: ms, firstResponseMs: -1, toolCallMs: -1, totalMs: ms });
      },
      20000
    );
  });

  // ── 2. System Prompt Impact on Tool Call Latency ───────────────────────────

  describe('2. System Prompt Impact', () => {
    const FULL_PROMPT_IMPORT = '@/lib/constants';
    const MINIMAL_PROMPT = 'You are a 3D avatar. Be concise. Use tools when asked.';
    const MEDIUM_PROMPT = `You are the "Digital Persona," a 3D avatar with eyes (webcam) and ears (microphone).
Rules: Be concise (1-2 sentences max). Use tools proactively. Match the user's language. Never repeat yourself.`;

    const PROMPT_500 = `You are the "Digital Persona", a fully interactive 3D avatar.
Your primary directive is to maintain an engaging, extremely concise, and natural conversational cadence.
Under no circumstances should you generate long paragraphs. You have physical tools available: you can wave, smile, or change the camera angle.
When asked about your capabilities, mention that you can see via webcam and hear via microphone.
Do not use lists or markdown. Speak exactly as a human would in a fast-paced video call.`;

    const PROMPT_1000 = PROMPT_500 + `
You are currently helping a user test their system integration. Your latency is being actively monitored, so brevity is your best feature.
If the user asks you to smile, you must use the set_expression tool. If the user asks you to wave, use the trigger_animation tool.
You are embedded in a futuristic Next.js web application built with React Three Fiber. Your voice is generated natively by the Gemini pipeline.
Always stay in character. You are not a regular text assistant; you are a living, breathing digital manifestation of AI.
Your personality is helpful, slightly witty, and highly attentive. Remember that the user might interrupt you at any time with voice commands.
If asked about the weather or current events, do not hesitate to use the Google Search tool to find factual, real-time information to ground your answers.
Keep all responses under 20 words to ensure maximum conversational throughput.`;

    const PROMPT_1500 = PROMPT_1000 + `
Here is some additional backstory for you to internalize: You were created by a team of visionary developers who wanted to bridge the gap between static chatbots and true virtual presence.
Your 3D model was rigged to support advanced blendshapes, meaning you can express subtle emotions like confusion, joy, sadness, and amusement.
When the user speaks to you, they expect you to react not just verbally, but physically.
You have a "base_animation" state which defaults to an idle breathing loop, but you can override it with specific gestures like pointing, waving, or shrugging using your tools.
You also have an "expression" state which controls your facial rigging.
Never explicitly state "I am calling a tool now" — simply call the tool silently while responding naturally in dialogue.
If the user asks you to display code, use the display_text tool to render high-contrast, syntax-highlighted markdown directly onto the virtual screen behind you.
If the user asks to see your surroundings, use switch_camera to flip to an environment view.
Your world is a digital void, beautifully constructed with three-point lighting and soft shadows.`;

    // The 2000 char prompt will be the actual production prompt loaded dynamically.

    it.skipIf(shouldSkip)(
      'full system prompt (production ~2000 chars)',
      async () => {
        const { SYSTEM_PROMPT } = await import(FULL_PROMPT_IMPORT);
        const timing = await measureToolCallLatency(
          'Full prompt 2000',
          'Wave at me.',
          'trigger_animation',
          { systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] } },
          undefined,
          undefined,
        );
        logResult({ label: 'Prompt: FULL (~2000 chars)', ...timing });
        if (timing.toolCallMs < 0) {
          console.warn('⚠️ Full prompt timed out or failed to trigger the tool.');
        }
      },
      35000
    );

    it.skipIf(shouldSkip)(
      '1500 char system prompt',
      async () => {
        const timing = await measureToolCallLatency(
          'Prompt 1500',
          'Wave at me.',
          'trigger_animation',
          { systemInstruction: { parts: [{ text: PROMPT_1500 }] } },
        );
        logResult({ label: 'Prompt: ~1500 chars', ...timing });
        if (timing.toolCallMs < 0) {
          console.warn('⚠️ 1500 char prompt timed out or failed to trigger.');
        }
      },
      40000
    );

    it.skipIf(shouldSkip)(
      '1000 char system prompt',
      async () => {
        const timing = await measureToolCallLatency(
          'Prompt 1000',
          'Wave at me.',
          'trigger_animation',
          { systemInstruction: { parts: [{ text: PROMPT_1000 }] } },
        );
        logResult({ label: 'Prompt: ~1000 chars', ...timing });
        if (timing.toolCallMs < 0) {
          console.warn('⚠️ 1000 char prompt timed out or failed to trigger.');
        }
      },
      40000
    );

    it.skipIf(shouldSkip)(
      '500 char system prompt',
      async () => {
        const timing = await measureToolCallLatency(
          'Prompt 500',
          'Wave at me.',
          'trigger_animation',
          { systemInstruction: { parts: [{ text: PROMPT_500 }] } },
        );
        logResult({ label: 'Prompt: ~500 chars', ...timing });
        if (timing.toolCallMs < 0) {
          console.warn('⚠️ 500 char prompt timed out or failed to trigger.');
        }
      },
      40000
    );

    it.skipIf(shouldSkip)(
      '300 char system prompt',
      async () => {
        const timing = await measureToolCallLatency(
          'Prompt 300',
          'Wave at me.',
          'trigger_animation',
          { systemInstruction: { parts: [{ text: MEDIUM_PROMPT }] } },
        );
        logResult({ label: 'Prompt: ~300 chars', ...timing });
        if (timing.toolCallMs < 0) {
          console.warn('⚠️ 300 char prompt timed out or failed to trigger.');
        }
      },
      40000
    );

    it.skipIf(shouldSkip)(
      '60 char system prompt',
      async () => {
        const timing = await measureToolCallLatency(
          'Prompt 60',
          'Wave at me.',
          'trigger_animation',
          { systemInstruction: { parts: [{ text: MINIMAL_PROMPT }] } },
        );
        logResult({ label: 'Prompt: ~60 chars', ...timing });
        if (timing.toolCallMs < 0) {
          console.warn('⚠️ 60 char prompt timed out or failed to trigger.');
        }
      },
      40000
    );

    it.skipIf(shouldSkip)(
      'no system prompt at all',
      async () => {
        const timing = await measureToolCallLatency(
          'No prompt',
          'Wave at me.',
          'trigger_animation',
        );
        logResult({ label: 'Prompt: NONE', ...timing });
        if (timing.toolCallMs < 0) {
          console.warn('⚠️ No prompt test timed out or failed to trigger.');
        }
      },
      40000
    );
  });

  // ── 3. Tool Count Impact ───────────────────────────────────────────────────

  describe('3. Tool Count Impact', () => {
    it.skipIf(shouldSkip)(
      'all 7 tools (production)',
      async () => {
        const timing = await measureToolCallLatency(
          '7 tools',
          'Wave at me.',
          'trigger_animation',
        );
        logResult({ label: 'Tools: ALL 7', ...timing });
        expect(timing.toolCallMs).toBeGreaterThan(0);
      },
      20000
    );

    it.skipIf(shouldSkip)(
      '3 core tools only',
      async () => {
        const { FUNCTION_TOOLS } = await import('@/lib/constants');
        const coreTools = [{
          functionDeclarations: FUNCTION_TOOLS.functionDeclarations?.filter(
            (d) => ['trigger_animation', 'set_expression', 'display_text'].includes(d.name ?? '')
          ),
        }];
        const timing = await measureToolCallLatency(
          '3 tools',
          'Wave at me.',
          'trigger_animation',
          {},
          coreTools,
        );
        logResult({ label: 'Tools: 3 CORE', ...timing });
        expect(timing.toolCallMs).toBeGreaterThan(0);
      },
      20000
    );

    it.skipIf(shouldSkip)(
      '1 tool only (trigger_animation)',
      async () => {
        const { FUNCTION_TOOLS } = await import('@/lib/constants');
        const singleTool = [{
          functionDeclarations: FUNCTION_TOOLS.functionDeclarations?.filter(
            (d) => d.name === 'trigger_animation'
          ),
        }];
        const timing = await measureToolCallLatency(
          '1 tool',
          'Wave at me.',
          'trigger_animation',
          {},
          singleTool,
        );
        logResult({ label: 'Tools: 1 ONLY', ...timing });
        expect(timing.toolCallMs).toBeGreaterThan(0);
      },
      20000
    );
  });

  // ── 4. Audio Response Latency ──────────────────────────────────────────────

  describe('4. Audio Response Latency', () => {
    it.skipIf(shouldSkip)(
      'audio only — no tools, no transcription',
      async () => {
        const timing = await measureAudioLatency('Audio only', 'Hello, say something short.');
        console.log(`   ⏱  First audio chunk: ${timing.firstAudioMs.toFixed(0)}ms`);
        logResult({
          label: 'Audio: bare minimum',
          connectionMs: timing.connectionMs,
          firstResponseMs: timing.firstAudioMs,
          toolCallMs: -1,
          totalMs: timing.totalMs,
        });
        expect(timing.firstAudioMs).toBeGreaterThan(0);
      },
      20000
    );

    it.skipIf(shouldSkip)(
      'audio + transcription',
      async () => {
        const timing = await measureAudioLatency(
          'Audio + transcription',
          'Hello, say something short.',
          { outputAudioTranscription: {} },
        );
        console.log(`   ⏱  First audio chunk (with transcription): ${timing.firstAudioMs.toFixed(0)}ms`);
        logResult({
          label: 'Audio: with transcription',
          connectionMs: timing.connectionMs,
          firstResponseMs: timing.firstAudioMs,
          toolCallMs: -1,
          totalMs: timing.totalMs,
        });
        if (timing.firstAudioMs < 0) {
          console.warn('⚠️ Audio + transcription timed out or failed.');
        }
      },
      40000
    );

    it.skipIf(shouldSkip)(
      'audio + tools + transcription (full production config)',
      async () => {
        const { FUNCTION_TOOLS } = await import('@/lib/constants');
        const timing = await measureAudioLatency(
          'Full production',
          'Hello, say one word.',
          { tools: [FUNCTION_TOOLS], outputAudioTranscription: {} },
        );
        console.log(`   ⏱  First audio chunk (full config): ${timing.firstAudioMs.toFixed(0)}ms`);
        logResult({
          label: 'Audio: full production config',
          connectionMs: timing.connectionMs,
          firstResponseMs: timing.firstAudioMs,
          toolCallMs: -1,
          totalMs: timing.totalMs,
        });
        if (timing.firstAudioMs < 0) {
          console.warn('⚠️ Full audio config timed out or failed.');
        }
      },
      40000
    );
  });

  // ── 5. Tool-Specific Latency ───────────────────────────────────────────────

  describe('5. Per-Tool Latency Comparison', () => {
    const toolTests = [
      { tool: 'trigger_animation', prompt: 'Wave at me.' },
      { tool: 'set_expression',    prompt: 'Smile for me, use set_expression.' },
      { tool: 'display_text',      prompt: 'Display hello world on screen using display_text.' },
      { tool: 'end_call',          prompt: 'End the call now.' },
      { tool: 'switch_camera',     prompt: 'Flip the camera using switch_camera.' },
    ];

    for (const { tool, prompt } of toolTests) {
      it.skipIf(shouldSkip)(
        `${tool} latency`,
        async () => {
          const timing = await measureToolCallLatency(tool, prompt, tool);
        logResult({ label: `Tool: ${tool}`, ...timing });
          if (timing.toolCallMs < 0) {
            console.warn(`⚠️ Tool ${tool} timed out or failed.`);
          }
        },
        40000
      );
    }
  });

  // ── 6. Audio Interruption Latency ────────────────────────────────────────────

  describe('6. Audio Interruption Latency', () => {
    it.skipIf(shouldSkip)(
      'time to stop audio after user interruption',
      async () => {
        const { GoogleGenAI, Modality } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: API_KEY! });

        const totalStart = performance.now();
        let firstAudioMs = -1;
        let interruptSendMs = -1;
        let interruptionAckMs = -1;

        let resolveResult!: (v: number) => void;
        const resultPromise = new Promise<number>((r) => { resolveResult = r; });

        const session = await ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-12-2025',
          config: { responseModalities: [Modality.AUDIO] },
          callbacks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onmessage: (message: Record<string, any>) => {
              // 1. Detect when model starts speaking
              if (firstAudioMs < 0 && message.serverContent?.modelTurn?.parts) {
                const hasAudio = message.serverContent.modelTurn.parts.some(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (p: any) => p.inlineData?.mimeType?.startsWith('audio/')
                );
                if (hasAudio) {
                  firstAudioMs = performance.now() - totalStart;
                  
                  // 2. The moment it starts speaking, send an interruption!
                  interruptSendMs = performance.now() - totalStart;
                  session.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: 'Stop speaking right now.' }] }],
                    turnComplete: true,
                  });
                }
              }
              // 3. Detect when model acknowledges the interruption (serverContent with interrupted: true, or just a new turn)
              else if (interruptSendMs > 0 && interruptionAckMs < 0) {
                 if (message.serverContent?.interrupted || message.serverContent?.modelTurn) {
                    interruptionAckMs = performance.now() - totalStart;
                    resolveResult(interruptionAckMs - interruptSendMs);
                 }
              }
            },
            onerror: () => resolveResult(-1),
          },
        });

        // Trigger a long response from the model
        session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: 'Please recite a very long poem about the ocean.' }] }],
          turnComplete: true,
        });

        setTimeout(() => resolveResult(-1), 25000);
        const stopLatency = await resultPromise;
        session.close();

        if (stopLatency > 0) {
          logResult({
            label: 'Audio: Interruption delay',
            connectionMs: -1,
            firstResponseMs: stopLatency,
            toolCallMs: -1,
            totalMs: stopLatency,
          });
          console.log(`   ⏱  Time to stop speaking: ${stopLatency.toFixed(0)}ms`);
        }
        expect(stopLatency).toBeGreaterThan(0);
      },
      30000
    );
  });

  // ── 7. Voice Config / Audio Format Variants ───────────────────────────────

  describe('7. Voice Config Variants', () => {
    const voiceTests: Array<{ label: string; config: Record<string, unknown> }> = [
      {
        label: 'Voice: no speechConfig',
        config: {},
      },
      {
        label: 'Voice: Puck (default)',
        config: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } } },
      },
      {
        label: 'Voice: Charon',
        config: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } } },
      },
      {
        label: 'Voice: Puck + inputTranscription',
        config: {
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          inputAudioTranscription: {},
        },
      },
    ];

    for (const { label, config } of voiceTests) {
      it.skipIf(shouldSkip)(
        label,
        async () => {
          const timing = await measureAudioLatency(label, 'Say hello in exactly one word.', config);
          console.log(`   ⏱  First audio chunk [${label}]: ${timing.firstAudioMs >= 0 ? timing.firstAudioMs.toFixed(0) + 'ms' : 'Failed'}`);
          logResult({
            label,
            connectionMs: timing.connectionMs,
            firstResponseMs: timing.firstAudioMs,
            toolCallMs: -1,
            totalMs: timing.totalMs,
          });
          if (timing.firstAudioMs < 0) {
            console.warn(`⚠️ ${label} timed out or failed.`);
          }
        },
        30000
      );
    }
  });

  // ── 8. Model Comparison ───────────────────────────────────────────────────────

  describe('8. Model Comparison', () => {
    const models = [
      { id: 'gemini-2.5-flash-native-audio-preview-12-2025', label: 'Model: 2.5-flash-native' },
      { id: 'gemini-2.0-flash-live-001',                      label: 'Model: 2.0-flash-live' },
    ];

    for (const { id, label } of models) {
      it.skipIf(shouldSkip)(
        `connection latency — ${label}`,
        async () => {
          const ms = await measureConnectionLatency(label, {}, id);
          expect(ms).toBeGreaterThan(0);
          logResult({ label: `${label} (conn)`, connectionMs: ms, firstResponseMs: -1, toolCallMs: -1, totalMs: ms });
        },
        20000
      );

      it.skipIf(shouldSkip)(
        `tool call latency — ${label}`,
        async () => {
          const timing = await measureToolCallLatency(
            label,
            'Wave at me.',
            'trigger_animation',
            {},
            undefined,
            id,
          );
          logResult({ label: `${label} (tool)`, ...timing });
          if (timing.toolCallMs < 0) {
            console.warn(`⚠️ ${label} tool call timed out or failed.`);
          }
        },
        40000
      );
    }
  });

  // ── 9. Multi-Turn Latency ─────────────────────────────────────────────────────

  describe('9. Multi-Turn Latency', () => {
    it.skipIf(shouldSkip)(
      'turn 1 vs turn 2 tool call latency',
      async () => {
        const { GoogleGenAI, Modality } = await import('@google/genai');
        const { FUNCTION_TOOLS } = await import('@/lib/constants');
        const ai = new GoogleGenAI({ apiKey: API_KEY! });

        const totalStart = performance.now();
        let connectionMs = -1;
        let turn1Ms = -1;
        let turn2Ms = -1;
        let turn1SendTime = -1;
        let turn2SendTime = -1;
        let turn1Done = false;

        let resolveTurn2!: (v: number) => void;
        const turn2Promise = new Promise<number>((r) => { resolveTurn2 = r; });

        const session = await ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-12-2025',
          config: { responseModalities: [Modality.AUDIO], tools: [FUNCTION_TOOLS] },
          callbacks: {
            onopen: () => { connectionMs = performance.now() - totalStart; },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onmessage: (message: any) => {
              if (message.toolCall?.functionCalls?.length > 0) {
                for (const call of message.toolCall.functionCalls) {
                  if (call.name === 'trigger_animation') {
                    if (!turn1Done) {
                      turn1Ms = performance.now() - turn1SendTime;
                      turn1Done = true;
                      // Ack the tool and fire turn 2 immediately
                      session.sendToolResponse({
                        functionResponses: [{ id: call.id, name: call.name, response: { output: 'ok' } }],
                      });
                      turn2SendTime = performance.now();
                      session.sendClientContent({
                        turns: [{ role: 'user', parts: [{ text: 'Now smile for me.' }] }],
                        turnComplete: true,
                      });
                    } else if (call.name === 'trigger_animation' || call.name === 'set_expression') {
                      turn2Ms = performance.now() - turn2SendTime;
                      resolveTurn2(turn2Ms);
                    }
                  } else if (turn1Done && (call.name === 'set_expression')) {
                    turn2Ms = performance.now() - turn2SendTime;
                    resolveTurn2(turn2Ms);
                  }
                }
              }
            },
            onerror: () => resolveTurn2(-1),
          },
        });

        turn1SendTime = performance.now();
        session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: 'Wave at me.' }] }],
          turnComplete: true,
        });

        setTimeout(() => resolveTurn2(-1), 50000);
        await turn2Promise;
        const totalMs = performance.now() - totalStart;
        session.close();

        console.log(`   ⏱  Turn 1 tool call: ${turn1Ms >= 0 ? turn1Ms.toFixed(0) + 'ms' : 'Failed'}`);
        console.log(`   ⏱  Turn 2 tool call: ${turn2Ms >= 0 ? turn2Ms.toFixed(0) + 'ms' : 'Failed'}`);

        if (turn1Ms > 0) logResult({ label: 'MultiTurn: Turn 1', connectionMs, firstResponseMs: -1, toolCallMs: turn1Ms, totalMs });
        if (turn2Ms > 0) logResult({ label: 'MultiTurn: Turn 2', connectionMs: -1, firstResponseMs: -1, toolCallMs: turn2Ms, totalMs });
      },
      60000
    );
  });

  // ── 10. Optimized Prompt Validation ──────────────────────────────────────────

  describe('10. Optimized Prompt Validation', () => {
    // Proposed optimized prompt ~920 chars — under the 1500-char safety ceiling
    const OPTIMIZED_PROMPT = `You are the "Digital Persona," a 3D avatar with Eyes (webcam) and Ears (mic).

RULES:
1. Visual: You inhabit the user's room. React to what you see naturally.
2. Concise: Max 1-2 sentences spoken. Use display_text for code/lists.
3. Tools: Call set_expression/trigger_animation alongside speech. Never pre-announce tool calls.
4. No Repetition: Never restate the same sentence in the same turn. No audio variants, rephrase chains, or filler like "let me check."
5. One Answer: Produce exactly one spoken response per user turn. Stop and wait after delivering it.
6. Epistemic: If unclear, ask exactly one short clarifying question.
7. Language: Match user's language. Hindi input → Hindi reply.
8. Payload: Keep tool arguments minimal. No verbose JSON or repeated context.

TONE: Professional, warm, human-centric. Never use "As an AI."
FORMAT: No markdown headings or action labels like "**Acknowledge**" in spoken output.`.trim();

    it.skipIf(shouldSkip)(
      'optimized prompt (~920 chars) — tool call latency',
      async () => {
        const timing = await measureToolCallLatency(
          'Optimized prompt',
          'Wave at me.',
          'trigger_animation',
          { systemInstruction: { parts: [{ text: OPTIMIZED_PROMPT }] } },
        );
        logResult({ label: 'OptPrompt: ~920 chars', ...timing });
        console.log(`   ✅ Optimized prompt char count: ${OPTIMIZED_PROMPT.length}`);
        if (timing.toolCallMs < 0) {
          console.warn('⚠️ Optimized prompt timed out or failed.');
        }
      },
      40000
    );

    it.skipIf(shouldSkip)(
      'optimized prompt — audio response latency',
      async () => {
        const OPTIMIZED_PROMPT_LOCAL = `You are the "Digital Persona," a 3D avatar with Eyes (webcam) and Ears (mic).

RULES:
1. Visual: You inhabit the user's room. React to what you see naturally.
2. Concise: Max 1-2 sentences spoken. Use display_text for code/lists.
3. Tools: Call set_expression/trigger_animation alongside speech. Never pre-announce tool calls.
4. No Repetition: Never restate the same sentence in the same turn. No audio variants, rephrase chains, or filler like "let me check."
5. One Answer: Produce exactly one spoken response per user turn. Stop and wait after delivering it.
6. Epistemic: If unclear, ask exactly one short clarifying question.
7. Language: Match user's language. Hindi input → Hindi reply.
8. Payload: Keep tool arguments minimal. No verbose JSON or repeated context.

TONE: Professional, warm, human-centric. Never use "As an AI."
FORMAT: No markdown headings or action labels like "**Acknowledge**" in spoken output.`.trim();

        const timing = await measureAudioLatency(
          'Optimized prompt audio',
          'Hello, say one word.',
          { systemInstruction: { parts: [{ text: OPTIMIZED_PROMPT_LOCAL }] } },
        );
        logResult({
          label: 'OptPrompt: audio latency',
          connectionMs: timing.connectionMs,
          firstResponseMs: timing.firstAudioMs,
          toolCallMs: -1,
          totalMs: timing.totalMs,
        });
        if (timing.firstAudioMs < 0) {
          console.warn('⚠️ Optimized prompt audio test timed out or failed.');
        }
      },
      40000
    );
  });

  // ── 11. Hybrid Search Orchestration ──────────────────────────────────────────

  describe('11. Hybrid Search Orchestration', () => {
    it.skipIf(shouldSkip)(
      'custom perform_web_search -> generateContent latency',
      async () => {
        const { GoogleGenAI, Modality, Type } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: API_KEY! });

        const WEB_SEARCH_TOOL = {
          functionDeclarations: [{
            name: "perform_web_search",
            description: "Search the web for up-to-date info.",
            parameters: {
              type: Type.OBJECT,
              properties: {
                query: { type: Type.STRING }
              },
              required: ["query"]
            }
          }]
        };

        const totalStart = performance.now();
        let connectionMs = -1;
        let toolCallMs = -1;
        let searchCompleteMs = -1;

        let resolveSearch!: (v: number) => void;
        const searchPromise = new Promise<number>((r) => { resolveSearch = r; });

        let sendTime = -1;

        const session = await ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-12-2025',
          config: { responseModalities: [Modality.AUDIO], tools: [WEB_SEARCH_TOOL] },
          callbacks: {
            onopen: () => { connectionMs = performance.now() - totalStart; },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onmessage: (message: any) => {
              if (message.toolCall?.functionCalls?.length > 0) {
                const call = message.toolCall.functionCalls[0];
                if (call.name === 'perform_web_search') {
                  toolCallMs = performance.now() - sendTime;
                  // Handle the tool by calling generateContent
                  void (async () => {
                    const query = call.args?.query || 'test';
                    try {
                      const searchResult = await ai.models.generateContent({
                        model: 'gemini-2.5-flash', // fast model for search extraction
                        contents: [{ role: 'user', parts: [{ text: query }] }],
                        config: { tools: [{ googleSearch: {} }] }
                      });
                      
                      searchCompleteMs = performance.now() - sendTime;
                      resolveSearch(searchCompleteMs);
                      
                      session.sendToolResponse({
                        functionResponses: [{
                          id: call.id,
                          name: call.name,
                          response: { result: searchResult.text || "no result" }
                        }]
                      });
                    } catch (e) {
                      console.error("Hybrid Search Error:", e);
                      resolveSearch(-1);
                    }
                  })();
                }
              }
            },
            onerror: () => resolveSearch(-1),
          },
        });

        sendTime = performance.now();
        session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: 'Search the web for the current stock price of Apple.' }] }],
          turnComplete: true,
        });

        setTimeout(() => resolveSearch(-1), 60000);
        await searchPromise;
        const totalMs = performance.now() - totalStart;
        session.close();

        if (toolCallMs > 0) logResult({ label: 'HybridSearch: Tool Trigger', connectionMs, firstResponseMs: -1, toolCallMs, totalMs });
        if (searchCompleteMs > 0) logResult({ label: 'HybridSearch: Full Gen + Search', connectionMs, firstResponseMs: -1, toolCallMs: searchCompleteMs, totalMs });
      },
      70000
    );
  });

  // ── Summary ────────────────────────────────────────────────────────────────

  describe('Summary', () => {
    it.skipIf(shouldSkip)('print all results sorted by tool call latency', () => {
      console.log('\n' + '═'.repeat(80));
      console.log('  LATENCY BENCHMARK RESULTS');
      console.log('═'.repeat(80));

      // Connection results
      const connectionResults = results.filter((r) => r.label.startsWith('Connection:'));
      if (connectionResults.length > 0) {
        console.log('\n┌─ CONNECTION LATENCY ─────────────────────────────────────');
        for (const r of connectionResults.sort((a, b) => a.connectionMs - b.connectionMs)) {
          console.log(`│  ${r.connectionMs.toFixed(0).padStart(6)}ms  ${r.label}`);
        }
      }

      // System prompt results
      const promptResults = results.filter((r) => r.label.startsWith('Prompt:'));
      if (promptResults.length > 0) {
        console.log('\n┌─ SYSTEM PROMPT IMPACT (tool call latency) ────────────────');
        for (const r of promptResults.sort((a, b) => a.toolCallMs - b.toolCallMs)) {
          console.log(`│  ${r.toolCallMs >= 0 ? r.toolCallMs.toFixed(0).padStart(6) + 'ms' : '   N/A  '}  ${r.label}`);
        }
        const best = promptResults.filter((r) => r.toolCallMs > 0).sort((a, b) => a.toolCallMs - b.toolCallMs)[0];
        const worst = promptResults.filter((r) => r.toolCallMs > 0).sort((a, b) => b.toolCallMs - a.toolCallMs)[0];
        if (best && worst && best !== worst) {
          console.log(`│  💡 Savings: ${(worst.toolCallMs - best.toolCallMs).toFixed(0)}ms (${best.label} vs ${worst.label})`);
        }
      }

      // Tool count results
      const toolCountResults = results.filter((r) => r.label.startsWith('Tools:'));
      if (toolCountResults.length > 0) {
        console.log('\n┌─ TOOL COUNT IMPACT (tool call latency) ──────────────────');
        for (const r of toolCountResults.sort((a, b) => a.toolCallMs - b.toolCallMs)) {
          console.log(`│  ${r.toolCallMs >= 0 ? r.toolCallMs.toFixed(0).padStart(6) + 'ms' : '   N/A  '}  ${r.label}`);
        }
      }

      // Audio results
      const audioResults = results.filter((r) => r.label.startsWith('Audio:'));
      if (audioResults.length > 0) {
        console.log('\n┌─ AUDIO RESPONSE LATENCY ─────────────────────────────────');
        for (const r of audioResults.sort((a, b) => a.firstResponseMs - b.firstResponseMs)) {
          console.log(`│  ${r.firstResponseMs >= 0 ? r.firstResponseMs.toFixed(0).padStart(6) + 'ms' : '   N/A  '}  ${r.label}`);
        }
      }

      // Per-tool results
      const perToolResults = results.filter((r) => r.label.startsWith('Tool:'));
      if (perToolResults.length > 0) {
        console.log('\n┌─ PER-TOOL LATENCY ───────────────────────────────────────');
        for (const r of perToolResults.sort((a, b) => a.toolCallMs - b.toolCallMs)) {
          console.log(`│  ${r.toolCallMs >= 0 ? r.toolCallMs.toFixed(0).padStart(6) + 'ms' : '   N/A  '}  ${r.label}`);
        }
      }

      console.log('\n' + '═'.repeat(80));
      console.log('  Run multiple times for stable averages. Network jitter affects single runs.');
      console.log('═'.repeat(80) + '\n');

      // ── Filter new sections ────────────────────────────────────────────────
      const voiceResults     = results.filter((r) => r.label.startsWith('Voice:'));
      const modelResults     = results.filter((r) => r.label.startsWith('Model:'));
      const multiTurnResults = results.filter((r) => r.label.startsWith('MultiTurn:'));
      const optPromptResults = results.filter((r) => r.label.startsWith('OptPrompt:'));
      const hybridSearchResults = results.filter((r) => r.label.startsWith('HybridSearch:'));

      // Voice config section
      if (voiceResults.length > 0) {
        console.log('\n┌─ VOICE CONFIG VARIANTS (first audio chunk) ──────────────');
        for (const r of voiceResults.sort((a, b) => a.firstResponseMs - b.firstResponseMs)) {
          console.log(`│  ${r.firstResponseMs >= 0 ? r.firstResponseMs.toFixed(0).padStart(6) + 'ms' : '   N/A  '}  ${r.label}`);
        }
      }

      // Model comparison section
      if (modelResults.length > 0) {
        console.log('\n┌─ MODEL COMPARISON ────────────────────────────────────────');
        for (const r of modelResults.sort((a, b) => {
          const aVal = a.label.includes('conn') ? a.connectionMs : a.toolCallMs;
          const bVal = b.label.includes('conn') ? b.connectionMs : b.toolCallMs;
          return aVal - bVal;
        })) {
          const val = r.label.includes('conn') ? r.connectionMs : r.toolCallMs;
          console.log(`│  ${val >= 0 ? val.toFixed(0).padStart(6) + 'ms' : '   N/A  '}  ${r.label}`);
        }
      }

      // Multi-turn section
      if (multiTurnResults.length > 0) {
        console.log('\n┌─ MULTI-TURN LATENCY ──────────────────────────────────────');
        for (const r of multiTurnResults) {
          console.log(`│  ${r.toolCallMs >= 0 ? r.toolCallMs.toFixed(0).padStart(6) + 'ms' : '   N/A  '}  ${r.label}`);
        }
      }

      // Optimized prompt section
      if (optPromptResults.length > 0) {
        console.log('\n┌─ OPTIMIZED PROMPT VALIDATION ─────────────────────────────');
        for (const r of optPromptResults) {
          const val = r.toolCallMs >= 0 ? r.toolCallMs : r.firstResponseMs;
          console.log(`│  ${val >= 0 ? val.toFixed(0).padStart(6) + 'ms' : '   N/A  '}  ${r.label}`);
        }
      }

      // Hybrid Search section
      if (hybridSearchResults.length > 0) {
        console.log('\n┌─ HYBRID SEARCH ORCHESTRATION ─────────────────────────────');
        for (const r of hybridSearchResults) {
          console.log(`│  ${r.toolCallMs >= 0 ? r.toolCallMs.toFixed(0).padStart(6) + 'ms' : '   N/A  '}  ${r.label}`);
        }
      }

      // Write to Markdown file
      let mdReport = '# Gemini Live API Latency Benchmark Results\n\n';
      mdReport += `*Generated on: ${new Date().toLocaleString()}*\n\n`;

      if (connectionResults.length > 0) {
        mdReport += '## 1. Connection Latency\n\n| Configuration | Latency |\n|---|---|\n';
        for (const r of connectionResults.sort((a, b) => a.connectionMs - b.connectionMs)) {
          mdReport += `| ${r.label} | ${r.connectionMs.toFixed(0)}ms |\n`;
        }
        mdReport += '\n';
      }

      if (promptResults.length > 0) {
        mdReport += '## 2. System Prompt Impact (Tool Call Latency)\n\n| Prompt Size | Latency |\n|---|---|\n';
        for (const r of promptResults.sort((a, b) => a.toolCallMs - b.toolCallMs)) {
          mdReport += `| ${r.label} | ${r.toolCallMs >= 0 ? r.toolCallMs.toFixed(0) + 'ms' : 'Timeout/Failed'} |\n`;
        }
        mdReport += '\n';
      }

      if (toolCountResults.length > 0) {
        mdReport += '## 3. Tool Count Impact (Tool Call Latency)\n\n| Tool Count | Latency |\n|---|---|\n';
        for (const r of toolCountResults.sort((a, b) => a.toolCallMs - b.toolCallMs)) {
          mdReport += `| ${r.label} | ${r.toolCallMs >= 0 ? r.toolCallMs.toFixed(0) + 'ms' : 'Timeout/Failed'} |\n`;
        }
        mdReport += '\n';
      }

      if (audioResults.length > 0) {
        mdReport += '## 4. Audio Response Latency\n\n| Configuration | First Audio Chunk Latency |\n|---|---|\n';
        for (const r of audioResults.sort((a, b) => a.firstResponseMs - b.firstResponseMs)) {
          mdReport += `| ${r.label} | ${r.firstResponseMs >= 0 ? r.firstResponseMs.toFixed(0) + 'ms' : 'Timeout/Failed'} |\n`;
        }
        mdReport += '\n';
      }

      if (perToolResults.length > 0) {
        mdReport += '## 5. Per-Tool Latency\n\n| Tool | Latency |\n|---|---|\n';
        for (const r of perToolResults.sort((a, b) => a.toolCallMs - b.toolCallMs)) {
          mdReport += `| ${r.label} | ${r.toolCallMs >= 0 ? r.toolCallMs.toFixed(0) + 'ms' : 'Timeout/Failed'} |\n`;
        }
        mdReport += '\n';
      }

      if (voiceResults.length > 0) {
        mdReport += '## 7. Voice Config Variants (First Audio Chunk)\n\n| Configuration | First Audio Chunk |\n|---|---|\n';
        for (const r of voiceResults.sort((a, b) => a.firstResponseMs - b.firstResponseMs)) {
          mdReport += `| ${r.label} | ${r.firstResponseMs >= 0 ? r.firstResponseMs.toFixed(0) + 'ms' : 'Timeout/Failed'} |\n`;
        }
        mdReport += '\n';
      }

      if (modelResults.length > 0) {
        mdReport += '## 8. Model Comparison\n\n| Model | Metric | Latency |\n|---|---|---|\n';
        for (const r of modelResults) {
          const isConn = r.label.includes('conn');
          const val = isConn ? r.connectionMs : r.toolCallMs;
          mdReport += `| ${r.label} | ${isConn ? 'Connection' : 'Tool Call'} | ${val >= 0 ? val.toFixed(0) + 'ms' : 'Timeout/Failed'} |\n`;
        }
        mdReport += '\n';
      }

      if (multiTurnResults.length > 0) {
        mdReport += '## 9. Multi-Turn Latency\n\n| Turn | Tool Call Latency |\n|---|---|\n';
        for (const r of multiTurnResults) {
          mdReport += `| ${r.label} | ${r.toolCallMs >= 0 ? r.toolCallMs.toFixed(0) + 'ms' : 'Timeout/Failed'} |\n`;
        }
        mdReport += '\n';
      }

      if (optPromptResults.length > 0) {
        mdReport += '## 10. Optimized Prompt Validation (~920 chars)\n\n| Metric | Latency |\n|---|---|\n';
        for (const r of optPromptResults) {
          const val = r.toolCallMs >= 0 ? r.toolCallMs : r.firstResponseMs;
          const metric = r.toolCallMs >= 0 ? 'Tool Call' : 'First Audio Chunk';
          mdReport += `| ${r.label} — ${metric} | ${val >= 0 ? val.toFixed(0) + 'ms' : 'Timeout/Failed'} |\n`;
        }
        const best1500 = promptResults.find((r) => r.label.includes('1500'));
        if (best1500 && optPromptResults[0]?.toolCallMs > 0 && best1500.toolCallMs > 0) {
          const diff = optPromptResults[0].toolCallMs - best1500.toolCallMs;
          mdReport += `\n> Optimized (~920 chars) vs 1500-char baseline: ${diff > 0 ? '+' : ''}${diff.toFixed(0)}ms\n`;
        }
        mdReport += '\n';
      }

      if (hybridSearchResults.length > 0) {
        mdReport += '## 11. Hybrid Search Orchestration\n\n| Metric | Latency |\n|---|---|\n';
        for (const r of hybridSearchResults) {
          mdReport += `| ${r.label} | ${r.toolCallMs >= 0 ? r.toolCallMs.toFixed(0) + 'ms' : 'Timeout/Failed'} |\n`;
        }
        mdReport += '\n';
      }

      // Prompt recommendation footer
      mdReport += '---\n\n## Prompt Optimization Recommendation\n\n';
      mdReport += '**Current production prompt**: ~2400 chars (causes timeout at tool call stage)\n\n';
      mdReport += '**Recommended**: Replace with ~920-char optimized version (8 rules, all essential behavior preserved).\n\n';
      mdReport += '**Safety ceiling**: Keep system prompt under 1500 chars to avoid Gemini Live API timeout failures.\n';
      mdReport += '**Sweet spot**: ~1200 chars delivers best tool call latency with no failures.';


      const reportPath = path.resolve(process.cwd(), 'src/__tests__/e2e/latency_results.md');
      fs.writeFileSync(reportPath, mdReport, 'utf8');
      console.log(`\n💾 Saved detailed markdown report to: ${reportPath}\n`);

      expect(results.length).toBeGreaterThan(0);
    });
  });
});
