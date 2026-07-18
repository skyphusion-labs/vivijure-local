import { test, expect } from "./fixtures";

// cf#129: the three cast image pickers are a PROJECTION of the host catalog -- they render
// GET /api/models filtered on type==="image". Before this they were fed by a hardcoded array
// inside cast.js, so they stayed fully populated even when the host could serve nothing.
//
// This drives the REAL panel in a REAL browser against a REAL host: no stubbed fetch, no
// simulated DOM. The assertion is deliberately written against WHAT THE HOST ACTUALLY SERVES
// rather than an expected id list, so the same test is meaningful on a populated host AND on
// a demo-mode host serving an honestly empty catalog, and it cannot rot when phase 2 changes
// the image rows from a hardcoded list to a module projection.
test.describe("cast image pickers project the host catalog (cf#129)", () => {
  test("the picker shows exactly the image rows the host serves, or names what is missing", async ({ page }) => {
    await page.goto("/cast.html");

    // What the HOST says, read through the same origin the panel uses.
    const served: string[] = await page.evaluate(async () => {
      const token = localStorage.getItem("vivijure_api_token") || "";
      const resp = await fetch("/api/models", { headers: { authorization: "Bearer " + token } });
      const data = (await resp.json()) as { models?: Array<{ id: string; type: string }> };
      return (data.models || []).filter((m) => m.type === "image").map((m) => m.id);
    });

    // The type FILTER is only actually exercised when the host serves non-image rows. On a
    // host with no plan.enhance module installed there are zero chat rows, so removing the
    // filter changes nothing and this test would pass over a broken projection -- verified: a
    // negative control that deleted the filter still passed here. Record which case ran, so a
    // green tick is never mistaken for filter coverage. The mixed-row filter assertion lives in
    // the unit suite (tests/cast-image-picker.test.ts, "EXCLUDES chat rows"), which serves a
    // chat row deliberately.
    const nonImage: number = await page.evaluate(async () => {
      const token = localStorage.getItem("vivijure_api_token") || "";
      const resp = await fetch("/api/models", { headers: { authorization: "Bearer " + token } });
      const data = (await resp.json()) as { models?: Array<{ type: string }> };
      return (data.models || []).filter((m) => m.type !== "image").length;
    });
    test.info().annotations.push({
      type: nonImage > 0 ? "filter-exercised" : "filter-NOT-exercised",
      description: nonImage > 0
        ? "host serves " + nonImage + " non-image rows, so the type filter is under test here"
        : "host serves ONLY image rows, so the type filter is a no-op here and is NOT covered by this test",
    });

    const sel = page.locator("#cast-portrait-gen-model");
    const details = page.locator("details:has(#cast-portrait-gen-model)").first();
    if (await details.count()) await details.evaluate((d) => { (d as unknown as { open: boolean }).open = true; });

    if (served.length === 0) {
      // HONEST FAIL: a visible, disabled state naming what is missing, and an empty value so
      // downstream gates block truthfully instead of submitting a placeholder as a model id.
      await expect
        .poll(async () => (await sel.locator("option").allTextContents()).join("|"), { timeout: 15_000 })
        .toContain("no image models available");
      const opts = await sel.locator("option").all();
      expect(opts.length).toBe(1);
      expect(await opts[0].isDisabled()).toBe(true);
      expect(await opts[0].getAttribute("value")).toBe("");
      // and NONE of the ids the panel used to hardcode
      const text = (await sel.locator("option").allTextContents()).join("|");
      expect(text).not.toContain("FLUX");
      expect(text).not.toContain("Nano Banana");
    } else {
      // PROJECTION FIDELITY: exactly the served ids, in the served order, nothing invented.
      await expect
        .poll(async () => (await sel.locator("option").evaluateAll((os) => os.map((o) => (o as unknown as { value: string }).value))).length, { timeout: 15_000 })
        .toBe(served.length);
      const values = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as unknown as { value: string }).value));
      expect(values).toEqual(served);
      expect(await sel.isEnabled()).toBe(true);
    }
  });
});
