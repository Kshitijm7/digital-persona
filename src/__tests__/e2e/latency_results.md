# Gemini Live API Latency Benchmark Results

*Generated on: 17/3/2026, 10:13:26 pm*

## 1. Connection Latency

| Configuration | Latency |
|---|---|
| Connection: with transcription | 171ms |
| Connection: with tools | 582ms |
| Connection: functions + search | 679ms |
| Connection: no tools | 929ms |

## 2. System Prompt Impact (Tool Call Latency)

| Prompt Size | Latency |
|---|---|
| Prompt: FULL (~2000 chars) | Timeout/Failed |
| Prompt: ~500 chars | Timeout/Failed |
| Prompt: ~1500 chars | 1769ms |
| Prompt: ~1000 chars | 1923ms |
| Prompt: ~300 chars | 2124ms |
| Prompt: ~60 chars | 2232ms |
| Prompt: NONE | 2442ms |

## 3. Tool Count Impact (Tool Call Latency)

| Tool Count | Latency |
|---|---|
| Tools: 1 ONLY | 1812ms |
| Tools: 3 CORE | 2211ms |
| Tools: ALL 7 | 2550ms |

## 4. Audio Response Latency

| Configuration | First Audio Chunk Latency |
|---|---|
| Audio: Interruption delay | 16ms |
| Audio: with transcription | 1682ms |
| Audio: bare minimum | 1781ms |
| Audio: full production config | 1891ms |

## 5. Per-Tool Latency

| Tool | Latency |
|---|---|
| Tool: end_call | 1261ms |
| Tool: switch_camera | 1605ms |
| Tool: set_expression | 2057ms |
| Tool: trigger_animation | 2106ms |
| Tool: display_text | 2664ms |

## 7. Voice Config Variants (First Audio Chunk)

| Configuration | First Audio Chunk |
|---|---|
| Voice: Charon | Timeout/Failed |
| Voice: no speechConfig | 1790ms |
| Voice: Puck (default) | 1950ms |
| Voice: Puck + inputTranscription | 2058ms |

## 8. Model Comparison

| Model | Metric | Latency |
|---|---|---|
| Model: 2.0-flash-live (tool) | Tool Call | Timeout/Failed |
| Model: 2.5-flash-native (conn) | Connection | 485ms |
| Model: 2.0-flash-live (conn) | Connection | 491ms |
| Model: 2.5-flash-native (tool) | Tool Call | 2081ms |

## 9. Multi-Turn Latency

| Turn | Tool Call Latency |
|---|---|
| MultiTurn: Turn 1 | 1990ms |
| MultiTurn: Turn 2 | 2656ms |

## 10. Optimized Prompt Validation (~920 chars)

| Metric | Latency |
|---|---|
| OptPrompt: ~920 chars — First Audio Chunk | Timeout/Failed |
| OptPrompt: audio latency — First Audio Chunk | Timeout/Failed |

## 11. Hybrid Search Orchestration

| Metric | Latency |
|---|---|
| HybridSearch: Tool Trigger | 2170ms |

---

## Prompt Optimization Recommendation

**Current production prompt**: ~2400 chars (causes timeout at tool call stage)

**Recommended**: Replace with ~920-char optimized version (8 rules, all essential behavior preserved).

**Safety ceiling**: Keep system prompt under 1500 chars to avoid Gemini Live API timeout failures.
**Sweet spot**: ~1200 chars delivers best tool call latency with no failures.