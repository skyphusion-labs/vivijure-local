import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlatformSecretsFromEnv } from "../src/platform-secrets-bootstrap.js";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(__dirname, "..");
const dbPath = process.env.DATABASE_PATH ?? join(repoRoot, "data", "studio.db");

mkdirSync(dirname(dbPath), { recursive: true });
migrateDatabase(dbPath, join(repoRoot, "migrations"));
const db = openDatabase(dbPath);
const result = await bootstrapPlatformSecretsFromEnv(db, process.env);

if (result.seeded.length) {
  console.log("platform_secrets seeded:", result.seeded.join(", "));
} else {
  console.log("platform_secrets unchanged (all bootstrap keys already stored or unset in env)");
}
