// Registry-driven render config projection for GET /api/modules (full resolver in M5+).

import type { RenderConfigProjection } from "./modules/types.js";

export type RenderTier = "draft" | "standard" | "final";

export interface QualityTierOption {
  value: RenderTier;
  label: string;
  blurb: string;
}

export const QUALITY_TIERS: readonly QualityTierOption[] = [
  { value: "draft", label: "draft", blurb: "33 frames, 8 steps; fastest, lowest quality" },
  { value: "standard", label: "standard", blurb: "8-step keyframes + 20-step EasyCache i2v; balanced" },
  { value: "final", label: "final", blurb: "97 frames, 22 steps; production quality" },
];

export const DEFAULT_QUALITY_TIER: RenderTier = "final";

export function renderConfigProjection(): RenderConfigProjection {
  return {
    quality_tiers: QUALITY_TIERS.map((t) => ({ value: t.value, label: t.label, blurb: t.blurb })),
    default_tier: DEFAULT_QUALITY_TIER,
  };
}
