// local#238 (cf#520 twin) -- AUTHORIZATION: the second question, asked after admission.
//
// src/auth-gate.ts answers WHO is calling: the operator secret, a named per-consumer token, or the
// dev opt-out. Before local#238 nothing answered WHAT the caller may do, so every named token was
// operator-equivalent ("an operator token with a name on it").
//
// THE AXIS IS WHOSE DATA, NOT HOW VIOLENT THE VERB (same as cf).
//   operator -- installation, configuration, secrets, or studio-wide state.
//   consumer -- the studio's own work: projects, cast, renders, chat, however destructive.
// Deleting your own cast portrait is consumer work. A guard that refuses correct work is the guard
// people switch off.
//
// TWO VALUES, deliberately, and the SAME two as vivijure-cf so a token minted on either door means
// the same thing. Parity is the set and the bias, not the bytes (local#226).

import type { Hono, MiddlewareHandler } from "hono";

/** The one vocabulary, used for BOTH what a route requires and what a credential holds. */
export type Scope = "operator" | "consumer";

export const SCOPES: readonly Scope[] = ["operator", "consumer"] as const;

/** Narrowing guard for a value read from SQLite. A row's `scope` is a string at runtime whatever the
 *  schema says. Anything outside the union is a CONFIGURATION DEFECT and the caller fails closed. */
export function isScope(v: unknown): v is Scope {
  return v === "operator" || v === "consumer";
}

/** The comparison. `credential` is null when no gate decision was recorded for this request; that
 *  fails CLOSED so a route reached without passing the gate can never serve an operator handler. */
export function authorizeRoute(route: Scope, credential: Scope | null): boolean {
  if (route === "consumer") return true;
  return credential === "operator";
}

/** The 403 body for an authorization refusal. DELIBERATELY FREE of the words the frontend shim keys
 *  on (public/auth-token.js: `/api token|STUDIO_API_TOKEN/i`). An authn failure should raise the
 *  paste-a-token prompt; an authz failure must not, because the token is fine. Same text as cf. */
export const AUTHZ_DENY_REASON = "insufficient scope: this credential is not authorized for this route";

/** Machine-readable discriminator (cf#525 twin): attached ONLY to the scope deny, never to an
 *  auth-gate 403, so a client can tell "needs operator scope" from "paste a live token". */
export const AUTHZ_DENY_CODE = "scope_denied";

/** Every route that requires `operator`. Anything under /api/* not listed here is `consumer`.
 *
 *  Hono registers routes across many files and has no route table to put a `scope` field on, so the
 *  operator set is this one list and enforcement is registered against these EXACT patterns through
 *  Hono's own router (registerOperatorGuards). Matching through the router, not by comparing
 *  strings against the URL, is load-bearing: the guard then sees the same path normalisation
 *  (percent-decoding included) the handler does, so no spelling reaches the handler and skips the
 *  guard. tests/api-token-scope-238.test.ts pins this list against the live route table.
 *
 *  The cf rows are the cf#520 classification wherever this door serves the same route. Two local-only
 *  rows are added: the settings secrets surface, which reads and writes the studio's provider
 *  credentials and is the most operator thing this door serves. */
export const OPERATOR_ROUTES: ReadonlyArray<{ method: string; pattern: string }> = [
  { method: "GET", pattern: "/api/storage/usage" },
  { method: "POST", pattern: "/api/storage/reconcile" },
  { method: "GET", pattern: "/api/modules/:name/config" },
  { method: "PATCH", pattern: "/api/modules/:name/config" },
  { method: "GET", pattern: "/api/settings/secrets" },
  { method: "PATCH", pattern: "/api/settings/secrets" },
];

/** What the auth gate decided for each request. A WeakMap keyed on the raw Request, so nothing has
 *  to be threaded through Hono's typed context and a request the gate never saw reads as null. */
const credentialScopes = new WeakMap<Request, Scope>();

export function recordCredentialScope(request: Request, scope: Scope): void {
  credentialScopes.set(request, scope);
}

export function credentialScopeOf(request: Request): Scope | null {
  return credentialScopes.get(request) ?? null;
}

/** Register one guard per operator pattern. Must be called right after the auth gate and BEFORE any
 *  handler, because Hono runs matched handlers in registration order. HEAD is treated as GET because
 *  Hono serves HEAD from a GET handler. */
export function registerOperatorGuards(app: Hono): void {
  const byPattern = new Map<string, Set<string>>();
  for (const r of OPERATOR_ROUTES) {
    const set = byPattern.get(r.pattern) ?? new Set<string>();
    set.add(r.method);
    if (r.method === "GET") set.add("HEAD");
    byPattern.set(r.pattern, set);
  }
  for (const [pattern, methods] of byPattern) {
    const guard: MiddlewareHandler = async (c, next) => {
      const method = c.req.method.toUpperCase();
      if (!methods.has(method)) return next();
      const held = credentialScopeOf(c.req.raw);
      if (!authorizeRoute("operator", held)) {
        console.warn(JSON.stringify({
          ev: "authz.deny",
          method,
          route: pattern,
          required: "operator",
          held: held ?? "none",
        }));
        // Same body AND header as cf (src/studio.ts): X-Vivijure-Authz lets a client read the refusal without parsing JSON.
        return c.json({ error: AUTHZ_DENY_REASON, code: AUTHZ_DENY_CODE }, 403, { "X-Vivijure-Authz": AUTHZ_DENY_CODE });
      }
      return next();
    };
    app.use(pattern, guard);
  }
}
