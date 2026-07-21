import { describe, expect, it } from "vitest";

import {
  isCastLoraReady,
  unreadyBoundLoraSlots,
  loraSlotSignature,
  WAN_LORA_BACKEND,
  type CastMember,
} from "../public/lora-preflight.js";

const ADA = "11111111-1111-4111-8111-111111111111";
const WREN = "22222222-2222-4222-8222-222222222222";
const KIT = "33333333-3333-4333-8333-333333333333";
const GONE = "99999999-9999-4999-8999-999999999999";

const ready = (id: string, name: string): CastMember => ({
  id,
  name,
  lora_status: "ready",
  lora_key: "loras/" + name + ".safetensors",
});
const wanReady = (id: string, name: string): CastMember => ({
  id,
  name,
  lora_status: "ready",
  wan_lora_key_high: "loras/" + name + ".high.safetensors",
  wan_lora_key_low: "loras/" + name + ".low.safetensors",
});
const idle = (id: string, name: string): CastMember => ({ id, name, lora_status: "idle" });
const training = (id: string, name: string): CastMember => ({ id, name, lora_status: "training" });

const slots = (unready: ReturnType<typeof unreadyBoundLoraSlots>) => unready.map((u) => u.slot);

describe("isCastLoraReady (mirrors the server reuse gate)", () => {
  it("is true only for ready status with a loras/ SDXL key", () => {
    expect(isCastLoraReady(ready(ADA, "wren"))).toBe(true);
  });
  it("accepts Wan dual keys when motion backend is alibaba-wan-lora", () => {
    expect(isCastLoraReady(wanReady(ADA, "mara"), { motionBackend: WAN_LORA_BACKEND })).toBe(true);
  });
  it("rejects Wan-only keys when motion backend is not Wan", () => {
    expect(isCastLoraReady(wanReady(ADA, "mara"))).toBe(false);
  });
});

describe("unreadyBoundLoraSlots", () => {
  it("does not flag Wan-ready cast on alibaba-wan-lora renders", () => {
    expect(
      unreadyBoundLoraSlots({ A: ADA }, [wanReady(ADA, "mara")], {
        motionBackend: WAN_LORA_BACKEND,
      }),
    ).toEqual([]);
  });
  it("flags Wan-only cast when motion backend is not Wan", () => {
    expect(unreadyBoundLoraSlots({ A: ADA }, [wanReady(ADA, "mara")])).toEqual([
      { slot: "A", castId: ADA, name: "mara" },
    ]);
  });
  it("sorts by slot for a stable warning order", () => {
    const catalog = [idle(ADA, "ada"), training(WREN, "wren"), idle(KIT, "kit")];
    expect(slots(unreadyBoundLoraSlots({ C: KIT, A: ADA, B: WREN }, catalog))).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});

describe("loraSlotSignature", () => {
  it("is order-independent over the slot set", () => {
    const catalog = [idle(ADA, "ada"), idle(WREN, "wren")];
    const a = unreadyBoundLoraSlots({ A: ADA, B: WREN }, catalog);
    const b = unreadyBoundLoraSlots({ B: WREN, A: ADA }, catalog);
    expect(loraSlotSignature(a)).toBe(loraSlotSignature(b));
  });
});
