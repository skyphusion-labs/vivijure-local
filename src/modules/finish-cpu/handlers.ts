import type {
  FinishInput,
  FinishOutput,
  InvokeRequest,
  InvokeResponse,
} from "@skyphusion-labs/vivijure-core";
import type { ArtifactStore } from "../../platform/create-storage.js";
import {
  buildContainerSpec,
  buildDrawtextFilter,
  coerceConfig,
  coerceOverlays,
  outputClipKey,
  passthroughOutput,
} from "./text-overlay-core.js";

export interface FinishCpuEnv {
  VIDEO_FINISH_URL?: string;
}

export function finishCpuEnvFromProcess(env: NodeJS.ProcessEnv): FinishCpuEnv {
  return { VIDEO_FINISH_URL: env.VIDEO_FINISH_URL?.replace(/\/+$/, "") || undefined };
}

export async function invokeTextOverlay(
  env: FinishCpuEnv,
  store: ArtifactStore,
  req: InvokeRequest<FinishInput>,
): Promise<InvokeResponse<FinishOutput>> {
  const input = req.input;
  if (!input?.shot_id || !input?.clip_key) {
    return { ok: false, error: "text-overlay: input needs shot_id and clip_key" };
  }
  const cfg = coerceConfig(req.config ?? {});
  const overlays = coerceOverlays(req.config?.overlays);
  const filter = buildDrawtextFilter(overlays, cfg);
  if (!filter) {
    return { ok: true, output: passthroughOutput(input, "no-overlays", { degraded: false }) };
  }
  if (!env.VIDEO_FINISH_URL) {
    return { ok: true, output: passthroughOutput(input, "no-video-finish-url") };
  }

  const obj = await store.get(input.clip_key);
  if (!obj) {
    return { ok: true, output: passthroughOutput(input, "clip-not-found", { detail: input.clip_key }) };
  }
  const clipBytes = new Uint8Array(obj);
  const outKey = outputClipKey(input.clip_key);
  const specHeader = Buffer.from(JSON.stringify(buildContainerSpec(filter, outKey)), "utf8").toString("base64");

  let resp: Response;
  try {
    resp = await fetch(`${env.VIDEO_FINISH_URL}/overlay`, {
      method: "POST",
      headers: {
        "content-type": "video/mp4",
        "x-overlay-spec": specHeader,
      },
      body: clipBytes,
    });
  } catch (e) {
    return { ok: true, output: passthroughOutput(input, "container-failed", { detail: (e as Error).message }) };
  }
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    return {
      ok: true,
      output: passthroughOutput(input, "container-failed", { detail: `HTTP ${resp.status}: ${errText.slice(0, 200)}` }),
    };
  }
  const outBytes = new Uint8Array(await resp.arrayBuffer());
  if (!outBytes.byteLength) {
    return { ok: true, output: passthroughOutput(input, "container-empty-response") };
  }
  await store.put(outKey, outBytes, { httpMetadata: { contentType: "video/mp4" } });
  return {
    ok: true,
    output: {
      shot_id: input.shot_id,
      clip_key: outKey,
      out_fps: input.src_fps ?? 24,
      frames: input.frames ?? 0,
      applied: [`text-overlay:${overlays.length}`],
    },
  };
}

export type FinishCpuModuleName = "text-overlay";

export function isFinishCpuModuleName(name: string): name is FinishCpuModuleName {
  return name === "text-overlay";
}
