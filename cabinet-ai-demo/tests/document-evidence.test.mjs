import assert from "node:assert/strict";
import test from "node:test";
import {
  documentEvidencePromptSummary,
  extractAxisAlignedPdfLines,
  isAllowedDocumentEvidence,
} from "../app/document-evidence.ts";
import {
  adaptiveLinePixels,
  histogramLevelBounds,
  lineEnhancementInkRatio,
  lineEnhancementLooksUsable,
  scanEncodingForMode,
} from "../app/scan-preprocess.ts";
import {
  CARCASS_PRIMARY_OUTPUT_TOKENS,
  CARCASS_RETRY_OUTPUT_TOKENS,
  CARCASS_TIMEOUT_MS,
} from "../app/carcass-scan-budget.ts";

test("PDF vector parser preserves horizontal and vertical drawing segments", () => {
  const ops = { save: 1, restore: 2, transform: 3, constructPath: 4 };
  const path = new Float32Array([0, 10, 10, 1, 90, 10, 0, 50, 10, 1, 50, 90]);
  const result = extractAxisAlignedPdfLines({ fnArray: [4], argsArray: [[20, [path], [10, 10, 90, 90]]] }, ops, [0, 0, 100, 100]);
  assert.equal(result.vectorPathCount, 1);
  assert.equal(result.axisLines.some((line) => line.axis === "horizontal" && line.length === 800), true);
  assert.equal(result.axisLines.some((line) => line.axis === "vertical" && line.length === 800), true);
});

test("PDF vector parser applies saved transform without turning diagonals into dimensions", () => {
  const ops = { save: 1, restore: 2, transform: 3, constructPath: 4 };
  const horizontal = new Float32Array([0, 0, 10, 1, 20, 10]);
  const diagonal = new Float32Array([0, 0, 0, 1, 20, 20]);
  const result = extractAxisAlignedPdfLines({
    fnArray: [1, 3, 4, 4, 2],
    argsArray: [[], [2, 0, 0, 2, 10, 10], [20, [horizontal], [0, 10, 20, 10]], [20, [diagonal], [0, 0, 20, 20]], []],
  }, ops, [0, 0, 100, 100]);
  assert.equal(result.axisLines.length, 1);
  assert.equal(result.axisLines[0].axis, "horizontal");
});

test("document evidence is bounded and summarized as uncalculated observations", () => {
  const evidence = {
    imageName: "drawing.pdf#第1頁", sourceKind: "vector_pdf", extractor: "pdfjs_text_and_paths",
    pageWidth: 1000, pageHeight: 800, extractedText: "D42.6 鏡子35×130 K1590",
    textRuns: [
      { text: "D42.6", x: 100, y: 200, width: 40, height: 10, rotationDeg: 0 },
      { text: "鏡子35×130", x: 400, y: 300, width: 90, height: 12, rotationDeg: 0 },
    ],
    axisLines: [{ x1: 0, y1: 500, x2: 1000, y2: 500, axis: "horizontal", length: 1000 }], vectorPathCount: 32,
  };
  assert.equal(isAllowedDocumentEvidence(evidence), true);
  const summary = documentEvidencePromptSummary([evidence]);
  assert.equal(summary[0].textRuns.length, 2);
  assert.equal(summary[0].axisLines[0].length, 1000);
});

test("scan preprocessing stretches levels and preserves thin dark lines", () => {
  const histogram = new Uint32Array(256);
  histogram[80] = 10; histogram[180] = 980; histogram[240] = 10;
  assert.deepEqual(histogramLevelBounds(histogram, 1000), { low: 80, high: 180 });
  const gray = new Uint8ClampedArray(49).fill(235);
  for (let y = 0; y < 7; y += 1) gray[y * 7 + 3] = 25;
  const binary = adaptiveLinePixels(gray, 7, 7, 2, 8);
  assert.equal(binary[3 * 7 + 3], 0);
  assert.equal(binary[3 * 7 + 1], 255);
});

test("line enhancement rejects blank or flooded output and keeps binary pixels lossless", () => {
  assert.equal(lineEnhancementLooksUsable(new Uint8ClampedArray(1000).fill(255)), false);
  assert.equal(lineEnhancementLooksUsable(new Uint8ClampedArray(1000).fill(0)), false);
  const drawing = new Uint8ClampedArray(1000).fill(255);
  drawing.fill(0, 0, 60);
  assert.equal(lineEnhancementInkRatio(drawing), 0.06);
  assert.equal(lineEnhancementLooksUsable(drawing), true);
  assert.equal(scanEncodingForMode("line_binary"), "image/png");
  assert.equal(scanEncodingForMode("ocr_gray"), "image/jpeg");
});

test("complete multi-elevation carcass reads retain enough structured-output budget", () => {
  assert.ok(CARCASS_PRIMARY_OUTPUT_TOKENS >= 7_000);
  assert.ok(CARCASS_RETRY_OUTPUT_TOKENS >= 5_000);
  assert.ok(CARCASS_TIMEOUT_MS >= 60_000);
  assert.ok(CARCASS_TIMEOUT_MS < 75_000);
});
