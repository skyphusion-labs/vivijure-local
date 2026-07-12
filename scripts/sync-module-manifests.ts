#!/usr/bin/env tsx
/**
 * Extract MANIFEST JSON from vivijure module workers into dev/manifests/.
 * Requires sibling clone: ../vivijure (override with VIVIJURE_SRC).
 *
 * Tries dynamic import when MANIFEST is exported; otherwise parses the source literal.
 * Skips modules whose entry graph requires cloudflare: or other Node-unsupported imports.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const VIV = process.env.VIVIJURE_SRC ?? join(ROOT, "..", "vivijure");
const OUT = join(ROOT, "dev", "manifests");

const MODULES = [
  "keyframe",
  "local-gpu",
  "own-gpu",
  "finish-rife",
  "finish-lipsync",
  "finish-upscale",
  "beat-sync",
  "audio-master",
  "film-titles",
  "subtitle",
  "dialogue-gen",
  "music-gen",
  "cast-image",
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
      const m = new RegExp(`export const ${name}\\s*=\\s*(\\[[^\\]]*\\])`).exec(src);
      if (m) return m[1];
    }
    return match;
  });
}

function parseManifestLiteral(literal: string, modDir: string): unknown {
  let normalized = inlineConstSpreads(literal, modDir)
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
