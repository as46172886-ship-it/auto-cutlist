import { strFromU8, unzipSync } from "fflate";
import { calculateCompleteSop } from "../app/sop.ts";
import { buildEstimateWorkbook } from "../app/xlsx-export.ts";
import { fosterCombinedStructured } from "./fixtures/foster-combined-structured.mjs";
import { scoreExactRows, scoreExactRowSections } from "./lib/exact-row-score.mjs";
import { evaluationReport } from "./lib/evaluation-report.mjs";
import { bomRowScope, outputRows, parseSheet, referenceRows, workbookSheets } from "./lib/xlsx-row-extract.mjs";

const [referencePath] = process.argv.slice(2);
if (!referencePath) throw new Error("usage: node scripts/diagnose-foster-combined.mjs <reference.xlsx>");

const expected = referenceRows(await workbookSheets(referencePath), "", "full");
const calculated = calculateCompleteSop(fosterCombinedStructured);
const files = unzipSync(buildEstimateWorkbook("離線完整雙立面決定式回歸", calculated.materials, calculated.hardware, calculated.notes));
const generatedSheets = Object.entries(files)
  .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
  .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
  .map(([, bytes]) => parseSheet(strFromU8(bytes)));
const actual = outputRows(generatedSheets);
const result = scoreExactRows(expected, actual);
const sections = scoreExactRowSections(expected, actual, bomRowScope);

console.log(JSON.stringify(evaluationReport("deterministic_fixture", {
  ...result,
  sections,
}), null, 2));

if (result.f1 !== 100 || result.missing.length || result.extra.length) process.exitCode = 1;
