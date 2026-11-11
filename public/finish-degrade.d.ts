// Types for the pure helpers in finish-degrade.js (cf#118).
// Hand-authored (no build step) so tests typecheck under the CI tsc gate.

export interface DeliveredClip {
  shot_id: string;
  key: string;
}

/** `output.finish_unavailable` as the core poll bridge emits it, plus the clips that ride
 *  alongside it on the same output object. */
export interface FinishUnavailable {
  at?: string | null;
  reason?: string | null;
  delivered?: string | null;
}

export interface RenderOutput {
  output_key?: string | null;
  project?: string | null;
  clips?: unknown;
  finish_unavailable?: unknown;
  [k: string]: unknown;
}

export interface NormalizedDegrade {
  /** "assemble" | "mux" as reported; null when the studio did not say. */
  at: string | null;
  /** "clips" | "silent_film" as reported; null when the studio did not say. */
  delivered: string | null;
  /** The studio reason VERBATIM, or NO_REASON when it gave none. */
  reason: string;
  clips: DeliveredClip[];
}

export interface Deliverable {
  kind: "film" | "clips" | "none";
  key: string | null;
  clips: DeliveredClip[];
}

export const NO_REASON: string;
export function clipsFrom(output: RenderOutput | null | undefined): DeliveredClip[];
export function degradeFrom(output: RenderOutput | null | undefined): NormalizedDegrade | null;
export function deliverable(output: RenderOutput | null | undefined): Deliverable;
export function deliveredSummary(degrade: NormalizedDegrade | null | undefined): string | null;

// ---- local#539: render signals (ported from vivijure-cf cf#916 / cf#1282 / cf#1283 / cf#1385) ----

export interface ContentValidation {
  failed: number;
  failedShots: string[];
  unmeasured: number;
  reasons: string[];
}
export function parseContentValidation(raw: unknown): ContentValidation | null;
export function parsePlateCheck(raw: unknown): { shots: string[] } | null;
export function parseKeyframesIncomplete(raw: unknown): { missing: number; shots: string[]; expected: number } | null;
export function plateUncleanShots(output: RenderOutput | null | undefined): string[];
export function keyframeUnclean(kf: { plate_count?: unknown } | null | undefined): boolean;
export function shotWarnings(
  output: RenderOutput | null | undefined,
  shotId: unknown,
  kf?: { plate_count?: unknown } | null,
): string[];
export interface SignalLine {
  text: string;
  /** The studio's reasons, verbatim. */
  reasons: string[];
}
export function renderSignalLines(output: RenderOutput | null | undefined): SignalLine[];
export const STILL_EXTRA_PERSON: string;
export interface KeyframeReuse {
  stills: number;
  reused: string[];
}
export function parseKeyframeReuse(raw: unknown): KeyframeReuse | null;
export function keyframeReusedShots(output: RenderOutput | null | undefined): string[];
export function keyframeReused(
  output: RenderOutput | null | undefined,
  kf: { shot_id?: unknown; reused?: unknown } | null | undefined,
): boolean;
export function reuseNote(output: RenderOutput | null | undefined): string;
export const STILL_REUSED_TAG: string;
export const STILL_REUSED_TITLE: string;
export const NEW_PICTURE_HINT: string;
