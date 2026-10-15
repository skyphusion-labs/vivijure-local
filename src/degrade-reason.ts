// The DEGRADE REASON CHANNEL: one owner for the format of the `degraded` string (local#307).
//
// WHY THIS FILE EXISTS AT ALL. An honest soft-degrade returns `ok: true` (local#249/#77: a polish
// miss must never fail the chain), so every structured failure marker the module contract defines --
// `outcome`, `runpodStatus`, `errorType` -- is out of reach: `PollResponse` puts all three on the
// `ok: false` arm ONLY (vivijure-core modules/types.ts). The single channel the contract gives a
// degrade is `degraded?: string` on the output.
//
// So the reason has to ride a string, and a string is exactly where this estate has been burned
// before. The answer is not to give up and sniff prose; it is to make the string have ONE AUTHOR AND
// ONE GRAMMAR, written and read in this file:
//
//     "<reason>"                 or      "<reason>: <detail>"
//
// `<reason>` is a machine literal from the producing handler and contains no `DETAIL_SEP`. Reading
// the head token back off a string this module also WROTE is not prose parsing: there is no other
// author, and a format change breaks both halves in one file rather than silently degrading one.
//
// WHAT IS STILL BANNED, unchanged: deriving an outcome from `error`. That field is backend prose with
// no closed set and no author on this side of the wire; see the fault-class note in
// src/runpod-job-log.ts for the long form of why a parser built from a sentence is a lie that looks
// solved. This file is the opposite case and is narrow on purpose.
//
// RESIDUAL, named rather than rounded off: a structured field on the `ok: true` arm of the contract
// (or on the output types) would be strictly better than a formatted string, and it is a
// vivijure-core change, not something this repo can take. Same class of residual local#406 records
// for the `ok: false` arm.

/** The one separator between the reason token and its human detail. Both halves read it from here. */
export const DEGRADE_DETAIL_SEP = ": ";

/**
 * Build a `degraded` value. The ONLY writer: a handler passes a closed-set reason literal plus an
 * optional detail, and never concatenates its own.
 *
 * An empty or absent detail yields the bare reason, so "no detail" never becomes a dangling
 * separator that the reader would have to tolerate.
 */
export function formatDegrade(reason: string, detail?: string): string {
  return detail ? reason + DEGRADE_DETAIL_SEP + detail : reason;
}

/**
 * Read the reason token back. The ONLY reader.
 *
 * Returns the head segment before the first `DEGRADE_DETAIL_SEP`, or the whole value when there is
 * no separator. Returns undefined for anything that is not a non-empty string, so an absent
 * `degraded` (a genuine success) and a malformed one are both "no reason named" rather than a
 * guess. A detail containing the separator itself (a JSON blob, for instance) is harmless: the
 * split is at the FIRST occurrence and a reason literal never contains one.
 */
export function degradeReasonOf(degraded: unknown): string | undefined {
  if (typeof degraded !== "string") return undefined;
  const raw = degraded.trim();
  if (!raw) return undefined;
  const at = raw.indexOf(DEGRADE_DETAIL_SEP);
  const token = at === -1 ? raw : raw.slice(0, at);
  return token || undefined;
}
