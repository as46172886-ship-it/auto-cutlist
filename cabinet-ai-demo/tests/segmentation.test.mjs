import assert from "node:assert/strict";
import test from "node:test";
import { isSegmentationPlan } from "../app/segmentation.ts";

const cabinet = (cabinetId, elevationId, widthOrder, cropId) => ({
  cabinetId, elevationId, widthOrder, label: cabinetId,
  bottomSegmentMm: 500, bottomDimensionText: "50",
  sourceCrops: [{
    cropId, sourceImageName: `${elevationId}.jpg`, role: "internal", rotationToUprightDeg: 0,
    box: { x: 0, y: 0, width: 500, height: 900 }, region: cabinetId, evidence: "完整桶身",
  }],
  confidence: "high", evidence: "底部尺寸鏈",
});

const plan = (cabinets) => ({
  projectName: "雙立面測試", drawingUnit: "mm", views: [], cabinets, unresolved: [],
});

test("multi-elevation segmentation requires globally unique cabinet and crop identities", () => {
  assert.equal(isSegmentationPlan(plan([
    cabinet("E01-C01", "E01", 1, "E01-C01-internal"),
    cabinet("E02-C01", "E02", 1, "E02-C01-internal"),
  ])), true);

  assert.equal(isSegmentationPlan(plan([
    cabinet("C01", "E01", 1, "E01-C01-internal"),
    cabinet("C01", "E02", 1, "E02-C01-internal"),
  ])), false);

  assert.equal(isSegmentationPlan(plan([
    cabinet("E01-C01", "E01", 1, "same-crop"),
    cabinet("E02-C01", "E02", 1, "same-crop"),
  ])), false);

  assert.equal(isSegmentationPlan(plan([
    cabinet("E01-C01", "E01", 1, "E01-C01-internal"),
    cabinet("E01-C02", "E01", 1, "E01-C02-internal"),
  ])), false);
});
