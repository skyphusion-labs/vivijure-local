import { describe, expect, it, vi, afterEach } from "vitest";
import * as structured from "../src/structured-events.js";

describe("film phase observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emitStructuredEvent supports film.phase and film.render.terminal shapes", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    structured.emitStructuredEvent({
      ev: "film.phase",
      film_id: "film-abc",
      project: "demo",
      from: "keyframe",
      to: "clips",
    });
    structured.emitStructuredEvent({
      ev: "film.render.terminal",
      film_id: "film-abc",
      project: "demo",
      status: "done",
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(spy.mock.calls[0][0]))).toMatchObject({
      ev: "film.phase",
      to: "clips",
    });
    expect(JSON.parse(String(spy.mock.calls[1][0]))).toMatchObject({
      ev: "film.render.terminal",
      status: "done",
    });
  });
});
