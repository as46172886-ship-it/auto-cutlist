import assert from "node:assert/strict";
import test from "node:test";
import {
  closeInternalCropsFromInternalViews,
  isInternalCropRepairResult,
  mergeInternalCropRepairs,
  missingInternalCropCabinetIds,
  segmentationSourceReferenceErrors,
} from "../app/segmentation-internal.ts";
import { buildPreflightReport } from "../app/preflight.ts";
import { missingStructuralSourceCabinetIds, selectStructuralCropsForRequest } from "../app/non-door-scan-budget.ts";

function frontOnlyPlan(viewKind = "front") {
  return {
    projectName: "單張完整立面",
    drawingUnit: "mm",
    views: [{ imageName: "e01.jpg", viewKind, elevationId: "E01", rotationToUprightDeg: 0, evidence: "同一張完整立面" }],
    cabinets: [400, 800, 600].map((width, index) => ({
      cabinetId: `E01-C0${index + 1}`,
      elevationId: "E01",
      label: `第${index + 1}桶`,
      widthOrder: index + 1,
      bottomSegmentMm: width,
      bottomDimensionText: String(width),
      sourceCrops: [{
        cropId: `E01-C0${index + 1}-front`,
        sourceImageName: "e01.jpg",
        role: "front",
        rotationToUprightDeg: 0,
        box: { x: index * 300, y: 0, width: 300, height: 900 },
        region: `第${index + 1}桶完整框`,
        evidence: "保留左右側板、頂底與正立面",
      }],
      confidence: "high",
      evidence: "底部水平寬度鏈",
    })),
    unresolved: [],
  };
}

test("three front crops survive the request budget but still fail internal coverage", () => {
  const plan = frontOnlyPlan();
  const crops = plan.cabinets.map((cabinet) => ({
    name: `${cabinet.cabinetId}-front.jpg`, dataUrl: "data:image/jpeg;base64,AA==",
    cabinetId: cabinet.cabinetId, cropId: cabinet.sourceCrops[0].cropId, role: "front",
    sourceImageName: "e01.jpg", region: cabinet.sourceCrops[0].region, scanPass: 1,
  }));
  const selected = selectStructuralCropsForRequest(crops, 18);
  assert.deepEqual(selected.map((crop) => crop.cabinetId), ["E01-C01", "E01-C02", "E01-C03"]);
  assert.deepEqual(missingStructuralSourceCabinetIds(selected, plan.cabinets.map((cabinet) => cabinet.cabinetId)), ["E01-C01", "E01-C02", "E01-C03"]);
  assert.equal(buildPreflightReport(plan, crops).ready, false);
});

test("an internal-classified combined elevation closes all three roles without deleting front evidence", () => {
  const plan = closeInternalCropsFromInternalViews(frontOnlyPlan("internal"));
  assert.deepEqual(missingInternalCropCabinetIds(plan), []);
  for (const cabinet of plan.cabinets) {
    assert.deepEqual(new Set(cabinet.sourceCrops.map((crop) => crop.role)), new Set(["front", "internal"]));
    assert.deepEqual(cabinet.sourceCrops[0].box, cabinet.sourceCrops[1].box);
    assert.notEqual(cabinet.sourceCrops[0].cropId, cabinet.sourceCrops[1].cropId);
  }
  assert.equal(buildPreflightReport(plan).ready, true);
});

test("a source classified only as front is never promoted to internal without a visual repair", () => {
  const plan = closeInternalCropsFromInternalViews(frontOnlyPlan("front"));
  assert.deepEqual(missingInternalCropCabinetIds(plan), ["E01-C01", "E01-C02", "E01-C03"]);
  assert.equal(plan.cabinets.every((cabinet) => cabinet.sourceCrops.every((crop) => crop.role === "front")), true);
});

test("focused visual repairs add only valid uploaded sources and leave unresolved cabinets blocked", () => {
  const plan = frontOnlyPlan("front");
  const repair = {
    repairs: [
      { cabinetId: "E01-C01", sourceImageName: "e01.jpg", rotationToUprightDeg: 0, box: { x: 0, y: 0, width: 300, height: 900 }, region: "第一桶", evidence: "可見側板與抽屜框" },
      { cabinetId: "E01-C02", sourceImageName: "invented.jpg", rotationToUprightDeg: 0, box: { x: 300, y: 0, width: 300, height: 900 }, region: "第二桶", evidence: "不存在的來源" },
    ],
    unresolved: ["E01-C03只有封閉門片，未見桶內板線"],
  };
  assert.equal(isInternalCropRepairResult(repair), true);
  const merged = mergeInternalCropRepairs(plan, repair, ["e01.jpg"]);
  assert.deepEqual(missingInternalCropCabinetIds(merged), ["E01-C02", "E01-C03"]);
  assert.equal(merged.cabinets[0].sourceCrops.at(-1).role, "internal");
  assert.match(merged.unresolved.join("；"), /只有封閉門片/);
});

test("segmentation source references must resolve to the actual upload names", () => {
  const plan = frontOnlyPlan("internal");
  assert.deepEqual(segmentationSourceReferenceErrors(plan, ["e01.jpg"]), []);
  plan.cabinets[1].sourceCrops[0].sourceImageName = "renamed.jpg";
  assert.deepEqual(segmentationSourceReferenceErrors(plan, ["e01.jpg"]), ["E01-C02/E01-C02-front:renamed.jpg"]);
});
