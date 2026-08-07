/**
 * speech-upscale pure logic (ported from vivijure/modules/speech-upscale/speech.ts).
 */
import type { SpeechInput, SpeechOutput } from "@skyphusion-labs/vivijure-core/modules/types";
import type { ArtifactStore } from "../../platform/create-storage.js";

export function passthroughOutput(
  input: { shot_id: string; audio_key: string },
  reason: string,
  detail?: string,
): SpeechOutput {
  return {
    shot_id: input.shot_id,
    audio_key: input.audio_key,
    applied: [],
    degraded: detail ? `${reason}: ${detail}` : reason,
  };
}

export interface SpeechUpscaleConfig {
  enable: boolean;
  denoise: boolean;
}

export function coerceConfig(cfg: Record<string, unknown> | undefined): SpeechUpscaleConfig {
  return {
    enable: cfg?.enable === true,
    denoise: cfg?.denoise === true,
  };
}

export function enhancedAudioKey(audioKey: string): string {
  const slash = audioKey.lastIndexOf("/");
  const dot = audioKey.lastIndexOf(".");
  return dot > slash ? `${audioKey.slice(0, dot)}_enh.wav` : `${audioKey}_enh.wav`;
}

export function successOutput(
  input: SpeechInput,
  outKey: string,
  denoise: boolean,
): SpeechOutput {
  return {
    shot_id: input.shot_id,
    audio_key: outKey,
    applied: [`speech-upscale:local-mock${denoise ? "+denoise" : ""}`],
  };
}

export function buildRunPodBody(
  input: SpeechInput,
  cfg: SpeechUpscaleConfig,
  project: string,
): { input: Record<string, unknown> } {
  // `project` scopes R2 keys on the shared-bucket speech endpoint (renders/<project>/...).
  return {
    input: {
      project,
      audio_key: input.audio_key,
      output_key: enhancedAudioKey(input.audio_key),
      denoise: cfg.denoise,
    },
  };
}

export interface SpeechPollState {
  jobId: string;
  shotId: string;
  audioKey: string;
  submittedAt?: number;
  /**
   * The door that ACCEPTED this job, when it was submitted to a local door (local#383).
   *
   * Present means local door, absent means RunPod -- that is the discriminator the poll reads, and
   * it is why a token minted before this field existed still polls RunPod exactly as it did. The
   * job id lives in the serving door's in-process registry, so polling any other door 404s and
   * would read a healthy job as gone.
   */
  doorUrl?: string;
}

export function encodeSpeechPoll(s: SpeechPollState): string {
  return Buffer.from(JSON.stringify(s), "utf8").toString("base64");
}

export function decodeSpeechPoll(token: string): SpeechPollState | null {
  try {
    const o = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as SpeechPollState;
    if (o && typeof o.jobId === "string" && typeof o.shotId === "string" && typeof o.audioKey === "string") {
      return {
        jobId: o.jobId,
        shotId: o.shotId,
        audioKey: o.audioKey,
        submittedAt: typeof o.submittedAt === "number" ? o.submittedAt : undefined,
        doorUrl: typeof o.doorUrl === "string" && o.doorUrl ? o.doorUrl : undefined,
      };
    }
  } catch {
    /* bad token */
  }
  return null;
}

export interface SpeechBackendOutput {
  output_key?: string;
  applied?: string[];
}

export function parseSpeechBackendOutput(output: unknown): SpeechBackendOutput | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  return {
    output_key: typeof o.output_key === "string" ? o.output_key : undefined,
    applied: Array.isArray(o.applied) ? (o.applied as string[]) : undefined,
  };
}

/**
 * `fallbackTag` is what we claim when the backend completed but named no `applied` tag.
 *
 * It is a per-backend argument rather than a constant because the tag is a CLAIM about what ran:
 * the RunPod satellite is resemble-enhance, and an on-box door is whatever the operator started, so
 * the honest minimum there is that a local door served it. Never a tag naming work we cannot
 * evidence.
 */
export function successRunpodOutput(
  st: SpeechPollState,
  out: SpeechBackendOutput,
  fallbackTag = "speech-upscale:resemble-enhance",
): SpeechOutput {
  return {
    shot_id: st.shotId,
    audio_key: out.output_key as string,
    applied: out.applied && out.applied.length ? out.applied : [fallbackTag],
  };
}

/** Local mock: copy bytes to enhanced key (real module uses RunPod). */
export async function processSpeechLocal(
  store: ArtifactStore,
  input: SpeechInput,
  cfg: SpeechUpscaleConfig,
): Promise<SpeechOutput> {
  if (!cfg.enable) {
    return passthroughOutput(input, "disabled");
  }
  const obj = await store.getBytes(input.audio_key);
  if (!obj) {
    return passthroughOutput(input, "no-audio", `missing ${input.audio_key}`);
  }
  const outKey = enhancedAudioKey(input.audio_key);
  await store.put(outKey, obj.bytes, { httpMetadata: { contentType: "audio/wav" } });
  return successOutput(input, outKey, cfg.denoise);
}
