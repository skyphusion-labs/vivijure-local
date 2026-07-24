// Configured-only view over the core module registry (local#201).
//
// A module worker may declare a boolean `configured` field in its /module.json when the operator has
// NOT yet supplied the credentials/bindings it needs to run (the RunPod sidecars do this: absent
// RUNPOD_* creds -> configured:false). Such a module would otherwise appear in every picker and
// preflight and then hard-fail at /invoke -- the "broken button". This is the ONE choke point that
// drops those modules from discovery, so "absent creds = clean hide" holds everywhere the panel reads
// the registry, rather than each picker re-deciding it.
//
// The flag is opt-in and additive: a module that omits `configured` (every CF-AI / local / container
// module, and every third-party module that never heard of the field) is ALWAYS kept -- only an
// EXPLICIT `configured:false` hides it. The field rides through core discovery verbatim
// (validateManifest preserves unknown manifest keys), so no core change is needed.

import { discoverModules, type RegisteredModule } from "@skyphusion-labs/vivijure-core";

/** A module is shown unless it EXPLICITLY self-reports `configured:false`. Undefined (the common case)
 *  and true both mean "show". */
export function isModuleConfigured(mod: RegisteredModule): boolean {
  return (mod as { configured?: unknown }).configured !== false;
}

/** Drop modules that self-report `configured:false` (e.g. a RunPod sidecar with no creds). */
export function filterConfiguredModules(modules: RegisteredModule[]): RegisteredModule[] {
  return modules.filter(isModuleConfigured);
}

/** discoverModules, minus any module that self-reports `configured:false`. Every panel-facing caller
 *  (pickers, catalog projection, render dispatch, preflight) MUST use this, not the raw core
 *  discoverModules, so an unconfigured module is neither visible nor submittable. */
export async function discoverConfiguredModules(
  env: Record<string, unknown>,
  opts?: { cacheTtlMs?: number; nowMs?: number },
): Promise<RegisteredModule[]> {
  return filterConfiguredModules(await discoverModules(env, opts));
}
