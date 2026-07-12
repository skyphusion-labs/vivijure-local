import { describe, expect, it, vi, afterEach } from "vitest";
import { callAnthropic } from "../src/planner-providers.js";
import type { ModelEntry } from "../src/models.js";

const model: ModelEntry = {
  id: "anthropic/claude-opus-4-8",
  label: "Opus",
  group: "Chat",
  type: "chat",
  capabilities: [],
  provider: "anthropic",
};

describe("planner anthropic auth priority", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers AI Gateway unified billing over direct BYOK key", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callAnthropic(
      {
        CLOUDFLARE_ACCOUNT_ID: "acc",
        GATEWAY_ID: "vivijure",
        CF_AIG_TOKEN: "aig",
        ANTHROPIC_API_KEY: "sk-direct-should-not-be-used",
      },
      model,
      "system",
      [{ role: "user", content: "hi" }],
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.ai.cloudflare.com/v1/acc/vivijure/anthropic/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "cf-aig-authorization": "Bearer aig",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
  });
});
