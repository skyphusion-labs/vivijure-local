import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/** Matches planner-state.js PERSIST_DEBOUNCE_MS (500) plus slack. */
const PERSIST_DEBOUNCE_MS = 600;

async function clickPlannerStep(page: Page, stepId: string) {
  const step = page.locator(`#planner-steps .planner-step[data-step-id="${stepId}"]`);
  await expect(step).toBeEnabled();
  await step.click();
}

async function waitForHistoryPanel(page: Page) {
  const history = page.locator("#planner-history");
  await expect(history).toBeVisible();
  // History section stays `hidden` until loadHistory -> renderHistoryList runs.
  await expect(history).not.toHaveAttribute("hidden", "");
  await expect(
    page.locator("#planner-history-list .planner-history-empty, #planner-history-list .planner-history-item"),
  ).toHaveCount(1, { timeout: 30_000 });
}

async function waitForPlanPanel(page: Page) {
  await expect(page.locator("#planner-steps .planner-step.is-active")).toContainText(/plan/i);
  await expect(page.locator("#planner-brief")).toBeVisible();
}

const NAV = [
  { label: "Planner", heading: /storyboard planner/i },
  { label: "Cast", heading: /^cast$/i },
  { label: "Modules", heading: /module host/i },
  { label: "Settings", heading: /^settings$/i },
] as const;

test.describe("studio navigation", () => {
  for (const item of NAV) {
    test(`loads ${item.label} page`, async ({ page }) => {
      await page.goto("/planner.html");
      await page.getByRole("navigation", { name: "Studio pages" }).getByRole("link", { name: item.label }).click();
      await expect(page.getByRole("heading", { level: 1, name: item.heading })).toBeVisible();
    });
  }
});

test.describe("planner control panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/planner.html");
    await expect(page.getByRole("heading", { name: /storyboard planner/i })).toBeVisible();
    await expect(page.locator("#planner-steps .planner-step").first()).toBeEnabled();
    await expect(page.locator("#planner-steps .planner-step.is-active")).toContainText(/plan/i);
  });

  test("stepper steps and account menu", async ({ page }) => {
    const steps = page.locator("#planner-steps .planner-step");
    await expect(steps).toHaveCount(5);
    await expect(steps.nth(0)).toHaveText(/plan/i);
    await expect(steps.nth(4)).toHaveText(/history/i);

    await clickPlannerStep(page, "history");
    await waitForHistoryPanel(page);

    await clickPlannerStep(page, "plan");
    await waitForPlanPanel(page);

    const accountToggle = page.getByRole("button", { name: /account/i });
    await accountToggle.click();
    await expect(page.locator("#account-menu")).toBeVisible();
    const emailPref = page.locator("#pref-email-notifications");
    await expect(emailPref).toBeVisible();
    await emailPref.check();
    await expect(emailPref).toBeChecked();
    await emailPref.uncheck();
    await page.keyboard.press("Escape");
  });

  test("project picker and plan form controls", async ({ page }) => {
    await expect(page.locator("#planner-project-picker")).toBeVisible();

    await page.locator("#planner-brief").fill("smoke e2e brief: forest path, two friends, upright cat");
    await expect(page.locator("#planner-model")).toBeVisible();
    const model = page.locator("#planner-model");
    if (await model.isEnabled()) {
      if ((await model.locator("option").count()) > 0) {
        await model.selectOption({ index: 0 });
      }
    }

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "New session", exact: true }).click();
    await expect(page.locator("#planner-brief")).toHaveValue("", { timeout: 10_000 });
    // Brief input persists on a 500ms debounce; wait past it so a late save cannot repopulate.
    await page.waitForTimeout(PERSIST_DEBOUNCE_MS);
    await expect(page.locator("#planner-brief")).toHaveValue("");
  });

  test("render step toggles without submitting", async ({ page }) => {
    const renderStep = page.locator("#planner-steps .planner-step").filter({ hasText: /render/i });
    if (!(await renderStep.isEnabled())) {
      test.skip(true, "render step locked until bundle exists");
    }
    await renderStep.click();
    await expect(page.locator("#planner-render")).toBeVisible();

    const keyframesOnly = page.locator("#planner-keyframes-only");
    await keyframesOnly.check();
    await expect(keyframesOnly).toBeChecked();
    await keyframesOnly.uncheck();

    const scatter = page.locator("#planner-scatter");
    if (await scatter.isEnabled()) {
      await scatter.check();
      await expect(scatter).toBeChecked();
      await scatter.uncheck();
    }

    await expect(page.locator("#planner-quality-tier")).toBeVisible();
    await page.locator("#planner-quality-tier").selectOption({ index: 0 }).catch(() => undefined);

    const filmTitle = page.locator("#planner-film-title");
    if (await filmTitle.isVisible()) {
      await filmTitle.fill("Smoke Film");
      await expect(filmTitle).toHaveValue("Smoke Film");
    }
  });

  test("history filters and search", async ({ page }) => {
    await page.locator("#planner-steps .planner-step").filter({ hasText: /history/i }).click();
    await expect(page.locator("#planner-history")).toBeVisible();

    const search = page.locator("#planner-history-search");
    await search.fill("exhaustive");
    await expect(search).toHaveValue("exhaustive");

    for (const id of ["planner-filter-inflight", "planner-filter-done", "planner-filter-failed"]) {
      const box = page.locator(`#${id}`);
      await box.uncheck();
      await expect(box).not.toBeChecked();
      await box.check();
      await expect(box).toBeChecked();
    }

    await page.locator("#planner-history-refresh").click();
  });

  test("audio step expandables and beat controls", async ({ page }) => {
    const audioStep = page.locator("#planner-steps .planner-step").filter({ hasText: /audio/i });
    if (!(await audioStep.isEnabled())) {
      test.skip(true, "audio step locked until plan exists");
    }
    await audioStep.click();
    await expect(page.locator("#planner-audio")).toBeVisible();

    const bpm = page.locator("#planner-bpm");
    await bpm.fill("128");
    await expect(bpm).toHaveValue("128");

    const beatClip = page.locator("#planner-beat-clip");
    await beatClip.fill("4");
    await expect(beatClip).toHaveValue("4");

    for (const id of ["planner-music-gen-block", "planner-narration-gen-block"]) {
      const block = page.locator(`#${id}`);
      if (await block.isVisible()) {
        await block.locator("summary").click();
      }
    }
  });
});

test.describe("cast page", () => {
  test("list loads and new character UI", async ({ page }) => {
    await page.goto("/cast.html");
    await expect(page.getByRole("heading", { name: /^cast$/i })).toBeVisible();
    await expect(page.locator("#cast-list")).toBeVisible();

    const newBtn = page.locator("#cast-new-btn");
    await newBtn.click();
    await expect(page.locator("#cast-editor")).toBeVisible();
    await page.locator("#cast-name").fill("E2E Test Character");

    const firstItem = page.locator("#cast-list .cast-list-item").first();
    if (await firstItem.isVisible()) {
      await firstItem.click();
      await expect(page.locator("#cast-editor")).toBeVisible();
    }
  });
});

test.describe("modules page", () => {
  test("pipeline and module cards load", async ({ page }) => {
    await page.goto("/modules.html");
    await expect(page.getByRole("heading", { name: /module host/i })).toBeVisible();

    await expect(page.locator("#pipeline")).not.toHaveText("loading...", { timeout: 30_000 });
    await expect(page.locator("#modules")).not.toHaveText(/^loading/i, { timeout: 30_000 });

    const moduleCards = page.locator("#modules .module, #modules .modules-compact > *");
    await expect(moduleCards.first()).toBeVisible({ timeout: 30_000 });

    const firstCard = moduleCards.first();
    const summary = firstCard.locator("summary, button, [role='button']").first();
    if (await summary.isVisible()) {
      await summary.click();
    }
  });
});

test.describe("settings page", () => {
  test("connection and module sections expand", async ({ page }) => {
    await page.goto("/settings.html");
    await expect(page.getByRole("heading", { name: /^settings$/i })).toBeVisible();

    await expect(page.locator("#settings-secrets")).not.toHaveText("loading...", { timeout: 30_000 });
    await expect(page.locator("#settings-modules")).not.toHaveText("loading...", { timeout: 30_000 });

    const secretToggle = page.locator("#settings-secrets details summary, #settings-secrets .settings-group summary").first();
    if (await secretToggle.isVisible()) {
      await secretToggle.click();
    }

    const moduleToggle = page.locator("#settings-modules details summary, #settings-modules .settings-group summary").first();
    if (await moduleToggle.isVisible()) {
      await moduleToggle.click();
    }

    await expect(page.locator("#settings-secrets-save")).toBeVisible();
  });
});
