import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCarcassResult,
  CARCASS_ONLY_RULES,
  CARCASS_RULES,
  dimensionTextToMm,
  isCarcassObservationRead,
  measurementToMm,
} from "../app/carcass.ts";
import { CARCASS_INSTRUCTIONS } from "../app/api/carcass/instructions.ts";
import { shouldRetryCarcassScan } from "../app/scan-retry.ts";

const orientation = {
  images: [{
    imageName: "YCX.jpeg",
    rotationToUprightDeg: 270,
    uprightTextEvidence: "四維路置物櫃及尺寸字正向",
    numberDirectionEvidence: "40、80、60、55.2、227.2正向可讀",
    widthDirectionEvidence: "40／80／60沿桶身底部由左到右排列",
    bottomHorizontalDimensionTexts: ["40", "80", "60"],
    sideVerticalDimensionTexts: ["55.2", "2.4", "16", "163.1", "2.4", "61.7"],
    orientationBasis: "numbers_and_width_agree",
    confidence: "high",
  }],
};

const blankMeasurement = { rawText: "", value: 0, unit: "unknown", evidence: "" };
const cm = (rawText, value, evidence = "尺寸線清楚") => ({ rawText, value, unit: "cm", evidence });

const observations = {
  projectName: "易利居－四維路－置物櫃",
  drawingUnit: "cm",
  cabinets: [
    {
      widthOrder: 1,
      heightMode: "segment_chain",
      heightTotal: blankMeasurement,
      heightSegments: [cm("55.2", 55.2), cm("2.4", 2.4), cm("16", 16)],
      heightSharedWithOrder: 0,
      sidePanelsContinuous: true,
      bottomBoundaryEvidence: "矮櫃桶底線",
      topBoundaryEvidence: "矮櫃桶頂線",
      heightEvidence: "三段垂直尺寸首尾相接並跨滿矮櫃",
      depthGroupId: "D-ALL",
      confidence: "high",
    },
    {
      widthOrder: 2,
      heightMode: "shared_height",
      heightTotal: blankMeasurement,
      heightSegments: [],
      heightSharedWithOrder: 1,
      sidePanelsContinuous: true,
      bottomBoundaryEvidence: "與第一桶同底線",
      topBoundaryEvidence: "與第一桶同頂線",
      heightEvidence: "C01、C02共用相同桶底及桶頂",
      depthGroupId: "D-ALL",
      confidence: "high",
    },
    {
      widthOrder: 3,
      heightMode: "segment_chain",
      heightTotal: blankMeasurement,
      heightSegments: [cm("163.1", 163.1), cm("2.4", 2.4), cm("61.7", 61.7)],
      heightSharedWithOrder: 0,
      sidePanelsContinuous: true,
      bottomBoundaryEvidence: "高櫃桶底線，不含下方9.5腳高",
      topBoundaryEvidence: "高櫃桶頂線，不含上方15.9留空",
      heightEvidence: "左右側板連續，三段垂直尺寸首尾相接",
      depthGroupId: "D-ALL",
      confidence: "high",
    },
  ],
  depthGroups: [{
    groupId: "D-ALL",
    measurement: cm("D42.6", 42.6, "三桶下方均標D42.6"),
    appliesToOrders: [1, 2, 3],
    evidence: "同一排三桶深度標註一致",
    confidence: "high",
  }],
  unresolved: [],
};

test("uses structured carcass knowledge without embedding the YCX answer in the production prompt", () => {
  assert.equal(CARCASS_RULES.length, 15);
  assert.match(CARCASS_ONLY_RULES.join("\n"), /D42\.6固定表示深度42\.6cm＝426mm/);
  assert.match(CARCASS_ONLY_RULES.join("\n"), /側板完成尺寸＝D×H/);
  assert.doesNotMatch(CARCASS_INSTRUCTIONS, /40[／／]80[／／]60|163\.1.*61\.7|W400/);
  assert.match(CARCASS_INSTRUCTIONS, /AI只抄原始文字|輸出是觀察資料/);
});

test("converts only explicit or drawing-backed units", () => {
  assert.equal(dimensionTextToMm("D42.6", "unknown"), 426);
  assert.equal(dimensionTextToMm("D426mm", "cm"), 426);
  assert.equal(measurementToMm({ rawText: "55.2", value: 55.2, unit: "drawing", evidence: "" }, "cm"), 552);
  assert.equal(measurementToMm({ rawText: "55.2", value: 55.2, unit: "unknown", evidence: "" }, "unknown"), 0);
});

test("validates the observation contract before deterministic calculation", () => {
  assert.equal(isCarcassObservationRead(observations), true);
  const invalid = structuredClone(observations);
  delete invalid.cabinets[0].heightSegments[0].unit;
  assert.equal(isCarcassObservationRead(invalid), false);
});

test("derives the YCX W/H/D and eight merged carcass rows from raw evidence", () => {
  const result = buildCarcassResult(observations, orientation);
  assert.equal(result.complete, true);
  assert.deepEqual(result.cabinets.map((cabinet) => [cabinet.cabinetId, cabinet.widthMm, cabinet.heightMm, cabinet.depthMm]), [
    ["C01", 400, 736, 426],
    ["C02", 800, 736, 426],
    ["C03", 600, 2272, 426],
  ]);
  assert.equal(result.cabinets[0].heightFormula, "552＋24＋160＝736 mm");
  assert.equal(result.cabinets[1].heightSource, "shared_height");
  assert.equal(result.cabinets[2].heightFormula, "1631＋24＋617＝2272 mm");
  const rows = new Map(result.materials.map((row) => [`${row.item}|${row.spec}`, row.qty]));
  assert.deepEqual(Object.fromEntries(rows), {
    "側板|426 × 2272": 2,
    "側板|426 × 736": 4,
    "頂底板|426 × 764": 2,
    "頂底板|426 × 564": 2,
    "頂底板|426 × 364": 2,
    "背板|774 × 710": 1,
    "背板|574 × 2246": 1,
    "背板|374 × 710": 1,
  });
  assert.equal(result.materials.every((row) => /^C1[0-2]$/.test(row.ruleId)), true);
});

test("keeps a dominant middle span as carcass height instead of adding exterior clearances", () => {
  const fosterOrientation = {
    images: [{
      imageName: "storage.jpg", rotationToUprightDeg: 270,
      uprightTextEvidence: "文字正立", numberDirectionEvidence: "100、1472、88可讀",
      widthDirectionEvidence: "底部500", bottomHorizontalDimensionTexts: ["500"],
      sideVerticalDimensionTexts: ["100", "1472", "88"],
      orientationBasis: "numbers_and_width_agree", confidence: "high",
    }],
  };
  const input = {
    projectName: "置物櫃", drawingUnit: "mm",
    cabinets: [{
      widthOrder: 1, heightMode: "segment_chain", heightTotal: blankMeasurement,
      heightSegments: [
        { rawText: "100", value: 100, unit: "mm", evidence: "桶外下方短尺寸" },
        { rawText: "1472", value: 1472, unit: "mm", evidence: "端點對齊桶底與桶頂" },
        { rawText: "88", value: 88, unit: "mm", evidence: "桶外上方短尺寸" },
      ],
      heightSharedWithOrder: 0, sidePanelsContinuous: true,
      bottomBoundaryEvidence: "1472尺寸下端對齊桶底", topBoundaryEvidence: "1472尺寸上端對齊桶頂",
      heightEvidence: "三個共線尺寸中，1472直接跨滿連續側板",
      depthGroupId: "D1", confidence: "high",
    }],
    depthGroups: [{
      groupId: "D1", measurement: { rawText: "D350mm", value: 350, unit: "mm", evidence: "深度標註" },
      appliesToOrders: [1], evidence: "單桶深度", confidence: "high",
    }],
    unresolved: [],
  };
  const result = buildCarcassResult(input, fosterOrientation);
  assert.equal(result.complete, true);
  assert.equal(result.cabinets[0].heightMm, 1472);
  assert.equal(result.cabinets[0].heightFormula, "1472＝1472 mm");
  assert.deepEqual(result.cabinets[0].heightRawTexts, ["1472"]);
});

test("repairs a near-match OCR height segment with the orientation hard lock", () => {
  const noisy = structuredClone(observations);
  noisy.cabinets[0].heightSegments[2] = cm("16.4", 16.4, "OCR把16右側尺寸線誤讀成小數點4");
  const result = buildCarcassResult(noisy, orientation);
  assert.equal(result.cabinets[0].heightMm, 736);
  assert.equal(result.cabinets[0].heightFormula, "552＋24＋160＝736 mm");
  assert.deepEqual(result.cabinets[0].heightRawTexts, ["55.2", "2.4", "16"]);
});

test("rejects a segmented height when continuous side panels were not proven", () => {
  const incomplete = structuredClone(observations);
  incomplete.cabinets[2].sidePanelsContinuous = false;
  const result = buildCarcassResult(incomplete, orientation);
  assert.equal(result.complete, false);
  assert.equal(result.cabinets[2].heightMm, 0);
  assert.equal(result.materials.some((row) => row.cabinetIds.includes("C03")), false);
  assert.match(result.warnings.join("\n"), /同一對連續側板/);
});

test("does not invent a missing depth or silently emit that cabinet's boards", () => {
  const incomplete = structuredClone(observations);
  incomplete.depthGroups[0].appliesToOrders = [2, 3];
  const result = buildCarcassResult(incomplete, orientation);
  assert.equal(result.complete, false);
  assert.match(result.unresolved.join("\n"), /C01 無法辨識桶身深度 D/);
  assert.equal(result.materials.some((row) => row.cabinetIds.includes("C01")), false);
  assert.equal(result.materials.some((row) => row.cabinetIds.includes("C02")), true);
});

test("unknown drawing units block width and every drawing-unit measurement", () => {
  const unknown = structuredClone(observations);
  unknown.drawingUnit = "unknown";
  unknown.depthGroups[0].measurement = { rawText: "42.6", value: 42.6, unit: "drawing", evidence: "單位被裁切" };
  unknown.cabinets[0].heightSegments = unknown.cabinets[0].heightSegments.map((item) => ({ ...item, unit: "drawing" }));
  const result = buildCarcassResult(unknown, orientation);
  assert.equal(result.complete, false);
  assert.match(result.unresolved.join("\n"), /圖面單位無法確認/);
  assert.equal(result.materials.length, 0);
});

test("W/H/D retries only timeout, malformed output, and server failures", () => {
  const timeout = Object.assign(new Error("timeout"), { code: "timeout", status: 504 });
  const malformed = Object.assign(new Error("bad shape"), { code: "invalid_carcass_observations", status: 502 });
  const badRequest = Object.assign(new Error("bad input"), { code: "missing_orientation", status: 400 });
  assert.equal(shouldRetryCarcassScan(timeout), true);
  assert.equal(shouldRetryCarcassScan(malformed), true);
  assert.equal(shouldRetryCarcassScan(badRequest), false);
});
