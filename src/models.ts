// Shared model-row types for the studio catalog.
//
// TYPES ONLY: this file deliberately holds no model names.
//
// cf#129 removed the last legacy rows. They were an `export const MODELS` array of four Anthropic
// entries left behind by the #102 sync of cf#62: every importer of this file takes only the TYPES
// (ModelEntry / Provider), and an unbounded grep across src/ tests/ scripts/ public/ modules/ found
// ZERO readers of the array itself. Under the bare-skeleton doctrine the studio hardcodes no model
// names -- the planning catalog is projected from installed plan.enhance modules
// (src/planning-models.ts), and cf#129 phase 2 projects the image rows the same way
// (src/module-catalog.ts). src/image-models.ts is gone: this host holds no model names of any kind.
//
// Kept key-identical to vivijure-cf/src/models.ts: public/ is a verbatim-shared surface between the
// two hosts, so a divergence in the row type is drift the shared panel cannot absorb.

export type ModelType = "chat" | "image" | "tts" | "video" | "stt" | "music" | "voice";
export type Provider =
  | "workers-ai"
  | "anthropic"
  | "google"
  | "openai"
  | "bytedance"
  | "minimax"
  | "runwayml"
  | "alibaba"
  | "pixverse"
  | "vidu"
  | "recraft";

export interface ModelEntry {
  id: string;
  label: string;
  group: string;
  type: ModelType;
  // "vision" = accepts image input in chat; "image-input" = image-to-video source image required.
  capabilities: Array<"vision" | "image-input">;
  provider?: Provider; // defaults to "workers-ai" when omitted
}
