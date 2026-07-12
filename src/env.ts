// Local auth env (subset of vivijure Env used by the gate).
import type { Database } from "./platform/types.js";

export interface AuthEnv {
  AUTH_MODE?: string;
  STUDIO_API_TOKEN?: string;
  ALLOW_UNAUTHENTICATED?: string;
  DB?: Database;
}
