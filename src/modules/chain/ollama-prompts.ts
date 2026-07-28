/**
 * Homelab Ollama prompt overlays for creative film / storyboard work (local#265).
 *
 * Core schema prompts (vivijure-core planner-prompt) stay authoritative for JSON shape.
 * These preambles steer open-weight models toward video ideas, shot lists, and
 * keyframe-ready direction without Anthropic-only tone.
 */

export type OllamaPromptMode = "plan" | "refine" | "chat" | "enhance";

/** Default chat system when the UI omits system_prompt (Ollama path). */
export const OLLAMA_CHAT_SYSTEM_DEFAULT =
  "You are Vivijure Studio's local creative director on the homelab. Help the user invent " +
  "short-film and music-video ideas, loglines, character beats, shot lists, and storyboard " +
  "direction that can become SDXL keyframes and short motion clips. Be concrete: camera, " +
  "subject action, lighting, and emotional beat. Prefer visual, filmable language over " +
  "abstract theme essays. Ask one clarifying question only when the brief is too thin to plan.";

/**
 * Prepended when plan.enhance talks to Ollama so structured plan/refine still honors
 * the schema rules from vivijure-core while writing for a local GPU door pipeline.
 */
export const OLLAMA_STRUCTURED_PREAMBLE =
  "You are directing for Vivijure's local film pipeline (open-weight planner on Ollama, " +
  "then SDXL keyframes + short motion on a 16GB door). Think in filmable shots: clear " +
  "subject, action, framing, and light. Prefer concrete visual beats a camera can hold " +
  "over literary metaphor. Keep dialogue sparse and speakable. Obey every schema and " +
  "length rule in the instructions below. Output JSON only when asked for JSON.";

/** Soft preamble for enhance mode (shot rewrite arrays). */
export const OLLAMA_ENHANCE_PREAMBLE =
  "You are polishing shot descriptions for SDXL keyframes and short AI video clips. " +
  "Favor camera, subject action, lighting, and mood that a still keyframe can show.";

/**
 * Merge Ollama creative guidance with a caller-supplied system message.
 * Idempotent when the preamble is already present.
 */
export function augmentSystemForOllama(
  systemMessage: string | undefined,
  mode: OllamaPromptMode,
): string {
  const base = systemMessage?.trim() ?? "";
  if (mode === "chat") {
    if (!base) return OLLAMA_CHAT_SYSTEM_DEFAULT;
    if (base.includes("local creative director") || base.includes("Vivijure Studio")) return base;
    return `${OLLAMA_CHAT_SYSTEM_DEFAULT}\n\nAdditional instructions:\n${base}`;
  }
  const preamble = mode === "enhance" ? OLLAMA_ENHANCE_PREAMBLE : OLLAMA_STRUCTURED_PREAMBLE;
  if (!base) return preamble;
  if (base.startsWith(preamble) || base.includes("Vivijure's local film pipeline")) return base;
  return `${preamble}\n\n${base}`;
}
