/** Minimal planner YAML types (full parser is M7 planner scope). */

export interface ParsedBundleScene {
  shot_id: string;
  prompt: string;
  seconds: number;
  dialogue?: { slot: string; text: string };
}
