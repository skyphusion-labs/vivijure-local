import { test as base, expect } from "@playwright/test";

const TOKEN = process.env.STUDIO_API_TOKEN || "change-me-local-dev-only";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((token) => {
      localStorage.setItem("vivijure_api_token", token);
      // Avoid resume-banner / persisted brief bleeding across e2e runs.
      localStorage.removeItem("skyphusion.planner.state.v1");
    }, TOKEN);
    await use(page);
  },
});

export { expect };
