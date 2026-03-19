# Gemini Live API Latency Benchmark Results

*Generated on: 19/3/2026, 8:41:31 pm*

## 1. Connection Latency

| Configuration | Latency |
|---|---|
| Connection: with tools | 158ms |
| Connection: functions + search | 489ms |
| Connection: with transcription | 501ms |
| Connection: no tools | 593ms |

## 2. System Prompt Impact (Tool Call Latency)

| Prompt Size | Latency |
|---|---|
| Prompt: FULL (~2000 chars) | Timeout/Failed |
| Prompt: ~1500 chars | Timeout/Failed |
| Prompt: ~60 chars | 1599ms |
| Prompt: NONE | 1901ms |
| Prompt: ~1000 chars | 1917ms |
| Prompt: ~300 chars | 2299ms |
| Prompt: ~500 chars | 3177ms |

## 3. Tool Count Impact (Tool Call Latency)

| Tool Count | Latency |
|---|---|
| Tools: ALL 7 | 2067ms |
| Tools: 1 ONLY | 2095ms |
| Tools: 3 CORE | 2432ms |

## 4. Audio Response Latency

| Configuration | First Audio Chunk Latency |
|---|---|
| Audio: full production config | Timeout/Failed |
| Audio: Interruption delay | 4ms |
| Audio: bare minimum | 1503ms |
| Audio: with transcription | 1665ms |

## 5. Per-Tool Latency

| Tool | Latency |
|---|---|
| Tool: end_call | 1938ms |
| Tool: set_expression | 2168ms |
| Tool: trigger_animation | 2231ms |
| Tool: switch_camera | 2411ms |
| Tool: display_text | 2725ms |

## 7. Voice Config Variants (First Audio Chunk)

| Configuration | First Audio Chunk |
|---|---|
| Voice: no speechConfig | Timeout/Failed |
| Voice: Charon | Timeout/Failed |
| Voice: Puck + inputTranscription | 1660ms |
| Voice: Puck (default) | 1951ms |

## 8. Model Comparison

| Model | Metric | Latency |
|---|---|---|
| Model: 2.0-flash-live (tool) | Tool Call | Timeout/Failed |
| Model: 2.0-flash-live (conn) | Connection | 469ms |
| Model: 2.5-flash-native (conn) | Connection | 612ms |
| Model: 2.5-flash-native (tool) | Tool Call | 2052ms |

## 9. Multi-Turn Latency

| Turn | Tool Call Latency |
|---|---|
| MultiTurn: Turn 1 | 1703ms |
| MultiTurn: Turn 2 | 3195ms |

## 10. Optimized Prompt Validation (~920 chars)

| Metric | Latency |
|---|---|
| OptPrompt: ~920 chars — First Audio Chunk | Timeout/Failed |
| OptPrompt: audio latency — First Audio Chunk | 1769ms |

## 11. Hybrid Search Orchestration

| Metric | Latency |
|---|---|
| HybridSearch: Tool Trigger | 1994ms |

---

## Prompt Optimization Recommendation

**Current production prompt**: ~2400 chars (causes timeout at tool call stage)

**Recommended**: Replace with ~920-char optimized version (8 rules, all essential behavior preserved).

**Safety ceiling**: Keep system prompt under 1500 chars to avoid Gemini Live API timeout failures.
**Sweet spot**: ~1200 chars delivers best tool call latency with no failures.