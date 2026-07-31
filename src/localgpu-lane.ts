// ONE OPERATOR KNOB FOR THE GPU DOOR LANE (local#280).
//
// The `localgpu` compose lane needs three values to agree: the profile must be enabled, the module
// must have a URL the studio can bind, and the sidecar must know the door address. Three knobs for one
// decision is a footgun -- set the door but forget the profile and the module silently is not there;
// enable the profile but forget the door and the stack refuses to start.
//
// So the operator sets ONE thing, LOCAL_BACKEND_URL (their door address), and `npm run install:studio`
// derives the rest into .env. Compose reads .env on its own, so a plain `docker compose up -d` sees the
// same lane as `npm run compose:up`.
//
// It derives in BOTH directions on purpose. Clearing the door address must also drop the profile,
// otherwise a stale `localgpu` in COMPOSE_PROFILES leaves localgpu-door-gate refusing the whole stack
// over a variable the operator already removed.
//
// Pure functions, no filesystem: the installer owns reading and writing .env, this owns the decision.

/** Compose profile that carries the GPU door module. */
export const LOCALGPU_PROFILE = "localgpu";

/** In-network URL of the door module sidecar (the compose service name and its port). */
export const LOCALGPU_MODULE_URL = "http://module-local-gpu:9102";

/** A door address counts only if it is a real absolute http(s) URL, matching normalizeBackendUrl. */
export function isDoorConfigured(doorUrl: string | undefined): boolean {
  const raw = (doorUrl ?? "").trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Split a COMPOSE_PROFILES value, dropping blanks. Comma-separated, per compose. */
export function parseProfiles(profiles: string | undefined): string[] {
  return (profiles ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Add or remove one profile, preserving the others and their order (never clobbers edge/cloud).
 *
 * A profile ALREADY present keeps its position. Appending unconditionally rewrote
 * `localgpu,cloud` to `cloud,localgpu` on the first run, so the installer reported an update and a
 * diff for a lane that was already exactly right -- true convergence, but only from the second run on,
 * which is not what "idempotent" claims.
 */
export function setProfile(profiles: string | undefined, name: string, on: boolean): string {
  const list = parseProfiles(profiles).filter((p, i, all) => all.indexOf(p) === i);
  if (!on) return list.filter((p) => p !== name).join(",");
  return (list.includes(name) ? list : [...list, name]).join(",");
}

/**
 * The .env entries the localgpu lane implies, given the operator's door address.
 *
 * Returns only the keys whose value must CHANGE, so the installer can report what it touched and stay
 * idempotent (a second run with the same door writes nothing).
 */
export function localGpuLaneUpdates(vars: Map<string, string>): Map<string, string> {
  const on = isDoorConfigured(vars.get("LOCAL_BACKEND_URL"));
  const desired = new Map<string, string>([
    ["COMPOSE_PROFILES", setProfile(vars.get("COMPOSE_PROFILES"), LOCALGPU_PROFILE, on)],
    ["MODULE_LOCAL_GPU_URL", on ? LOCALGPU_MODULE_URL : ""],
  ]);
  const updates = new Map<string, string>();
  for (const [key, value] of desired) {
    if ((vars.get(key) ?? "") !== value) updates.set(key, value);
  }
  return updates;
}
