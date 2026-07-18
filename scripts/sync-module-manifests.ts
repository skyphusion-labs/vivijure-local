#!/usr/bin/env tsx
/**
 * Extract MANIFEST JSON from vivijure-cf module workers into dev/manifests/.
 * Requires sibling clone: ../vivijure-cf (override with VIVIJURE_SRC).
 *
 * Tries dynamic import when MANIFEST is exported; otherwise parses the source literal.
 * Skips modules whose entry graph requires cloudflare: or other Node-unsupported imports.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const VIV = process.env.VIVIJURE_SRC ?? join(ROOT, "..", "vivijure-cf");
const OUT = join(ROOT, "dev", "manifests");

const MODULES = [
  "keyframe",
  "local-gpu",
  "own-gpu",
  "cloud-keyframe",
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
    const arrRe = /(?:export )?const ([A-Z][A-Z0-9_]*)\s*=\s*(\[[\s\S]*?\])\s*;?/g;
    let m: RegExpExecArray | null;
    while ((m = arrRe.exec(src))) {
      if (m[2].includes("{")) continue;
      try {
        const parsed = Function(`"use strict"; return (${m[2]});`)();
        if (!Array.isArray(parsed)) continue;
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

mkdirSync(OUT, { recursive: true });

let failed = 0;
for (const name of MODULES) {
  const mod = join(VIV, "modules", name, "src", "index.ts");
  if (!existsSync(mod)) {
    console.log(`skip (missing): ${name}`);
    continue;
  }
  try {
    const manifest = await loadManifest(name, mod);
    if (!manifest) {
      console.error(`no MANIFEST: ${name}`);
      failed++;
      continue;
    }
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`wrote ${name}.json`);
  } catch (e) {
    console.error(`failed ${name}:`, e instanceof Error ? e.message : e);
    failed++;
  }
}

if (failed > 0) process.exitCode = 1;
