import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { calculateCompleteSop } from "../app/sop.ts";
import { buildEstimateWorkbook } from "../app/xlsx-export.ts";
import { fosterCombinedStructured } from "../scripts/fixtures/foster-combined-structured.mjs";
import { fosterFullExpectedRows } from "../scripts/fixtures/foster-full-expected.mjs";
import { scoreExactRows, scoreExactRowSections } from "../scripts/lib/exact-row-score.mjs";
import { bomRowScope, outputRows, parseSheet } from "../scripts/lib/xlsx-row-extract.mjs";

test("full Foster two-elevation fixture keeps all 61 exact rows including doors and hardware", () => {
  const calculated = calculateCompleteSop(fosterCombinedStructured);
  const files = unzipSync(buildEstimateWorkbook("離線完整雙立面決定式回歸", calculated.materials, calculated.hardware, calculated.notes));
  const sheets = Object.entries(files)
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([, bytes]) => parseSheet(strFromU8(bytes)));
  const actual = outputRows(sheets);
  const result = scoreExactRows(fosterFullExpectedRows, actual);
  const sections = scoreExactRowSections(fosterFullExpectedRows, actual, bomRowScope);

  assert.deepEqual(result, {
    matched: 61, expected: 61, actual: 61,
    precision: 100, recall: 100, f1: 100,
    missing: [], extra: [],
  });
  assert.equal(sections.doorPanels.matched, 5);
  assert.equal(sections.doorHardware.matched, 6);
  assert.equal(sections.doorRelated.matched, 11);
  assert.equal(sections.doorRelated.f1, 100);
});
