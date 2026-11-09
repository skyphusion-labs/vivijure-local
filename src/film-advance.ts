// local#503: one film tick for the poll routes, with the throw core#428 adds handled ON PURPOSE.
//
// vivijure-core#428 changed advanceFilmJob: when storage blocks reading or writing the film's doc,
// the tick now THROWS and leaves the film in progress, where it used to mark the film failed. A
// failed row stopped the sweep, which is the only thing that drives the film again, and stranded its
// GPU jobs paying with nobody able to read their tokens. The next tick (the next poll, or the
// background render sweep in src/server.ts, which already catches per job inside core) picks it up.
// Core bounds it: a row that has not moved for a phase deadline fails in D1 and stops.
//
// So a throw out of advanceFilmJob means "this film was not resolved THIS tick", never "this film
// failed". Every other failure inside the tick is already caught by core and returned as a failed
// job. That is why this catches every throw from the call and not one error class: core rethrows the
// ORIGINAL storage error, so there is no class to match, and anything that escapes is the same state.
//
// THE ANSWER IS THE CONTRACT'S UNCAUGHT-ERROR ENVELOPE, `500 { "error": "internal error" }`
// (vivijure-cf docs/CONTRACT.md, Errors). cf answers this throw that way through its router, and
// API parity is non-negotiable here. Before this file the throw escaped to Hono's default handler,
// whose 500 is plain text, so the panel's poll loop failed to parse it and reported a network error.
// The reason goes to the LOG, not the wire: it is a storage error string, and the route's caller can
// do nothing with it except poll again, which the panel already does on any non-2xx.

import { advanceFilmJob } from "@skyphusion-labs/vivijure-core/film-orchestrator";

type Advanced = Awaited<ReturnType<typeof advanceFilmJob>>;

/** Marker for a tick that threw. The film is left in progress for the next tick. */
export const FILM_TICK_DEFERRED = Symbol("film-tick-deferred");

/** The contract's body for an uncaught error. Same bytes as cf. */
export const FILM_TICK_DEFERRED_BODY = { error: "internal error" } as const;

export async function advanceFilmTick(
  env: Parameters<typeof advanceFilmJob>[0],
  filmId: string,
  route: string,
): Promise<Advanced | typeof FILM_TICK_DEFERRED> {
  try {
    return await advanceFilmJob(env, filmId);
  } catch (e) {
    console.warn(JSON.stringify({
      ev: "film.poll_deferred",
      film_id: filmId,
      // The route TEMPLATE, never the raw path (cf#223).
      route,
      error: e instanceof Error ? e.message : String(e),
      msg: "the film tick threw and the film is left in progress for the next tick (core#428)",
    }));
    return FILM_TICK_DEFERRED;
  }
}
