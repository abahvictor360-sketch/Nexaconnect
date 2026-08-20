/**
 * Regenerate local.db from scratch - the pre-seeded database electron-builder
 * bundles into every installer as the fresh-install library (see
 * electron-builder.json5's extraResources: local.db -> seed.db).
 *
 * A stale local.db (created once for dev/testing, already clicked through)
 * would otherwise ship as "seed data" silently: electron-builder only warns
 * "file source doesn't exist" when the file is *missing*, not when it is
 * present but stale, so a locally-packaged installer can go out with no demo
 * songs and firstRun already false with no build error at all - exactly what
 * happened once. Run before every local `bun run dist`; CI does the
 * equivalent in .github/workflows/desktop-build.yml.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(dir, "local.db");
if (existsSync(dbPath)) rmSync(dbPath);

const env = { ...process.env, DATABASE_URL: `file:${dbPath}` };

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { cwd: dir, env, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited with ${code}`);
}

await run(["bunx", "drizzle-kit", "push", "--force"]);
await run(["bun", "src/api/seed.ts"]);
console.log(`local.db regenerated fresh at ${dbPath}`);
