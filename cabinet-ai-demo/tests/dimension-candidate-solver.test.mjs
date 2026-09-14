import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCarcassResult,
  extractDocumentDimensionCandidates,
  reconcileCarcassCandidates,
} from "../app/carcass.ts";

const orientation = {
  images: [{
    imageName: "case.jpg",
    rotationToUprightDeg: 0,
    uprightTextEvidence: "文字正向",
    numberDirectionEvidence: "尺寸正向",
    widthDirectionEvidence: "40／80／60為底部水平鏈",
    bottomHorizontalDimensionTexts: ["40", "80", "60"],
    sideVerticalDimensionTexts: ["55.2", "2.4", "16", "163.1", "2.4", "61.7"],
    orientationBasis: "numbers_and_width_agree",
    confidence: "high",
  }],
};

const blank = { rawText: "", value: 0, unit: "unknown", evidence: "" };
const cm = (rawText, value) => ({ rawText, value, unit: "cm", evidence: "圖面尺寸" });
const cabinet = (widthOrder, mode, total, segments = [], shared = 0) => ({
  widthOrder,
  heightMode: mode,
  heightTotal: total,
  heightSegments: segments,
  heightSharedWithOrder: shared,
  sidePanelsContinuous: true,
  bottomBoundaryEvidence: "桶底",
  topBoundaryEvidence: "桶頂",
  heightEvidence: "連續側板",
  depthGroupId: "D-ALL",
  confidence: "high",
});

const base = {
  projectName: "候選求解測試",
  drawingUnit: "cm",
  cabinets: [
    cabinet(1, "explicit_total", cm("71.1", 71.1)),
    cabinet(2, "shared_height", blank, [], 1),
    cabinet(3, "segment_chain", blank, [cm("163.1", 163.1), cm("2.4", 2.4), cm("61.7", 61.7)]),
  ],
  depthGroups: [{
    groupId: "D-ALL",
    measurement: cm("D42.6", 42.6),
    appliesToOrders: [1, 2, 3],
    evidence: "三桶共用D42.6",
    confidence: "high",
  }],
  unresolved: [],
};

test("candidate solver repairs a 711mm total only when a unique contiguous chain closes", () => {
  const reconciled = reconcileCarcassCandidates(base, orientation, []);
  assert.equal(reconciled.observations.cabinets[0].heightMode, "segment_chain");
  assert.deepEqual(reconciled.observations.cabinets[0].heightSegments.map((item) => item.rawText), ["55.2", "2.4", "16"]);
  assert.equal(reconciled.audit.closuresAccepted, 1);
  assert.match(reconciled.audit.repairs[0], /711 → 736/);
  const result = buildCarcassResult(reconciled.observations, orientation);
  assert.deepEqual(result.cabinets.map((item) => item.heightMm), [736, 736, 2272]);
});

test("candidate solver repairs one noisy segment by matching the whole sequence", () => {
  const noisy = structuredClone(base);
  noisy.cabinets[0].heightMode = "segment_chain";
  noisy.cabinets[0].heightTotal = blank;
  noisy.cabinets[0].heightSegments = [cm("55.2", 55.2), cm("2.4", 2.4), cm("13.5", 13.5)];
  const reconciled = reconcileCarcassCandidates(noisy, orientation, []);
  assert.deepEqual(reconciled.observations.cabinets[0].heightSegments.map((item) => item.rawText), ["55.2", "2.4", "16"]);
  assert.match(reconciled.audit.repairs.join("\n"), /552＋24＋135 → 552＋24＋160/);
});

test("vector PDF candidates keep axis association and repeated D values fill missing orders", () => {
  const documentEvidence = [{
    imageName: "case.pdf#第1頁",
    sourceKind: "vector_pdf",
    extractor: "pdfjs_text_and_paths",
    pageWidth: 1000,
    pageHeight: 800,
    extractedText: "D42.6 D42.6 D42.6 55.2 2.4 16",
    textRuns: [
      { text: "D42.6", x: 100, y: 700, width: 40, height: 10, rotationDeg: 0 },
      { text: "D42.6", x: 400, y: 700, width: 40, height: 10, rotationDeg: 0 },
      { text: "D42.6", x: 700, y: 700, width: 40, height: 10, rotationDeg: 0 },
      { text: "55.2", x: 70, y: 120, width: 30, height: 10, rotationDeg: 90 },
      { text: "2.4", x: 70, y: 220, width: 25, height: 10, rotationDeg: 90 },
      { text: "16", x: 70, y: 320, width: 20, height: 10, rotationDeg: 90 },
    ],
    axisLines: [
      { x1: 90, y1: 100, x2: 90, y2: 380, axis: "vertical", length: 280 },
      { x1: 0, y1: 720, x2: 1000, y2: 720, axis: "horizontal", length: 1000 },
    ],
    vectorPathCount: 20,
  }];
  const candidates = extractDocumentDimensionCandidates(documentEvidence, "cm");
  assert.equal(candidates.filter((item) => item.role === "depth" && item.valueMm === 426).length, 3);
  assert.equal(candidates.find((item) => item.rawText === "55.2").axis, "vertical");

  const missingDepth = structuredClone(base);
  missingDepth.depthGroups[0].appliesToOrders = [1];
  const reconciled = reconcileCarcassCandidates(missingDepth, orientation, documentEvidence);
  const pdfDepth = reconciled.observations.depthGroups.find((item) => item.groupId === "PDF-REPEATED-DEPTH");
  assert.deepEqual(pdfDepth.appliesToOrders, [2, 3]);
  assert.match(reconciled.audit.repairs.join("\n"), /深度426mm補足桶序 2、3/);
});

const quietOrientation = { images: [{ ...orientation.images[0], sideVerticalDimensionTexts: [] }] };
const heightDocument = (textRuns, axisLines, imageName = "height.pdf#第1頁") => [{
  imageName,
  sourceKind: "vector_pdf",
  extractor: "pdfjs_text_and_paths",
  pageWidth: 1000,
  pageHeight: 800,
  extractedText: textRuns.map((item) => item.text).join(" "),
  textRuns,
  axisLines,
  vectorPathCount: axisLines.length,
}];

test("parallel vertical dimension lines never form a mixed height chain", () => {
  const documentEvidence = heightDocument([
    { text: "55.2", x: 92, y: 130, width: 10, height: 10, rotationDeg: 90 },
    { text: "16", x: 92, y: 245, width: 10, height: 10, rotationDeg: 90 },
    { text: "2.4", x: 122, y: 190, width: 10, height: 10, rotationDeg: 90 },
  ], [
    { x1: 100, y1: 100, x2: 100, y2: 220, axis: "vertical", length: 120 },
    { x1: 100, y1: 220, x2: 100, y2: 300, axis: "vertical", length: 80 },
    { x1: 130, y1: 150, x2: 130, y2: 240, axis: "vertical", length: 90 },
  ]);
  const reconciled = reconcileCarcassCandidates(base, quietOrientation, documentEvidence);
  assert.equal(reconciled.observations.cabinets[0].heightMode, "explicit_total");
  assert.equal(reconciled.audit.closuresAccepted, 0);
});

test("an explicit total is not expanded by an adjacent same-line segment", () => {
  const input = structuredClone(base);
  input.cabinets[0].heightTotal = cm("147.2", 147.2);
  const documentEvidence = heightDocument([
    { text: "147.2", x: 92, y: 130, width: 10, height: 10, rotationDeg: 90 },
    { text: "8.8", x: 92, y: 230, width: 10, height: 10, rotationDeg: 90 },
  ], [{ x1: 100, y1: 100, x2: 100, y2: 280, axis: "vertical", length: 180 }]);
  const reconciled = reconcileCarcassCandidates(input, quietOrientation, documentEvidence);
  assert.equal(reconciled.observations.cabinets[0].heightMode, "explicit_total");
  assert.equal(reconciled.observations.cabinets[0].heightTotal.rawText, "147.2");
  assert.equal(reconciled.audit.closuresAccepted, 0);
});

test("nested or overlapping collinear spans never form a height chain", () => {
  const documentEvidence = heightDocument([
    { text: "55.2", x: 92, y: 115, width: 10, height: 10, rotationDeg: 90 },
    { text: "18.4", x: 92, y: 195, width: 10, height: 10, rotationDeg: 90 },
  ], [
    { x1: 100, y1: 100, x2: 100, y2: 300, axis: "vertical", length: 200 },
    { x1: 100, y1: 160, x2: 100, y2: 240, axis: "vertical", length: 80 },
  ]);
  const reconciled = reconcileCarcassCandidates(base, quietOrientation, documentEvidence);
  assert.equal(reconciled.observations.cabinets[0].heightMode, "explicit_total");
  assert.equal(reconciled.audit.closuresAccepted, 0);
});

test("endpoint-adjacent collinear spans may form one legal height chain", () => {
  const documentEvidence = heightDocument([
    { text: "55.2", x: 92, y: 130, width: 10, height: 10, rotationDeg: 90 },
    { text: "2.4", x: 92, y: 185, width: 10, height: 10, rotationDeg: 90 },
    { text: "16", x: 92, y: 225, width: 10, height: 10, rotationDeg: 90 },
  ], [
    { x1: 100, y1: 100, x2: 100, y2: 180, axis: "vertical", length: 80 },
    { x1: 100, y1: 180, x2: 100, y2: 200, axis: "vertical", length: 20 },
    { x1: 100, y1: 200, x2: 100, y2: 260, axis: "vertical", length: 60 },
  ]);
  const reconciled = reconcileCarcassCandidates(base, quietOrientation, documentEvidence);
  assert.equal(reconciled.observations.cabinets[0].heightMode, "segment_chain");
  assert.deepEqual(reconciled.observations.cabinets[0].heightSegments.map((item) => item.rawText), ["55.2", "2.4", "16"]);
  assert.equal(reconciled.audit.closuresAccepted, 1);
});

test("conflicting PDF depths are reported and never merged", () => {
  const documentEvidence = [{
    imageName: "mixed.pdf#第1頁", sourceKind: "vector_pdf", extractor: "pdfjs_text_and_paths",
    pageWidth: 1000, pageHeight: 800, extractedText: "D42.6 D56",
    textRuns: [
      { text: "D42.6", x: 100, y: 700, width: 40, height: 10, rotationDeg: 0 },
      { text: "D56", x: 500, y: 700, width: 30, height: 10, rotationDeg: 0 },
    ],
    axisLines: [], vectorPathCount: 12,
  }];
  const reconciled = reconcileCarcassCandidates(base, orientation, documentEvidence);
  assert.match(reconciled.audit.conflicts.join("\n"), /多個不同深度值/);
  assert.equal(reconciled.observations.depthGroups.some((item) => item.groupId === "PDF-REPEATED-DEPTH"), false);
});
