import { describe, expect, it } from "vitest";
import { appliedTags, SILENT_FALLBACK_TAG, MODEL } from "../src/modules/chain/dialogue-gen-core.js";
import { invokeNotifyEmail } from "../src/modules/chain/handlers.js";
import { extractVideoUrl } from "../src/modules/runpod/fixed-motion.js";

// #50 + #51: local module stubs must not report success dishonestly, and a cloud motion backend must not
// adopt a non-video URL as the clip.

describe("dialogue-gen honesty (#50)", () => {
  it("tags the silent placeholder as a silent fallback, NOT the real Deepgram model", () => {
    const tags = appliedTags([
      { shot_id: "s1", audio_key: "k1", voice_id: "angus" },
      { shot_id: "s2", audio_key: "k2", voice_id: "luna" },
    ]);
    expect(tags).toContain(SILENT_FALLBACK_TAG);
    expect(tags).not.toContain(`dialogue:${MODEL}`); // no longer claims a real TTS model it never ran
    expect(tags).toContain("lines:2");
  });
});

describe("notify-email honesty (#50)", () => {
  it("reports delivered:[] because the local stub only logs, never sends", async () => {
    const r = await invokeNotifyEmail({
      hook: "notify",
      input: { event: "render.complete", film_id: "f1", project: "p", download_url: "https://x/f.mp4", seconds: 10 },
      config: { notify_email: "owner@example.com" },
      context: { project: "p", job_id: "j1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("output" in r) || !r.output) throw new Error("expected output");
    expect(r.output.delivered).toEqual([]); // honest: nothing was actually delivered
  });
});

describe("fixed-motion extractVideoUrl (#51)", () => {
  it("prefers the real video URL over an earlier thumbnail/preview URL", () => {
    // thumbnail appears BEFORE the video in key order; the old single pass returned the thumbnail.
    const out = { thumbnail: "https://cdn/x/preview.jpg", assets: { video: "https://cdn/x/clip.mp4" } };
    expect(extractVideoUrl(out)).toBe("https://cdn/x/clip.mp4");
  });

  it("still falls back to an extension-less URL when NO video-typed URL is present", () => {
    expect(extractVideoUrl({ url: "https://cdn/x/video?token=abc" })).toBe("https://cdn/x/video?token=abc");
  });

  it("returns null when there is no URL at all (caller then fails honestly)", () => {
    expect(extractVideoUrl({ status: "done", logs: ["rendered ok"] })).toBeNull();
  });
});
