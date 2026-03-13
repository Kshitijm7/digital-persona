"use client";

import { type SceneConfig } from "@/hooks/SceneConfigContext";
import { Section, Vec3Input, NumInput } from "./ui-components";
import { useAnimationStore } from "@/store/useAnimationStore";
import { type AnimationMeta } from "@/lib/animationRegistry.types";

export function AvatarSection({
  draft,
  patchAvatar,
  avatarRegistry,
}: {
  draft: SceneConfig;
  patchAvatar: (p: Partial<SceneConfig["avatar"]>) => void;
  avatarRegistry: any[];
}) {
  return (
    <Section title="Avatar" accent="#a78bfa" defaultOpen={false}>
      {/* Model Selector */}
      <div>
        <p className="text-[10px] text-muted-foreground/60 mb-1">Model</p>
        <select
          value={draft.avatar.model}
          onChange={(e) => patchAvatar({ model: e.target.value })}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-foreground/90 font-medium focus:outline-none focus:border-violet-400/50 cursor-pointer appearance-none transition-colors hover:bg-white/8"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239ca3af%27 stroke-width=%272%27%3E%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
        >
          {avatarRegistry.map((a) => (
            <option key={a.id} value={a.id} className="bg-zinc-900 text-white">
              {a.label}
            </option>
          ))}
        </select>
      </div>
      {/* Idle Animation Selector */}
      <div>
        <p className="text-[10px] text-muted-foreground/60 mb-1 mt-2">Idle Animation</p>
        <select
          value={draft.avatar.idleAnimation || "masculine_idle_f_standing_idle_001"}
          onChange={(e) => patchAvatar({ idleAnimation: e.target.value })}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-foreground/90 font-medium focus:outline-none focus:border-violet-400/50 cursor-pointer appearance-none transition-colors hover:bg-white/8"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239ca3af%27 stroke-width=%272%27%3E%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
        >
          {/* Filter registry for idle animations, plus a forced fallback option */}
          <option value="masculine_idle_f_standing_idle_001" className="bg-zinc-900 text-white">Default F Standing Idle 001</option>
          <option value="male-idle" className="bg-zinc-900 text-white">Default Male Idle (male-idle)</option>
          <option value="idle" className="bg-zinc-900 text-white">Default Idle (idle.glb)</option>
          {Object.entries(useAnimationStore.getState().registry as Record<string, AnimationMeta>)
            .filter(([, meta]) => meta.type === "idle" && meta.name !== "male-idle" && meta.name !== "idle")
            .map(([key, meta]) => (
              <option key={key} value={key} className="bg-zinc-900 text-white">
                {meta.name}
              </option>
            ))}
        </select>
      </div>
      <Vec3Input
        label="Position"
        value={draft.avatar.position}
        onChange={(p) => patchAvatar({ position: p })}
        description="Base offset of the avatar model."
      />
      <Vec3Input
        label="Rotation"
        value={draft.avatar.rotation}
        onChange={(r) => patchAvatar({ rotation: r })}
        description="Euler rotation (radians)."
      />
      <NumInput
        label="Scale"
        value={draft.avatar.scale}
        onChange={(s) => patchAvatar({ scale: s })}
        step={0.05}
        description="Universal size multiplier."
      />
    </Section>
  );
}
