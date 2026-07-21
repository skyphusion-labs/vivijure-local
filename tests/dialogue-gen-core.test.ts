import { describe, expect, it } from "vitest";
import {
  MODEL,
  SILENT_FALLBACK_TAG,
  appliedTags,
  buildTtsParams,
  dialogueGatewayConfigured,
} from "../src/modules/chain/dialogue-gen-core.js";

describe("dialogue-gen-core gateway parity", () => {
  it("dialogueGatewayConfigured requires account, gateway id, and AI token", () => {
    expect(dialogueGatewayConfigured({})).toBe(false);
    expect(
      dialogueGatewayConfigured({
        CLOUDFLARE_ACCOUNT_ID: "acct",
        GATEWAY_ID: "gw",
        CF_AIG_TOKEN: "tok",
      }),
    ).toBe(true);
    expect(
      dialogueGatewayConfigured({
        CLOUDFLARE_ACCOUNT_ID: "acct",
        GATEWAY_ID: "",
        CF_AIG_TOKEN: "tok",
      }),
    ).toBe(false);
  });

  it("buildTtsParams mirrors CF Aura-1 WAV request shape", () => {
    expect(buildTtsParams("Hello.", "athena")).toEqual({
      text: "Hello.",
      speaker: "athena",
      encoding: "linear16",
      container: "wav",
    });
  });

  it("appliedTags switches between real model and silent fallback honestly", () => {
    const audio = [{ shot_id: "shot_01", audio_key: "k", voice_id: "athena" }];
    expect(appliedTags(audio, { gatewayConfigured: true })).toEqual([`dialogue:${MODEL}`, "lines:1"]);
    expect(appliedTags(audio, { gatewayConfigured: false })).toEqual([SILENT_FALLBACK_TAG, "lines:1"]);
  });
});
