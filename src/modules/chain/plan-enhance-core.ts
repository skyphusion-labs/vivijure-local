/**
 * plan.enhance core (ported from vivijure/modules/plan-enhance/enhance.ts).
 */
import type { PlanEnhanceScene, PlanEnhanceStoryboard } from "@skyphusion-labs/vivijure-core/modules/types";

export type Intensity = "light" | "medium" | "bold";

const INTENSITY_GUIDE: Record<Intensity, string> = {
  light:
    "Add a light touch of filmable direction: one concrete camera angle or lighting cue per shot that an SDXL keyframe can show. Stay close to the original.",
  medium:
    "Add clear shot-list direction: camera framing or gentle movement, subject action, and lighting or mood, in one or two natural sentences per shot (keyframe-ready, not prose fiction).",
  bold:
    "Direct each shot vividly for short AI video: camera framing and movement, lens feel, lighting, mood, and a sense of motion, while keeping the original subject and action.",
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
        "You are a film director rewriting storyboard shot lines for a local AI film studio " +
        "(SDXL keyframes → short motion clips). " +
        guide +
        " Preserve each shot's subject, action, and meaning; do not add or remove shots; do not change who appears. " +
        "Write visual, filmable language (who/what, framing, light); avoid abstract theme essays and style words that belong in a global style_prefix. " +
        "Reply with ONLY a JSON array of strings: the rewritten shot descriptions, in the same order, the same length as the input. " +
        "No prose before or after the array, no keys, no markdown fences, no thinking tags.",
    },
    {
      role: "user",
      content: `Rewrite these ${prompts.length} shot descriptions for keyframe-ready direction:\n${numbered}`,
    },
  ];
}

/** Drop CoT wrappers before structured parse (belt-and-suspenders vs think:false). */
function stripModelChrome(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

function tryJsonArray(raw: string, n: number): string[] | null {
  let s = stripModelChrome(raw);
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
  for (const line of stripModelChrome(raw).split(/\r?\n/)) {
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
  let text = stripModelChrome(raw);
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1]!.trim();
  try {
    const parsed = JSON.parse(text) as PlanEnhanceStoryboard;
    if (parsed && Array.isArray(parsed.scenes)) return parsed;
  } catch {
    // Model sometimes wraps the object in prose; extract the outermost {...}.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) return null;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as PlanEnhanceStoryboard;
      if (parsed && Array.isArray(parsed.scenes)) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

/** Dev mock: deterministic director pass without cloud AI (homelab offline). */
export function mockEnhanced(prompts: string[], intensity: Intensity): string[] {
  const suffix =
    intensity === "bold"
      ? " -- vivid cinematic framing and lighting."
      : intensity === "light"
        ? " (subtle direction)"
        : " -- directed.";
  return prompts.map((p) => (p.trim() ? p.trim() + suffix : p));
}
