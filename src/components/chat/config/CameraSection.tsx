"use client";

import { type SceneConfig } from "@/hooks/SceneConfigContext";
import { Vec3Input, NumInput, Section } from "./ui-components";

export function CameraSection({ draft, patchCamera }: { draft: SceneConfig, patchCamera: (p: Partial<SceneConfig["camera"]>) => void }) {
  return (
    <Section title="Camera" accent="#22d3ee" defaultOpen={false}>
      <Vec3Input
        label="Position"
        value={draft.camera.position}
        onChange={(p) => patchCamera({ position: p })}
        description="World coordinates of the camera lens."
      />
      <NumInput
        label="FOV"
        value={draft.camera.fov}
        onChange={(v) => patchCamera({ fov: v })}
        step={1}
        description="Field of view (degrees). Wider values show more context."
      />
      <Vec3Input
        label="Target"
        value={draft.camera.target}
        onChange={(t) => patchCamera({ target: t })}
        description="The focal point the camera look at and orbits around."
      />
      <NumInput
        label="Min Dist"
        value={draft.camera.controlsMinDistance ?? 0.5}
        onChange={(v) => patchCamera({ controlsMinDistance: v })}
        step={0.1}
        description="Closest zoom limit (prevents clipping into mesh)."
      />
      <NumInput
        label="Max Dist"
        value={draft.camera.controlsMaxDistance ?? 3.2}
        onChange={(v) => patchCamera({ controlsMaxDistance: v })}
        step={0.1}
        description="Furthest zoom limit (keeps character in frame)."
      />
      <NumInput
        label="Min Polar (rad)"
        value={draft.camera.minPolarAngle ?? 1.4}
        onChange={(v) => patchCamera({ minPolarAngle: v })}
        step={0.05}
        max={3.14}
        description="Lower vertical rotation limit (radians)."
      />
      <NumInput
        label="Max Polar (rad)"
        value={draft.camera.maxPolarAngle ?? 1.4}
        onChange={(v) => patchCamera({ maxPolarAngle: v })}
        step={0.05}
        max={3.14}
        description="Upper vertical rotation limit (radians)."
      />
      <NumInput
        label="Zoom Shift"
        value={draft.camera.zoomTargetShift ?? 0.6}
        onChange={(v) => patchCamera({ zoomTargetShift: v })}
        step={0.05}
        description="How much the focus shifts between chest and face during zoom."
      />
    </Section>
  );
}
