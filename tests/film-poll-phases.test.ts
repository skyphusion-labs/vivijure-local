import { describe, expect, it } from "vitest";
import { filmJobToPollView } from "@skyphusion-labs/vivijure-core/film-render-bridge";
import type { FilmJob } from "@skyphusion-labs/vivijure-core/film-model";

function baseJob(phase: FilmJob["phase"], extra: Partial<FilmJob> = {}): FilmJob {
  return {
    film_id: "film-phases",
    project: "parity",
    bundle_key: "bundles/parity.tar.gz",
    scenes: [
      { shot_id: "shot_01", prompt: "a", seconds: 4 },
      { shot_id: "shot_02", prompt: "b", seconds: 4 },
    ],
    motion_backend: "local-gpu",
    motion_config: {},
    finish_config: {},
    speech_config: {},
    film_finish_config: {},
    master_config: {},
    keyframes_only: false,
    keyframe_binding: "MODULE_KEYFRAME",
    phase,
    created_at: Date.now() - 60_000,
    phase_started_at: Date.now() - 30_000,
    ...extra,
  };
}

describe("film poll phase projection (vivijure-core filmJobToPollView)", () => {
  it("maps keyframe phase", () => {
    const view = filmJobToPollView(baseJob("keyframe"), null, 0);
    expect(view.status).toBe("IN_PROGRESS");
    expect((view.output as { phase?: string })?.phase).toBe("keyframe");
  });

  it("maps clips phase to i2v", () => {
    const view = filmJobToPollView(baseJob("clips"), null);
    expect(view.status).toBe("IN_PROGRESS");
    expect((view.output as { phase?: string })?.phase).toBe("i2v");
  });

  it("maps finish phase", () => {
    const view = filmJobToPollView(baseJob("finish"), null);
    expect(view.status).toBe("IN_PROGRESS");
    expect((view.output as { phase?: string })?.phase).toBe("finish");
  });

  it("maps assemble and mux phases", () => {
    expect((filmJobToPollView(baseJob("assemble"), null).output as { phase?: string })?.phase).toBe(
      "assemble",
    );
    expect((filmJobToPollView(baseJob("mux"), null).output as { phase?: string })?.phase).toBe("mux");
  });

  it("reports IN_PROGRESS for dialogue and speech phases", () => {
    for (const phase of ["dialogue", "speech"] as const) {
      const view = filmJobToPollView(baseJob(phase), null);
      expect(view.status).toBe("IN_PROGRESS");
    }
  });

  it("reports IN_PROGRESS for master phase", () => {
    expect(filmJobToPollView(baseJob("master"), null).status).toBe("IN_PROGRESS");
  });

  it("maps done to COMPLETED with output_key", () => {
    const view = filmJobToPollView(
      baseJob("done", { film_key: "renders/film-phases/film.mp4" }),
      null,
    );
    expect(view.status).toBe("COMPLETED");
    expect((view.output as { output_key?: string })?.output_key).toBe("renders/film-phases/film.mp4");
  });
});
