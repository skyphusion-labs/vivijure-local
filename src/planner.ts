/**
 * Thin planner scaffold: prompt assembly + validation live here; all LLM work is delegated to
 * installed plan.enhance modules via the module host.
 */
import {
  invokeModule,
  resolveFetcher,
  validateConfig,
  type PlanEnhanceInput,
  type PlanEnhanceOutput,
  type RegisteredModule,
} from "@skyphusion-labs/vivijure-core";
import {
  validateStoryboard,
  type StoryboardValidated,
} from "@skyphusion-labs/vivijure-core/storyboard-validate";
import {
  type PlannerCharacter,
  buildPlanningSystemPrompt,
  buildPlanningUserMessage,
  buildRefinementSystemPrompt,
  buildRefinementUserMessage,
} from "@skyphusion-labs/vivijure-core/planner-prompt";
import { resolvePlanningTarget } from "./planning-models.js";

export type { PlannerCharacter };

export interface PlanningHost {
  modEnv: Record<string, unknown>;
  modules: RegisteredModule[];
}

export interface PlanStoryboardArgs {
  brief: string;
  characters: PlannerCharacter[];
  model: string;
  beatBlock?: string;
}

export type PlanStoryboardResult =
  | {
      ok: true;
      storyboard: StoryboardValidated;
      raw: string;
      provider: "module";
      model: string;
      logId: string | null;
      module: string;
    }
  | {
      ok: false;
      errors: string[];
      raw: string | null;
      provider: "module" | null;
      model: string;
      logId: string | null;
      module?: string;
    };

async function invokePlanningModule(
  host: PlanningHost,
  opts: {
    mode: "plan" | "refine" | "chat";
    model: string;
    storyboard?: unknown;
    brief?: string;
    systemMessage: string;
    userMessage: string;
  },
): Promise<
  | { ok: true; output: PlanEnhanceOutput; module: string; raw: string }
  | { ok: false; error: string; module?: string }
> {
  const target = resolvePlanningTarget(host.modules, opts.model);
  if (!target) {
    return {
      ok: false,
      error: `no plan.enhance module serves model "${opts.model}" (install a planning module)`,
    };
  }
  const mod = host.modules.find((m) => m.name === target.moduleName);
  if (!mod) {
    return { ok: false, error: `plan.enhance module ${target.moduleName} not found` };
  }
  const fetcher = resolveFetcher(host.modEnv, mod.binding);
  if (!fetcher) {
    return {
      ok: false,
      error: `plan.enhance module ${mod.name} (${mod.binding}) is not bound`,
      module: mod.name,
    };
  }

  const config = {
    ...validateConfig(mod.config_schema, {
      intensity: "medium",
    }),
    mode: opts.mode,
    model: target.configModel ?? target.modelId,
    system_message: opts.systemMessage,
    message: opts.userMessage,
  };

  const input: PlanEnhanceInput = {
    storyboard:
      opts.mode === "plan"
        ? { scenes: [] }
        : (opts.storyboard as PlanEnhanceInput["storyboard"]) ?? { scenes: [] },
    brief: opts.brief,
  };

  const r = await invokeModule<PlanEnhanceInput, PlanEnhanceOutput>(fetcher, {
    hook: "plan.enhance",
    input,
    config,
    context: { project: "planner", job_id: crypto.randomUUID() },
  });

  if (!r.ok) {
    return {
      ok: false,
      error: ("error" in r ? r.error : undefined) || "plan.enhance module returned no output",
      module: mod.name,
    };
  }
  if (!("output" in r) || !r.output) {
    return {
      ok: false,
      error: "plan.enhance module returned no output",
      module: mod.name,
    };
  }

  const raw =
    opts.mode === "chat"
      ? (r.output.notes?.join("\n") ?? "")
      : JSON.stringify(r.output.storyboard ?? {});

  return { ok: true, output: r.output, module: mod.name, raw };
}

export async function planStoryboard(
  host: PlanningHost,
  args: PlanStoryboardArgs,
): Promise<PlanStoryboardResult> {
  const systemMessage = buildPlanningSystemPrompt();
  const userMessage = buildPlanningUserMessage(args.brief, args.characters, args.beatBlock);

  const r = await invokePlanningModule(host, {
    mode: "plan",
    model: args.model,
    brief: args.brief,
    systemMessage,
    userMessage,
  });

  if (!r.ok) {
    return {
      ok: false,
      errors: [r.error],
      raw: null,
      provider: "module",
      model: args.model,
      logId: null,
      module: r.module,
    };
  }

  const validation = validateStoryboard(r.output.storyboard);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      raw: r.raw,
      provider: "module",
      model: args.model,
      logId: null,
      module: r.module,
    };
  }

  return {
    ok: true,
    storyboard: validation.value,
    raw: r.raw,
    provider: "module",
    model: args.model,
    logId: null,
    module: r.module,
  };
}

export interface RefineStoryboardArgs {
  storyboard: unknown;
  message: string;
  model: string;
}

export async function refineStoryboard(
  host: PlanningHost,
  args: RefineStoryboardArgs,
): Promise<PlanStoryboardResult> {
  const systemMessage = buildRefinementSystemPrompt();
  const userMessage = buildRefinementUserMessage(args.storyboard, args.message);

  const r = await invokePlanningModule(host, {
    mode: "refine",
    model: args.model,
    storyboard: args.storyboard,
    systemMessage,
    userMessage,
  });

  if (!r.ok) {
    return {
      ok: false,
      errors: [r.error],
      raw: null,
      provider: "module",
      model: args.model,
      logId: null,
      module: r.module,
    };
  }

  const validation = validateStoryboard(r.output.storyboard);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      raw: r.raw,
      provider: "module",
      model: args.model,
      logId: null,
      module: r.module,
    };
  }

  return {
    ok: true,
    storyboard: validation.value,
    raw: r.raw,
    provider: "module",
    model: args.model,
    logId: null,
    module: r.module,
  };
}

export interface ChatCompleteArgs {
  model: string;
  user_input: string;
  system_prompt?: string;
}

export type ChatCompleteResult =
  | { ok: true; output: string; model: string; logId: string | null; module: string }
  | { ok: false; error: string; model: string };

export async function chatComplete(
  host: PlanningHost,
  args: ChatCompleteArgs,
): Promise<ChatCompleteResult> {
  const systemMessage = args.system_prompt?.trim() || "You are a helpful assistant.";
  const r = await invokePlanningModule(host, {
    mode: "chat",
    model: args.model,
    systemMessage,
    userMessage: args.user_input,
  });

  if (!r.ok) {
    return { ok: false, error: r.error, model: args.model };
  }

  const output = (r.output.notes ?? []).join("\n").trim();
  if (!output) {
    return { ok: false, error: "plan.enhance module returned empty chat output", model: args.model };
  }

  return { ok: true, output, model: args.model, logId: null, module: r.module };
}
