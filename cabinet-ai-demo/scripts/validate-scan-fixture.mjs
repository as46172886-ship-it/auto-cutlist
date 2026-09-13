import { readFile } from "node:fs/promises";
import { validateScanFixture } from "./lib/scan-fixture.mjs";

const [manifestPath, sourceRoot] = process.argv.slice(2);
if (!manifestPath || !sourceRoot) {
  throw new Error("usage: node scripts/validate-scan-fixture.mjs <manifest.json> <materialized-source-root>");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const result = await validateScanFixture(manifest, sourceRoot);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
