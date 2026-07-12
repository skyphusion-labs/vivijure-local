/**
 * dialogue-gen pure logic (ported from vivijure/modules/dialogue-gen/dialogue-gen.ts).
 */
import type { DialogueInput, DialogueLine, DialogueOutput, DialogueShotAudio } from "@skyphusion-labs/vivijure-core/modules/types";

export const MODEL = "@cf/deepgram/aura-1" as const;

export const VOICE_IDS = [
  "angus", "asteria", "arcas", "orion", "orpheus", "athena",
  "luna", "zeus", "perseus", "helios", "hera", "stella",
] as const;
export type VoiceId = (typeof VOICE_IDS)[number];
export const DEFAULT_VOICE_ID: VoiceId = "angus";
const VOICE_SET: ReadonlySet<string> = new Set(VOICE_IDS);

export function resolveVoice(voiceId: string | undefined): VoiceId {
  return voiceId && VOICE_SET.has(voiceId) ? (voiceId as VoiceId) : DEFAULT_VOICE_ID;
}

export const DIALOGUE_MAX_CHARS = 300;
export const AUDIO_MIME = "audio/wav";

export interface PollToken {
  job_id: string;
}

export function encodePoll(t: PollToken): string {
  return Buffer.from(JSON.stringify(t)).toString("base64");
}

export function decodePoll(token: string): PollToken | null {
  try {
    const o = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as PollToken;
    if (o && typeof o.job_id === "string" && o.job_id.length > 0) return { job_id: o.job_id };
  } catch {
    /* fall through */
  }
  return null;
}

export function stateKey(jobId: string): string {
  return `dialogue-gen/${jobId}.state.json`;
}

export function audioKey(project: string, shotId: string): string {
  return `renders/${project}/dialogue/${shotId}.wav`;
}

export type RunState =
  | { status: "running"; started_at: number; project: string; lines: NormalizedLine[]; next_index: number; audio: DialogueShotAudio[] }
  | { status: "done"; project: string; audio: DialogueShotAudio[]; applied: string[] }
  | { status: "failed"; error: string };

export function appliedTags(audio: DialogueShotAudio[]): string[] {
  return [`dialogue:${MODEL}`, `lines:${audio.length}`];
}

export function readOutput(state: Extract<RunState, { status: "done" }>): DialogueOutput {
  return { project: state.project, audio: state.audio, applied: state.applied };
}

export interface NormalizedLine {
  shot_id: string;
  text: string;
  voice: VoiceId;
}

export function normalizeInput(
  input: DialogueInput | undefined,
): { ok: true; project: string; lines: NormalizedLine[] } | { ok: false; error: string } {
  const project = typeof input?.project === "string" ? input.project.trim() : "";
  if (!project) return { ok: false, error: "input.project required" };
  if (!Array.isArray(input?.lines)) return { ok: false, error: "input.lines must be an array" };
  const lines: NormalizedLine[] = [];
  for (const raw of input.lines as DialogueLine[]) {
    const shotId = typeof raw?.shot_id === "string" ? raw.shot_id.trim() : "";
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (!shotId || !text) continue;
    if (text.length > DIALOGUE_MAX_CHARS) {
      return { ok: false, error: `line for ${shotId} is ${text.length} chars; cap is ${DIALOGUE_MAX_CHARS}` };
    }
    lines.push({ shot_id: shotId, text, voice: resolveVoice(raw.voice_id) });
  }
  return { ok: true, project, lines };
}
