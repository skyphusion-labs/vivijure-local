// Extract per-scene injected keyframes from a bundle tar and stage them in object storage.

import { extractTarBytes, listTarNames } from "@skyphusion-labs/vivijure-core/bundle-storyboard";
import type { OrchestratorEnv } from "@skyphusion-labs/vivijure-core/platform";

const KF_PATH = /^clips\/(.+)_keyframe\.png$/;

export interface StagedBundleKeyframe {
  shot_id: string;
  keyframe_key: string;
}

export function bundleKeyframeShotIds(tarNames: string[]): string[] {
  const out: string[] = [];
  for (const name of tarNames) {
    const m = name.match(KF_PATH);
    if (m) out.push(m[1]);
  }
  return out;
}

export async function stageBundleInjectedKeyframes(
  env: OrchestratorEnv,
  bundleKey: string,
  project: string,
): Promise<StagedBundleKeyframe[]> {
  const obj = await env.R2_RENDERS.get(bundleKey);
  if (!obj) return [];
  const compressed = await obj.arrayBuffer();
  const tarStream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const tarBuf = new Uint8Array(await new Response(tarStream).arrayBuffer());
  const names = listTarNames(tarBuf);
  const shotIds = bundleKeyframeShotIds(names);
  const out: StagedBundleKeyframe[] = [];
  const safeProject = project.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "project";

  for (const shot_id of shotIds) {
    const tarPath = `clips/${shot_id}_keyframe.png`;
    const bytes = extractTarBytes(tarBuf, tarPath);
    if (!bytes) continue;
    const keyframe_key = `renders/${safeProject}/bundle-kf/${shot_id}.png`;
    await env.R2_RENDERS.put(keyframe_key, bytes, {
      httpMetadata: { contentType: "image/png" },
    });
    out.push({ shot_id, keyframe_key });
  }
  return out;
}
