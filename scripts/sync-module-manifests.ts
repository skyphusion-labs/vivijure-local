#!/usr/bin/env tsx
/**
 * Extract MANIFEST JSON from vivijure-cf module workers into dev/manifests/.
 * Requires sibling clone: ../vivijure-cf (override with VIVIJURE_SRC).
 *
 * Tries dynamic import when MANIFEST is exported; otherwise parses the source literal.
 * Skips modules whose entry graph requires cloudflare: or other Node-unsupported imports.
 *
 * Local-only divergences (local#313): a committed fixture with
 *   "_local_divergence": "do-not-sync"
 * is never overwritten when writing into the real dev/manifests/ tree. (CI regen into a
 * temp dir via MANIFESTS_OUT still produces the cf shape so the drift checker can exclude
 * by the same marker on the committed file.)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const VIV = process.env.VIVIJURE_SRC ?? join(ROOT, "..", "vivijure-cf");
// MANIFESTS_OUT lets CI / check-module-manifest-drift.sh regenerate into a temp dir
// without touching the committed fixtures.
const OUT = process.env.MANIFESTS_OUT ?? join(ROOT, "dev", "manifests");

const MODULES = [
  "keyframe",
  "local-gpu",
  "own-gpu",
  "cloud-keyframe",
  // NOT A LOCAL-INSTALL MODULE (local#291). Kept in this list for TWO reasons, neither of which is
  // "vivijure-local ships RIFE": (1) check-module-manifest-drift.sh diffs every committed fixture
  // against vivijure-cf, and dropping it here would orphan the fixture and fail that check; (2) an
  // operator who wires RIFE to RunPod explicitly (scripts/finish-module-server.ts, see
  // docs/FINISH_BACKEND.md) reads the module config schema from this fixture. There is no local RIFE
  // image and no local RIFE path (Conrad 2026-07-28), so it is NOT in scripts/dev-module-fleet.sh and
  // has no compose service in any profile. A fixture is a manifest on disk; a module is a thing the
  // registry can discover. See dev/manifests/README.md.
  "finish-rife",
  "finish-lipsync",
  "finish-upscale",
  "beat-sync",
  "audio-master",
  "film-titles",
  "subtitle",
  "dialogue-gen",
  "plan-enhance",
  // cf#129 phase 2. Registered here so the documented local fleet can stand it up; the phase-2
  // module shipped without its dev-tooling entry, which meant the gate had to hand-author a
  // manifest to run at all.
  "image-generate",
  "speech-upscale",
  "notify-email",
  "music-gen",
  "narration-gen",
  "cast-image",
  "seedance",
  "kling",
  "google-veo",
  "minimax-hailuo",
  "vidu-q3",
  "alibaba-wan",
  "alibaba-wan-lora",
];

function extractObjectLiteral(src: string, startIdx: number): string | null {
  const open = src.indexOf("{", startIdx);
  if (open === -1) return null;
  let depth = 0;
  let inStr: "'" | '"' | "`" | null = null;
  let esc = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

function inlineConstSpreads(literal: string, modDir: string): string {
  return literal.replace(/\[\.\.\.([A-Z][A-Z0-9_]*)\]/g, (match, name: string) => {
    for (const file of readdirSync(modDir)) {
      if (!file.endsWith(".ts")) continue;
      const src = readFileSync(join(modDir, file), "utf8");
      const m = new RegExp(`export const ${name}\\s*=\\s*(\\[[\\s\\S]*?\\])`, "m").exec(src);
      if (m) return m[1];
    }
    return match;
  });
}

function inlineModuleConsts(literal: string, modDir: string): string {
  let out = literal;
  for (const file of readdirSync(modDir)) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(join(modDir, file), "utf8");
    const strRe = /export const ([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = strRe.exec(src))) {
      out = out.replace(new RegExp(`\\b${m[1]}\\b`, "g"), JSON.stringify(m[2]));
    }
    const numArrRe = /export const ([A-Z][A-Z0-9_]*)\s*=\s*\[([\d,\s]+)\]\s*as const/g;
    while ((m = numArrRe.exec(src))) {
      const nums = m[2]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      out = out.replace(new RegExp(`${m[1]}\\.map\\(String\\)`, "g"), JSON.stringify(nums));
    }
  }
  return out;
}

function inlineBareConsts(literal: string, modDir: string): string {
  let out = literal;
  for (const file of readdirSync(modDir)) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(join(modDir, file), "utf8");
    // Optional TypeScript type annotation between name and `=` (cast-image TRAINING_PROMPTS).
    const arrRe =
      /(?:export )?const ([A-Z][A-Z0-9_]*)\s*(?::\s*[^=]+)?\s*=\s*(\[[\s\S]*?\])\s*;?/g;
    let m: RegExpExecArray | null;
    while ((m = arrRe.exec(src))) {
      if (m[2].includes("{")) continue;
      try {
        const parsed = Function(`"use strict"; return (${m[2]});`)();
        if (!Array.isArray(parsed)) continue;
        // Prefer .length / [0] before the bare-name replace so manifests stay numeric/scalar.
        out = out.replace(new RegExp(`${m[1]}\\.length\\b`, "g"), String(parsed.length));
        out = out.replace(new RegExp(`${m[1]}\\[0\\]`, "g"), JSON.stringify(parsed[0]));
        out = out.replace(new RegExp(`\\b${m[1]}\\b`, "g"), JSON.stringify(parsed));
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

function parseManifestLiteral(literal: string, modDir: string): unknown {
  let normalized = inlineConstSpreads(literal, modDir);
  normalized = inlineModuleConsts(normalized, modDir);
  normalized = inlineBareConsts(normalized, modDir);
  normalized = normalized
    .replace(/\bMODULE_API\b/g, '"vivijure-module/2"')
    .replace(/,\s*([\]}])/g, "$1");
  return Function(`"use strict"; return (${normalized});`)();
}

function extractManifestFromSource(path: string): unknown | null {
  const modDir = join(path, "..");
  const src = readFileSync(path, "utf8");
  const re = /(?:export\s+)?const\s+MANIFEST(?::\s*ModuleManifest)?\s*=\s*/g;
  const hit = re.exec(src);
  if (!hit) return null;
  const literal = extractObjectLiteral(src, hit.index + hit[0].length);
  if (!literal) return null;
  return parseManifestLiteral(literal, modDir);
}

async function loadManifest(name: string, modPath: string): Promise<unknown | null> {
  try {
    const m = await import(pathToFileURL(modPath).href);
    if (m.MANIFEST) return m.MANIFEST;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("cloudflare:") && !msg.includes("ERR_UNSUPPORTED_ESM_URL_SCHEME")) {
      // import failed for another reason; fall through to source parse
    }
  }
  return extractManifestFromSource(modPath);
}

/** True when a committed fixture is a deliberate local divergence (local#313). */
function isLocalDivergenceFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as { _local_divergence?: unknown };
    return j._local_divergence === "do-not-sync" || j._local_divergence === true;
  } catch {
    return false;
  }
}

// Writing into the real dev/manifests tree (no MANIFESTS_OUT) must preserve marked files.
// CI / check-module-manifest-drift.sh sets MANIFESTS_OUT to a temp dir and always wants the
// cf shape there so the checker can exclude by marker on the committed side only.
const protectLocalDivergence = !process.env.MANIFESTS_OUT;

mkdirSync(OUT, { recursive: true });

let failed = 0;
let skippedLocal = 0;
for (const name of MODULES) {
  const outPath = join(OUT, `${name}.json`);
  // Prefer leaf manifest.ts (cf#285) when present; fall back to entrypoint index.ts.
  const leaf = join(VIV, "modules", name, "src", "manifest.ts");
  const mod = existsSync(leaf) ? leaf : join(VIV, "modules", name, "src", "index.ts");
  if (!existsSync(mod)) {
    console.log(`skip (missing): ${name}`);
    continue;
  }
  if (protectLocalDivergence && isLocalDivergenceFile(outPath)) {
    console.log(
      `skip (local divergence marker _local_divergence=do-not-sync): ${name}.json -- will not overwrite`,
    );
    skippedLocal++;
    continue;
  }
  try {
    const manifest = await loadManifest(name, mod);
    if (!manifest) {
      console.error(`no MANIFEST: ${name}`);
      failed++;
      continue;
    }
    writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`wrote ${name}.json`);
  } catch (e) {
    console.error(`failed ${name}:`, e instanceof Error ? e.message : e);
    failed++;
  }
}

if (skippedLocal > 0) {
  console.log(
    `preserved ${skippedLocal} local-divergence fixture(s); remove "_local_divergence" to allow overwrite`,
  );
}
if (failed > 0) process.exitCode = 1;
