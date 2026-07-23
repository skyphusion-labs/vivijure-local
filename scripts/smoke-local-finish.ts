#!/usr/bin/env tsx
/** Silent local-gpu + local-finish smoke (local#180). */
import { api, fail, type SmokeStoryboard } from "./smoke-lib.js";

const STORYBOARD: SmokeStoryboard = {
  title: "local_finish_smoke",
  full_prompt: "Silent two-shot finish smoke.",
  duration_seconds: 8,
  clip_seconds: 4,
  style_prefix: "cinematic",
  style_category: "None",
  style_preset: "None",
  use_characters: [],
  scenes: [
    { id: "shot_01", prompt: "calm ocean horizon", target_seconds: 4 },
    { id: "shot_02", prompt: "gentle beach waves", target_seconds: 4 },
  ],
};

async function main(): Promise<void> {
  const bundleRes = await api("/api/storyboard/bundle", {
    method: "POST",
    body: JSON.stringify({ storyboard: STORYBOARD, characterRefs: {} }),
  });
  const bundle = (await bundleRes.json()) as { ok?: boolean; bundleKey?: string };
  if (!bundleRes.ok || !bundle.ok || !bundle.bundleKey) fail(`bundle: ${JSON.stringify(bundle)}`);
  console.log(`smoke: bundle -> ${bundle.bundleKey}`);

  const renderRes = await api("/api/storyboard/render", {
    method: "POST",
    body: JSON.stringify({
      bundleKey: bundle.bundleKey,
      project: "local_finish_smoke",
      motion_backend: "local-gpu",
      renderOverrides: { keyframe_backend: "local-gpu" },
      scenes: STORYBOARD.scenes.map((s) => ({
        shot_id: s.id,
        prompt: s.prompt,
        seconds: s.target_seconds,
      })),
      qualityTier: "draft",
    }),
  });
  const render = (await renderRes.json()) as { jobId?: string; error?: string };
  if (!renderRes.ok || !render.jobId) fail(`render: ${JSON.stringify(render)}`);
  console.log(`smoke: jobId -> ${render.jobId}`);

  const deadline = Date.now() + 25 * 60_000;
  let lastPhase = "";
  while (Date.now() < deadline) {
    const pollRes = await api(`/api/storyboard/render/${encodeURIComponent(render.jobId!)}`);
    const view = (await pollRes.json()) as {
      status?: string;
      error?: string;
      output?: { output_key?: string };
      progress?: { phase?: string; finish_chain?: unknown };
    };
    if (!pollRes.ok) fail(`poll: ${JSON.stringify(view)}`);
    const phase = String(view.progress?.phase ?? view.status ?? "");
    if (phase !== lastPhase) {
      const chain = view.progress?.finish_chain ? ` chain=${JSON.stringify(view.progress.finish_chain)}` : "";
      console.log(`smoke: poll ${view.status} phase=${phase}${chain}`);
      lastPhase = phase;
    }
    if (view.status === "COMPLETED") {
      console.log(`smoke: PASS -- ${view.output?.output_key}`);
      return;
    }
    if (view.status === "FAILED" || view.status === "CANCELLED") fail(view.error ?? view.status ?? "unknown");
    await new Promise((r) => setTimeout(r, 15000));
  }
  fail("timeout");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
