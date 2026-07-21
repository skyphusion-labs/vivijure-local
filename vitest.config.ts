import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    server: {
      deps: {
        // npm-installed core uses internal relative imports; inline so vi.mock on
        // @skyphusion-labs/vivijure-core/* applies inside cast-lora-train etc.
        inline: ["@skyphusion-labs/vivijure-core"],
      },
    },
  },
});
