// Image generation catalog for POST /api/chat (cast portrait / preview).

import type { ModelEntry } from "./models.js";

/** Image models used by cast.js TRAINING_MODELS + upstream image-gen set. */
export const IMAGE_MODELS: ModelEntry[] = [
  {
    id: "google/nano-banana-pro",
    label: "Nano Banana Pro (Google)",
    group: "Image Gen",
    type: "image",
    capabilities: [],
    provider: "google",
  },
  {
    id: "openai/gpt-image-1.5",
    label: "GPT Image 1.5 (OpenAI; transparent PNG with OPENAI_API_KEY, else opaque)",
    group: "Image Gen",
    type: "image",
    capabilities: [],
    provider: "openai",
  },
  {
    id: "recraft/recraftv4",
    label: "Recraft V4 (art-directed, opaque)",
    group: "Image Gen",
    type: "image",
    capabilities: [],
    provider: "recraft",
  },
  {
    id: "@cf/black-forest-labs/flux-2-klein-9b",
    label: "FLUX 2 Klein 9B (frontier)",
    group: "Image Gen",
    type: "image",
    capabilities: [],
  },
  {
    id: "@cf/black-forest-labs/flux-2-klein-4b",
    label: "FLUX 2 Klein 4B (faster)",
    group: "Image Gen",
    type: "image",
    capabilities: [],
  },
  {
    id: "@cf/black-forest-labs/flux-2-dev",
    label: "FLUX 2 Dev (multi-reference)",
    group: "Image Gen",
    type: "image",
    capabilities: [],
  },
  {
    id: "@cf/black-forest-labs/flux-1-schnell",
    label: "FLUX-1 schnell (fast)",
    group: "Image Gen",
    type: "image",
    capabilities: [],
  },
  {
    id: "@cf/leonardo/phoenix-1.0",
    label: "Phoenix 1.0 (Leonardo)",
    group: "Image Gen",
    type: "image",
    capabilities: [],
  },
  {
    id: "@cf/lykon/dreamshaper-8-lcm",
    label: "Dreamshaper 8 LCM (fast SD)",
    group: "Image Gen",
    type: "image",
    capabilities: [],
  },
  {
    id: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    label: "Stable Diffusion XL (SDXL)",
    group: "Image Gen",
    type: "image",
    capabilities: [],
  },
];

export function findImageModel(id: string): ModelEntry | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}
