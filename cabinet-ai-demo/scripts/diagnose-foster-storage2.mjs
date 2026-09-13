import { strFromU8, unzipSync } from "fflate";
import { calculateCompleteSop } from "../app/sop.ts";
import { buildEstimateWorkbook } from "../app/xlsx-export.ts";
import { fosterStorage2Structured } from "./fixtures/foster-storage2-structured.mjs";
import { scoreExactRows } from "./lib/exact-row-score.mjs";
import { evaluationReport } from "./lib/evaluation-report.mjs";
import { outputRows, parseSheet, referenceRows, workbookSheets } from "./lib/xlsx-row-extract.mjs";

const [referencePath] = process.argv.slice(2);
if (!referencePath) throw new Error("usage: node scripts/diagnose-foster-storage2.mjs <reference.xlsx>");

const expected = referenceRows(await workbookSheets(referencePath), "置物櫃2", "full");
const calculated = calculateCompleteSop(fosterStorage2Structured);
const files = unzipSync(buildEstimateWorkbook("離線置物櫃2決定式回歸", calculated.materials, calculated.hardware, calculated.notes));
const generatedSheets = Object.entries(files)
  .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
  .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
  .map(([, bytes]) => parseSheet(strFromU8(bytes)));
const result = scoreExactRows(expected, outputRows(generatedSheets));

console.log(JSON.stringify(evaluationReport("deterministic_fixture", {
  matched: result.matched,
  expected: result.expected,
  actual: result.actual,
  precision: result.precision,
  recall: result.recall,
  f1: result.f1,
  missing: result.missing,
  extra: result.extra,
}), null, 2));

if (result.f1 !== 100 || result.missing.length || result.extra.length) process.exitCode = 1;
