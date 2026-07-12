// Re-export Platform ICD from vivijure-core (source of truth).
// Host-specific adapters live in ./sqlite.ts, ./storage.ts, ./modules.ts, ./secrets.ts.

export {
  PLATFORM_ICD_VERSION,
  platformAsEnv,
  type Database,
  type FetcherLike,
  type ModuleTransport,
  type ObjectHead,
  type ObjectPresigner,
  type ObjectStore,
  type Platform,
  type PreparedStatement,
  type RateLimiter,
  type RateLimitResult,
  type Scheduler,
  type SecretStore,
} from "@skyphusion-labs/vivijure-core/platform";
