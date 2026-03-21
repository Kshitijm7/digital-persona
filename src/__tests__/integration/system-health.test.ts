/**
 * System Health Integration Tests
 * Verifies all components work together according to the architecture diagrams
 */

import { describe, it, expect } from 'vitest';

describe('Digital Persona System Health', () => {
  describe('Environment Configuration', () => {
    it('should have required environment variables', () => {
      expect(process.env.GEMINI_API_KEY).toBeDefined();
      expect(process.env.GEMINI_API_KEY).not.toBe('');
      expect(process.env.GEMINI_API_KEY).toMatch(/^AIza/);
    });

    it('should have valid GCP configuration', () => {
      // These can be optional for development but should be set for production
      const gcpProjectId = process.env.NEXT_PUBLIC_GCP_PROJECT_ID;
      
      if (gcpProjectId && gcpProjectId !== 'your_project_id') {
        expect(gcpProjectId).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
      }
    });
  });

  describe('Asset Availability', () => {
    it('should have avatar model in public directory', async () => {
      const response = await fetch('/avatar-transformed.glb');
      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('model/gltf-binary');
    });

    it('should have valid GLB file structure', async () => {
      const response = await fetch('/avatar-transformed.glb');
      const buffer = await response.arrayBuffer();
      
      // GLB files start with "glTF" magic number (0x46546C67)
      const view = new DataView(buffer);
      const magic = view.getUint32(0, true);
      expect(magic).toBe(0x46546C67);
    });
  });

  describe('Constants Configuration', () => {
    it('should have valid system prompt', async () => {
      const { SYSTEM_PROMPT } = await import('@/lib/constants');
      
      expect(SYSTEM_PROMPT).toContain('Digital Persona');
      expect(SYSTEM_PROMPT).toContain('PRESENCE');
      expect(SYSTEM_PROMPT).toContain('trigger_animation');
    });

    it('should have valid Gemini tools configuration', async () => {
      const { getToolsForMode } = await import('@/lib/constants');
      const tools = getToolsForMode("full");

      expect(tools.length).toBeGreaterThanOrEqual(1);

      const toolsWithFunctions = tools.filter((tool) =>
        Array.isArray(tool.functionDeclarations)
      );
      expect(toolsWithFunctions.length).toBeGreaterThanOrEqual(1);

      const triggerAnim = toolsWithFunctions
        .flatMap((tool) => tool.functionDeclarations ?? [])
        .find(
        (f) => f.name === 'trigger_animation'
      );
      
      expect(triggerAnim).toBeDefined();
      expect(triggerAnim?.parameters?.properties?.base_animation).toBeDefined();
      expect(triggerAnim?.parameters?.properties?.base_animation?.enum).toBeDefined();
    });

    it('should use correct Gemini model (SDK format)', async () => {
      const { GEMINI_MODEL } = await import('@/lib/constants');
      // SDK format: no "models/" prefix
      expect(GEMINI_MODEL).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
      expect(GEMINI_MODEL).not.toContain('models/');
    });

    it('should have correct audio configuration', async () => {
      const { AUDIO_CONFIG } = await import('@/lib/constants');
      
      expect(AUDIO_CONFIG.input_hz).toBe(16000);
      expect(AUDIO_CONFIG.output_hz).toBe(24000);
    });
  });
});
