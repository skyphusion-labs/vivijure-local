#!/usr/bin/env tsx
/**
 * Exit-criterion smoke: bundle -> render -> poll -> artifact HEAD against a running stack.
 *
 *   STUDIO_URL=http://127.0.0.1:8790 STUDIO_API_TOKEN=... npm run smoke:exit
 *
 * Requires `docker compose up` (studio + CPU containers + gpu mocks + minio).
 */
const BASE = (process.env.STUDIO_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
const TOKEN = process.env.STUDIO_API_TOKEN || "change-me-local-dev-only";

const STORYBOARD = {
  title: "exit_smoke",
  full_prompt: "A two-shot smoke test for the homelab film pipeline.",
  duration_seconds: 8,
  clip_seconds: 4,
  style_prefix: "cinematic",
  style_category: "None",
  style_preset: "None",
  use_characters: [] as string[],
  scenes: [
    { id: "shot_01", prompt: "a calm ocean horizon at sunset", target_seconds: 4 },
    { id: "shot_02", prompt: "gentle waves on an empty beach", target_seconds: 4 },
  ],
};

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

function fail(msg: string): never {
  console.error(`smoke: FAIL -- ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE}/health`);
  if (!health.ok) fail(`studio not reachable at ${BASE}/health (${health.status})`);

  const bundleRes = await api("/api/storyboard/bundle", {
    method: "POST",
    body: JSON.stringify({ storyboard: STORYBOARD, characterRefs: {} }),
  });
  const bundle = (await bundleRes.json()) as { ok?: boolean; bundleKey?: string; errors?: string[] };
  if (!bundleRes.ok || !bundle.ok || !bundle.bundleKey) {
    fail(`bundle failed (${bundleRes.status}): ${JSON.stringify(bundle)}`);
  }
  console.log(`smoke: bundle -> ${bundle.bundleKey}`);

  const scenes = STORYBOARD.scenes.map((s) => ({
    shot_id: s.id,
    prompt: s.prompt,
    seconds: s.target_seconds ?? 4,
  }));

  const renderRes = await api("/api/storyboard/render", {
    method: "POST",
    body: JSON.stringify({
      bundleKey: bundle.bundleKey,
      project: "exit_smoke",
      motion_backend: "local-gpu",
      scenes,
      qualityTier: "draft",
    }),
  });
  const render = (await renderRes.json()) as { jobId?: string; error?: string };
  if (!renderRes.ok || !render.jobId) {
    fail(`render submit failed (${renderRes.status}): ${JSON.stringify(render)}`);
  }
  const jobId = render.jobId;
  console.log(`smoke: render -> ${jobId}`);

  const deadline = Date.now() + 15 * 60_000;
  let lastPhase = "";
  while (Date.now() < deadline) {
    const pollRes = await api(`/api/storyboard/render/${encodeURIComponent(jobId)}`);
    const view = (await pollRes.json()) as {
      status?: string;
      error?: string;
      output?: { output_key?: string };
      progress?: { phase?: string };
    };
    if (!pollRes.ok) fail(`poll failed (${pollRes.status}): ${JSON.stringify(view)}`);

    const phase = String(view.progress?.phase ?? view.status ?? "");
    if (phase && phase !== lastPhase) {
      console.log(`smoke: poll ${view.status} phase=${phase}`);
      lastPhase = phase;
    }

    if (view.status === "COMPLETED") {
      const key = view.output?.output_key;
      if (!key) fail("completed without output_key");
      const artifactRes = await api(`/api/artifact/${key}`, { method: "HEAD" });
      if (!artifactRes.ok) fail(`artifact HEAD ${key} -> ${artifactRes.status}`);
      console.log(`smoke: PASS -- film at ${key} (${artifactRes.headers.get("content-length") ?? "?"} bytes)`);
      return;
    }
    if (view.status === "FAILED" || view.status === "CANCELLED") {
      fail(`job ${view.status}: ${view.error ?? "unknown"}`);
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  fail("timed out waiting for COMPLETED");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
