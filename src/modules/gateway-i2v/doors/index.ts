import type { GatewayI2vDoor } from "../door.js";
import { door as cfViduQ3Turbo } from "./cf-vidu-q3-turbo.js";

/** Every hosted gateway i2v door this host serves (local#568). One entry per ported cf door. */
export const GATEWAY_I2V_DOORS: Record<string, GatewayI2vDoor<never>> = {
  "cf-vidu-q3-turbo": cfViduQ3Turbo as GatewayI2vDoor<never>,
};

export function gatewayI2vDoor(name: string): GatewayI2vDoor<unknown> | null {
  return (GATEWAY_I2V_DOORS[name] as GatewayI2vDoor<unknown> | undefined) ?? null;
}
