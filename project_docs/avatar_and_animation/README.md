# Avatar & Animation

The technical core of the Emotive Realism engine. Governs how the Ready Player Me model behaves dynamically.

## Documents

- **[emotive_realism_guide.md](./emotive_realism_guide.md)**: The holy grail guide detailing procedural life constraints—asymmetric blinking curves, pink noise for saccades, breathing sine waves, and ARKit emotional layering.
- **[complete_visme_avatar_guide.md](./complete_visme_avatar_guide.md)**: Comprehensive breakdown of combining Oculus Visemes with text-driven phonemes to create co-articulation (blending distinct mouth shapes natively).
- **[emotive_realism implementation plan.md](./emotive_realism%20implementation%20plan.md)**: The architectural tracker for applying these updates inside React Three Fiber.
- **[avatar_integration_guidelines.md](./avatar_integration_guidelines.md)**: Steps on importing `.glb` avatars into the Next.js `public/` directory and wrapping them via `gltfjsx`.
- **[visage-lipsync.md](./visage-lipsync.md)**: Deep dive into parsing 16-bit PCM Audio to extract amplitude/frequency to drive mouth movements.
- **[viseme_lipsync_alignment_2026.md](./viseme_lipsync_alignment_2026.md)**: Latest practical guide for low-latency viseme alignment using audio clock compensation, co-articulation windows, and realtime tuning.
