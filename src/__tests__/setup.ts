import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock ResizeObserver before any imports
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock environment variables
process.env.GEMINI_API_KEY = 'AIzaTestKeyPlaceholder_000000000000000';
process.env.NEXT_PUBLIC_GCP_PROJECT_ID = 'test-project';
process.env.NEXT_PUBLIC_GCS_BUCKET_NAME = 'test-bucket';

// Mock WebGL context for Three.js
HTMLCanvasElement.prototype.getContext = vi.fn((contextType) => {
  if (contextType === 'webgl' || contextType === 'webgl2') {
    return {
      canvas: document.createElement('canvas'),
      drawingBufferWidth: 800,
      drawingBufferHeight: 600,
    };
  }
  return null;
}) as any;

// Mock MediaDevices API
Object.defineProperty(global.navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn(),
    enumerateDevices: vi.fn(),
  },
  writable: true,
});

// Mock AudioContext
global.AudioContext = vi.fn().mockImplementation(() => ({
  createMediaStreamSource: vi.fn(),
  createAnalyser: vi.fn(() => ({
    fftSize: 256,
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn(),
  })),
  createScriptProcessor: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null,
  })),
  createBuffer: vi.fn(),
  createBufferSource: vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    onended: null,
  })),
  destination: {},
  sampleRate: 48000,
  close: vi.fn(),
})) as any;

// ResizeObserver already mocked above - no need to redefine
global.fetch = vi.fn((url) => {
  if (url === '/avatar-transformed.glb') {
    // Create a minimal valid GLB file structure
    const buffer = new ArrayBuffer(12);
    const view = new DataView(buffer);
    view.setUint32(0, 0x46546C67, true); // "glTF" magic number
    
    return Promise.resolve({
      ok: true,
      headers: new Headers({
        'content-type': 'model/gltf-binary',
      }),
      arrayBuffer: () => Promise.resolve(buffer),
    } as Response);
  }
  return Promise.reject(new Error('Not found'));
}) as any;
