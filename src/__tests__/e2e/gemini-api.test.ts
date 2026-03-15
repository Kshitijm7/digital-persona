/**
 * End-to-End Tests for Gemini Live API Integration
 * Tests real API connectivity using the @google/genai SDK
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/** Returns true if the key looks like a placeholder / is not a real key. */
function isPlaceholderKey(key: string | undefined): boolean {
  if (!key || key === '') return true;
  if (key.includes('your_')) return true;
  // Reject short or obviously invalid keys
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(key)) return true;
  return false;
}

describe('Gemini Live API Integration', () => {
  let API_KEY = process.env.GEMINI_API_KEY;

  beforeAll(() => {
    // Try to load real API key from .env.local for E2E tests
    try {
      const envLocalPath = path.resolve(process.cwd(), '.env.local');
      if (fs.existsSync(envLocalPath)) {
        const envConfig = dotenv.parse(fs.readFileSync(envLocalPath));
        if (envConfig.GEMINI_API_KEY) {
          API_KEY = envConfig.GEMINI_API_KEY;
        }
      }
    } catch {
      console.warn('Could not load .env.local');
    }

    if (isPlaceholderKey(API_KEY)) {
      console.warn('⚠️  Skipping E2E tests: No valid real API key configured');
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
              // Close after connecting
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

        const audioReceived = await new Promise<boolean>((resolve) => {
          let session: Awaited<ReturnType<typeof ai.live.connect>>;

          ai.live
            .connect({
              model: 'gemini-2.5-flash-native-audio-preview-12-2025',
              config: {
                responseModalities: [Modality.AUDIO],
              },
              callbacks: {
                onopen: () => {
                  // Send text after connection
                  session.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: 'Hello' }] }],
                    turnComplete: true,
                  });
                },
                onmessage: (message) => {
                  const parts = message.serverContent?.modelTurn?.parts;
                  if (parts) {
                    for (const part of parts) {
                      if (part.inlineData?.mimeType?.startsWith('audio/')) {
                        resolve(true);
                        return;
                      }
                    }
                  }
                },
                onerror: () => resolve(false),
                onclose: () => {},
              },
            })
            .then((s) => {
              session = s;
            })
            .catch(() => resolve(false));

          setTimeout(() => resolve(false), 20000);
        });

        expect(audioReceived).toBe(true);
      },
      25000
    );
  });

  describe('Tool Calling', () => {
    const shouldSkip = isPlaceholderKey(API_KEY);

    it.skipIf(shouldSkip)(
      'should support trigger_animation tool via SDK',
      async () => {
        const { GoogleGenAI, Modality, Type } = await import('@google/genai');
        
        const ai = new GoogleGenAI({ apiKey: API_KEY! });

        const connected = await new Promise<boolean>((resolve) => {
          ai.live
            .connect({
              model: 'gemini-2.5-flash-native-audio-preview-12-2025',
              config: {
                responseModalities: [Modality.AUDIO],
                tools: [
                  {
                    functionDeclarations: [
                      {
                        name: 'trigger_animation',
                        description: 'Triggers a 3D animation',
                        parameters: {
                          type: Type.OBJECT,
                          properties: {
                            base_animation: {
                              type: Type.STRING,
                              enum: ['idle', 'nod', 'shake_head', 'explain_hands', 'shrug', 'point_forward', 'inquisitive_tilt', 'wave', 'laugh'],
                            },
                          },
                          required: ['base_animation'],
                        },
                      },
                    ],
                  },
                ],
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
  });
});
