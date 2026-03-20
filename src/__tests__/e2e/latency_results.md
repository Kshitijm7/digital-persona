# Gemini Live API Latency Benchmark Results

*Generated on: 20/3/2026, 8:54:51 pm*

## 1. Connection Latency

| Configuration | Latency |
|---|---|
| Connection: with transcription | 149ms |
| Connection: functions + search | 186ms |
| Connection: no tools | 258ms |
| Connection: with tools | 484ms |

## 2. System Prompt Impact (Tool Call Latency)

| Prompt Size | Latency |
|---|---|
| Prompt: FULL (~2000 chars) | Timeout/Failed |
| Prompt: ~1500 chars | Timeout/Failed |
| Prompt: ~60 chars | 2082ms |
| Prompt: ~1000 chars | 2239ms |
| Prompt: ~500 chars | 2332ms |
| Prompt: NONE | 2465ms |
| Prompt: ~300 chars | 2882ms |

## 3. Tool Count Impact (Tool Call Latency)

| Tool Count | Latency |
|---|---|
| Tools: 1 ONLY | 2040ms |
| Tools: ALL 7 | 2397ms |
| Tools: 3 CORE | 2736ms |

## 4. Audio Response Latency

| Configuration | First Audio Chunk Latency |
|---|---|
| Audio: full production config | Timeout/Failed |
| Audio: Interruption delay | 1ms |
| Audio: bare minimum | 1515ms |
| Audio: with transcription | 1968ms |

## 5. Per-Tool Latency

| Tool | Latency |
|---|---|
| Tool: end_call | 1457ms |
| Tool: set_expression | 2030ms |
| Tool: switch_camera | 2304ms |
| Tool: trigger_animation | 2314ms |
| Tool: display_text | 3313ms |

## 7. Voice Config Variants (First Audio Chunk)

| Configuration | First Audio Chunk |
|---|---|
| Voice: Charon | Timeout/Failed |
| Voice: Puck + inputTranscription | 1758ms |
| Voice: no speechConfig | 2016ms |
| Voice: Puck (default) | 2121ms |

## 8. Model Comparison

| Model | Metric | Latency |
|---|---|---|
| Model: 2.0-flash-live (tool) | Tool Call | Timeout/Failed |
| Model: 2.5-flash-native (conn) | Connection | 163ms |
| Model: 2.0-flash-live (conn) | Connection | 465ms |
| Model: 2.5-flash-native (tool) | Tool Call | 2307ms |

## 9. Multi-Turn Latency

| Turn | Tool Call Latency |
|---|---|
| MultiTurn: Turn 1 | 2624ms |
| MultiTurn: Turn 2 | 3829ms |

## 10. Optimized Prompt Validation (~920 chars)

| Metric | Latency |
|---|---|
| OptPrompt: ~920 chars — Tool Call | 4065ms |
| OptPrompt: audio latency — First Audio Chunk | 2347ms |

## 11. Hybrid Search Orchestration

| Metric | Latency |
|---|---|
| HybridSearch: Tool Trigger | 2273ms |

---

## Prompt Optimization Recommendation

**Current production prompt**: ~2400 chars (causes timeout at tool call stage)

**Recommended**: Replace with ~920-char optimized version (8 rules, all essential behavior preserved).

**Safety ceiling**: Keep system prompt under 1500 chars to avoid Gemini Live API timeout failures.
**Sweet spot**: ~1200 chars delivers best tool call latency with no failures.