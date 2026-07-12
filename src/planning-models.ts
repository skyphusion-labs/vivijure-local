/**
 * Planning model catalog derived from installed plan.enhance modules (no hardcoded list).
 */
import { servingForHook, type RegisteredModule } from "@skyphusion-labs/vivijure-core";
import type { ModelEntry } from "./models.js";

export interface PlanningTarget {
  moduleName: string;
  modelId: string;
  configModel?: string;
}

function moduleLabel(mod: RegisteredModule): string {
  const label = mod.provides?.[0]?.label;
  return (typeof label === "string" && label.trim()) || mod.name;
}

/** Build the GET /api/storyboard/models catalog from installed plan.enhance modules. */
export function planningModelsFromModules(modules: RegisteredModule[]): ModelEntry[] {
  const out: ModelEntry[] = [];
  for (const mod of servingForHook(modules, "plan.enhance")) {
    const modelField = mod.config_schema?.model;
    if (modelField?.type === "enum" && modelField.values.length > 0) {
      for (const value of modelField.values) {
        const id = String(value);
        out.push({
          id,
          label: `${moduleLabel(mod)} · ${id}`,
          group: `Planning · ${mod.name}`,
          type: "chat",
          capabilities: [],
        });
      }
      continue;
    }
    out.push({
      id: mod.name,
      label: moduleLabel(mod),
      group: `Planning · ${mod.name}`,
      type: "chat",
      capabilities: [],
    });
  }
  return out;
}

/** Resolve a client model id to the module + config.model that should answer. */
export function resolvePlanningTarget(
  modules: RegisteredModule[],
  modelId: string,
): PlanningTarget | null {
  const trimmed = modelId.trim();
  if (!trimmed) return null;
  const serving = servingForHook(modules, "plan.enhance");

  for (const mod of serving) {
    const values = mod.config_schema?.model?.type === "enum" ? mod.config_schema.model.values : [];
    if (values.map(String).includes(trimmed)) {
      return { moduleName: mod.name, modelId: trimmed, configModel: trimmed };
    }
  }

  const byName = serving.find((m) => m.name === trimmed);
  if (byName) return { moduleName: byName.name, modelId: trimmed };

  if (serving.length === 1) {
    const mod = serving[0]!;
    const values = mod.config_schema?.model?.type === "enum" ? mod.config_schema.model.values : [];
    const fallback = values[0] ? String(values[0]) : mod.name;
    return { moduleName: mod.name, modelId: trimmed, configModel: fallback };
  }

  return null;
}

export function findPlanningModel(
  modules: RegisteredModule[],
  modelId: string,
): ModelEntry | undefined {
  return planningModelsFromModules(modules).find((m) => m.id === modelId);
}
