import { describe, expect, it } from "vitest";
import {
  aiGatewayConfig,
  aiGatewayConfigured,
  gatewayCompatBase,
  gatewayProviderBase,
  unifiedBillingHeaders,
} from "../src/platform/ai-gateway.js";

describe("ai gateway", () => {
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "acc123",
    GATEWAY_ID: "vivijure",
    CF_AIG_TOKEN: "aig-token",
  };

  it("detects unified billing configuration", () => {
    expect(aiGatewayConfigured(env)).toBe(true);
    expect(aiGatewayConfigured({ ...env, CF_AIG_TOKEN: "" })).toBe(false);
  });

  it("builds provider URLs like the Workers binding getUrl()", () => {
    const cfg = aiGatewayConfig(env)!;
    expect(gatewayProviderBase(cfg, "anthropic")).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc123/vivijure/anthropic",
    );
    expect(gatewayCompatBase(cfg)).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc123/vivijure/compat",
    );
  });

  it("uses cf-aig-authorization for unified billing", () => {
    const cfg = aiGatewayConfig(env)!;
    expect(unifiedBillingHeaders(cfg)["cf-aig-authorization"]).toBe("Bearer aig-token");
  });
});
