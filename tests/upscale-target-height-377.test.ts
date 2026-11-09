// local#377: the local panel's upscale control is target_height, and it is LIVE end to end.
//
// The receive side was the defect: vivijure-upscale handler.py read only `scale` and collapsed it to
// 2 or 4, so `target_height` was accepted and discarded. That was fixed upstream in vivijure-upscale
// PR #109 (closing vivijure-upscale#102), first published as the `1.1.3-serve` image. Its
// `_size_request` docstring names this door's contract: "vivijure-local local-finish sends 1080 and
// no scale". The handler REFUSES when both knobs are sent and disagree.
//
// So this side's job is to keep sending exactly that, and this file is the guard. It reads the body
// a real socket door receives, not a mock of fetch: a removed `extra` would silently return every
// local upscale to a blind 2x, and a `scale` key added beside target_height would make the handler
// refuse most sources. Both directions go red here.

import { describe, it, expect, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createLocalFinishModuleApp } from "../src/modules/local-finish/app.js";
import { resetDoorCursorsForTests } from "../src/modules/door-pool.js";

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (close) await close();
  close = null;
  vi.restoreAllMocks();
});

/** A real door that records the body of every POST /run and answers with a job id. */
async function recordingDoor(): Promise<{ url: string; runs: Array<{ input: Record<string, unknown> }> }> {
  const runs: Array<{ input: Record<string, unknown> }> = [];
  const srv = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/run") runs.push(JSON.parse(data));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "job-377" }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  close = () =>
    new Promise<void>((r) => {
      srv.closeAllConnections();
      srv.close(() => r());
    });
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, runs };
}

async function invoke(moduleName: "finish-upscale" | "finish-lipsync", doorUrl: string) {
  resetDoorCursorsForTests();
  const env = { LOCAL_FINISH_UPSCALE_URL: doorUrl, LOCAL_FINISH_LIPSYNC_URL: doorUrl };
  const app = createLocalFinishModuleApp({ name: moduleName }, moduleName, async () => env);
  const res = await app.request("/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hook: "finish",
      input: { shot_id: "shot_01", clip_key: "renders/p/clips/shot_01.mp4", audio_key: "renders/p/a.wav" },
      config: {},
      context: { project: "p" },
    }),
  });
  return (await res.json()) as { ok: boolean };
}

describe("local#377: finish-upscale sends the handler's sizing contract", () => {
  it("target_height 1080 and NO scale reach the door", async () => {
    const door = await recordingDoor();
    const r = await invoke("finish-upscale", door.url);
    expect(r.ok).toBe(true);
    expect(door.runs).toHaveLength(1);
    const input = door.runs[0].input;
    expect(input.action).toBe("upscale_clip");
    expect(input.target_height).toBe(1080);
    // Both knobs present and disagreeing is a refusal at the handler, so `scale` must not ride along.
    expect("scale" in input).toBe(false);
  });

  it("CONTROL: lipsync carries no target_height, so the field above is specific to upscale", async () => {
    const door = await recordingDoor();
    const r = await invoke("finish-lipsync", door.url);
    expect(r.ok).toBe(true);
    expect(door.runs).toHaveLength(1);
    expect("target_height" in door.runs[0].input).toBe(false);
  });
});
