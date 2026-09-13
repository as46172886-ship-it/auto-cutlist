import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { evaluationReport } from "./lib/evaluation-report.mjs";
import { scoreExactRows, scoreExactRowSections } from "./lib/exact-row-score.mjs";
import { validateFormalSiteReceipt } from "./lib/formal-site-run.mjs";
import { bomRowScope, outputRows, referenceRows, workbookSheets } from "./lib/xlsx-row-extract.mjs";

const [referencePath, outputPath, receiptPath, manifestPath, ledgerPath] = process.argv.slice(2);
if (!referencePath || !outputPath || !receiptPath || !manifestPath || !ledgerPath) {
  throw new Error("usage: node scripts/score-formal-site-output.mjs <reference.xlsx> <downloaded.xlsx> <receipt.json> <scan-manifest.json> <run-ledger.json>");
}

const [receipt, manifest, outputBytes] = await Promise.all([
  readFile(receiptPath, "utf8").then(JSON.parse),
  readFile(manifestPath, "utf8").then(JSON.parse),
  readFile(outputPath),
]);
let priorRuns = [];
try { priorRuns = JSON.parse(await readFile(ledgerPath, "utf8")); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (!Array.isArray(priorRuns)) throw new Error("run ledger must be a JSON array");
const outputSha256 = createHash("sha256").update(outputBytes).digest("hex");
const provenance = validateFormalSiteReceipt(receipt, manifest, priorRuns, {
  expectedLiveUrl: "https://cabinet-ai-demo.as46172886.chatgpt.site",
  outputSha256,
});
if (!provenance.ok) {
  console.error(JSON.stringify({ evaluationKind: "rejected_formal_site_scan", ...provenance }, null, 2));
  process.exit(1);
}

const expected = referenceRows(await workbookSheets(referencePath), "", "full");
const actual = outputRows(await workbookSheets(outputPath));
const score = scoreExactRows(expected, actual);
const report = evaluationReport("formal_site_scan", {
  date: provenance.date,
  runNumber: provenance.runNumber,
  liveUrl: receipt.liveUrl,
  deploymentVersion: receipt.deploymentVersion,
  outputSha256,
  ...score,
  sections: scoreExactRowSections(expected, actual, bomRowScope),
});
await writeFile(ledgerPath, `${JSON.stringify([...priorRuns, {
  startedAt: receipt.startedAt,
  downloadedAt: receipt.downloadedAt,
  deploymentVersion: receipt.deploymentVersion,
  outputSha256,
  precision: score.precision,
  recall: score.recall,
  f1: score.f1,
}], null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
