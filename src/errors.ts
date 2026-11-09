import { ConfigValueError } from "@skyphusion-labs/vivijure-core/modules/registry";
import { BoardKeyCollisionError } from "@skyphusion-labs/vivijure-core/storyboard-projects-db";
import { FilmBusyError, FilmNotStartedError } from "@skyphusion-labs/vivijure-core/film-orchestrator";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const badRequest = (message: string) => new HttpError(400, message);
export const forbidden = (message: string) => new HttpError(403, message);
export const notFound = (message = "not found") => new HttpError(404, message);
export const serviceUnavailable = (message: string) => new HttpError(503, message);

/** local#520, local#525, local#526: the client error for a refusal core threw, or null when `err` is not
 *  one. Same statuses as vivijure-cf (src/core-refusals.ts, src/studio.ts), so the two panels answer alike.
 *  Without this every one of them reaches Hono's default 500, which reads the same as a studio fault. */
export function coreRefusal(err: unknown): { status: number; body: Record<string, unknown> } | null {
  // core#343 (PR core#517): an enum value the module does not declare, named with the allowed set.
  if (err instanceof ConfigValueError) return { status: 400, body: { error: err.message } };
  // core#518 (PR core#519): another project already renders under this board's title key.
  if (err instanceof BoardKeyCollisionError) return { status: 409, body: { error: err.message } };
  // core#448: a cancel could not take the film's advance lease in time. Try again.
  if (err instanceof FilmBusyError) return { status: 409, body: { error: err.message, retryable: true } };
  // core#422: the start threw before any module was invoked, so nothing was spent and a retry is safe.
  if (err instanceof FilmNotStartedError) return { status: 503, body: { error: err.message } };
  return null;
}

export function httpErrorResponse(err: unknown): Response | null {
  if (err instanceof HttpError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const refused = coreRefusal(err);
  if (refused) {
    return new Response(JSON.stringify(refused.body), {
      status: refused.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return null;
}
