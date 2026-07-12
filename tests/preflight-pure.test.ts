import { describe, expect, it } from "vitest";
import {
  checkStoryboardShape,
  resolveCastBindings,
  summarize,
} from "../src/preflight.js";

describe("preflight pure checks", () => {
  it("flags empty scenes", () => {
    const result = summarize(checkStoryboardShape({ title: "t", scenes: [] }));
    expect(result.ok).toBe(false);
    expect(result.counts.error).toBeGreaterThan(0);
  });

  it("resolves public cast ids to numeric row ids", () => {
    const { resolved, unresolved } = resolveCastBindings(
      { A: "cast-uuid-1" },
      [{ id: 7, public_id: "cast-uuid-1" }],
    );
    expect(unresolved).toHaveLength(0);
    expect(resolved.A).toBe(7);
  });
});
