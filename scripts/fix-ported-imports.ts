#!/usr/bin/env tsx
/** Add .js extensions and remap Env imports on ported vivijure sources. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src");
const FILES = [
  "film-model.ts",
  "film-orchestrator.ts",
  "film-render-bridge.ts",
  "render-orchestrator.ts",
  "render-module-config.ts",
  "modules/render-pipeline.ts",
  "modules/conformance.ts",
  "renders-db.ts",
  "d1-retry.ts",
  "cast-loras.ts",
  "render-progress.ts",
  "render-log.ts",
  "audio-stage.ts",
  "clip-validate.ts",
  "finish-hash.ts",
  "lora-bundle.ts",
  "operator-config.ts",
  "storyboard-validate.ts",
  "bundle-assembler.ts",
  "srt.ts",
  "captions.ts",
  "clip-content-validate.ts",
  "dialogue-lines.ts",
  "cast-lora-train.ts",
];

function fixImports(src: string, file: string): string {
  let s = src;
  s = s.replace(/from "\.\/env"/g, 'from "./orchestrator-env.js"');
  s = s.replace(/from "\.\/runpod-submit"/g, 'from "./runpod-types.js"');
  s = s.replace(/from "\.\/secret-store"/g, 'from "./platform/secrets.js"');
  if (file === "cast-db.ts" || file.includes("cast")) {
    // cast-db uses DbEnv; orchestrator Env is compatible
  }
  s = s.replace(/from "(\.\.?\/[^"]+)"/g, (m, p: string) => {
    if (p.endsWith(".js")) return m;
    if (p.endsWith(".ts")) return `from "${p.slice(0, -3)}.js"`;
    return `from "${p}.js"`;
  });
  return s;
}

for (const rel of FILES) {
  const path = join(ROOT, rel);
  const before = readFileSync(path, "utf8");
  const after = fixImports(before, rel);
  if (after !== before) writeFileSync(path, after);
  console.log("fixed", rel);
}
