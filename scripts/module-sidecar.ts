#!/usr/bin/env tsx
/**
 * Manifest-only module sidecar for local dev (M4).
 * Serves /module.json from a static JSON file; invoke/poll/cancel return honest errors.
 *
 * Usage: tsx scripts/module-sidecar.ts <port> <manifest.json>
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync } from "node:fs";

const port = Number(process.argv[2]);
const manifestPath = process.argv[3];
if (!port || !manifestPath) {
  console.error("usage: module-sidecar.ts <port> <manifest.json>");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const name = manifest.name ?? manifestPath;
const app = new Hono();

app.get("/module.json", (c) => c.json(manifest));

const stub = (path: string) =>
  app.post(path, (c) =>
    c.json({
      ok: false,
      error: `${name} sidecar is manifest-only (no GPU bindings in local catalog mode)`,
    }),
  );

stub("/invoke");
stub("/poll");
stub("/cancel");

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`module sidecar ${name} on http://127.0.0.1:${port}`);
});
