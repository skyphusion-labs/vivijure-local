// /api/* auth gate -- ported from vivijure/src/auth-gate.ts (token + demo modes for local v1).
// CF Access (access mode) is a cloud-host concern; unset/legacy path honors ALLOW_UNAUTHENTICATED only.

import type { AuthEnv } from "./env.js";

export const TOKEN_COOKIE = "vivijure_token";

export type AccessDecision =
  | { ok: true; sub: string | null; email: string | null }
  | { ok: false; status: number; reason: string };

export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const ua = new Uint8Array(da);
  const ub = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

function presentedToken(request: Request): string | null {
  const authz = (request.headers.get("authorization") || "").trim();
  const m = /^Bearer\s+(\S+)$/i.exec(authz);
  if (m) return m[1];
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === TOKEN_COOKIE) {
      const v = part.slice(eq + 1).trim();
      if (v.length === 0) return null;
      try {
        return decodeURIComponent(v);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function namedTokenConsumer(presented: string, env: AuthEnv): Promise<string | null> {
  if (!env.DB) return null;
  try {
    const hash = await sha256Hex(presented);
    const row = await env.DB.prepare(
      "SELECT name FROM api_tokens WHERE token_hash = ?1 AND revoked_at IS NULL",
    )
      .bind(hash)
      .first<{ name: string }>();
    return row?.name ?? null;
  } catch {
    return null;
  }
}

export async function verifyTokenRequest(request: Request, env: AuthEnv): Promise<AccessDecision> {
  const secret = (env.STUDIO_API_TOKEN || "").trim();
  if (!secret) {
    return {
      ok: false,
      status: 403,
      reason:
        "token mode: STUDIO_API_TOKEN secret is not set -- denying everything (fail closed). " +
        "Set STUDIO_API_TOKEN in .env (e.g. openssl rand -hex 32)",
    };
  }
  const presented = presentedToken(request);
  if (presented === null) {
    return {
      ok: false,
      status: 403,
      reason: "missing API token: send Authorization: Bearer <your studio API token>",
    };
  }
  if (await constantTimeEqual(presented, secret)) {
    return { ok: true, sub: "studio-api-token", email: null };
  }
  const consumer = await namedTokenConsumer(presented, env);
  if (consumer !== null) {
    return { ok: true, sub: `api-token:${consumer}`, email: null };
  }
  return { ok: false, status: 403, reason: "bad API token" };
}

export function isDemoMode(env: AuthEnv): boolean {
  return (env.AUTH_MODE || "").trim() === "demo";
}

/** Hide operator catalogs on demo deploys (voices, models, etc.). */
export function catalogForDeploy<T>(env: AuthEnv, catalog: readonly T[]): readonly T[] {
  return isDemoMode(env) ? [] : catalog;
}

export const DEMO_WRITE_ROUTES: ReadonlySet<string> = new Set(["/api/demo/render", "/api/demo/chat"]);

/** #43: operator-only read surfaces that a public demo GET must NOT reach. Demo allows all GETs so the
 *  read-only studio UI works, but these routes disclose the operator's connection config -- an S3
 *  access-key id, Cloudflare account/gateway ids, RunPod endpoint ids, and the full internal module/backend
 *  topology (every `sensitive:false` field is returned in cleartext for the operator's own view). The demo
 *  UI never needs them, so deny at the GATE (defence-in-depth: covers both routes and any future
 *  handler under these paths, not one per-route check that can be forgotten). Note: `/api/modules` (the
 *  registry catalog the demo UI renders from) stays allowed; only `/api/modules/:name/config` is denied. */
export function isDemoDeniedRead(pathname: string): boolean {
  if (pathname === "/api/settings" || pathname.startsWith("/api/settings/")) return true;
  if (/^\/api\/modules\/[^/]+\/config$/.test(pathname)) return true;
  return false;
}

export function verifyDemoRequest(request: Request): AccessDecision {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") {
    if (isDemoDeniedRead(new URL(request.url).pathname)) {
      return {
        ok: false,
        status: 403,
        reason: "operator settings are not exposed on the demo studio",
      };
    }
    return { ok: true, sub: "demo-visitor", email: null };
  }
  if (method === "POST" && DEMO_WRITE_ROUTES.has(new URL(request.url).pathname)) {
    return { ok: true, sub: "demo-visitor", email: null };
  }
  return {
    ok: false,
    status: 403,
    reason: "demo studio is read-only: mutations are disabled on this deployment. Run your own studio to render.",
  };
}

function legacyUnconfiguredGate(env: AuthEnv): AccessDecision {
  if ((env.ALLOW_UNAUTHENTICATED || "").trim() === "true") {
    return { ok: true, sub: "unauthenticated-dev", email: null };
  }
  return {
    ok: false,
    status: 503,
    reason: "auth not configured: set AUTH_MODE=token and STUDIO_API_TOKEN, or ALLOW_UNAUTHENTICATED=true for dev",
  };
}

export async function gateApi(request: Request, env: AuthEnv): Promise<AccessDecision> {
  const mode = (env.AUTH_MODE || "").trim();
  if (mode === "token") return verifyTokenRequest(request, env);
  if (mode === "demo") return verifyDemoRequest(request);
  if (mode === "access") {
    return {
      ok: false,
      status: 503,
      reason: 'AUTH_MODE=access is not supported on vivijure-local (use AUTH_MODE=token)',
    };
  }
  if (mode === "") return legacyUnconfiguredGate(env);
  return {
    ok: false,
    status: 403,
    reason: `unknown AUTH_MODE ${JSON.stringify(mode)} (expected "token" or "demo") -- denying (fail closed)`,
  };
}
