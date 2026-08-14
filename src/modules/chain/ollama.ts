/**
 * Homelab Ollama client for plan.enhance (local#265).
 *
 * Open-weight chat via the Ollama HTTP API, plus explicit unload so the same
 * GPU card can be claimed by local-gpu keyframe afterward (sequential VRAM).
 */

export interface OllamaEnv {
  OLLAMA_BASE_URL?: string;
  OLLAMA_PLAN_MODEL?: string;
  /**
   * Bound on the VRAM unload call, milliseconds. Default 5000, clamped to 120000.
   * Exists because ten render entry points await the unload: without a bound a HUNG
   * Ollama produces neither `unloaded` nor `failed`, it produces an unresolved promise,
   * and fail-open only fails open if it RETURNS.
   */
  OLLAMA_UNLOAD_TIMEOUT_MS?: string;
}

/** Default bound on the unload call. Control-plane (keep_alive:0), not inference. */
export const OLLAMA_UNLOAD_TIMEOUT_MS_DEFAULT = 5000;
/** Upper clamp so a typo cannot restore the unbounded wait this exists to remove. */
export const OLLAMA_UNLOAD_TIMEOUT_MS_MAX = 120000;

export function ollamaUnloadTimeoutMs(env: OllamaEnv): number {
  const raw = env.OLLAMA_UNLOAD_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return OLLAMA_UNLOAD_TIMEOUT_MS_DEFAULT;
  return Math.min(n, OLLAMA_UNLOAD_TIMEOUT_MS_MAX);
}

/** A bounded unload that ran out of time. Distinguishable without parsing the message. */
export class OllamaUnloadTimeout extends Error {
  readonly timedOut = true as const;
  readonly ms: number;
  constructor(ms: number, model: string) {
    super(`ollama unload timed out after ${ms}ms (model=${model})`);
    this.name = "OllamaUnloadTimeout";
    this.ms = ms;
  }
}

export function isUnloadTimeout(e: unknown): e is OllamaUnloadTimeout {
  return e instanceof OllamaUnloadTimeout;
}

/**
 * Default open-weight planner: Qwen3 14B (Ollama Q4_K_M ~9.3GB).
 * Fits a 16GB door with headroom for KV cache; stronger creative writing +
 * instruction following than qwen2.5:14b for video ideation, scripts, and
 * plan.enhance. deepseek-r1:14b remains a catalog alternate for max reasoning.
 */
export const DEFAULT_OLLAMA_PLAN_MODEL = "qwen3:14b";

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
  // Prefer name:tag (qwen3:14b). Bare names are accepted only when they look like model families.
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

export interface CallOllamaOptions {
  /**
   * Ollama thinking toggle (qwen3 / deepseek-r1). Default false so structured
   * plan.enhance JSON is not eaten by CoT. Chat/ideation may pass true.
   */
  think?: boolean;
  /** Sampling temperature. Structured plan/enhance ~0.4; chat ~0.75. */
  temperature?: number;
  /** Context window tokens (default 8192; enough for brief + storyboard JSON). */
  num_ctx?: number;
}

/** Structured plan / enhance / refine (JSON fidelity over flourish). */
export const OLLAMA_STRUCTURED_TEMPERATURE = 0.4;
/** Chat / ideation (creative film direction). */
export const OLLAMA_CHAT_TEMPERATURE = 0.75;
/** Default context for storyboard plan/refine payloads. */
export const OLLAMA_DEFAULT_NUM_CTX = 8192;

/** Strip residual &lt;think&gt; blocks if a model ignored think:false. */
export function stripThinkingContent(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

export async function callOllama(
  env: OllamaEnv,
  messages: OllamaChatMessage[],
  modelOverride?: string,
  opts?: CallOllamaOptions,
): Promise<string> {
  const base = ollamaBaseUrl(env);
  if (!base) throw new Error("ollama requires OLLAMA_BASE_URL");
  const model = ollamaPlanModel(env, modelOverride);
  const think = opts?.think === true;
  const temperature =
    typeof opts?.temperature === "number" && Number.isFinite(opts.temperature)
      ? opts.temperature
      : think
        ? OLLAMA_CHAT_TEMPERATURE
        : OLLAMA_STRUCTURED_TEMPERATURE;
  const num_ctx =
    typeof opts?.num_ctx === "number" && opts.num_ctx > 0 ? opts.num_ctx : OLLAMA_DEFAULT_NUM_CTX;

  const resp = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      // Top-level think (not options.think) -- required for qwen3 / r1 on native API.
      think,
      options: { temperature, num_ctx },
      // Keep the model loaded only for this call; unloadOllamaModel frees VRAM after.
      keep_alive: "5m",
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    const hint =
      resp.status === 404 || /not found|pull/i.test(errText)
        ? ` (is ${model} pulled? run: docker compose run --rm ollama-pull)`
        : "";
    throw new Error(`ollama ${resp.status}: ${errText.slice(0, 300)}${hint}`);
  }
  const data = (await resp.json()) as {
    message?: { content?: string; thinking?: string };
  };
  const text = stripThinkingContent(data.message?.content ?? "");
  if (!text) throw new Error("ollama returned no message content");
  return text;
}

/**
 * Unload a model from Ollama VRAM (keep_alive: 0). Throws on HTTP/network failure
 * when Ollama is configured; no-ops when OLLAMA_BASE_URL is unset.
 */
export async function unloadOllamaModel(env: OllamaEnv, modelOverride?: string): Promise<void> {
  const base = ollamaBaseUrl(env);
  if (!base) return;
  const model = ollamaPlanModel(env, modelOverride);

  // Bounded: an unbounded unload is an unresolved promise on ten render entry points.
  const timeoutMs = ollamaUnloadTimeoutMs(env);
  const signal = AbortSignal.timeout(timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "",
        keep_alive: 0,
        think: false,
      }),
      signal,
    });
  } catch (e) {
    // Read the SIGNAL, not the error name: the abort reason is spelled TimeoutError by
    // undici and AbortError elsewhere, and `signal.aborted` is true in both.
    if (signal.aborted) throw new OllamaUnloadTimeout(timeoutMs, model);
    throw e;
  }
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ollama unload ${resp.status}: ${errText.slice(0, 200)}`);
  }
  // Drain body so the connection can close cleanly.
  await resp.text().catch(() => undefined);
}

/**
 * Structured VRAM handoff result (local#325).
 *
 * Pre-#325 both "Ollama not configured" and "unload threw" returned `false`, so a
 * monitor could not tell them apart and the render path discarded the boolean.
 * Three statuses, content-free machine fields:
 *   skipped  -- OLLAMA_BASE_URL unset; nothing to free
 *   unloaded -- keep_alive:0 accepted
 *   failed   -- configured, attempted, could not free VRAM
 */
export type OllamaUnloadResult =
  | { status: "skipped"; reason: "not-configured" }
  | { status: "unloaded"; model: string }
  | { status: "failed"; model: string; error: string; timed_out?: true };

/** Best-effort unload for handoff into local-gpu; never throws. Distinguishes skip from fail. */
export async function unloadOllamaModelBestEffort(
  env: OllamaEnv,
  modelOverride?: string,
): Promise<OllamaUnloadResult> {
  if (!ollamaConfigured(env)) {
    return { status: "skipped", reason: "not-configured" };
  }
  const model = ollamaPlanModel(env, modelOverride);
  try {
    await unloadOllamaModel(env, modelOverride);
    return { status: "unloaded", model };
  } catch (e) {
    const error = e instanceof Error && e.message ? e.message : String(e);
    // A timeout stays status:"failed" ON PURPOSE. Every consumer switches on "failed", so a
    // fourth status would make a monitor stop seeing the WORST case; `timed_out` is the
    // extra machine-readable bit rather than a replacement band.
    const timedOut = isUnloadTimeout(e);
    // Layer 1 signal: failed unload is a WARN with a stable prefix a monitor can grep.
    console.warn(
      JSON.stringify({
        event: "ollama_unload",
        status: "failed",
        model,
        error: error.slice(0, 200),
        ...(timedOut ? { timed_out: true } : {}),
      }),
    );
    return timedOut
      ? { status: "failed", model, error, timed_out: true }
      : { status: "failed", model, error };
  }
}

/** Read OLLAMA_* from process env, orchestrator env bags, or typed OllamaEnv. */
export function ollamaEnvFromRecord(
  env: OllamaEnv | NodeJS.ProcessEnv | Record<string, unknown>,
): OllamaEnv {
  const get = (k: keyof OllamaEnv): string | undefined => {
    const v = (env as Record<string, unknown>)[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  return {
    OLLAMA_BASE_URL: get("OLLAMA_BASE_URL"),
    OLLAMA_PLAN_MODEL: get("OLLAMA_PLAN_MODEL"),
    // Must be copied here too, or the render path (which goes through this projection)
    // silently gets the default while the operator's setting reads as configured.
    OLLAMA_UNLOAD_TIMEOUT_MS: get("OLLAMA_UNLOAD_TIMEOUT_MS"),
  };
}

/**
 * Canonical sequential-VRAM handoff (local#265 / local#325): free Ollama before any
 * local door GPU job (keyframe, motion, local finish).
 *
 * Fail-open for the render (a stuck LLM is worse than a blocked film), but the result
 * is ALWAYS structured so a caller/monitor can see unload failed vs not configured.
 * Never skip the unload attempt when OLLAMA_BASE_URL is configured.
 */
export async function ensureOllamaUnloadedForGpu(
  env: OllamaEnv | NodeJS.ProcessEnv | Record<string, unknown>,
  modelOverride?: string,
): Promise<OllamaUnloadResult> {
  const ollama = ollamaEnvFromRecord(env);
  if (!ollamaConfigured(ollama)) {
    return { status: "skipped", reason: "not-configured" };
  }
  const result = await unloadOllamaModelBestEffort(ollama, modelOverride);
  if (result.status === "unloaded") {
    console.info(
      JSON.stringify({
        event: "ollama_unload",
        status: "unloaded",
        model: result.model,
        note: "before local GPU claim",
      }),
    );
  } else if (result.status === "failed") {
    // Layer 2 signal: success used to be the only log line at this layer; failure was silent
    // here and only a lower-level warn. Emit the same shape so a monitor watching ollama_unload
    // sees both.
    console.warn(
      JSON.stringify({
        event: "ollama_unload",
        status: "failed",
        model: result.model,
        error: result.error.slice(0, 200),
        ...(result.timed_out ? { timed_out: true } : {}),
        note: "before local GPU claim; render continues (fail-open)",
      }),
    );
  }
  return result;
}
