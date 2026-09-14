import assert from "node:assert/strict";
import test from "node:test";
import { validatedCarcassLocks } from "../app/carcass-locks.ts";

const lock = (cabinetId, widthOrder, widthMm) => ({
  cabinetId, widthOrder, widthMm, heightMm: widthOrder === 3 ? 2272 : 736, depthMm: 426,
  widthRawText: String(widthMm / 10), heightRawTexts: ["73.6"], depthRawText: "D42.6",
  heightFormula: "已閉合", widthEvidence: "底鏈", heightEvidence: "標高", depthEvidence: "D42.6",
  confidence: "high", widthSource: "orientation_lock", heightSource: "explicit_total", depthSource: "depth_group", complete: true,
});

const carcass = (cabinets) => ({
  mode: "carcass_only", projectName: "測試", drawingUnit: "mm", cabinets,
  materials: [], unresolved: [], warnings: [], excluded: [], complete: true,
});

const segment = (cabinetId, elevationId, widthOrder, width) => ({
  cabinetId, elevationId, label: cabinetId, widthOrder, bottomSegmentMm: width,
  bottomDimensionText: String(width), sourceCrops: [{
    cropId: `${cabinetId}-internal`, sourceImageName: `${elevationId}.jpg`, role: "internal",
    rotationToUprightDeg: 0, box: { x: 0, y: 0, width: 300, height: 900 }, region: cabinetId, evidence: "內部",
  }], confidence: "high", evidence: "底鏈",
});

const plan = (cabinets) => ({ projectName: "測試", drawingUnit: "mm", views: [], cabinets, unresolved: [] });

test("single-elevation local Cxx carcass IDs safely remap to global segmentation IDs", () => {
  const segmentation = plan([
    segment("E01-C01", "E01", 1, 400),
    segment("E01-C02", "E01", 2, 800),
    segment("E01-C03", "E01", 3, 600),
  ]);
  const locks = validatedCarcassLocks(carcass([
    lock("C01", 1, 400), lock("C02", 2, 800), lock("C03", 3, 600),
  ]), segmentation);
  assert.deepEqual([...locks.keys()], ["E01-C01", "E01-C02", "E01-C03"]);
  assert.deepEqual([...locks.values()].map((item) => item.cabinetId), ["E01-C01", "E01-C02", "E01-C03"]);
  assert.equal(locks.get("E01-C03").heightMm, 2272);
});

test("order remapping rejects a width mismatch instead of exchanging W/H/D evidence", () => {
  const segmentation = plan([segment("E01-C01", "E01", 1, 400)]);
  assert.equal(validatedCarcassLocks(carcass([lock("C01", 1, 800)]), segmentation).size, 0);
});

test("local Cxx locks never cross two different elevations", () => {
  const segmentation = plan([
    segment("E01-C01", "E01", 1, 500),
    segment("E02-C01", "E02", 1, 500),
  ]);
  assert.equal(validatedCarcassLocks(carcass([lock("C01", 1, 500)]), segmentation).size, 0);
});

test("globally matching carcass IDs remain valid in a multi-elevation plan", () => {
  const segmentation = plan([
    segment("E01-C01", "E01", 1, 500),
    segment("E02-C01", "E02", 1, 500),
  ]);
  const locks = validatedCarcassLocks(carcass([
    lock("E01-C01", 1, 500), lock("E02-C01", 1, 500),
  ]), segmentation);
  assert.deepEqual([...locks.keys()], ["E01-C01", "E02-C01"]);
});
