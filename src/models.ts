// Planning model catalog subset (vivijure src/models.ts).

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
  capabilities: Array<"vision" | "image-input">;
  provider?: Provider;
  byok_alias?: string;
  streaming?: boolean;
}

/** Legacy model rows; planning catalog is derived from installed plan.enhance modules. */
export const MODELS: ModelEntry[] = [
  {
    id: "anthropic/claude-opus-4-8",
    label: "Claude Opus 4.8 (Anthropic)",
    group: "Chat · Anthropic",
    type: "chat",
    capabilities: ["vision"],
    provider: "anthropic",
    streaming: true,
  },
  {
    id: "anthropic/claude-opus-4-7",
    label: "Claude Opus 4.7 (Anthropic)",
    group: "Chat · Anthropic",
    type: "chat",
    capabilities: ["vision"],
    provider: "anthropic",
    streaming: true,
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5 (Anthropic)",
    group: "Chat · Anthropic",
    type: "chat",
    capabilities: ["vision"],
    provider: "anthropic",
    streaming: true,
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    label: "Claude Sonnet 4.6 (Anthropic)",
    group: "Chat · Anthropic",
    type: "chat",
    capabilities: ["vision"],
    provider: "anthropic",
    streaming: true,
  },
];
