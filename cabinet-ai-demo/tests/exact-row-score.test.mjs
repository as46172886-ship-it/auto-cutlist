import assert from "node:assert/strict";
import test from "node:test";
import { scoreExactRows, scoreExactRowSections } from "../scripts/lib/exact-row-score.mjs";
import { bomRowScope, filterRowsByScope, outputRows, parseSheet, referenceRows } from "../scripts/lib/xlsx-row-extract.mjs";

const row = (overrides = {}) => ({ item: "側板", spec: "350 × 1472", thickness: 18, qty: 2, note: "", ...overrides });

test("exact row scorer preserves duplicate multiplicity instead of collapsing to a Set", () => {
  const result = scoreExactRows([row(), row()], [row()]);
  assert.deepEqual({ matched: result.matched, expected: result.expected, actual: result.actual }, { matched: 1, expected: 2, actual: 1 });
  assert.equal(result.precision, 100);
  assert.equal(result.recall, 50);
  assert.equal(result.missing[0].count, 1);
});

test("thickness and note are part of the exact-match identity", () => {
  const result = scoreExactRows([row()], [row({ thickness: 8, note: "不同備註" })]);
  assert.equal(result.matched, 0);
  assert.equal(result.f1, 0);
  assert.equal(result.missing.length, 1);
  assert.equal(result.extra.length, 1);
});

test("spacing around the multiplication sign is presentation-only", () => {
  const result = scoreExactRows([row({ spec: "350×1472" })], [row({ spec: "350  ×  1472" })]);
  assert.equal(result.f1, 100);
});

test("reference extraction excludes merged titles, prose and formula summary rows", () => {
  const sheets = [[
    ["佛斯特｜修正版板料單", "佛斯特｜修正版板料單", "佛斯特｜修正版板料單", "佛斯特｜修正版板料單", "佛斯特｜修正版板料單", "", "佛斯特｜修正版板料單"],
    ["置物櫃1 板料列數", "18", "總片數", "50", "置物櫃2 板料列數", "26", "總片數", "79"],
    ["櫃體", "品項", "深／寬", "長", "厚", "色號", "數量（片）", "備註"],
    ["置物櫃1", "側板", "350", "1472", "18", "H003", "8", ""],
    ["置物櫃1", "4E門板", "507", "1468", "18", "H003", "2", "長斜把"],
  ], [
    ["佛斯特｜修正版五金料單", "佛斯特｜修正版五金料單", "佛斯特｜修正版五金料單", "佛斯特｜修正版五金料單"],
    ["置物櫃1 品項數", "8", "置物櫃2 品項數", "9", "合計品項數", "17"],
    ["置物櫃1", "GS鉸鍊", "—", "6", "個", ""],
  ]];
  assert.deepEqual(referenceRows(sheets, "", "full"), [
    { item: "側板", spec: "350 × 1472", thickness: "18", qty: "8", note: "" },
    { item: "4E門板", spec: "507 × 1468", thickness: "18", qty: "2", note: "長斜把" },
    { item: "GS鉸鍊", spec: "", thickness: "", qty: "6", note: "" },
  ]);
  assert.deepEqual(referenceRows(sheets, "", "non-door").map((item) => item.item), ["側板"]);
});

test("output extraction rejects headers, audit summaries and zero-quantity rows", () => {
  const sheets = [[
    ["案件名稱：佛斯特　｜　完整料單"],
    ["項目", "規格（mm）", "", "厚度", "數量"],
    ["側板", "350 × 1472", "", "18", "8", "", "", "", "", "", "", ""],
    ["五金"],
    ["GS鉸鍊", "", "", "", "6", "", "", "", "", "", "", ""],
    ["45滑軌", "45cm", "", "", "0", "", "", "", "", "", "", ""],
  ]];
  assert.deepEqual(outputRows(sheets).map((item) => item.item), ["側板", "GS鉸鍊"]);
});

test("SpreadsheetML self-closing cells preserve later column positions", () => {
  const rows = parseSheet('<worksheet><row r="1"><c r="A1" t="inlineStr"><is><t>側板</t></is></c><c r="B1" t="inlineStr"><is><t>350 × 1472</t></is></c><c r="C1"/><c r="D1"><v>18</v></c><c r="E1"><v>8</v></c><c r="L1"/></row></worksheet>');
  assert.equal(rows[0].length, 12);
  assert.deepEqual(rows[0].slice(0, 5), ["側板", "350 × 1472", "", "18", "8"]);
  assert.equal(rows[0][11], "");
});

test("scope filtering is symmetric for expected and actual rows", () => {
  const rows = [
    row(),
    row({ item: "4E門板" }),
    row({ item: "假門板" }),
    row({ item: "屜頭" }),
    row({ item: "GS鉸鍊", spec: "", thickness: "" }),
  ];
  assert.deepEqual(filterRowsByScope(rows, "non-door").map((item) => item.item), ["側板", "假門板", "屜頭"]);
  assert.deepEqual(filterRowsByScope(rows, "door-related").map((item) => item.item), ["4E門板", "假門板", "屜頭", "GS鉸鍊"]);
});

test("full exact-match reporting separates panels, drawer fronts and door hardware", () => {
  const expected = [
    row({ item: "4E門板" }),
    row({ item: "假門板" }),
    row({ item: "屜頭" }),
    row({ item: "GS鉸鍊", spec: "", thickness: "" }),
  ];
  const actual = expected.slice(0, 3);
  const sections = scoreExactRowSections(expected, actual, bomRowScope);
  assert.deepEqual({ matched: sections.doorPanels.matched, expected: sections.doorPanels.expected }, { matched: 3, expected: 3 });
  assert.deepEqual({ matched: sections.doorHardware.matched, expected: sections.doorHardware.expected }, { matched: 0, expected: 1 });
  assert.equal(sections.doorRelated.f1, 85.7);
});
