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
