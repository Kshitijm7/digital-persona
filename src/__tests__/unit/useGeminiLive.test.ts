/**
 * Unit Tests for useGeminiLive Hook
 * Tests SDK-based connection, message handling, and API integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { SceneConfigProvider } from '@/hooks/SceneConfigContext';

// Must define __mockConnect and __mockSession at module level
// since vi.mock factory is hoisted above all other code
const __mockSession = {
  sendRealtimeInput: vi.fn(),
  sendClientContent: vi.fn(),
  sendToolResponse: vi.fn(),
  close: vi.fn(),
};

let __capturedCallbacks: {
  onopen?: () => void;
  onmessage?: (msg: unknown) => void;
  onerror?: (e: ErrorEvent) => void;
  onclose?: (e: CloseEvent) => void;
} = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __mockConnect = vi.fn(async (options: any) => {
  __capturedCallbacks = options.callbacks || {};
  setTimeout(() => {
    __capturedCallbacks.onopen?.();
  }, 0);
  return __mockSession;
});

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    live = { connect: __mockConnect };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_config: { apiKey: string }) {}
  }

  return {
    GoogleGenAI,
    Modality: { AUDIO: 'AUDIO' },
    Type: {
      TYPE_UNSPECIFIED: 'TYPE_UNSPECIFIED',
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT',
      NULL: 'NULL',
    },
  };
});

// Import AFTER mock is set up (vitest hoists the mock above imports)
import { useGeminiLive } from '@/hooks/useGeminiLive';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(SceneConfigProvider, null, children);

const renderGeminiHook = () => renderHook(() => useGeminiLive(), { wrapper });

describe('useGeminiLive Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __capturedCallbacks = {};
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "mock-ephemeral-token" })
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Connection Management', () => {
    it('should initialize with disconnected status', () => {
      const { result } = renderGeminiHook();
      expect(result.current.status).toBe('disconnected');
    });

    it('should connect using the SDK', async () => {
      const { result } = renderGeminiHook();
      
      act(() => {
        result.current.connect();
      });

      expect(result.current.status).toBe('connecting');

      await vi.waitFor(() => {
        expect(__mockConnect).toHaveBeenCalledTimes(1);
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });
    });

    it('should pass correct model, config, and VAD config to SDK', async () => {
      const { result } = renderGeminiHook();
      
      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(__mockConnect).toHaveBeenCalledTimes(1);
        const callArgs = __mockConnect.mock.calls[0][0];
        expect(callArgs.model).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
        expect(callArgs.config.responseModalities).toEqual(['AUDIO']);
        // VAD config should be present
        expect(callArgs.config.realtimeInputConfig).toBeDefined();
        expect(callArgs.config.realtimeInputConfig.automaticActivityDetection).toBeDefined();
        expect(callArgs.callbacks.onopen).toBeDefined();
        expect(callArgs.callbacks.onmessage).toBeDefined();
      });
    });

    it('should handle disconnection', async () => {
      const { result } = renderGeminiHook();
      
      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.status).toBe('disconnected');
      expect(__mockSession.close).toHaveBeenCalled();
    });
  });

  describe('Video Frame Streaming', () => {
    it('should send video frames via SDK session', async () => {
      const { result } = renderGeminiHook();
      
      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      const testFrame = 'base64encodedimage';
      
      act(() => {
        result.current.sendVideoFrame(testFrame);
      });

      expect(__mockSession.sendRealtimeInput).toHaveBeenCalledWith({
        media: {
          data: testFrame,
          mimeType: 'image/jpeg',
        },
      });
    });

    it('should not throw when sending frames before connected', () => {
      const { result } = renderGeminiHook();
      
      expect(() => {
        act(() => {
          result.current.sendVideoFrame('test');
        });
      }).not.toThrow();
    });
  });

  describe('Audio Streaming', () => {
    it('should send audio chunks via SDK session', async () => {
      const { result } = renderGeminiHook();
      
      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      const testAudio = 'base64encodedaudio';
      
      act(() => {
        result.current.sendAudioChunk(testAudio);
      });

      expect(__mockSession.sendRealtimeInput).toHaveBeenCalledWith({
        audio: {
          data: testAudio,
          mimeType: 'audio/pcm;rate=16000',
        },
      });
    });
  });

  describe('Text Sending', () => {
    it('should send text via SDK sendClientContent', async () => {
      const { result } = renderGeminiHook();
      
      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      act(() => {
        result.current.sendText('Hello world');
      });

      expect(__mockSession.sendClientContent).toHaveBeenCalledWith({
        turns: [{ role: 'user', parts: [{ text: 'Hello world' }] }],
        turnComplete: true,
      });
    });
  });

  describe('Response Handling', () => {
    it('should handle audio responses', async () => {
      const { result } = renderGeminiHook();
      
      const audioCallback = vi.fn();
      result.current.onAudioData.current = audioCallback;

      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      act(() => {
        __capturedCallbacks.onmessage?.({
          serverContent: {
            modelTurn: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/pcm',
                    data: 'audiodata123'
                  }
                }
              ]
            }
          }
        });
      });

      expect(audioCallback).toHaveBeenCalledWith('audiodata123');
    });

    it('should handle text transcripts', async () => {
      const { result } = renderGeminiHook();
      
      const transcriptCallback = vi.fn();
      result.current.onTranscript.current = transcriptCallback;

      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      act(() => {
        __capturedCallbacks.onmessage?.({
          serverContent: {
            modelTurn: {
              parts: [{ text: 'Hello, how can I help you?' }]
            }
          }
        });
      });

      expect(transcriptCallback).toHaveBeenCalledWith('Hello, how can I help you?');
    });

    it('should use fallback { result: ok } when no handler is registered', async () => {
      const { result } = renderGeminiHook();

      const toolCallback = vi.fn();
      result.current.onToolCall.current = toolCallback;

      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      act(() => {
        __capturedCallbacks.onmessage?.({
          toolCall: {
            functionCalls: [
              {
                id: 'call-123',
                name: 'trigger_animation',
                args: { gesture_name: 'wave' }
              }
            ]
          }
        });
      });

      expect(toolCallback).toHaveBeenCalledWith({
        name: 'trigger_animation',
        args: { gesture_name: 'wave' },
        id: 'call-123'
      });

      // No handler registered → fallback ok response
      await vi.waitFor(() => {
        expect(__mockSession.sendToolResponse).toHaveBeenCalledWith({
          functionResponses: [
            {
              id: 'call-123',
              name: 'trigger_animation',
              response: { result: 'ok' },
            },
          ],
        });
      });
    });

    it('should invoke registered tool handler and send its result', async () => {
      const { result } = renderGeminiHook();

      // Register a real handler before connecting
      const handler = vi.fn().mockResolvedValue({ formatted: '10:00 AM', iso: '2026-03-07T10:00:00Z' });
      act(() => {
        result.current.registerTool('get_time_date', handler);
      });

      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      act(() => {
        __capturedCallbacks.onmessage?.({
          toolCall: {
            functionCalls: [
              {
                id: 'call-time-1',
                name: 'get_time_date',
                args: {}
              }
            ]
          }
        });
      });

      // Handler should have been called with the (empty) args
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledWith({});
      });

      // The handler's return value should be sent back
      await vi.waitFor(() => {
        expect(__mockSession.sendToolResponse).toHaveBeenCalledWith({
          functionResponses: [
            {
              id: 'call-time-1',
              name: 'get_time_date',
              response: { formatted: '10:00 AM', iso: '2026-03-07T10:00:00Z' },
            },
          ],
        });
      });
    });

    it('should handle interruptions gracefully', async () => {
      const { result } = renderGeminiHook();
      
      const audioCallback = vi.fn();
      result.current.onAudioData.current = audioCallback;

      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      expect(() => {
        act(() => {
          __capturedCallbacks.onmessage?.({
            serverContent: {
              interrupted: true,
            }
          });
        });
      }).not.toThrow();

      expect(audioCallback).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle SDK connection errors', async () => {
      __mockConnect.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderGeminiHook();
      
      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('error');
        expect(result.current.errorMessage).toContain('Network error');
      });
    });

    it('should handle onerror callback', async () => {
      const { result } = renderGeminiHook();
      
      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      act(() => {
        __capturedCallbacks.onerror?.(new ErrorEvent('error', { message: 'WebSocket failed' }));
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('error');
        expect(result.current.errorMessage).toContain('WebSocket failed');
      });
    });
  });

  describe('Session Resumption', () => {
    it('should capture sessionResumptionUpdate handle from server', async () => {
      const { result } = renderGeminiHook();

      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      // Simulate server sending a session resumption update
      act(() => {
        __capturedCallbacks.onmessage?.({
          sessionResumptionUpdate: {
            handle: 'test-session-handle-abc123',
          },
        });
      });

      expect(result.current.lastSessionHandle.current).toBe('test-session-handle-abc123');
    });

    it('should pass stored handle to SDK config on reconnect', async () => {
      const { result } = renderGeminiHook();

      // First connection
      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        expect(result.current.status).toBe('connected');
      });

      // Receive session handle
      act(() => {
        __capturedCallbacks.onmessage?.({
          sessionResumptionUpdate: {
            handle: 'resume-handle-xyz',
          },
        });
      });

      // Disconnect
      act(() => {
        result.current.disconnect();
      });

      // Reconnect — should pass the saved handle
      act(() => {
        result.current.connect();
      });

      await vi.waitFor(() => {
        const secondCallArgs = __mockConnect.mock.calls[1][0];
        expect(secondCallArgs.config.sessionResumption).toEqual({
          handle: 'resume-handle-xyz',
        });
      });
    });
  });

  describe('Tool Handler Timeout', () => {
    it('should return timeout error when handler exceeds 10s', async () => {
      vi.useFakeTimers();

      const { result } = renderGeminiHook();

      // Register a handler that never resolves
      const neverResolve = () => new Promise<Record<string, unknown>>(() => {});
      act(() => {
        result.current.registerTool('slow_tool', neverResolve);
      });

      act(() => {
        result.current.connect();
      });

      // Manually trigger onopen since fake timers prevent setTimeout
      await act(async () => {
        __capturedCallbacks.onopen?.();
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        __capturedCallbacks.onmessage?.({
          toolCall: {
            functionCalls: [
              {
                id: 'call-slow-1',
                name: 'slow_tool',
                args: {},
              },
            ],
          },
        });
      });

      // Advance past the 10s timeout
      await act(async () => {
        vi.advanceTimersByTime(11_000);
      });

      await vi.waitFor(() => {
        expect(__mockSession.sendToolResponse).toHaveBeenCalledWith({
          functionResponses: [
            {
              id: 'call-slow-1',
              name: 'slow_tool',
              response: expect.objectContaining({
                error: expect.stringContaining('timed out'),
              }),
            },
          ],
        });
      });

      errorSpy.mockRestore();
      vi.useRealTimers();
    });
  });
});
