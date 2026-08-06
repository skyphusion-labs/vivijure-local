/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// local#331 / cf#353: real retry route + panel control match.

const ROW_JS = readFileSync(`${process.cwd()}/public/planner-history-row.js`, "utf8");
const M13 = readFileSync(`${process.cwd()}/src/routes/m13-render-history.ts`, "utf8");

describe("local#331 / cf#353 the retry control is real", () => {
  it("the panel calls POST .../retry via retryFailedRender", () => {
    expect(ROW_JS).toContain("async function retryFailedRender");
    expect(ROW_JS).toMatch(/\/api\/storyboard\/renders\/.*\/retry/);
  });

  it("the route is registered on the studio", () => {
    expect(M13).toContain('app.post("/api/storyboard/renders/:id/retry"');
    expect(M13).toContain("retryFailedRender");
  });

  it("a failed row still has re-render as a recovery path", () => {
    const start = ROW_JS.indexOf('// v0.35.1: "re-render" with the same bundle');
    expect(start, "the re-render section anchor is gone; re-anchor this test").toBeGreaterThan(-1);
    const block = ROW_JS.slice(start, ROW_JS.indexOf("actions.appendChild(rerun)", start));
    expect(block).toContain('rerun.textContent = "re-render"');
    expect(block, "re-render became status-gated; a failed row now has no recovery path")
      .not.toMatch(/if\s*\(/);
  });

  it("POSITIVE CONTROL: the matchers can see the files they are reading", () => {
    expect(ROW_JS.length).toBeGreaterThan(1000);
    expect(ROW_JS).toContain('rerun.textContent = "re-render"');
    expect(M13.length).toBeGreaterThan(500);
  });
});
