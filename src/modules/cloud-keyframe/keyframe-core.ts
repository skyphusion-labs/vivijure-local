// Pure cloud-keyframe logic (ported from vivijure/modules/cloud-keyframe/src/keyframe.ts).

import type { KeyframeShot } from "@skyphusion-labs/vivijure-core";
import type { BundleScene, RegistryCharacter } from "./bundle-core.js";

export const MODELS = [
  "@cf/black-forest-labs/flux-2-klein-9b",
  "google/nano-banana-pro",
  "@cf/black-forest-labs/flux-2-klein-4b",
  "@cf/black-forest-labs/flux-2-dev",
] as const;
export type Model = (typeof MODELS)[number];

export const MIN_DIM = 512;
export const MAX_DIM = 1536;

export function clampModel(v: unknown): Model {
  return (MODELS as readonly string[]).includes(v as string) ? (v as Model) : MODELS[0];
}

export function clampDim(v: unknown, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_DIM, Math.min(MAX_DIM, n));
}

export function clampRefsPerSlot(v: unknown): number {
  const n = Math.round(Number(v) || 1);
  return Math.max(1, Math.min(4, n));
}

export function composePrompt(
  stylePrefix: string,
  scenePrompt: string,
  shotSlots: string[],
  registry: Record<string, RegistryCharacter>,
): string {
  const lead = stylePrefix.trim() ? `${stylePrefix.trim()}. ` : "";
  const ids: string[] = [];
  for (const slot of shotSlots) {
    const c = registry[slot];
    if (!c) continue;
    const bible = c.prompt.trim();
    const capped = bible.length > 300 ? bible.slice(0, 300) : bible;
    const namePart = c.name.trim();
    const piece = [namePart, capped].filter(Boolean).join(": ");
    if (piece) ids.push(piece);
  }
  const idText = ids.length ? ` Featuring ${ids.join("; ")}.` : "";
  return `${lead}${scenePrompt.trim()}${idText}`;
}

export function keyframeKey(project: string, shotId: string): string {
  return `renders/${project}/keyframes/${shotId}.png`;
}

export function stageRefKey(project: string, jobId: string, slot: string, index: number): string {
  return `keyframe-stage/${project}/${jobId}/ref_${slot}_${String(index).padStart(2, "0")}.png`;
}

export function stateKey(project: string, jobId: string): string {
  return `keyframe-stage/${project}/${jobId}.state.json`;
}

export interface ShotPlan {
  shot_id: string;
  prompt: string;
  slots: string[];
}

export interface CloudKeyframeState {
  project: string;
  job_id: string;
  model: Model;
  width: number;
  height: number;
  slot_refs: Record<string, string[]>;
  shots: ShotPlan[];
  done: KeyframeShot[];
  total: number;
}

export function selectScenes(scenes: BundleScene[], shotIds?: string[]): BundleScene[] {
  if (!shotIds || shotIds.length === 0) return scenes;
  const want = new Set(shotIds.filter((s) => typeof s === "string" && s.length > 0));
  return scenes.filter((s) => want.has(s.shot_id));
}

export function usedSlots(scenes: BundleScene[]): string[] {
  const set = new Set<string>();
  for (const s of scenes) for (const slot of s.slots) set.add(slot);
  return [...set].sort();
}

export interface PollToken {
  project: string;
  job_id: string;
}

export function encodePoll(t: PollToken): string {
  return btoa(JSON.stringify(t));
}

export function decodePoll(token: string): PollToken | null {
  try {
    const o = JSON.parse(atob(token)) as PollToken;
    if (o && typeof o.project === "string" && typeof o.job_id === "string") {
      return { project: o.project, job_id: o.job_id };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function readOutput(state: CloudKeyframeState): { project: string; keyframes: KeyframeShot[] } {
  return { project: state.project, keyframes: state.done };
}
