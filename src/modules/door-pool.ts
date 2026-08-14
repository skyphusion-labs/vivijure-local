/**
 * THE door pool: one parser, one selector, for every on-box HTTP door this panel talks to.
 *
 * local#378 built comma-separated door lists, drop-and-count, health probing and rotation for the
 * finish sidecars, inside `finish-backend.ts` and `local-finish/handlers.ts`. `speech-upscale` needs
 * exactly the same behaviour and is NOT a finish module (it is a chain module with its own env,
 * its own typed I/O and its own poll token), so it cannot reach that code by adding a map entry.
 *
 * The alternative to this file is a second selection path, which is how two doors start disagreeing
 * about what a valid URL is or which card is next. So the generic half of local#378 moved HERE
 * unchanged, and `finish-backend.ts` re-exports it under its original names: every existing call
 * site, and every test local#378 shipped, keeps the same contract and the same import path.
 */

/** A resolved door pool plus what it cost to resolve it (local#378). */
export interface DoorSet {
  /** Usable, normalised, de-duplicated door base URLs, in declaration order. */
  urls: string[];
  /** Entries present in the raw value that did NOT become a usable door.
   *
   *  SURFACED RATHER THAN SWALLOWED, deliberately: a silently shortened pool is a capacity
   *  halving nobody sees. One typo in a two-door list is a 50% loss that no error reports. */
  dropped: number;
}

export function normalizeDoorBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Parse a COMMA-SEPARATED door list.
 *
 * A single value parses to a one-element list with `dropped: 0`, so every existing deployment is
 * bit-for-bit unaffected. This delegates to `normalizeDoorBaseUrl` per entry, so the singular and
 * the plural can never disagree about what a valid URL is.
 *
 * An INVALID ENTRY IS DROPPED rather than failing the whole list: one bad door must not take a
 * healthy one down with it. An all-invalid list returns `urls: []`, and it is the CALLER's job to
 * decide what that means -- see the note on `LOCAL_FINISH_SPEECH_URL` in chain/handlers.ts, where
 * "set but unusable" must NOT be read as "unset", because the fall-through would be a cloud call.
 */
export function normalizeDoorBaseUrls(raw: string): DoorSet {
  const urls: string[] = [];
  let dropped = 0;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue; // a trailing comma is sloppiness, not a lost door
    const normalized = normalizeDoorBaseUrl(trimmed);
    if (!normalized) {
      dropped += 1;
      continue;
    }
    if (!urls.includes(normalized)) urls.push(normalized); // same door twice is one door
  }
  return { urls, dropped };
}

/**
 * Round-robin cursor, KEYED BY POOL.
 *
 * local#378 kept one module-level counter, which was correct while exactly one module per process
 * used it. Sharing this selector across finish and speech would have made two unrelated pools
 * advance one counter, so the phase of one module's rotation would depend on the other module's
 * traffic. Keying by the pool itself keeps every existing single-pool deployment byte-identical
 * (one key, one counter) and removes a coupling that sharing would otherwise have introduced.
 *
 * Process-local and deliberately not persisted: at two doors the only property that matters is that
 * consecutive jobs do not both land on the same card, and a restart re-starting at zero costs
 * nothing.
 */
const doorCursors = new Map<string, number>();

/** Reset between tests; a module-level cursor otherwise leaks ordering across cases. */
export function resetDoorCursorsForTests(): void {
  doorCursors.clear();
}

const DOOR_HEALTH_TIMEOUT_MS = 3000;

export async function doorHealthy(url: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), DOOR_HEALTH_TIMEOUT_MS);
    try {
      const r = await fetch(`${url}/health`, { signal: ctl.signal });
      return r.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/**
 * Order the doors this submit should try, healthiest-first-and-rotated.
 *
 * A SINGLE DOOR TAKES NO HEALTH PROBE AT ALL. That is not an optimisation, it is the compatibility
 * guarantee: every existing single-valued deployment keeps exactly today's behaviour and today's
 * number of round trips, and a door that is up but whose /health is unimplemented cannot be turned
 * into a refusal by this change.
 *
 * With several doors, probe them, keep the ones that answer, and rotate the starting point so
 * consecutive jobs do not both land on the same card. The returned list is a PREFERENCE ORDER, not
 * a single choice: the tail is the failover path.
 */
export async function orderDoors(urls: string[]): Promise<string[]> {
  if (urls.length <= 1) return urls;
  const health = await Promise.all(urls.map((u) => doorHealthy(u)));
  const healthy = urls.filter((_, i) => health[i]);
  if (healthy.length === 0) return [];
  const poolKey = urls.join(",");
  const cursor = doorCursors.get(poolKey) ?? 0;
  doorCursors.set(poolKey, cursor + 1);
  const start = cursor % healthy.length;
  return [...healthy.slice(start), ...healthy.slice(0, start)];
}
