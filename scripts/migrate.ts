import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "../src/platform/sqlite.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(__dirname, "..");
const dbPath = process.env.DATABASE_PATH ?? join(repoRoot, "data", "studio.db");

mkdirSync(dirname(dbPath), { recursive: true });
migrateDatabase(dbPath, join(repoRoot, "migrations"));
console.log("migrations applied:", dbPath);
