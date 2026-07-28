/**
 * Homelab Ollama client for plan.enhance (local#265).
 *
 * Open-weight chat via the Ollama HTTP API, plus explicit unload so the same
 * GPU card can be claimed by local-gpu keyframe afterward (sequential VRAM).
 */

export interface OllamaEnv {
  OLLAMA_BASE_URL?: string;
  OLLAMA_PLAN_MODEL?: string;
}

/** Default open-weight model: fits a 16GB door with headroom after unload. */
export const DEFAULT_OLLAMA_PLAN_MODEL = "qwen2.5:14b";

export function ollamaBaseUrl(env: OllamaEnv): string | null {
  const raw = env.OLLAMA_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function ollamaConfigured(env: OllamaEnv): boolean {
  return Boolean(ollamaBaseUrl(env));
}

export function ollamaPlanModel(env: OllamaEnv, override?: string): string {
  const fromConfig = override?.trim();
  if (fromConfig && isOllamaModelId(fromConfig)) {
    return stripOllamaPrefix(fromConfig);
  }
  const m = env.OLLAMA_PLAN_MODEL?.trim();
  return m && m.length > 0 ? stripOllamaPrefix(m) : DEFAULT_OLLAMA_PLAN_MODEL;
}

/** True for ollama/... ids or name:tag Ollama model refs (not Anthropic / Workers AI). */
export function isOllamaModelId(id: string): boolean {
  const s = id.trim();
  if (!s) return false;
  if (s.startsWith("ollama/")) return true;
  if (s.startsWith("anthropic/") || s.startsWith("claude-")) return false;
  if (s.startsWith("@cf/")) return false;
  // Prefer name:tag (qwen2.5:14b). Bare names are accepted only when they look like model families.
  if (s.includes(":")) return true;
  return /^(qwen|llama|gemma|mistral|phi|deepseek|qwq)/i.test(s);
}

function stripOllamaPrefix(id: string): string {
  return id.trim().replace(/^ollama\//, "");
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callOllama(
  env: OllamaEnv,
  messages: OllamaChatMessage[],
  modelOverride?: string,
): Promise<string> {
  const base = ollamaBaseUrl(env);
  if (!base) throw new Error("ollama requires OLLAMA_BASE_URL");
  const model = ollamaPlanModel(env, modelOverride);

  const resp = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      // Keep the model loaded only for this call; unloadOllamaModel frees VRAM after.
      keep_alive: "5m",
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ollama ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = (await resp.json()) as { message?: { content?: string } };
  const text = data.message?.content?.trim();
  if (!text) throw new Error("ollama returned no message content");
  return text;
}

/**
 * Unload a model from Ollama VRAM (keep_alive: 0). Best-effort: logs via throw
 * only when the caller wants to surface failure; local-gpu swallows errors.
 */
export async function unloadOllamaModel(env: OllamaEnv, modelOverride?: string): Promise<void> {
  const base = ollamaBaseUrl(env);
  if (!base) return;
  const model = ollamaPlanModel(env, modelOverride);

  const resp = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: "",
      keep_alive: 0,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ollama unload ${resp.status}: ${errText.slice(0, 200)}`);
  }
  // Drain body so the connection can close cleanly.
  await resp.text().catch(() => undefined);
}

/** Best-effort unload for handoff into local-gpu; never throws. */
export async function unloadOllamaModelBestEffort(
  env: OllamaEnv,
  modelOverride?: string,
): Promise<boolean> {
  if (!ollamaConfigured(env)) return false;
  try {
    await unloadOllamaModel(env, modelOverride);
    return true;
  } catch (e) {
    console.warn(`ollama unload failed (continuing): ${(e as Error).message}`);
    return false;
  }
}
