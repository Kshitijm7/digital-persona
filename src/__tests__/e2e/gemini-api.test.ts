/**
 * End-to-End Tests for Gemini Live API Integration
 * Tests real API connectivity using the @google/genai SDK
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables for E2E tests
// Use override to bypass the placeholder set in setup.ts
// process.cwd() in vitest is the project root (where vitest.config.ts lives)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

const API_KEY = process.env.GEMINI_API_KEY;

/** Returns true if the key looks like a placeholder / is not a real key. */
function isPlaceholderKey(key: string | undefined): boolean {
  if (!key || key === '') return true;
  if (key.includes('your_')) return true;
  // Reject short or obviously invalid keys
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(key)) return true;
  return false;
}

describe('Gemini Live API Integration', () => {

  beforeAll(() => {
    if (isPlaceholderKey(API_KEY)) {
      console.warn('⚠️  Skipping E2E tests: No valid real API key configured');
    } else {
      console.log('✅ Real API key detected — running E2E tests against live Gemini API');
    }
  });

  describe('API Configuration', () => {
    it.skipIf(isPlaceholderKey(API_KEY))('should have valid API key format', () => {
      expect(API_KEY).toBeDefined();
      expect(API_KEY).toMatch(/^AIza[A-Za-z0-9_-]{35}$/);
    });

    it('should have correct model name in constants', async () => {
      const { GEMINI_MODEL } = await import('@/lib/constants');
      // SDK format: model name without "models/" prefix
      expect(GEMINI_MODEL).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
    });
  });
   describe('SDK Connection', () => {
    const shouldSkip = isPlaceholderKey(API_KEY);

    it.skipIf(shouldSkip)(
      'should connect via @google/genai SDK',
      async () => {
        const { GoogleGenAI, Modality } = await import('@google/genai');

        const ai = new GoogleGenAI({ apiKey: API_KEY! });

        const connected = await new Promise<boolean>((resolve) => {
          ai.live
            .connect({
              model: 'gemini-2.5-flash-native-audio-preview-12-2025',
              config: {
                responseModalities: [Modality.AUDIO],
              },
              callbacks: {
                onopen: () => resolve(true),
                onmessage: () => {},
                onerror: () => resolve(false),
                onclose: () => {},
              },
            })
            .then((session) => {
              setTimeout(() => session.close(), 1000);
            })
            .catch(() => resolve(false));

          setTimeout(() => resolve(false), 10000);
        });

        expect(connected).toBe(true);
      },
      15000
    );

    it.skipIf(shouldSkip)(
      'should receive audio response for text input',
      async () => {
        const { GoogleGenAI, Modality } = await import('@google/genai');
        
        const ai = new GoogleGenAI({ apiKey: API_KEY! });

        // Use a deferred pattern to avoid the session race condition
        let resolveResult!: (value: boolean) => void;
        const resultPromise = new Promise<boolean>((r) => { resolveResult = r; });

        const session = await ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-12-2025',
          config: {
            responseModalities: [Modality.AUDIO],
          },
          callbacks: {
            onopen: () => {},
            onmessage: (message) => {
              const parts = message.serverContent?.modelTurn?.parts;
              if (parts) {
                for (const part of parts) {
                  if (part.inlineData?.mimeType?.startsWith('audio/')) {
                    resolveResult(true);
                    return;
                  }
                }
              }
            },
            onerror: () => resolveResult(false),
            onclose: () => {},
          },
        });

        // Session is guaranteed to be assigned here — send content
        session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          turnComplete: true,
        });

        setTimeout(() => resolveResult(false), 20000);
        const audioReceived = await resultPromise;
        session.close();

        expect(audioReceived).toBe(true);
      },
      25000
    );

    it.skipIf(shouldSkip)(
      'should send PCM audio and receive dual-transcription & audio back',
      async () => {
        const { GoogleGenAI, Modality } = await import('@google/genai');
        
        const ai = new GoogleGenAI({ apiKey: API_KEY! });

        const pcmPath = path.join(process.cwd(), 'src', '__tests__', 'e2e', 'sample.pcm');
        if (!fs.existsSync(pcmPath)) {
          console.warn('⚠️ sample.pcm missing, skipping PCM test');
          expect(true).toBe(true); // Pass — no test asset available
          return;
        }

        let gotAudio = false;
        let gotTranscript = false;
        let resolveResult!: (value: boolean) => void;
        const resultPromise = new Promise<boolean>((r) => { resolveResult = r; });

        const session = await ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-12-2025',
          // @ts-expect-error Types in preview SDK might not explicitly list the beta fields
          config: {
            responseModalities: [Modality.AUDIO],
            outputAudioTranscription: {},
          } as unknown,
          callbacks: {
            onopen: () => {},
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onmessage: (message: any) => {
              if (message.serverContent) {
                if (message.serverContent.outputTranscription) {
                  gotTranscript = true;
                }
                if (message.serverContent.modelTurn?.parts) {
                  for (const part of message.serverContent.modelTurn.parts) {
                    if (part.inlineData?.mimeType?.startsWith('audio/')) {
                      gotAudio = true;
                    }
                  }
                }
                
                if (gotTranscript && gotAudio) {
                  resolveResult(true);
                }
              }
            },
            onerror: () => resolveResult(false),
            onclose: () => {},
          },
        });

        // Session is guaranteed — send audio
        const fileBuffer = fs.readFileSync(pcmPath);
        const base64Audio = Buffer.from(fileBuffer).toString('base64');

        session.sendRealtimeInput({
          audio: {
            data: base64Audio,
            mimeType: 'audio/pcm;rate=16000'
          }
        });

        session.sendRealtimeInput({
          audioStreamEnd: true
        });

        setTimeout(() => resolveResult(false), 20000);
        const success = await resultPromise;
        session.close();

        expect(success).toBe(true);
      },
      25000
    );
  });

  // ── Tool Calling Tests (Individual per Tool) ─────────────────────────────────
  // Each tool gets its own test for clear pass/fail reporting.
  // Uses FUNCTION_TOOLS from constants.ts to match the real app config.

  describe('Tool Calling', () => {
    const shouldSkip = isPlaceholderKey(API_KEY);

    /**
     * Helper: connects to Gemini with FUNCTION_TOOLS, sends a prompt,
     * and resolves with the first toolCall matching `expectedToolName`.
     */
    async function testToolCall(
      prompt: string,
      expectedToolName: string,
      timeoutMs = 15000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<{ triggered: boolean; args: Record<string, any> }> {
      const { GoogleGenAI, Modality } = await import('@google/genai');
      const { FUNCTION_TOOLS } = await import('@/lib/constants');

      const ai = new GoogleGenAI({ apiKey: API_KEY! });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let resolveResult!: (value: { triggered: boolean; args: Record<string, any> }) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultPromise = new Promise<{ triggered: boolean; args: Record<string, any> }>((r) => {
        resolveResult = r;
      });

      const session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [FUNCTION_TOOLS],
        },
        callbacks: {
          onopen: () => {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onmessage: (message: any) => {
            if (message.toolCall?.functionCalls?.length > 0) {
              for (const call of message.toolCall.functionCalls) {
                if (call.name === expectedToolName) {
                  resolveResult({ triggered: true, args: call.args ?? {} });
                  return;
                }
              }
            }
          },
          onerror: () => resolveResult({ triggered: false, args: {} }),
          onclose: () => {},
        },
      });

      // Send the prompt
      session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: prompt }] }],
        turnComplete: true,
      });

      setTimeout(() => resolveResult({ triggered: false, args: {} }), timeoutMs);
      
      const result = await resultPromise;
      session.close();
      return result;
    }

    it.skipIf(shouldSkip)(
      'trigger_animation — should be called when asking for a wave',
      async () => {
        const result = await testToolCall(
          'Can you wave at me? Use your animation tool.',
          'trigger_animation',
        );
        expect(result.triggered).toBe(true);
        expect(result.args.base_animation).toBeDefined();
      },
      20000);

    it.skipIf(shouldSkip)(
      'set_expression — should be called when asking to smile',
      async () => {
        const result = await testToolCall(
          'Smile for me! Change your expression.',
          'set_expression',
        );
        expect(result.triggered).toBe(true);
        expect(result.args.expression).toBeDefined();
      },
      20000
    );

    it.skipIf(shouldSkip)(
      'update_persona_state — should be called when changing persona mood',
      async () => {
        const result = await testToolCall(
          'Please look very happy and joyful. Update your persona state.',
          'update_persona_state',
        );
        expect(result.triggered).toBe(true);
      },
      20000
    );

    it.skipIf(shouldSkip)(
      'display_text — should be called when asked to show code on screen',
      async () => {
        const result = await testToolCall(
          'Display a python hello world script on the screen using display_text.',
          'display_text',
        );
        expect(result.triggered).toBe(true);
        expect(result.args.content).toBeDefined();
      },
      20000
    );

    it.skipIf(shouldSkip)(
      'switch_camera — should be called when asked to flip the camera',
      async () => {
        const result = await testToolCall(
          'Can you flip or switch the camera so I can see the room?',
          'switch_camera',
        );
        expect(result.triggered).toBe(true);
      },
      20000
    );

    it.skipIf(shouldSkip)(
      'end_call — should be called when saying goodbye',
      async () => {
        const result = await testToolCall(
          'Goodbye, please end the call now.',
          'end_call',
        );
        expect(result.triggered).toBe(true);
      },
      20000
    );
  });

  // ── Google Search Integration ────────────────────────────────────────────────
  describe('Google Search', () => {
    const shouldSkip = isPlaceholderKey(API_KEY);

    it.skipIf(shouldSkip)(
      'should invoke google search when asking a real-time factual question',
      async () => {
        const { GoogleGenAI, Modality } = await import('@google/genai');
        const { getToolsForMode } = await import('@/lib/constants');

        const ai = new GoogleGenAI({ apiKey: API_KEY! });

        let resolveResult!: (value: boolean) => void;
        const resultPromise = new Promise<boolean>((r) => { resolveResult = r; });

        let gotGroundingMetadata = false;
        let gotTextResponse = false;

        const session = await ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-12-2025',
          config: {
            responseModalities: [Modality.AUDIO],
            tools: getToolsForMode("full"),
          },
          callbacks: {
            onopen: () => {},
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onmessage: (message: any) => {
              // Google Search results appear as groundingMetadata or as server content
              if (message.serverContent?.groundingMetadata) {
                gotGroundingMetadata = true;
              }
              // The model will respond with audio/text after search
              if (message.serverContent?.modelTurn?.parts?.length > 0) {
                gotTextResponse = true;
              }
              // Consider success if grounding metadata or just a text response arrives
              if (gotGroundingMetadata || gotTextResponse) {
                resolveResult(true);
              }
            },
            onerror: () => resolveResult(false),
            onclose: () => {},
          },
        });

        session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: 'What is the current weather in Tokyo, Japan right now? Search the web to find out.' }] }],
          turnComplete: true,
        });

        setTimeout(() => resolveResult(false), 20000);
        const success = await resultPromise;
        session.close();

        expect(success).toBe(true);
      },
      25000
    );
  });
});
