// Storyboard planner dispatcher (Anthropic-only release set).
//
// Dispatches to callAnthropic (AI Gateway Unified Billing or direct BYOK),
// or PLANNER_AI_MOCK for offline dev. Strips ```json fences, JSON.parses,
// runs validateStoryboard, returns StoryboardValidated or errors.

import type { PlannerEnv } from "./planner-env.js";
import { callAnthropic } from "./planner-providers.js";
import { plannerAiMockEnabled, mockPlannerRaw } from "./planner-ai-mock.js";
import { extractOutput, detectProviderFailure } from "@skyphusion-labs/vivijure-core/output-extract";
import {
  validateStoryboard,
  type StoryboardValidated,
} from "@skyphusion-labs/vivijure-core/storyboard-validate";
import {
  type PlanningProvider,
  findPlanningModel,
  plannerProviderFor,
} from "./planner-catalog.js";
import {
  type PlannerCharacter,
  buildPlanningSystemPrompt,
  buildPlanningUserMessage,
  buildRefinementSystemPrompt,
  buildRefinementUserMessage,
  stripJsonFences,
} from "@skyphusion-labs/vivijure-core/planner-prompt";

export type { PlannerCharacter, PlanningProvider };

export interface PlanStoryboardArgs {
  brief: string;
  // v0.165.0 (#143): optional so hPlan can safely default to [] when the
  // client omits the field (new project with no cast assigned yet).
  characters: PlannerCharacter[];
  // PlanningModel.id from planner-catalog, e.g. "anthropic/claude-opus-4-7"
  // or "@cf/zai-org/glm-4.7-flash".
  model: string;
  // Optional beat-synced timing block (beat-timing.buildBeatTimingBlock).
  // When set, it is injected into the planning user message to pin the shot
  // count + per-shot pacing to an audio bed.
  beatBlock?: string;
}

export type PlanStoryboardResult =
  | {
      ok: true;
      storyboard: StoryboardValidated;
      raw: string;
      provider: PlanningProvider;
      model: string;
      logId: string | null;
    }
  | {
      ok: false;
      errors: string[];
      raw: string | null;
      provider: PlanningProvider | null;
      model: string;
      logId: string | null;
    };

export async function planStoryboard(
  env: PlannerEnv,
  args: PlanStoryboardArgs,
): Promise<PlanStoryboardResult> {
  const modelEntry = findPlanningModel(args.model);
  if (!modelEntry) {
    return {
      ok: false,
      errors: [`model "${args.model}" is not in the planning catalog`],
      raw: null,
      provider: null,
      model: args.model,
      logId: null,
    };
  }

  const provider = plannerProviderFor(modelEntry);
  const systemPrompt = buildPlanningSystemPrompt();
  const userMessage = buildPlanningUserMessage(args.brief, args.characters, args.beatBlock);

  let result: unknown;
  let logId: string | null = null;

  try {
    if (plannerAiMockEnabled(env)) {
      // Dev-only (#411): replace the live provider call with a deterministic canned completion so
      // the planner flow is drivable in the fully-local module-bound dev env (which has no AI
      // binding). The result still runs the real extract/parse/validate pipeline below. In prod
      // PLANNER_AI_MOCK is unset, so this branch is dead and the live path is unchanged.
      result = mockPlannerRaw(userMessage);
      logId = "dev-ai-mock";
    } else {
      const messages = [{ role: "user", content: userMessage }];
      const r = await callAnthropic(env, modelEntry, systemPrompt, messages);
      result = r.raw;
      logId = r.logId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [`provider call failed: ${message}`],
      raw: null,
      provider,
      model: args.model,
      logId,
    };
  }

  const providerFailure = detectProviderFailure(result);
  if (providerFailure) {
    return {
      ok: false,
      errors: [`model execution failed: ${providerFailure}`],
      raw: null,
      provider,
      model: args.model,
      logId,
    };
  }

  const completion = extractOutput(result);
  const json = stripJsonFences(completion);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [
        `model output was not valid JSON: ${message}`,
        `raw output starts with: ${json.slice(0, 200)}`,
      ],
      raw: completion,
      provider,
      model: args.model,
      logId,
    };
  }

  const validation = validateStoryboard(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      raw: completion,
      provider,
      model: args.model,
      logId,
    };
  }

  return {
    ok: true,
    storyboard: validation.value,
    raw: completion,
    provider,
    model: args.model,
    logId,
  };
}

// ---------- Refinement dispatcher (v0.50.0) ----------
//
// Mirrors planStoryboard's plumbing (provider dispatch, JSON parse, validation)
// but builds a different prompt: the system message tells the model to apply
// ONE delta and preserve everything else, and the user message ships the
// current storyboard JSON + the new instruction.

export interface RefineStoryboardArgs {
  storyboard: unknown;
  message: string;
  model: string;
}

export async function refineStoryboard(
  env: PlannerEnv,
  args: RefineStoryboardArgs,
): Promise<PlanStoryboardResult> {
  const modelEntry = findPlanningModel(args.model);
  if (!modelEntry) {
    return {
      ok: false,
      errors: [`model "${args.model}" is not in the planning catalog`],
      raw: null,
      provider: null,
      model: args.model,
      logId: null,
    };
  }

  const provider = plannerProviderFor(modelEntry);
  const systemPrompt = buildRefinementSystemPrompt();
  const userMessage = buildRefinementUserMessage(args.storyboard, args.message);

  let result: unknown;
  let logId: string | null = null;

  try {
    if (plannerAiMockEnabled(env)) {
      // Dev-only (#411): replace the live provider call with a deterministic canned completion so
      // the planner flow is drivable in the fully-local module-bound dev env (which has no AI
      // binding). The result still runs the real extract/parse/validate pipeline below. In prod
      // PLANNER_AI_MOCK is unset, so this branch is dead and the live path is unchanged.
      result = mockPlannerRaw(userMessage);
      logId = "dev-ai-mock";
    } else {
      const messages = [{ role: "user", content: userMessage }];
      const r = await callAnthropic(env, modelEntry, systemPrompt, messages);
      result = r.raw;
      logId = r.logId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [`provider call failed: ${message}`],
      raw: null,
      provider,
      model: args.model,
      logId,
    };
  }

  const providerFailure = detectProviderFailure(result);
  if (providerFailure) {
    return {
      ok: false,
      errors: [`model execution failed: ${providerFailure}`],
      raw: null,
      provider,
      model: args.model,
      logId,
    };
  }

  const completion = extractOutput(result);
  const jsonStr = stripJsonFences(completion);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [
        `model output was not valid JSON: ${message}`,
        `raw output starts with: ${jsonStr.slice(0, 200)}`,
      ],
      raw: completion,
      provider,
      model: args.model,
      logId,
    };
  }

  const validation = validateStoryboard(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      raw: completion,
      provider,
      model: args.model,
      logId,
    };
  }

  return {
    ok: true,
    storyboard: validation.value,
    raw: completion,
    provider,
    model: args.model,
    logId,
  };
}

// ---------- One-shot text completion (planner UI helpers) ------------------
//
// Same provider dispatch as plan/refine, but returns plain text instead of
// parsing/validating storyboard JSON. Used by POST /api/chat for music-prompt
// suggestion and other one-liner LLM calls from the planner frontend.

export interface ChatCompleteArgs {
  model: string;
  user_input: string;
  system_prompt?: string;
}

export type ChatCompleteResult =
  | { ok: true; output: string; model: string; logId: string | null }
  | { ok: false; error: string; model: string };

export async function chatComplete(
  env: PlannerEnv,
  args: ChatCompleteArgs,
): Promise<ChatCompleteResult> {
  const modelEntry = findPlanningModel(args.model);
  if (!modelEntry) {
    return {
      ok: false,
      error: `model "${args.model}" is not in the planning catalog`,
      model: args.model,
    };
  }

  const provider = plannerProviderFor(modelEntry);
  const systemPrompt = args.system_prompt?.trim() || "You are a helpful assistant.";
  const userMessage = args.user_input;

  let result: unknown;
  let logId: string | null = null;

  try {
    if (plannerAiMockEnabled(env)) {
      // Dev-only (#411): replace the live provider call with a deterministic canned completion so
      // the planner flow is drivable in the fully-local module-bound dev env (which has no AI
      // binding). The result still runs the real extract/parse/validate pipeline below. In prod
      // PLANNER_AI_MOCK is unset, so this branch is dead and the live path is unchanged.
      result = mockPlannerRaw(userMessage);
      logId = "dev-ai-mock";
    } else {
      const messages = [{ role: "user", content: userMessage }];
      const r = await callAnthropic(env, modelEntry, systemPrompt, messages);
      result = r.raw;
      logId = r.logId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `provider call failed: ${message}`, model: args.model };
  }

  const providerFailure = detectProviderFailure(result);
  if (providerFailure) {
    return {
      ok: false,
      error: `model execution failed: ${providerFailure}`,
      model: args.model,
    };
  }

  const output = extractOutput(result).trim();
  if (!output) {
    return { ok: false, error: "model returned empty output", model: args.model };
  }

  return { ok: true, output, model: args.model, logId };
}
