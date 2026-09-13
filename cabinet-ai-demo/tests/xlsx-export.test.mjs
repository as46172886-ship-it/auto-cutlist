import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { buildEstimateWorkbook, compactProductionNote } from "../app/xlsx-export.ts";

test("keeps manufacturing notes while removing formula traces", () => {
  assert.equal(compactProductionNote("[R17] 活格板用 D-40 × W-37", "活格板", "310 × 472"), "活格深度採D−40");
  assert.equal(compactProductionNote("[R22] 固格前縮19，完成452 × 884", "固格板", "452 × 884"), "471用，前縮19mm");
  assert.equal(compactProductionNote("圖註1L2SA；[R40] 檯面", "檯面", "540 × 2348"), "1L2SA");
  assert.equal(compactProductionNote("圖註下斜把；價格備註，不列五金", "屜頭", "457 × 201"), "下斜把");
  assert.equal(compactProductionNote("圖據3左、2右／上斜把×5", "4E門板", "457 × 415"), "3左、2右，上斜把");
  assert.equal(compactProductionNote("完成門面457×636／右開／J把×1／圖據", "4E門板", "457 × 636"), "右開J把×1");
  assert.equal(compactProductionNote("左開／J把×1；右開／完成門面", "4E門板", "457 × 636"), "右開；左開J把×1");
  assert.equal(compactProductionNote("[R24] 活格深度採D−40；1000桶由中立板分隔", "活格板", "310 × 472"), "活格深度採D−40；1000桶由中立板分隔");
  assert.equal(compactProductionNote("圖註1000桶由中立板分隔", "側板", "350 × 1472"), "");
  assert.equal(compactProductionNote("圖註1000桶由中立板分隔／長斜把×1", "4E門板", "507 × 1468"), "長斜把");
});

test("exports one formatted Excel workbook with production and audit sheets", () => {
  const bytes = buildEstimateWorkbook("四維路置物櫃", [
    { item: "側板", spec: "426 × 736", thicknessMm: 19, qty: 4, note: "[R16] D×H" },
    { item: "屜頭", spec: "397 × 160", qty: 3, note: "長斜把×3（價格備註）" },
    { item: "背板", spec: "374 × 710", qty: 1, note: "[R18] W-26 × H-26" },
  ], [
    { item: "35滑軌", qty: 3, unit: "組", note: "D-29取350" },
    { item: "KD", qty: 24, unit: "個", note: "頂底連接" },
  ], ["沒有待確認尺寸"]);
  assert.equal(String.fromCharCode(...bytes.slice(0, 2)), "PK");
  const files = unzipSync(bytes);
  assert.ok(files["xl/worksheets/sheet1.xml"]);
  assert.ok(files["xl/worksheets/sheet2.xml"]);
  const workbook = strFromU8(files["xl/workbook.xml"]);
  const production = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const audit = strFromU8(files["xl/worksheets/sheet2.xml"]);
  assert.match(workbook, /name="料單"/);
  assert.match(workbook, /name="驗算依據"/);
  assert.doesNotMatch(workbook, /#REF!|definedNames|Print_Area/);
  assert.match(production, /<dimension ref="A1:L8"\/>/);
  assert.match(audit, /<dimension ref="A1:E7"\/>/);
  assert.match(production, /案件名稱：四維路置物櫃/);
  assert.match(production, />五金</);
  assert.match(production, /規格（mm）/);
  assert.match(production, /426 × 736/);
  assert.match(production, /<c r="D3" s="7"><v>19<\/v><\/c>/);
  assert.match(production, />長斜把</);
  assert.doesNotMatch(production, /長斜把×3/);
  assert.match(production, />35滑軌</);
  assert.match(production, />35cm</);
  assert.doesNotMatch(production, />組</);
  assert.doesNotMatch(production, /\[R16\]|D×H|D-29取350/);
  assert.ok(
    production.indexOf("<autoFilter") < production.indexOf("<mergeCells"),
    "SpreadsheetML requires autoFilter before mergeCells for Microsoft Excel compatibility",
  );
  assert.ok(
    production.indexOf("<sheetPr>") < production.indexOf("<dimension"),
    "SpreadsheetML requires sheetPr before dimension",
  );
  assert.match(production, /<pageSetUpPr fitToPage="1"\/>/);
  assert.match(production, /<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/);
  assert.match(audit, /<pageSetUpPr fitToPage="1"\/>/);
  assert.match(audit, /<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/);
  assert.doesNotMatch(audit, /<autoFilter/);
  assert.match(audit, /\[R16\] D×H/);
  assert.match(audit, /D-29取350/);
});
