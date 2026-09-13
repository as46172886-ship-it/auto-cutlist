import assert from "node:assert/strict";
import test from "node:test";
import { applyStructureVerification, settleStructureVerification } from "../app/non-door-structure-consensus.ts";
import { missingStructuralSourceCabinetIds, NON_DOOR_CLIENT_BUFFER_MS, NON_DOOR_PRIMARY_TIMEOUT_MS, NON_DOOR_SCAN_CONCURRENCY, NON_DOOR_VERIFY_TIMEOUT_MS, nonDoorClientTimeoutMs, selectGlobalNonDoorImages, selectStructuralCropsForRequest } from "../app/non-door-scan-budget.ts";

test("global non-door scanning retains the fifth and sixth uploaded originals", () => {
  const originals = Array.from({ length: 6 }, (_, index) => ({ name: `original-${index + 1}`, dataUrl: "data:image/jpeg;base64,AA==" }));
  const overviews = Array.from({ length: 4 }, (_, index) => ({ name: `overview-${index + 1}`, dataUrl: "data:image/jpeg;base64,AA==" }));
  assert.deepEqual(selectGlobalNonDoorImages(originals, overviews).map((image) => image.name), [
    "original-1", "original-2", "original-3", "original-4", "original-5", "original-6",
    "overview-1", "overview-2", "overview-3",
  ]);
});

test("bounded structure requests keep one internal source for every cabinet", () => {
  const crops = [];
  for (let cabinet = 1; cabinet <= 12; cabinet += 1) {
    const cabinetId = `C${String(cabinet).padStart(2, "0")}`;
    const crop = (suffix, role, scanPass = 1) => ({ name: `${cabinetId}-${suffix}`, dataUrl: "data:image/jpeg;base64,AA==", cabinetId, cropId: suffix, role, sourceImageName: "drawing.jpg", region: suffix, scanPass, focus: suffix });
    crops.push(crop("inside-a", "internal"), crop("inside-b", "internal"), crop("front", "front"), crop("dimension", "dimension"), crop("detail", "detail"), crop("door", "door"), crop("enhanced", "internal", 2));
  }
  const selected = selectStructuralCropsForRequest(crops, 18);
  assert.equal(selected.length, 18);
  for (let cabinet = 1; cabinet <= 12; cabinet += 1) {
    const cabinetId = `C${String(cabinet).padStart(2, "0")}`;
    assert.equal(selected.some((crop) => crop.cabinetId === cabinetId && crop.role === "internal"), true);
  }
  assert.equal(selected.every((crop) => crop.role === "internal" && crop.scanPass === 1), true);
  assert.equal(selected.some((crop) => crop.cabinetId === "C12"), true);
});

test("structure crop priority advances from internal to front and dimensions", () => {
  const crop = (name, role) => ({ name, dataUrl: "data:image/jpeg;base64,AA==", cabinetId: "C1", cropId: name, role, sourceImageName: "drawing.jpg", region: name, scanPass: 1, focus: name });
  const selected = selectStructuralCropsForRequest([
    crop("detail", "detail"), crop("dimension", "dimension"), crop("front", "front"), crop("inside", "internal"),
  ], 4);
  assert.deepEqual(selected.map((item) => item.name), ["inside", "front", "dimension", "detail"]);
});

test("structure request never drops a cabinet's only internal crop at the supplemental-view limit", () => {
  const crops = Array.from({ length: 19 }, (_, index) => ({
    name: `C${index + 1}-inside`, dataUrl: "data:image/jpeg;base64,AA==", cabinetId: `C${index + 1}`,
    cropId: "inside", role: "internal", sourceImageName: "drawing.jpg", region: "inside", scanPass: 1,
  }));
  const selected = selectStructuralCropsForRequest(crops, 18);
  assert.equal(selected.length, 19);
  assert.deepEqual(missingStructuralSourceCabinetIds(selected, crops.map((crop) => crop.cabinetId)), []);
});

test("a reliable focused line review restores an omitted full divider and split shelf count", () => {
  const read = { cabinet: { id: "C02", heightMm: 1400, middleDividers: [], adjustableShelves: 3, fixedShelves: 0, evidence: "完整掃描" }, warnings: [] };
  const merged = applyStructureVerification(read, {
    cabinetId: "C02", fullHeightMiddleDividerCount: 1, adjustableShelfBoardCount: 6, fixedShelfBoardCount: 0,
    drawerFrontCount: 0, drawerColumnCount: 0, drawerRowCount: 0, drawerCountReliable: false,
    reliable: true, confidence: "high", dividerEvidence: "中央實線由頂到底", shelfEvidence: "三層左右各一片", drawerEvidence: "未見抽屜", exclusions: ["門片斜虛線"],
  });
  assert.equal(merged.cabinet.adjustableShelves, 6);
  assert.equal(merged.cabinet.middleDividers.length, 1);
  assert.deepEqual(merged.cabinet.middleDividers[0], {
    depthMm: 0, heightMm: 0, referenceSpanMm: 1400, depthBasis: "standard_d_minus_29", heightBasis: "connection_span",
    region: "全高中立1", topConnection: "top_board", bottomConnection: "bottom_board", evidence: "專用線條複核：中央實線由頂到底",
  });
  assert.match(merged.warnings[0], /門片斜虛線/);
});

test("an unreliable focused line review cannot increase structural quantities", () => {
  const read = { cabinet: { id: "C01", heightMm: 700, middleDividers: [], adjustableShelves: 1, fixedShelves: 0 } };
  const merged = applyStructureVerification(read, {
    cabinetId: "C01", fullHeightMiddleDividerCount: 2, adjustableShelfBoardCount: 8, fixedShelfBoardCount: 2,
    drawerFrontCount: 8, drawerColumnCount: 4, drawerRowCount: 2, drawerCountReliable: true,
    reliable: false, confidence: "low", dividerEvidence: "遮擋", shelfEvidence: "不清楚", drawerEvidence: "不清楚", exclusions: [],
  });
  assert.deepEqual(merged, read);
});

test("a focused review for a neighboring cabinet cannot modify this cabinet", () => {
  const read = { cabinet: { id: "C01", heightMm: 700, middleDividers: [], adjustableShelves: 1, fixedShelves: 0 } };
  const merged = applyStructureVerification(read, {
    cabinetId: "C02", fullHeightMiddleDividerCount: 1, adjustableShelfBoardCount: 8, fixedShelfBoardCount: 0,
    drawerFrontCount: 0, drawerColumnCount: 0, drawerRowCount: 0, drawerCountReliable: false,
    reliable: true, confidence: "high", dividerEvidence: "中央實線", shelfEvidence: "左右各四片", drawerEvidence: "無", exclusions: [],
  });
  assert.deepEqual(merged, read);
});

test("a reliable local drawer-frame review replaces a whole-page overcount and reopens width calculation", () => {
  const read = { cabinet: {
    id: "C02", heightMm: 700, middleDividers: [], adjustableShelves: 1, fixedShelves: 1,
    drawerCount: 3, sideBySideDrawers: true,
    drawerGroups: [{ id: "DG", count: 3, openingWidthMm: 267, openingHeightMm: 160, sideBySide: true, usesCenterlineWidth: true, centerlineBoundaryCount: 1, evidence: "完整圖誤含相鄰桶" }],
  } };
  const merged = applyStructureVerification(read, {
    cabinetId: "C02", fullHeightMiddleDividerCount: 0, adjustableShelfBoardCount: 1, fixedShelfBoardCount: 2,
    drawerFrontCount: 2, drawerColumnCount: 2, drawerRowCount: 1, drawerCountReliable: true,
    reliable: true, confidence: "high", dividerEvidence: "無全高中立", shelfEvidence: "一片", drawerEvidence: "局部裁切內兩個抽框", exclusions: ["相鄰桶一個抽框"],
  });
  assert.equal(merged.cabinet.drawerCount, 2);
  assert.equal(merged.cabinet.drawerGroups[0].count, 2);
  assert.equal(merged.cabinet.drawerGroups[0].openingWidthMm, 0);
  assert.equal(merged.cabinet.fixedShelves, 1);
});

test("a supplemental structure timeout keeps the required cabinet read usable", async () => {
  const timeout = new Error("provider timeout");
  timeout.name = "AbortError";
  const settled = await settleStructureVerification("C09", Promise.reject(timeout));
  assert.equal(settled.verification, undefined);
  assert.match(settled.warning, /C09.*逾時.*沿用逐桶主掃描/);
  assert.ok(NON_DOOR_VERIFY_TIMEOUT_MS < NON_DOOR_PRIMARY_TIMEOUT_MS);
  assert.ok(NON_DOOR_VERIFY_TIMEOUT_MS <= 35_000);
  assert.ok(NON_DOOR_PRIMARY_TIMEOUT_MS >= 80_000);
  assert.ok(nonDoorClientTimeoutMs(1) > NON_DOOR_PRIMARY_TIMEOUT_MS);
  assert.ok(nonDoorClientTimeoutMs(1) - NON_DOOR_PRIMARY_TIMEOUT_MS >= 10_000);
});

test("the browser non-door timeout covers every bounded cabinet batch", () => {
  const cabinetCount = 9;
  const batches = Math.ceil(cabinetCount / NON_DOOR_SCAN_CONCURRENCY);
  const backendWorstCase = batches * NON_DOOR_PRIMARY_TIMEOUT_MS;
  assert.equal(nonDoorClientTimeoutMs(cabinetCount), backendWorstCase + NON_DOOR_CLIENT_BUFFER_MS);
  assert.ok(NON_DOOR_SCAN_CONCURRENCY <= 3);
});

test("a successful supplemental structure review remains available for merging", async () => {
  const verification = {
    cabinetId: "C02", fullHeightMiddleDividerCount: 1, adjustableShelfBoardCount: 6, fixedShelfBoardCount: 0,
    drawerFrontCount: 0, drawerColumnCount: 0, drawerRowCount: 0, drawerCountReliable: false,
    reliable: true, confidence: "high", dividerEvidence: "中央實線", shelfEvidence: "左右各三片", drawerEvidence: "無", exclusions: [],
  };
  const settled = await settleStructureVerification("C02", Promise.resolve(verification));
  assert.equal(settled.warning, undefined);
  assert.deepEqual(settled.verification, verification);
});
