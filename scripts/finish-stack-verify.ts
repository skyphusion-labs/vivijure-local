#!/usr/bin/env tsx
/**
 * Bounded adverse audit for the local finish stack after a compose roll. Checks studio health,
 * finish module discovery, and (optionally) a delivered film_key in MinIO via the artifact route.
 *
 *   STUDIO_URL=https://vivijure-local.skyphusion.org \
 *   STUDIO_API_TOKEN=$(cat .studio-token) \
 *   FINISH_VERIFY_FILM_KEY=renders/film-…/film.mp4 \
 *   npm run finish-stack:verify
 */
const VERIFY_BASE = (process.env.STUDIO_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
const VERIFY_TOKEN = process.env.STUDIO_API_TOKEN || "change-me-local-dev-only";
const FILM_KEY = process.env.FINISH_VERIFY_FILM_KEY?.trim() || "";

type Status = "pass" | "fail" | "warn";
interface Row {
  name: string;
  status: Status;
  detail?: string;
}
const rows: Row[] = [];

function verifyRecord(name: string, status: Status, detail?: string): void {
  rows.push({ name, status, detail });
  const tag = status.toUpperCase().padEnd(4);
  const line = detail ? `${tag} ${name} -- ${detail}` : `${tag} ${name}`;
  if (status === "fail") console.error(line);
  else console.log(line);
}

async function verifyApi(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${VERIFY_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${VERIFY_TOKEN}`,
      accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function verifyMain(): Promise<void> {
  console.log(`finish-stack verify @ ${VERIFY_BASE}`);

  const health = await verifyApi("/health");
  if (!health.ok) {
    verifyRecord("studio /health", "fail", `HTTP ${health.status}`);
    process.exit(1);
  }
  const h = (await health.json()) as { ok?: boolean; storage?: string };
  verifyRecord("studio /health", h.ok ? "pass" : "fail", h.storage ? `storage=${h.storage}` : undefined);

  const mods = await verifyApi("/api/modules");
  if (!mods.ok) {
    verifyRecord("studio /api/modules", "fail", `HTTP ${mods.status}`);
  } else {
    const body = (await mods.json()) as { modules?: { name: string }[] };
    const names = new Set((body.modules ?? []).map((m) => m.name));
    for (const mod of ["finish-rife", "finish-lipsync", "finish-upscale", "subtitle", "film-titles"]) {
      verifyRecord(`module bound: ${mod}`, names.has(mod) ? "pass" : "fail");
    }
  }

  if (FILM_KEY) {
    const get = await verifyApi(`/api/artifact/${encodeURIComponent(FILM_KEY)}`);
    verifyRecord(`artifact ${FILM_KEY}`, get.ok ? "pass" : "fail", get.ok ? undefined : `HTTP ${get.status}`);
  } else {
    verifyRecord("artifact film_key", "warn", "FINISH_VERIFY_FILM_KEY unset (skip MinIO check)");
  }

  const failed = rows.filter((r) => r.status === "fail").length;
  const warned = rows.filter((r) => r.status === "warn").length;
  console.log(`\nfinish-stack: ${rows.length - failed - warned} pass, ${warned} warn, ${failed} fail`);
  if (failed) process.exit(1);
}

verifyMain().catch((e) => {
  console.error(e);
  process.exit(1);
});
