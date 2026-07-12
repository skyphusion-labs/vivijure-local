import { describe, expect, it } from "vitest";
import { opusModel } from "../src/modules/chain/plan-enhance-provider.js";

const GATEWAY_ENV = {
  GATEWAY_ID: "skyphusion-llm",
  CF_AIG_TOKEN: "tok",
  CLOUDFLARE_ACCOUNT_ID: "acct",
};

describe("plan.enhance anthropic model ids", () => {
  it("maps catalog ids to gateway model slugs", () => {
    expect(opusModel(GATEWAY_ENV, "anthropic/claude-opus-4-7")).toBe("claude-opus-4-7");
    expect(opusModel(GATEWAY_ENV, "anthropic/claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(opusModel(GATEWAY_ENV, "anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });
});
