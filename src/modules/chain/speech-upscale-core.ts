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

export function buildRunPodBody(input: SpeechInput, cfg: SpeechUpscaleConfig): { input: Record<string, unknown> } {
  return {
    input: {
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

export function successRunpodOutput(st: SpeechPollState, out: SpeechBackendOutput): SpeechOutput {
  return {
    shot_id: st.shotId,
    audio_key: out.output_key as string,
    applied: out.applied && out.applied.length ? out.applied : ["speech-upscale:resemble-enhance"],
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
