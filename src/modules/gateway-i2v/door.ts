// local#568: one hosted (AI Gateway) image-to-video door. Each door is a VENDORED copy of a
// vivijure-cf `cf-*` module's pure params (doors/<name>.ts). The runner (runner.ts) is written once.
import type { MotionBackendInput } from "@skyphusion-labs/vivijure-core/modules/types";

export interface GatewayI2vDoor<C = unknown> {
  /** The module name; equals the cf module name and the synced dev/manifests/<name>.json. */
  name: string;
  /** The AI Gateway model id. */
  model: string;
  /** The fps stamped on the output (the provider states none). */
  outFps: number;
  clampDuration(seconds: number): number;
  normalizeConfig(raw: Record<string, unknown>): C;
  buildParams(input: MotionBackendInput, config: C): Record<string, unknown>;
  parseVideoUrl(result: unknown): string | null;
  hasAudio(config: C): boolean;
  stateKey(jobId: string): string;
  clipKey(project: string, shotId: string): string;
}
