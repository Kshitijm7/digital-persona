# Latency Testing Guide

Use the existing E2E test infrastructure (`gemini-api.test.ts`) as a **live benchmarking harness** to measure, compare, and reduce latency across the Gemini Live API pipeline — then port winning approaches into the main codebase.

---

## Why This Works

The E2E tests already:
- Connect to the **real Gemini Live API** (no mocks)
- Use your **actual `FUNCTION_TOOLS`** from `constants.ts`
- Measure wall-clock time per test (vitest reports `ms` per test)
- Run independently so you can isolate variables

---

## What to Benchmark

| Metric | How to Measure | Where it Matters |
|--------|---------------|-----------------|
| **Connection time** | Time from `ai.live.connect()` to `onopen` | First-load UX |
| **Tool call latency** | Time from `sendClientContent()` to `toolCall` message | Animation/expression responsiveness |
| **Audio round-trip** | Time from text send to first audio chunk | Conversational feel |
| **Search latency** | Time from query to grounded response | Real-time Q&A |

---

## How to Add Latency Experiments

### 1. A/B Test Different System Prompts

Shorter system prompts → fewer tokens → faster first response.

```typescript
it('latency: minimal system prompt vs full', async () => {
  const { GoogleGenAI, Modality } = await import('@google/genai');
  const { FUNCTION_TOOLS, SYSTEM_PROMPT } = await import('@/lib/constants');

  const MINIMAL_PROMPT = 'You are a 3D avatar. Be concise. Use tools when asked.';

  for (const [label, prompt] of [['full', SYSTEM_PROMPT], ['minimal', MINIMAL_PROMPT]]) {
    const ai = new GoogleGenAI({ apiKey: API_KEY! });
    const start = performance.now();

    let resolveResult!: (v: number) => void;
    const resultPromise = new Promise<number>((r) => { resolveResult = r; });

    const session = await ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: prompt }] },
        tools: [FUNCTION_TOOLS],
      },
      callbacks: {
        onopen: () => {},
        onmessage: (msg: any) => {
          if (msg.toolCall?.functionCalls?.length > 0) {
            resolveResult(performance.now() - start);
          }
        },
        onerror: () => resolveResult(-1),
        onclose: () => {},
      },
    });

    session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: 'Wave at me.' }] }],
      turnComplete: true,
    });

    setTimeout(() => resolveResult(-1), 15000);
    const elapsed = await resultPromise;
    session.close();

    console.log(`[${label}] trigger_animation latency: ${elapsed.toFixed(0)}ms`);
  }
}, 40000);
```

### 2. Test Fewer Tools

More `functionDeclarations` = more tokens in the config = potentially slower tool dispatch. Test with subsets:

```typescript
it('latency: full tools vs minimal tools', async () => {
  const { FUNCTION_TOOLS } = await import('@/lib/constants');

  // Full set — all 7 tools
  const fullTools = FUNCTION_TOOLS;

  // Minimal — only the 3 most-used tools
  const minimalTools = {
    functionDeclarations: FUNCTION_TOOLS.functionDeclarations?.filter(
      (d) => ['trigger_animation', 'set_expression', 'display_text'].includes(d.name ?? '')
    ),
  };

  // Run testToolCall() with each and compare times
  // ...
}, 30000);
```

### 3. Compare Models

```typescript
const MODELS = [
  'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-2.0-flash-live-001',     // older, but potentially faster
];

for (const model of MODELS) {
  // connect + measure tool call latency
}
```

### 4. Test Audio Config Variations

The `speechConfig` and `outputAudioTranscription` settings affect pipeline weight:

```typescript
// Without transcription — potentially faster audio
config: {
  responseModalities: [Modality.AUDIO],
}

// With transcription — adds overhead
config: {
  responseModalities: [Modality.AUDIO],
  outputAudioTranscription: {},
}
```

### 5. Ephemeral Token vs Direct API Key

Compare connection time using your `/api/token` ephemeral token flow vs direct API key:

```typescript
// Direct API key (current test approach)
const ai = new GoogleGenAI({ apiKey: API_KEY });

// Ephemeral token (production approach — fetches from /api/token)
// Measure: does the extra fetch + token exchange add measurable latency?
```

---

## Workflow: Experiment → Validate → Ship

```
1. Write a latency test in gemini-api.test.ts
2. Run:  npx vitest run src/__tests__/e2e/gemini-api.test.ts
3. Read the console.log() timing outputs
4. Compare variants (run 3-5 times for stability)
5. If a variant wins → update constants.ts / useGeminiLive.ts / useSessionManager.ts
6. Re-run full test suite to confirm nothing breaks
```

---

## Candidate Optimizations to Test

| Optimization | Files to Change | Expected Impact |
|-------------|----------------|-----------------|
| Shorter system prompt | `constants.ts` | −200-500ms on first tool call |
| Fewer tools when features disabled | `useGeminiLive.ts` | −50-200ms per tool call |
| Remove `outputAudioTranscription` | `useGeminiLive.ts` | −100-300ms audio RTT |
| Pre-warm connection on page load | `useSessionManager.ts` | −500-2000ms first interaction |
| Connection pooling / keep-alive | `useGeminiLive.ts` | −200-800ms on reconnect |
| Batch tool calls (animation + expression) | `page.tsx` | Fewer round trips |

---

## Running the Tests

```bash
# Run all E2E tests (requires real API key in .env.local)
npx vitest run src/__tests__/e2e/gemini-api.test.ts

# Run only tool calling tests
npx vitest run src/__tests__/e2e/gemini-api.test.ts -t "Tool Calling"

# Run with verbose timing
npx vitest run src/__tests__/e2e/gemini-api.test.ts --reporter=verbose
```
