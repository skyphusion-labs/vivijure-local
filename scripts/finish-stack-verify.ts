#!/usr/bin/env tsx
/**
 * Bounded adverse audit for the local finish stack after a compose roll. Checks studio health,
 * finish module discovery, and (optionally) a delivered film_key in MinIO via the artifact route.
 *
 *   STUDIO_URL=https://vivijure-local.skyphusion.org \
 *   STUDIO_API_TOKEN=$(cat .studio-token) \
 *   FINISH_VERIFY_FILM_KEY=renders/film-…/film.mp4 \
 *   FINISH_VERIFY_FILM_ID=film-… \
 *   npm run finish-stack:verify
 *
 * When FINISH_VERIFY_FILM_ID is set, also runs the voiced-verify bar: any shot tagged lipsync:v15
 * must carry non-silent audio (max_volume above -60 dB). Silent anullsrc pads report ~ -91 dB.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const VERIFY_BASE = (process.env.STUDIO_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
const VERIFY_TOKEN = process.env.STUDIO_API_TOKEN || "change-me-local-dev-only";
const FILM_KEY = process.env.FINISH_VERIFY_FILM_KEY?.trim() || "";
const FILM_ID = process.env.FINISH_VERIFY_FILM_ID?.trim() || "";
const MAX_VOLUME_FLOOR_DB = -60;
const LIPSYNC_OK = "lipsync:v15";

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

  if (FILM_ID) {
    await verifyVoicedFilm(FILM_ID);
  } else {
    verifyRecord("voiced-verify bar", "warn", "FINISH_VERIFY_FILM_ID unset (skip per-shot audio bar)");
  }

  const failed = rows.filter((r) => r.status === "fail").length;
  const warned = rows.filter((r) => r.status === "warn").length;
  console.log(`\nfinish-stack: ${rows.length - failed - warned} pass, ${warned} warn, ${failed} fail`);
  if (failed) process.exit(1);
}

interface FinishShotRow {
  shot_id: string;
  clip_key?: string;
  applied?: string[];
}

interface FilmJobDoc {
  finish_shots?: FinishShotRow[];
}

function maxVolumeDbFromClip(bytes: Buffer): number | null {
  const dir = mkdtempSync(join(tmpdir(), "finish-verify-"));
  const path = join(dir, "clip.mp4");
  writeFileSync(path, bytes);
  try {
    execFileSync(
      "ffmpeg",
      ["-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
      { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
    );
    return null;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const text = err.stderr || err.message || "";
    const m = text.match(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/);
    return m ? Number(m[1]) : null;
  }
}

async function verifyVoicedFilm(filmId: string): Promise<void> {
  const jobPath = `/api/artifact/renders/${encodeURIComponent(filmId)}/film-job.json`;
  const jobResp = await verifyApi(jobPath);
  if (!jobResp.ok) {
    verifyRecord("voiced-verify film-job.json", "fail", `HTTP ${jobResp.status}`);
    return;
  }
  const job = (await jobResp.json()) as FilmJobDoc;
  const shots = (job.finish_shots ?? []).filter((s) => (s.applied ?? []).includes(LIPSYNC_OK));
  if (shots.length === 0) {
    verifyRecord("voiced-verify bar", "warn", `no ${LIPSYNC_OK} shots in ${filmId}`);
    return;
  }
  for (const shot of shots) {
    const key = shot.clip_key?.trim();
    if (!key) {
      verifyRecord(`voiced ${shot.shot_id}`, "fail", "missing clip_key on finish_shot");
      continue;
    }
    const clipResp = await verifyApi(`/api/artifact/${encodeURIComponent(key)}`);
    if (!clipResp.ok) {
      verifyRecord(`voiced ${shot.shot_id}`, "fail", `clip HTTP ${clipResp.status}`);
      continue;
    }
    const buf = Buffer.from(await clipResp.arrayBuffer());
    const maxDb = maxVolumeDbFromClip(buf);
    if (maxDb == null) {
      verifyRecord(`voiced ${shot.shot_id}`, "fail", "volumedetect returned no max_volume");
    } else if (maxDb <= MAX_VOLUME_FLOOR_DB) {
      verifyRecord(
        `voiced ${shot.shot_id}`,
        "fail",
        `${LIPSYNC_OK} on silent clip (max_volume ${maxDb} dB <= ${MAX_VOLUME_FLOOR_DB} dB)`,
      );
    } else {
      verifyRecord(`voiced ${shot.shot_id}`, "pass", `${LIPSYNC_OK} max_volume ${maxDb} dB`);
    }
  }
}

verifyMain().catch((e) => {
  console.error(e);
  process.exit(1);
});
