/**
 * Give every build its own version number.
 *
 * The app compares its installed version against the newest release to decide
 * whether to offer an update, and the About panel shows it. Two different
 * builds carrying the same number make both of those lie: an update that is
 * genuinely newer looks identical to the one already installed, and there is
 * no way to tell from the app which build a machine is actually running.
 *
 * So the patch number moves on every `bun run dist`. Minor and major stay
 * deliberate - bump those by hand when a release deserves it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "package.json");
const raw = readFileSync(pkgPath, "utf8");

// Edited as text rather than re-serialised from JSON.parse: rewriting the whole
// file would reformat it and churn the diff on every single build.
const match = /"version":\s*"(\d+)\.(\d+)\.(\d+)"/.exec(raw);
if (!match) {
  console.error("bump-version: no semver 'version' field found in package.json");
  process.exit(1);
}

const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
const next = `${major}.${minor}.${patch + 1}`;

writeFileSync(pkgPath, raw.replace(match[0], `"version": "${next}"`), "utf8");
console.log(`version ${major}.${minor}.${patch} -> ${next}`);
