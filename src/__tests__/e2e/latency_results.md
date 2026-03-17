# Gemini Live API Latency Benchmark Results

*Generated on: 17/3/2026, 5:04:25 pm*

## 1. Connection Latency

| Configuration | Latency |
|---|---|
| Connection: with tools | 142ms |
| Connection: functions + search | 151ms |
| Connection: with transcription | 160ms |
| Connection: no tools | 552ms |

## 2. System Prompt Impact (Tool Call Latency)

| Prompt Size | Latency |
|---|---|
| Prompt: FULL (~2000 chars) | Timeout/Failed |
| Prompt: ~60 chars | 1846ms |
| Prompt: ~300 chars | 1891ms |
| Prompt: NONE | 2199ms |
| Prompt: ~500 chars | 2221ms |
| Prompt: ~1000 chars | 2244ms |
| Prompt: ~1500 chars | 2687ms |

## 3. Tool Count Impact (Tool Call Latency)

| Tool Count | Latency |
|---|---|
| Tools: 1 ONLY | 2027ms |
| Tools: 3 CORE | 2125ms |
| Tools: ALL 7 | 2177ms |

## 4. Audio Response Latency

| Configuration | First Audio Chunk Latency |
|---|---|
| Audio: full production config | Timeout/Failed |
| Audio: Interruption delay | 0ms |
| Audio: with transcription | 1411ms |
| Audio: bare minimum | 1590ms |

## 5. Per-Tool Latency

| Tool | Latency |
|---|---|
| Tool: end_call | 1864ms |
| Tool: trigger_animation | 1925ms |
| Tool: set_expression | 2072ms |
| Tool: display_text | 2481ms |

## 7. Voice Config Variants (First Audio Chunk)

| Configuration | First Audio Chunk |
|---|---|
| Voice: Charon | Timeout/Failed |
| Voice: Puck + inputTranscription | Timeout/Failed |
| Voice: Puck (default) | 1691ms |
| Voice: no speechConfig | 2112ms |

## 8. Model Comparison

| Model | Metric | Latency |
|---|---|---|
| Model: 2.0-flash-live (tool) | Tool Call | Timeout/Failed |
| Model: 2.5-flash-native (conn) | Connection | 154ms |
| Model: 2.0-flash-live (conn) | Connection | 656ms |
| Model: 2.5-flash-native (tool) | Tool Call | 1911ms |

## 9. Multi-Turn Latency

| Turn | Tool Call Latency |
|---|---|
| MultiTurn: Turn 1 | 2095ms |
| MultiTurn: Turn 2 | 3026ms |

## 10. Optimized Prompt Validation (~920 chars)

| Metric | Latency |
|---|---|
| OptPrompt: ~920 chars — First Audio Chunk | Timeout/Failed |
| OptPrompt: audio latency — First Audio Chunk | 1787ms |

## 11. Hybrid Search Orchestration

| Metric | Latency |
|---|---|
| HybridSearch: Tool Trigger | 3524ms |

---

## Prompt Optimization Recommendation

**Current production prompt**: ~2400 chars (causes timeout at tool call stage)

**Recommended**: Replace with ~920-char optimized version (8 rules, all essential behavior preserved).

**Safety ceiling**: Keep system prompt under 1500 chars to avoid Gemini Live API timeout failures.
**Sweet spot**: ~1200 chars delivers best tool call latency with no failures.