"use client";

import { useEffect } from "react";
import { type SceneConfig } from "@/hooks/SceneConfigContext";
import { Vec3Input, NumInput, Section } from "./ui-components";
import { useCameraLiveStore } from "@/store/useCameraLiveStore";

export function CameraSection({ draft, patchCamera }: { draft: SceneConfig, patchCamera: (p: Partial<SceneConfig["camera"]>) => void }) {
  const liveCamera = useCameraLiveStore();

  // Automatically sync live Camera changes into the active Config panel draft
  useEffect(() => {
    if (!liveCamera.isDragging) return;
    
    // We only update if the differences are significant enough (reduces continuous React re-renders)
    const positionChanged = 
      Math.abs(draft.camera.position.x - liveCamera.px) > 0.01 ||
      Math.abs(draft.camera.position.y - liveCamera.py) > 0.01 ||
      Math.abs(draft.camera.position.z - liveCamera.pz) > 0.01;
      
    const targetChanged = 
      Math.abs(draft.camera.target.x - liveCamera.tx) > 0.01 ||
      Math.abs(draft.camera.target.y - liveCamera.ty) > 0.01 ||
      Math.abs(draft.camera.target.z - liveCamera.tz) > 0.01;

    // Use Math.round to check if FOV fundamentally shifted
    const fovChanged = Math.abs(draft.camera.fov - Math.round(liveCamera.fov)) > 1;

    // Only patch if we aren't at coordinate {0,0,0} which means the store just instantiated empty
    const isValidReading = liveCamera.px !== 0 || liveCamera.py !== 0 || liveCamera.pz !== 0;

    if (isValidReading && (positionChanged || targetChanged || fovChanged)) {
      patchCamera({
        position: { 
          x: Number(liveCamera.px.toFixed(4)), 
          y: Number(liveCamera.py.toFixed(4)), 
          z: Number(liveCamera.pz.toFixed(4)) 
        },
        target: { 
          x: Number(liveCamera.tx.toFixed(4)), 
          y: Number(liveCamera.ty.toFixed(4)), 
          z: Number(liveCamera.tz.toFixed(4)) 
        },
        fov: Math.round(liveCamera.fov),
      });
    }
  }, [liveCamera, draft.camera.position, draft.camera.target, draft.camera.fov, patchCamera]);

  return (
    <Section title="Camera" accent="#22d3ee" defaultOpen={false}>
      <div className="mb-4 text-center">
        <p className="text-[10px] text-muted-foreground/60 leading-snug">
          💡 Drag the avatar in the background to visually position the camera. Values below will update automatically. Click &quot;Save Config&quot; to keep them.
        </p>
      </div>

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
