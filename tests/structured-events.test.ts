import { describe, expect, it, vi, afterEach } from "vitest";
import { emitStructuredEvent } from "@skyphusion-labs/vivijure-core";

describe("emitStructuredEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a single JSON line with ev to stdout", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    emitStructuredEvent({ ev: "film.phase", film_id: "film-1", phase: "clips" });
    expect(spy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(spy.mock.calls[0][0]))).toEqual({
      ev: "film.phase",
      film_id: "film-1",
      phase: "clips",
    });
  });
});
