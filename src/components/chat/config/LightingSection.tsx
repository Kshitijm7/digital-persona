"use client";

import { type SceneConfig, type LightConfig } from "@/hooks/SceneConfigContext";
import { LightEditor, Section } from "./ui-components";

export function LightingSection({
  draft,
  patchLight,
}: {
  draft: SceneConfig;
  patchLight: (key: "keyLight" | "fillLight" | "rimLight", l: LightConfig) => void;
}) {
  return (
    <Section title="Lighting" accent="#fbbf24" defaultOpen={false}>
      <LightEditor
        label="Key Light"
        light={draft.lighting.keyLight}
        onChange={(l) => patchLight("keyLight", l)}
      />
      <LightEditor
        label="Fill Light"
        light={draft.lighting.fillLight}
        onChange={(l) => patchLight("fillLight", l)}
      />
      <LightEditor
        label="Rim Light"
        light={draft.lighting.rimLight}
        onChange={(l) => patchLight("rimLight", l)}
      />
    </Section>
  );
}
