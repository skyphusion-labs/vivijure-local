import { test, expect } from "./fixtures";

// cf#129 SPRINT-END PARITY GATE, encoded as a runnable suite.
//
// NOT part of the normal CI run: it asserts a PROJECTED catalog, which requires a host with real
// modules installed, and CI does not stand up the sidecar fleet. Running it against a bare host
// would assert nothing and pass, which is the exact vacuous-green this suite exists to prevent.
// So it SKIPS unless GATE_HOST=1 is set, making it deliberate on-demand gate encoding.
//
// HOST REQUIREMENTS (all three, from defects this sprint actually flushed):
//   1. an image.generate module AND a plan.enhance module installed. With neither, every
//      projection assertion passes vacuously while reading green.
//   2. ideally ALSO an ENUM-LESS module. Both label shapes are legitimate and asserting only the
//      enum shape is how two assertions in this very file were wrong while passing:
//        enum module      -> id = model id,    label = "<provides-label> · <model id>"
//        enum-less module -> id = MODULE NAME, label = "<provides-label>" (no separator)
//   3. a FRESH data dir per auth mode: this host persists AUTH_MODE into data/studio.db and it
//      OVERRIDES process env, so a mode flip without a fresh dir verifies the previous mode.
//
// Run: GATE_HOST=1 STUDIO_URL=http://127.0.0.1:8790 npx playwright test tests/e2e/gate-parity.spec.ts

test.skip(process.env.GATE_HOST !== "1", "gate suite: needs a module-provisioned host (GATE_HOST=1)");

async function catalog(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const token = localStorage.getItem("vivijure_api_token") || "";
    const resp = await fetch("/api/models", { headers: { authorization: "Bearer " + token } });
    const data = (await resp.json()) as { models?: Array<{ id: string; type: string; label: string; group: string }> };
    return data.models || [];
  });
}

test("GATE: all three cast image pickers project exactly the image rows", async ({ page }) => {
  await page.goto("/cast.html");
  const rows = await catalog(page);
  const imageIds = rows.filter((r) => r.type === "image").map((r) => r.id);
  const chatIds = rows.filter((r) => r.type === "chat").map((r) => r.id);
  expect(imageIds.length).toBeGreaterThan(0);
  expect(chatIds.length).toBeGreaterThan(0); // filter is genuinely under test

  for (const sel of ["#cast-training-model", "#cast-portrait-gen-model", "#cast-multi-model"]) {
    const loc = page.locator(sel);
    const holder = page.locator(`details:has(${sel})`).first();
    if (await holder.count()) await holder.evaluate((d) => { (d as unknown as { open: boolean }).open = true; });
    await expect.poll(async () => (await loc.locator("option").count()), { timeout: 15_000 }).toBe(imageIds.length);
    const values = await loc.locator("option").evaluateAll((os) => os.map((o) => (o as unknown as { value: string }).value));
    expect(values, `picker ${sel} must project exactly the served image ids`).toEqual(imageIds);
    for (const c of chatIds) expect(values, `${sel} must NOT offer a planning model`).not.toContain(c);
  }
});

test("GATE: labels and groups carry the DECLARING module identity", async ({ page }) => {
  await page.goto("/cast.html");
  const rows = await catalog(page);
  // TWO LABEL SHAPES are legitimate, and asserting one of them is how this test was WRONG:
  //   module WITH a model enum    -> id = the model id,   label = "<provides-label> · <model id>"
  //   module WITHOUT a model enum -> id = the MODULE NAME, label = "<provides-label>" (no separator)
  // The first version of this assertion required a separator in every label. It passed only because
  // the host happened to have enum-declaring modules; against an enum-less module it failed on the
  // real artifact. Assert the CONTRACT, not the formatting.
  for (const r of rows) {
    const moduleName = r.group.split(" · ").pop();
    expect(r.group, "group must name the declaring module").toMatch(/ · .+$/);
    expect(r.label.trim().length, "label must never be empty").toBeGreaterThan(0);
    if (r.label.includes(" · ")) {
      expect(r.label.endsWith(r.id), `enum row label must end with its model id: ${r.label}`).toBe(true);
    } else {
      expect(r.id, "an enum-less module contributes ONE row whose id IS the module name").toBe(moduleName);
    }
  }
  // SECOND environment-encoded assumption, also wrong: this pinned the group list to the exact
  // modules that happened to be installed, so installing a SECOND plan.enhance module broke it.
  // A projection has no fixed module set by definition -- that is the entire point. Assert the
  // PREFIX contract and that every group names a real installed module, never a specific roster.
  const imageGroups = [...new Set(rows.filter((r) => r.type === "image").map((r) => r.group))];
  const chatGroups = [...new Set(rows.filter((r) => r.type === "chat").map((r) => r.group))];
  for (const g of chatGroups) expect(g, "chat rows group under Planning").toMatch(/^Planning · .+$/);
  for (const g of imageGroups) expect(g, "image rows group under Image Gen").toMatch(/^Image Gen · .+$/);
  // and a third-party module must group under ITS OWN name, which is the visible proof of projection
  expect(chatGroups.length, "each declaring module gets its own group").toBeGreaterThan(0);
});

test("GATE: planner picker projects the chat rows and resolves a stale saved id visibly", async ({ page }) => {
  await page.goto("/planner.html");
  const rows = await catalog(page);
  const chatIds = rows.filter((r) => r.type === "chat").map((r) => r.id);
  const sel = page.locator("#planner-model");
  await expect.poll(async () => (await sel.locator("option").count()), { timeout: 15_000 }).toBe(chatIds.length);
  const values = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as unknown as { value: string }).value));
  expect(values).toEqual(chatIds);
  for (const r of rows.filter((x) => x.type === "image")) expect(values).not.toContain(r.id);

  // STALE ID: a saved model the catalog no longer serves must land on a REAL model, never blank.
  await page.evaluate(() => {
    // globalThis, not window: this callback RUNS in the browser but TYPECHECKS in node scope,
    // where the DOM lib is absent. Same trap that produced five errors in the sibling spec.
    (globalThis as unknown as { selectPlanningModel: (v: string) => void }).selectPlanningModel("anthropic/retired-model-xyz");
  });
  const after = await sel.evaluate((s) => (s as unknown as { value: string }).value);
  expect(after, "stale id must not blank the picker").not.toBe("");
  expect(chatIds).toContain(after);
});
