/**
 * Copies non-TypeScript database assets into the compiled output.
 *
 * `tsc` emits JavaScript only, so `schema.sql` (and any `migrations/*.sql`) would be
 * missing from `dist/`, which makes `npm run start` fail when it loads migrations.
 * Run automatically by the server `build` script.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(here, "..")
const srcDb = path.join(serverRoot, "src", "db")
const distDb = path.join(serverRoot, "dist", "db")

fs.mkdirSync(distDb, { recursive: true })
fs.copyFileSync(path.join(srcDb, "schema.sql"), path.join(distDb, "schema.sql"))

const migrationsSrc = path.join(srcDb, "migrations")
if (fs.existsSync(migrationsSrc)) {
  fs.cpSync(migrationsSrc, path.join(distDb, "migrations"), { recursive: true })
}

console.log("[build] copied database assets into dist/db")
