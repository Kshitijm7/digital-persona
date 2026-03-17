"use client";

import { type SceneConfig, type FeatureToggles } from "@/hooks/SceneConfigContext";
import { ToggleSwitch, Section } from "./ui-components";

export function FeaturesSection({
  draft,
  toggleFeatureLocal,
}: {
  draft: SceneConfig;
  toggleFeatureLocal: (key: keyof FeatureToggles) => void;
}) {
  return (
    <Section title="Features" accent="#6ee7b7" defaultOpen={false}>
      {((Object.keys(draft.features) as (keyof FeatureToggles)[]).map((key) => {
        const descriptions: Record<keyof FeatureToggles, string> = {
          lipSync: "Move mouth based on real-time audio analysis.",
          breathing: "Subtle chest expansion and shoulder movement.",
          gazeDrift: "Eye micro-movements to simulate life.",
          blinking: "Replaced by Randomized Idle Expressions.",
          hoverEffect: "Float the avatar slightly on the Y axis.",
          headMovement: "Neck and eyes follow the mouse cursor.",
          googleSearch: "Enable native Google Search grounding via the Live API.",
          proactiveAudio: "Allow spontaneous AI responses based on vision (Proactivity).",
          saccades: "Rapid, realistic eye jumps between fixation points.",
          microExpressions: "Subtle, random upper-face facial twitches.",
        };
        return (
          <ToggleSwitch
            key={key}
            label={key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
            checked={draft.features[key]}
            onChange={() => toggleFeatureLocal(key)}
            description={descriptions[key]}
          />
        );
      }))}
    </Section>
  );
}
