import { strFromU8, unzipSync } from "fflate";
import { buildEstimateWorkbook } from "../app/xlsx-export.ts";
import { scoreExactRows } from "./lib/exact-row-score.mjs";
import { evaluationReport } from "./lib/evaluation-report.mjs";
import { outputRows, parseSheet, referenceRows, workbookSheets } from "./lib/xlsx-row-extract.mjs";

const [referencePath, selectedCabinet = "", scope = "full"] = process.argv.slice(2);
if (!referencePath) {
  throw new Error("usage: node scripts/verify-reference-export-roundtrip.mjs <reference.xlsx> [cabinet-name] [full|non-door]");
}

const expected = referenceRows(await workbookSheets(referencePath), selectedCabinet, scope);
const materials = expected.filter((row) => row.thickness !== "").map((row) => ({
  item: row.item,
  spec: row.spec,
  qty: Number(row.qty),
  note: row.note,
}));
const hardware = expected.filter((row) => row.thickness === "").map((row) => ({
  item: row.item,
  qty: Number(row.qty),
  unit: "",
  note: row.note,
}));

const files = unzipSync(buildEstimateWorkbook("離線匯出回歸", materials, hardware));
const generatedSheets = Object.entries(files)
  .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
  .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
  .map(([, bytes]) => parseSheet(strFromU8(bytes)));
const result = scoreExactRows(expected, outputRows(generatedSheets));

console.log(JSON.stringify(evaluationReport("export_roundtrip", {
  cabinet: selectedCabinet || "全部",
  scope,
  matched: result.matched,
  expected: result.expected,
  actual: result.actual,
  precision: result.precision,
  recall: result.recall,
  f1: result.f1,
  missing: result.missing,
  extra: result.extra,
}), null, 2));

if (result.f1 !== 100) process.exitCode = 1;
