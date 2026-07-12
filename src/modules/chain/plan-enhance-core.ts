/**
 * plan.enhance core (ported from vivijure/modules/plan-enhance/enhance.ts).
 */
import type { PlanEnhanceScene, PlanEnhanceStoryboard } from "@skyphusion-labs/vivijure-core/modules/types";

export type Intensity = "light" | "medium" | "bold";

const INTENSITY_GUIDE: Record<Intensity, string> = {
  light:
    "Add a light touch of cinematic direction: one concrete camera or lighting detail per shot. Stay close to the original.",
  medium:
    "Add clear cinematic direction: camera framing or movement, lens feel, and lighting or mood, in a natural sentence or two per shot.",
  bold:
    "Direct each shot vividly: camera framing and movement, lens, lighting, mood, and a sense of motion, while keeping the original subject and action.",
};

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export function buildMessages(prompts: string[], intensity: Intensity): ChatMessage[] {
  const guide = INTENSITY_GUIDE[intensity] ?? INTENSITY_GUIDE.medium;
  const numbered = prompts.map((p, i) => `${i + 1}. ${p}`).join("\n");
  return [
    {
      role: "system",
      content:
        "You are a film director doing a pass over a storyboard's shot descriptions. " +
        guide +
        " Preserve each shot's subject, action, and meaning; do not add or remove shots; do not change who appears. " +
        "Reply with ONLY a JSON array of strings: the rewritten shot descriptions, in the same order, the same length as the input. No prose, no keys, no markdown fences.",
    },
    { role: "user", content: `Rewrite these ${prompts.length} shot descriptions:\n${numbered}` },
  ];
}

function tryJsonArray(raw: string, n: number): string[] | null {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== n) return null;
  if (!arr.every((x) => typeof x === "string" && (x as string).trim().length > 0)) return null;
  return (arr as string[]).map((x) => x.trim());
}

function tryNumberedList(raw: string, n: number): string[] | null {
  const items: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.*\S)\s*$/);
    if (m) items.push(m[1]!.replace(/^["']|["']$/g, "").trim());
  }
  if (items.length !== n || !items.every((x) => x.length > 0)) return null;
  return items;
}

export function parseEnhanced(raw: unknown, n: number): string[] | null {
  if (Array.isArray(raw)) {
    if (raw.length === n && raw.every((x) => typeof x === "string" && (x as string).trim().length > 0)) {
      return (raw as string[]).map((x) => x.trim());
    }
    return null;
  }
  if (typeof raw !== "string") return null;
  return tryJsonArray(raw, n) ?? tryNumberedList(raw, n);
}

export function mergeEnhanced(
  storyboard: PlanEnhanceStoryboard,
  enhanced: string[],
): PlanEnhanceStoryboard {
  const scenes: PlanEnhanceScene[] = storyboard.scenes.map((scene, i) =>
    typeof enhanced[i] === "string" ? { ...scene, prompt: enhanced[i] } : scene,
  );
  return { ...storyboard, scenes };
}

export function scenePrompts(storyboard: PlanEnhanceStoryboard): string[] | null {
  if (!storyboard || !Array.isArray(storyboard.scenes) || storyboard.scenes.length === 0) return null;
  return storyboard.scenes.map((s) => (typeof s.prompt === "string" ? s.prompt : ""));
}

/** Parse a full storyboard JSON object from a model reply (plan / refine modes). */
export function parsePlanStoryboard(raw: unknown): PlanEnhanceStoryboard | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as PlanEnhanceStoryboard;
    if (Array.isArray(o.scenes)) return o;
  }
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1]!.trim();
  try {
    const parsed = JSON.parse(text) as PlanEnhanceStoryboard;
    if (parsed && Array.isArray(parsed.scenes)) return parsed;
  } catch {
    return null;
  }
  return null;
}

/** Dev mock: deterministic director pass without cloud AI (homelab offline). */
export function mockEnhanced(prompts: string[], intensity: Intensity): string[] {
  const suffix =
    intensity === "bold"
      ? " — vivid cinematic framing and lighting."
      : intensity === "light"
        ? " (subtle direction)"
        : " — directed.";
  return prompts.map((p) => (p.trim() ? p.trim() + suffix : p));
}
