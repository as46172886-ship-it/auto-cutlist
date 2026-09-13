import assert from "node:assert/strict";
import test from "node:test";
import { findInteriorCompletenessErrors, inheritSharedDepths, normalizeDeterministicInterior, validateCabinetStructure } from "../app/api/analyze/structure-validation.ts";
import { findSemanticEvidenceErrors, hasAxisAwareLedger, normalizeSemanticEvidence, selectBetterSemanticResult } from "../app/api/analyze/semantic-validation.ts";
import { calculateCompleteSop, calculateSop } from "../app/sop.ts";
import { SOP_RULE_COUNT, SOP_RULES } from "../app/sop-rules.ts";
import { filterApplicableBlockingIssues, filterBlockingIssues, mergeBlockingIssues, mergeDoorAdvisoryIssues } from "../app/blocking-issues.ts";
import { drawerDowelsPerDrawerForDepth, QUANTITY, QUANTITY_RULE_COUNT, QUANTITY_RULES } from "../app/quantity-rules.ts";
import { buildQuantityAudit, buildQuantityAuditBlockers, quantityAuditCoverageIsComplete } from "../app/quantity-audit.ts";
import { cabinetQuantitySummary } from "../app/cabinet-quantity-summary.ts";
import {
  applyDoorRecognition,
  collectResolvedDoorGap24Locks,
  doorCountEvidenceIsClosed,
  doorReadUsesOnlyKnownSymbolCrops,
  lockableDoorRead,
  normalizeDoorGap24Fields,
  restoreLockedDoors,
  restoreResolvedDoorGap24Locks,
} from "../app/door-recognition.ts";
import { hingesPerDoorForFinishedHeight } from "../app/hinge-rules.ts";
import { doorScanTilesForPass, normalizedCropToPixels, selectCabinetFrameFromVerticalScores, subCropBox } from "../app/image-crop.ts";
import { drawerWallHeightForFrontHeight } from "../app/drawer-rules.ts";
import { batchForConcurrency, DOOR_SCAN_ATTEMPTS, doorCropsForAttempt, doorSourceEvidenceCropNames, isDoorNoResponseError, missingDoorSourceCabinetIds, preserveFirstDoorSymbolLock, selectDoorCropsForRequest, shouldStopDoorAttempts } from "../app/door-scan.ts";
import { DOOR_ATTEMPT_TIMEOUT_MS, DOOR_CLIENT_BUFFER_MS, DOOR_SCAN_CONCURRENCY, doorClientTimeoutMs } from "../app/door-scan-budget.ts";
import { buildPreflightReport } from "../app/preflight.ts";
import { applyOrientationLocks, enforceOrientationConfidence, isOrientationAudit, orientationTaskSummary } from "../app/orientation-audit.ts";
import { applySegmentationLocks, findSegmentationLockErrors, normalizeLedgerToSegmentationLocks } from "../app/api/analyze/segmentation-locks.ts";

const standardBoardProfile = {
  bodyThicknessMm: 18, backThicknessMm: 8, drawerBottomThicknessMm: 8, deductionBasis: "standard_sop",
  topBottomWidthDeductionMm: 36, backWidthDeductionMm: 26, backHeightDeductionMm: 26,
  fixedShelfDepthDeductionMm: 29, fixedShelfWidthDeductionMm: 36,
  adjustableShelfDepthDeductionMm: 40, adjustableShelfWidthDeductionMm: 37,
};

const baseCabinet = {
  id: "C1", name: "下櫃", cabinetKind: "floor", elevationId: "E1", widthChainId: "W1", widthOrder: 1,
  widthMm: 900, widthDimensionIds: ["M_W900"], heightMm: 800, heightDimensionIds: ["M_H800"], depthMm: 426, depthGroupId: "D1", depthSource: "explicit", depthEvidence: "側視D42.6",
  isHanging: false, underCountertop: true, fixedShelves: 0, fixedShelfPositionsMm: [], adjustableShelves: 0, slantedFixedShelfCount: 0,
  drawerCount: 0, sideBySideDrawers: false, innerDrawerCount: 0, footHeightMm: 100, footState: "present",
  topBoardRetreatMm: 0, bottomBoardRetreatMm: 0, specialBackStripCount: 0, specialBackStripState: "not_applicable", boardProfile: standardBoardProfile,
  middleDividers: [], baffles: [], drawerGroups: [], doors: [], drawingNotes: [], confidence: "high", evidence: "尺寸鏈900",
};

const structure = (cabinets, extra = {}) => ({
  cabinets, questions: [], warnings: [], independentPanels: [], dimensionChains: [], ...extra,
});

const completeSegmentationPlan = {
  projectName: "測試案件",
  drawingUnit: "mm",
  views: [
    { imageName: "inside.png", viewKind: "internal", elevationId: "E01", rotationToUprightDeg: 0, evidence: "內部圖" },
    { imageName: "face.png", viewKind: "door", elevationId: "E01", rotationToUprightDeg: 0, evidence: "門板圖" },
  ],
  cabinets: [{
    cabinetId: "C01", elevationId: "E01", label: "第一桶", widthOrder: 1, bottomSegmentMm: 800, bottomDimensionText: "80",
    sourceCrops: [
      { cropId: "C01-inside", sourceImageName: "inside.png", role: "internal", rotationToUprightDeg: 0, box: { x: 0, y: 0, width: 500, height: 900 }, region: "第一桶內部", evidence: "保留底寬與內部" },
      { cropId: "C01-face", sourceImageName: "face.png", role: "door", rotationToUprightDeg: 0, box: { x: 0, y: 0, width: 500, height: 900 }, region: "第一桶門面", evidence: "保留底寬與門面" },
    ],
    confidence: "high", evidence: "側板線與底寬清楚",
  }],
  unresolved: [],
};

test("locks a separately audited upright rotation across views and every crop", () => {
  const plan = structuredClone(completeSegmentationPlan);
  plan.views[0].rotationToUprightDeg = 180;
  plan.cabinets[0].sourceCrops[0].rotationToUprightDeg = 180;
  const audit = {
    images: [{
      imageName: "inside.png", rotationToUprightDeg: 270,
      uprightTextEvidence: "順時針270度後桶深350mm正向可讀",
      numberDirectionEvidence: "350、H003與門509均正向可讀",
      widthDirectionEvidence: "360、1000、1000、500沿櫃體底部由左至右排列",
      bottomHorizontalDimensionTexts: ["360", "1000", "1000", "500"],
      sideVerticalDimensionTexts: ["100", "1472", "88"], orientationBasis: "numbers_and_width_agree", confidence: "high",
    }],
  };
  assert.equal(isOrientationAudit(audit, ["inside.png"]), true);
  assert.deepEqual(orientationTaskSummary(audit)[0].bottomHorizontalWidthChain, ["360", "1000", "1000", "500"]);
  const locked = applyOrientationLocks(plan, audit);
  assert.equal(locked.views[0].rotationToUprightDeg, 270);
  assert.equal(locked.cabinets[0].sourceCrops[0].rotationToUprightDeg, 270);
  assert.equal(locked.orientationAudit.images[0].rotationToUprightDeg, 270);
  const orientationCheck = buildPreflightReport(locked).checks.find((check) => check.id === "orientation-inside.png");
  assert.equal(orientationCheck.status, "ready");
  assert.match(orientationCheck.detail, /270°.*360／1000／1000／500.*100／1472／88/);
});

test("caps one-signal orientation at medium and blocks conflicting evidence", () => {
  const item = {
    imageName: "drawing.jpg", rotationToUprightDeg: 90, uprightTextEvidence: "尺寸字正向",
    numberDirectionEvidence: "509正向", widthDirectionEvidence: "底鏈被裁掉",
    bottomHorizontalDimensionTexts: [], sideVerticalDimensionTexts: ["1472"], confidence: "high",
  };
  const numberOnly = enforceOrientationConfidence({ images: [{ ...item, orientationBasis: "numbers_only" }] });
  assert.equal(numberOnly.images[0].confidence, "medium");
  const conflict = enforceOrientationConfidence({ images: [{ ...item, orientationBasis: "conflict" }] });
  assert.equal(conflict.images[0].confidence, "low");
});

test("orientation confidence cannot stay high without a real bottom width chain", () => {
  const item = {
    imageName: "drawing.jpg", rotationToUprightDeg: 270, uprightTextEvidence: "文字正立", numberDirectionEvidence: "2、5、7可讀",
    widthDirectionEvidence: "聲稱底鏈成立但未列數字", bottomHorizontalDimensionTexts: [], sideVerticalDimensionTexts: ["1472"],
    orientationBasis: "numbers_and_width_agree", confidence: "high",
  };
  assert.equal(enforceOrientationConfidence({ images: [item] }).images[0].confidence, "low");
});

test("orientation audit requires exactly one result for every source image", () => {
  const item = {
    imageName: "inside.png", rotationToUprightDeg: 270, uprightTextEvidence: "文字正立", numberDirectionEvidence: "2、5、7可讀",
    widthDirectionEvidence: "底部360、1000水平排列", bottomHorizontalDimensionTexts: ["360", "1000"], sideVerticalDimensionTexts: ["1472"],
    orientationBasis: "numbers_and_width_agree", confidence: "high",
  };
  assert.equal(isOrientationAudit({ images: [item, { ...item }] }, ["inside.png", "face.png"]), false);
  assert.equal(isOrientationAudit({ images: [item, { ...item, imageName: "face.png" }] }, ["inside.png", "face.png"]), true);
});

test("later AI passes cannot reverse a locked rotation or collapse four width buckets", () => {
  const plan = {
    projectName: "測試", drawingUnit: "mm",
    views: [{ imageName: "drawing.jpg", viewKind: "internal", elevationId: "E01", rotationToUprightDeg: 270, evidence: "前置核對" }],
    orientationAudit: { images: [{
      imageName: "drawing.jpg", rotationToUprightDeg: 270, uprightTextEvidence: "字向正立", numberDirectionEvidence: "數字正立",
      widthDirectionEvidence: "底部鏈", bottomHorizontalDimensionTexts: ["360", "1000", "1000", "500"],
      sideVerticalDimensionTexts: ["100", "1472", "88"], orientationBasis: "numbers_and_width_agree", confidence: "high",
    }] },
    cabinets: [360, 1000, 1000, 500].map((width, index) => ({
      cabinetId: `C0${index + 1}`, elevationId: "E01", label: `第${index + 1}桶`, widthOrder: index + 1,
      bottomSegmentMm: width, bottomDimensionText: String(width),
      sourceCrops: [{ cropId: `C0${index + 1}-I`, sourceImageName: "drawing.jpg", role: "internal", rotationToUprightDeg: 270, box: { x: index * 200, y: 0, width: 200, height: 1000 }, region: "單桶", evidence: "真裁切" }],
      confidence: "high", evidence: "底部尺寸段",
    })), unresolved: [],
  };
  const wrongLedger = {
    projectName: "測試", drawingUnit: "mm",
    imageViews: [{ imageName: "drawing.jpg", viewKind: "front", elevationId: "E01", region: "全圖", rotationToUprightDeg: 90, notes: "誤轉" }],
    dimensions: ["100", "1472", "88", "360", "1000", "1000", "500"].map((rawText, index) => ({
      id: `M${index + 1}`, imageName: "drawing.jpg", rawText, sourceValue: Number(rawText), sourceUnit: "mm", valueMm: Number(rawText),
      kind: index < 3 ? "total_width" : "opening_height", orientation: index < 3 ? "horizontal" : "vertical", region: "誤判", targets: [], confidence: "high", evidence: "後段誤判",
    })), depthGroups: [], unresolved: [],
  };
  const ledger = normalizeLedgerToSegmentationLocks(wrongLedger, plan);
  assert.equal(ledger.imageViews[0].rotationToUprightDeg, 270);
  assert.deepEqual(ledger.dimensions.filter((item) => String(item.id).startsWith("SEG-W-")).map((item) => item.orientation), ["horizontal", "horizontal", "horizontal", "horizontal"]);
  assert.equal(ledger.dimensions.find((item) => item.rawText === "1472").orientation, "vertical");
  assert.equal(ledger.dimensions.find((item) => item.rawText === "1472").kind, "cabinet_height");
  assert.equal(ledger.dimensions.find((item) => item.rawText === "100").kind, "foot_height");

  const collapsed = { cabinets: [{ ...baseCabinet, id: "C01", widthMm: 1472, widthOrder: 1 }], dimensionChains: [] };
  const fallback = { cabinets: plan.cabinets.map((segment) => ({ ...baseCabinet, id: segment.cabinetId, widthMm: segment.bottomSegmentMm, widthOrder: segment.widthOrder })), dimensionChains: [] };
  const locked = applySegmentationLocks(collapsed, plan, ledger, fallback);
  assert.deepEqual(locked.cabinets.map((cabinet) => [cabinet.id, cabinet.widthMm]), [["C01", 360], ["C02", 1000], ["C03", 1000], ["C04", 500]]);
  assert.deepEqual(findSegmentationLockErrors(locked, plan, ledger), []);
});

test("identical widths in different elevations cannot exchange dimensions or cabinet contents", () => {
  const crop = (cropId, sourceImageName) => ({
    cropId, sourceImageName, role: "internal", rotationToUprightDeg: 0,
    box: { x: 0, y: 0, width: 500, height: 1000 }, region: "單桶", evidence: "來源原圖",
  });
  const plan = {
    projectName: "雙立面", drawingUnit: "mm",
    views: [
      { imageName: "e1.jpg", viewKind: "internal", elevationId: "E01", rotationToUprightDeg: 0, evidence: "第一立面" },
      { imageName: "e2.jpg", viewKind: "internal", elevationId: "E02", rotationToUprightDeg: 0, evidence: "第二立面" },
    ],
    cabinets: [
      { cabinetId: "E02-C01", elevationId: "E02", label: "第二立面第一桶", widthOrder: 1, bottomSegmentMm: 500, bottomDimensionText: "500", sourceCrops: [crop("e2-c1", "e2.jpg")], confidence: "high", evidence: "第二立面底鏈" },
      { cabinetId: "E01-C01", elevationId: "E01", label: "第一立面第一桶", widthOrder: 1, bottomSegmentMm: 500, bottomDimensionText: "500", sourceCrops: [crop("e1-c1", "e1.jpg")], confidence: "high", evidence: "第一立面底鏈" },
    ], unresolved: [],
  };
  const wrongLedger = {
    projectName: "雙立面", drawingUnit: "mm", imageViews: [], depthGroups: [], unresolved: [],
    dimensions: [
      { id: "M-E2", imageName: "e2.jpg", rawText: "500", valueMm: 500, kind: "other", orientation: "horizontal", region: "第二立面", targets: [], confidence: "high", evidence: "第二立面原圖" },
      { id: "M-E1", imageName: "e1.jpg", rawText: "500", valueMm: 500, kind: "other", orientation: "horizontal", region: "第一立面", targets: [], confidence: "high", evidence: "第一立面原圖" },
    ],
  };
  const ledger = normalizeLedgerToSegmentationLocks(wrongLedger, plan);
  assert.equal(ledger.dimensions.find((item) => item.id === "SEG-W-E01-C01").imageName, "e1.jpg");
  assert.equal(ledger.dimensions.find((item) => item.id === "SEG-W-E02-C01").imageName, "e2.jpg");

  const structured = { cabinets: [
    { ...baseCabinet, id: "wrong-e2", elevationId: "E02", widthMm: 500, widthOrder: 1, adjustableShelves: 7, evidence: "第二立面內容" },
    { ...baseCabinet, id: "wrong-e1", elevationId: "E01", widthMm: 500, widthOrder: 1, adjustableShelves: 3, evidence: "第一立面內容" },
  ], dimensionChains: [] };
  const locked = applySegmentationLocks(structured, plan, ledger, { cabinets: [] });
  assert.deepEqual(locked.cabinets.map((item) => [item.id, item.adjustableShelves]), [["E01-C01", 3], ["E02-C01", 7]]);
  assert.deepEqual(findSegmentationLockErrors(locked, plan, ledger), []);
});

test("loads every rule from the authoritative revised SOP", () => {
  assert.equal(SOP_RULE_COUNT, 67);
  assert.equal(SOP_RULES.at(23).id, "R24");
  assert.match(SOP_RULES.at(23).rule, /D-40/);
});

test("preflight opens only when unit, width, internal view and face view are all evidenced", () => {
  const report = buildPreflightReport(completeSegmentationPlan);
  assert.equal(report.ready, true);
  assert.equal(report.blockingCount, 0);
});

test("one source image may provide separate overlapping internal and door crops", () => {
  const plan = structuredClone(completeSegmentationPlan);
  plan.views = [plan.views[0]];
  plan.cabinets[0].sourceCrops[1].sourceImageName = "inside.png";
  plan.cabinets[0].sourceCrops[1].box = { ...plan.cabinets[0].sourceCrops[0].box };
  const report = buildPreflightReport(plan);
  assert.equal(report.ready, true);
  assert.equal(report.checks.find((check) => check.id === "C01-face").status, "ready");
});

test("preflight blocks a front-only drawing instead of guessing the cabinet interior", () => {
  const plan = structuredClone(completeSegmentationPlan);
  plan.cabinets[0].sourceCrops = plan.cabinets[0].sourceCrops.filter((crop) => crop.role !== "internal");
  const report = buildPreflightReport(plan);
  assert.equal(report.ready, false);
  assert.match(report.checks.find((check) => check.id === "C01-internal").detail, /只有正立面或門板圖不能直接拆料/);
});

test("preflight blocks unknown units and unreadable bottom widths but lets structure questions reach analysis", () => {
  const plan = structuredClone(completeSegmentationPlan);
  plan.drawingUnit = "unknown";
  plan.cabinets[0].bottomSegmentMm = 0;
  plan.unresolved = ["C01 中立上下接點不明"];
  const report = buildPreflightReport(plan);
  assert.equal(report.ready, false);
  assert.equal(report.blockingCount, 2);
  assert.equal(report.checks.find((check) => check.id === "segmentation-notes").status, "warning");
});

test("preflight lets an internal-only crop enter the three-pass door scan", () => {
  const plan = structuredClone(completeSegmentationPlan);
  plan.cabinets[0].sourceCrops = plan.cabinets[0].sourceCrops.filter((crop) => crop.role === "internal");
  plan.unresolved = ["缺門板圖或正立面，無法建立door/front裁切"];
  const actualCrops = [{ name: "inside", dataUrl: "data:image/png;base64,AA==", cabinetId: "C01", cropId: "C01-inside", role: "internal", sourceImageName: "inside.png", region: "第一桶內部" }];
  const report = buildPreflightReport(plan, actualCrops);
  assert.equal(report.ready, true);
  assert.equal(report.blockingCount, 0);
  assert.equal(report.checks.find((check) => check.id === "C01-face").status, "warning");
  assert.equal(report.checks.some((check) => check.id === "segmentation-notes"), false);
  assert.match(report.checks.find((check) => check.id === "C01-actual-crops").detail, /同桶裁切上掃描三次/);
});

test("an internal-only crop still receives all three independent door attempts", () => {
  assert.deepEqual(DOOR_SCAN_ATTEMPTS, [1, 2, 3]);
  const crop = (name, scanPass) => ({ name, dataUrl: "data:image/jpeg;base64,AA==", cabinetId: "C01", cropId: name, role: "internal", sourceImageName: "inside.png", region: "第一桶", scanPass, focus: name });
  const all = [crop("inside-full", 1), crop("inside-upper", 2), crop("inside-quadrant", 3)];
  assert.deepEqual(doorCropsForAttempt(all, 1).map((item) => item.name), ["inside-full"]);
  assert.deepEqual(doorCropsForAttempt(all, 2).map((item) => item.name), ["inside-full", "inside-upper"]);
  assert.deepEqual(doorCropsForAttempt(all, 3).map((item) => item.name), ["inside-full", "inside-quadrant"]);
});

test("door scans are scheduled in bounded cabinet batches", () => {
  assert.deepEqual(batchForConcurrency(["C1", "C2", "C3", "C4", "C5", "C6", "C7"], 3), [
    ["C1", "C2", "C3"],
    ["C4", "C5", "C6"],
    ["C7"],
  ]);
});

test("the browser door timeout covers every sequential batch and all three allowed attempts", () => {
  const cabinetCount = 9;
  const batches = Math.ceil(cabinetCount / DOOR_SCAN_CONCURRENCY);
  const backendWorstCase = batches * DOOR_SCAN_ATTEMPTS.length * DOOR_ATTEMPT_TIMEOUT_MS;
  assert.equal(doorClientTimeoutMs(cabinetCount), backendWorstCase + DOOR_CLIENT_BUFFER_MS);
  assert.ok(doorClientTimeoutMs(cabinetCount) > backendWorstCase);
});

test("door scanning stops early only after a complete symbol lock", () => {
  const lockedDoor = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"], openingWidthMm: 0, openingHeightMm: 0,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "unknown", direction: "right", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "unknown", hingeCountPerDoor: 0, evidence: "門面葉片內右開符號>",
    symbolRegions: [{ symbol: ">", cropName: "C1__door__p1.png", region: "右門面", xPermille: 630, yPermille: 570, evidence: "門面葉片內右開符號" }],
  };
  const read = { cabinetId: "C1", status: "confirmed_4e", doors: [lockedDoor], unresolvedDoorRegions: [] };
  assert.equal(shouldStopDoorAttempts(read), true);
  assert.equal(shouldStopDoorAttempts({ ...read, status: "partial" }), false);
  assert.equal(shouldStopDoorAttempts({ ...read, unresolvedDoorRegions: ["右側門樣區仍模糊"] }), false);
});

test("a silent door request is recognized as an early-stop condition", () => {
  const aborted = new Error("The operation was aborted");
  aborted.name = "AbortError";
  assert.equal(isDoorNoResponseError(aborted), true);
  assert.equal(isDoorNoResponseError(new Error("門板辨識逾時")), true);
  assert.equal(isDoorNoResponseError(new Error("結果格式無法讀取")), false);
});

test("a door timeout becomes a warning while keeping the cabinet structure", () => {
  const audited = applyDoorRecognition(structure([{ ...baseCabinet, fixedShelves: 1 }]), {
    cabinetDoors: [{
      cabinetId: "C1", status: "unknown", doors: [], attemptsUsed: 1,
      unresolvedDoorRegions: ["門板辨識沒有回應，已提早結束"],
      evidence: "無法偵測門板；其他尺寸與桶內結構仍照常輸出",
    }],
    unresolved: ["C1無法偵測門板"],
  });
  assert.equal(audited.cabinets[0].fixedShelves, 1);
  assert.equal(audited.cabinets[0].doors.length, 0);
  assert.match(audited.warnings.join(" "), /無法偵測門板.*其他尺寸與桶內結構照常顯示/);
});

test("loads every derived quantity rule and applies the corrected drawer-dowel depth tiers", () => {
  assert.equal(QUANTITY_RULE_COUNT, 30);
  assert.equal(QUANTITY_RULES.length, 30);
  assert.deepEqual([drawerDowelsPerDrawerForDepth(499), drawerDowelsPerDrawerForDepth(500)], [12, 4]);
  assert.match(QUANTITY_RULES.find((rule) => rule.item === "抽木榫").formula, /D<500.*12顆.*D≥500.*4顆/);
});

test("uses the authoritative hinge schedule at every boundary", () => {
  assert.deepEqual([0, 1, 959, 960, 1599, 1600, 2239, 2240].map(hingesPerDoorForFinishedHeight), [0, 2, 2, 3, 3, 4, 4, 5]);
});

test("converts a normalized cabinet crop into a padded pixel crop", () => {
  const crop = normalizedCropToPixels({ x: 250, y: 100, width: 500, height: 700 }, 2000, 1000, 0);
  assert.deepEqual(crop, { x: 500, y: 100, width: 1000, height: 700 });
});

test("creates genuinely different door scan regions for all three passes", () => {
  assert.equal(doorScanTilesForPass(1).length, 1);
  assert.equal(doorScanTilesForPass(2).length, 2);
  assert.equal(doorScanTilesForPass(3).length, 4);
  const focused = subCropBox({ x: 100, y: 200, width: 600, height: 500 }, doorScanTilesForPass(3)[3]);
  assert.deepEqual(focused, { x: 352, y: 410, width: 348, height: 290 });
});

test("rebuilds shifted AI crop boxes from actual side-panel lines and the locked width chain", () => {
  const scores = Array.from({ length: 1536 }, () => 0);
  const peaks = [414, 526, 800, 1060, 1201];
  for (const [index, strength] of peaks.map((position, index) => [position, index === 0 || index === peaks.length - 1 ? 900 : 500])) {
    scores[index] = strength;
    scores[index - 1] = strength * 0.7;
    scores[index + 1] = strength * 0.7;
  }
  // Strong drawing lines that are not the four cabinet boundaries must not
  // shift the chain or make a centre divider become a cabinet edge.
  scores[663] = 540;
  scores[926] = 535;
  scores[378] = 520;
  const frame = selectCabinetFrameFromVerticalScores(scores, [360, 1000, 1000, 500]);
  assert.ok(frame);
  assert.deepEqual(frame.boundariesPx, peaks);
});

test("each later door attempt keeps every raw reference beside its enhanced crop", () => {
  const crop = (name, role, scanPass) => ({ name, dataUrl: "data:image/jpeg;base64,AA==", cabinetId: "C1", cropId: name, role, sourceImageName: "drawing.jpg", region: name, scanPass, focus: name });
  const all = [crop("door-full", "door", 1), crop("inside-full", "internal", 1), crop("dimension-full", "dimension", 1), crop("door-upper", "door", 2), crop("inside-upper", "internal", 2), crop("door-quadrant", "door", 3)];
  assert.deepEqual(doorCropsForAttempt(all, 1).map((item) => item.name), ["door-full", "inside-full", "dimension-full"]);
  assert.deepEqual(doorCropsForAttempt(all, 2).map((item) => item.name), ["door-full", "door-upper", "inside-full", "inside-upper", "dimension-full"]);
  assert.deepEqual(doorCropsForAttempt(all, 3).map((item) => item.name), ["door-full", "door-quadrant", "inside-full", "dimension-full"]);
  assert.deepEqual([...doorSourceEvidenceCropNames(doorCropsForAttempt(all, 2))].sort(), ["door-full", "inside-full"]);
});

test("dimension arrows and generic details cannot prove a door direction", () => {
  const crop = (name, role) => ({ name, dataUrl: "data:image/jpeg;base64,AA==", cabinetId: "C1", cropId: name, role, sourceImageName: "drawing.jpg", region: name, scanPass: 1, focus: name });
  const allowed = doorSourceEvidenceCropNames([
    crop("door-source", "door"),
    crop("front-source", "front"),
    crop("inside-source", "internal"),
    crop("dimension-arrows", "dimension"),
    crop("generic-detail", "detail"),
  ]);
  assert.deepEqual([...allowed].sort(), ["door-source", "front-source", "inside-source"]);
  const read = (cropName) => ({ doors: [{ symbolRegions: [{ cropName }] }] });
  assert.equal(doorReadUsesOnlyKnownSymbolCrops(read("door-source"), allowed), true);
  assert.equal(doorReadUsesOnlyKnownSymbolCrops(read("dimension-arrows"), allowed), false);
  assert.equal(doorReadUsesOnlyKnownSymbolCrops(read("generic-detail"), allowed), false);
});

test("bounded door requests keep raw evidence for every cabinet before enhanced passes", () => {
  const crops = [];
  for (let cabinet = 1; cabinet <= 12; cabinet += 1) {
    const cabinetId = `C${String(cabinet).padStart(2, "0")}`;
    const crop = (suffix, role, scanPass) => ({ name: `${cabinetId}-${suffix}`, dataUrl: "data:image/jpeg;base64,AA==", cabinetId, cropId: suffix, role, sourceImageName: "drawing.jpg", region: suffix, scanPass, focus: suffix });
    crops.push(crop("door-raw", "door", 1), crop("inside-raw", "internal", 1), crop("dimension", "dimension", 1));
    crops.push(crop("door-mask", "door", 2));
    for (let tile = 1; tile <= 6; tile += 1) crops.push(crop(`door-tile-${tile}`, "door", 3));
  }
  const selected = selectDoorCropsForRequest(crops, 100);
  assert.equal(selected.length, 100);
  for (let cabinet = 1; cabinet <= 12; cabinet += 1) {
    const cabinetId = `C${String(cabinet).padStart(2, "0")}`;
    assert.equal(selected.some((crop) => crop.cabinetId === cabinetId && crop.scanPass === 1 && crop.role === "door"), true);
    assert.equal(selected.some((crop) => crop.cabinetId === cabinetId && crop.scanPass === 1 && crop.role === "internal"), true);
  }
  assert.equal(selected.slice(0, 24).every((crop) => crop.scanPass === 1 && crop.role !== "dimension"), true);
  assert.equal(selected.findIndex((crop) => crop.scanPass === 2) > selected.findIndex((crop) => crop.role === "dimension"), true);
  assert.equal(selected.some((crop) => crop.cabinetId === "C12" && crop.scanPass === 3), true);
});

test("door request reports cabinets omitted by the final crop budget", () => {
  const crops = Array.from({ length: 101 }, (_, index) => ({
    name: `C${index + 1}-door`, dataUrl: "data:image/jpeg;base64,AA==", cabinetId: `C${index + 1}`,
    cropId: "door", role: "door", sourceImageName: "drawing.jpg", region: "door", scanPass: 1,
  }));
  const selected = selectDoorCropsForRequest(crops, 100);
  assert.deepEqual(missingDoorSourceCabinetIds(selected, crops.map((crop) => crop.cabinetId)), ["C101"]);
});

test("derives drawer-wall height from the confirmed finished-front tiers", () => {
  assert.deepEqual([0, 145, 160, 175, 200, 201, 239, 240].map(drawerWallHeightForFrontHeight), [0, 100, 100, 100, 100, 120, 120, 180]);
});

test("blocks an unsplit cabinet wider than 1000mm", () => {
  const result = validateCabinetStructure(structure([{ ...baseCabinet, widthMm: 1800 }]));
  assert.match(result.questions.join(" "), /超過單一桶身/);
});

test("inherits a shared depth once for all cabinets in the same explicit depth group", () => {
  const input = structure([
    { ...baseCabinet, id: "C1", depthMm: 0, depthSource: "unknown" },
    { ...baseCabinet, id: "C2", widthOrder: 2, depthMm: 0, depthSource: "unknown" },
  ], {
    dimensionLedger: { depthGroups: [{ id: "D1", depthMm: 394, source: "shared_note", evidence: "內部圖上方共用D39.4" }] },
  });
  const inherited = inheritSharedDepths(input);
  assert.deepEqual(inherited.cabinets.map((cabinet) => cabinet.depthMm), [394, 394]);
  const result = validateCabinetStructure(input);
  assert.equal(result.questions.some((question) => /缺少.*深度|深度.*未知/.test(question)), false);
  assert.deepEqual(result.depthInheritance, ["C1", "C2"]);
});

test("groups unresolved depth into one blocking question instead of one per cabinet", () => {
  const result = validateCabinetStructure(structure([
    { ...baseCabinet, id: "C1", depthMm: 0, depthGroupId: "D1" },
    { ...baseCabinet, id: "C2", depthMm: 0, depthGroupId: "D1" },
    { ...baseCabinet, id: "C3", depthMm: 0, depthGroupId: "D2" },
  ]));
  assert.equal(result.questions.filter((question) => /深度/.test(question)).length, 1);
  assert.match(result.questions[0], /C1、C2/);
});

test("under-countertop drawers do not retreat boards without slanted-handle evidence", () => {
  const result = calculateSop([baseCabinet]);
  const topBottom = result.materials.find((row) => row.item === "頂底板");
  assert.equal(topBottom.spec, "426 × 864");
});

test("only the horizontal board that forms a slanted-handle gap retreats 19mm", () => {
  const result = calculateSop([{ ...baseCabinet, topBoardRetreatMm: 19 }]);
  assert.equal(result.materials.find((row) => row.item === "頂板").spec, "407 × 864");
  assert.equal(result.materials.find((row) => row.item === "底板").spec, "426 × 864");
});

test("uses the current D-40 adjustable-shelf rule", () => {
  const result = calculateSop([{ ...baseCabinet, adjustableShelves: 1 }]);
  assert.equal(result.materials.find((row) => row.item === "活格板").spec, "386 × 863");
});

test("visible horizontal shelves without an affirmative F marker are locked as adjustable shelves", () => {
  const cabinet = {
    ...baseCabinet,
    adjustableShelves: 0,
    componentRegions: [
      { region: "第1至3道水平層板", classification: "unknown", sopRuleIds: ["R23", "R24"], quantity: 3, widthMm: 0, heightMm: 0, depthMm: 0, confidence: "low", evidence: "可明確看到三道水平層板，但未見F註記或固格標記。" },
      { region: "門後三道虛線水平區", classification: "unknown", sopRuleIds: ["R24"], quantity: 3, widthMm: 0, heightMm: 0, depthMm: 0, confidence: "low", evidence: "門後可見三道虛線水平線，沒有固定層板的肯定證據。" },
    ],
  };
  const [normalized] = normalizeDeterministicInterior([cabinet]);
  assert.equal(normalized.adjustableShelves, 6);
  assert.deepEqual(normalized.componentRegions.map((region) => region.classification), ["adjustable_shelf", "adjustable_shelf"]);
  assert.equal(normalized.componentRegions.every((region) => region.sopRuleIds.includes("Q10")), true);
  const validated = validateCabinetStructure(structure([cabinet], { questions: ["請確認三道水平層板是固格還是活格。"] }));
  assert.doesNotMatch(validated.questions.join(" "), /水平層板是固格還是活格/);
});

test("a door overlay cannot silently erase unresolved horizontal shelf lines", () => {
  const cabinet = {
    ...baseCabinet,
    adjustableShelves: 3,
    middleDividers: [{ depthMm: 0, heightMm: 0, referenceSpanMm: 800, depthBasis: "standard_d_minus_29", heightBasis: "connection_span", region: "全高中立", topConnection: "top_board", bottomConnection: "bottom_board", evidence: "由頂到底" }],
    componentRegions: [
      { region: "左半3片活格", classification: "adjustable_shelf", quantity: 3, evidence: "左半可見3道水平層板" },
      { region: "右半門面／開口", classification: "unknown", quantity: 1, evidence: "門向虛線覆蓋其上，但右半仍可見數條水平分段線" },
    ],
  };
  const errors = findInteriorCompletenessErrors(structure([cabinet]));
  assert.match(errors.join(" "), /層板逐片對照/);
  assert.match(errors.join(" "), /門片開向虛線.*不會.*水平層板消失/);
});

test("an affirmative F-centerline marker is never auto-promoted to an adjustable shelf", () => {
  const [normalized] = normalizeDeterministicInterior([{
    ...baseCabinet,
    componentRegions: [{ region: "F600水平板", classification: "unknown", sopRuleIds: ["R23"], quantity: 1, widthMm: 0, heightMm: 0, depthMm: 0, confidence: "high", evidence: "圖上清楚標註F600中心線，確認為固格位置。" }],
  }]);
  assert.equal(normalized.componentRegions[0].classification, "unknown");
  assert.equal(normalized.adjustableShelves, 0);
});

test("prints fixed-shelf formulas, F centerline positions and drawing annotations in notes", () => {
  const result = calculateSop([{ ...baseCabinet, fixedShelves: 1, fixedShelfPositionsMm: [552], drawingNotes: ["上18下9"] }]);
  const shelf = result.materials.find((row) => row.item === "固格");
  assert.equal(shelf.spec, "397 × 864");
  assert.match(shelf.note, /\[R13\/R23\].*D-29.*W-36.*F中心線位置552.*圖註：上18下9/);
});

test("calculates a middle divider from D-29 and its actual upper/lower connections", () => {
  const divider = {
    depthMm: 0, heightMm: 0, referenceSpanMm: 552,
    depthBasis: "standard_d_minus_29", heightBasis: "connection_span", region: "抽屜分隔區",
    topConnection: "top_board", bottomConnection: "fixed_shelf_centerline", evidence: "F552，上接頂板",
  };
  const cabinet = { ...baseCabinet, sideBySideDrawers: true, middleDividers: [divider] };
  const row = calculateSop([cabinet]).materials.find((item) => item.item === "中立板");
  assert.equal(row.spec, "397 × 525");
  assert.match(row.note, /\[R54-R59\].*D-29=426-29=397.*高552-18-9=525/);
  assert.equal(findInteriorCompletenessErrors(structure([cabinet])).some((error) => /中立板/.test(error)), false);
});

test("blocks a middle divider that lacks its span or connection basis", () => {
  const divider = {
    depthMm: 397, heightMm: 525, referenceSpanMm: 0,
    depthBasis: "unknown", heightBasis: "unknown", region: "抽屜分隔區",
    topConnection: "unknown", bottomConnection: "unknown", evidence: "只看見中立線",
  };
  const errors = findInteriorCompletenessErrors(structure([{ ...baseCabinet, sideBySideDrawers: true, middleDividers: [divider] }]));
  assert.match(errors.join(" "), /中立板.*D扣數.*上下接點/);
});

test("uses current back-strip thresholds for ordinary floor cabinets", () => {
  const low = calculateSop([{ ...baseCabinet, heightMm: 1200 }]);
  const middle = calculateSop([{ ...baseCabinet, heightMm: 1500 }]);
  const tall = calculateSop([{ ...baseCabinet, heightMm: 1900 }]);
  assert.equal(low.materials.some((row) => row.item === "背條"), false);
  assert.equal(middle.materials.find((row) => row.item === "背條").qty, 1);
  assert.equal(tall.materials.find((row) => row.item === "背條").qty, 2);
});

test("calculates 4E door as width by height and avoids double deductions", () => {
  const openingDoor = {
    type: "4E", count: 2, countBasis: "symbols", doorSymbols: ["<", ">"], openingWidthMm: 900, openingHeightMm: 700, finishedWidthMm: 0, finishedHeightMm: 0,
    dimensionBasis: "opening", direction: "mixed", jHandleCount: 0, slantedHandle: true, includesBottom30: false,
    slantedHandleCount: 2, slantedHandleStyle: "long", includesSlantedGap24: true, slantedGap24Context: "door_chain_included", hingeCountPerDoor: 3, evidence: "門面區內兩個開向符號<、>",
  };
  const finishedDoor = { ...openingDoor, count: 1, doorSymbols: ["<"], slantedHandleCount: 1, dimensionBasis: "finished", finishedWidthMm: 447, finishedHeightMm: 672, includesSlantedGap24: false, slantedGap24Context: "already_separate" };
  const opening = calculateSop([{ ...baseCabinet, doors: [openingDoor] }]);
  const finished = calculateSop([{ ...baseCabinet, doors: [finishedDoor] }]);
  assert.equal(opening.materials.find((row) => row.item === "4E門板").spec, "447 × 672");
  assert.equal(finished.materials.find((row) => row.item === "4E門板").spec, "447 × 672");
});

test("locks a resolved 24mm context so later AI passes cannot change or double-deduct it", () => {
  const lockedDoor = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: ["<"], openingWidthMm: 900, openingHeightMm: 700,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "opening", direction: "left", jHandleCount: 0,
    slantedHandle: true, slantedHandleCount: 1, slantedHandleStyle: "long", includesBottom30: false, includesSlantedGap24: true,
    slantedGap24Context: "door_chain_included", hingeCountPerDoor: 0, evidence: "門面總高包含2.4cm斜把縫",
  };
  const first = structure([{ ...baseCabinet, doors: [lockedDoor] }]);
  const locks = collectResolvedDoorGap24Locks(first);
  assert.equal(locks.length, 1);

  const overwritten = structure([{ ...baseCabinet, doors: [{
    ...lockedDoor,
    includesSlantedGap24: false,
    slantedGap24Context: "already_separate",
    evidence: "後續階段誤改",
  }] }]);
  const restored = restoreResolvedDoorGap24Locks(overwritten, locks);
  const door = restored.cabinets[0].doors[0];
  assert.equal(door.slantedGap24Context, "door_chain_included");
  assert.equal(door.includesSlantedGap24, true);
  assert.equal(calculateSop(restored).materials.find((row) => row.item === "4E門板").spec, "897 × 672");
});

test("closes an explicit includes-24 decision and does not start another completeness repair", () => {
  const door = normalizeDoorGap24Fields({
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"], openingWidthMm: 400, openingHeightMm: 700,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "opening", direction: "right", jHandleCount: 0,
    slantedHandle: true, slantedHandleCount: 1, slantedHandleStyle: "long", includesBottom30: false, includesSlantedGap24: true,
    slantedGap24Context: "unknown", hingeCountPerDoor: 0, evidence: "已辨識含24mm斜把縫",
  });
  assert.equal(door.slantedGap24Context, "door_chain_included");
  assert.equal(door.includesSlantedGap24, true);
  assert.equal(findInteriorCompletenessErrors(structure([{ ...baseCabinet, doors: [door] }])).some((error) => /24mm/.test(error)), false);
});

test("an unresolved 24mm relation stays advisory-only instead of triggering another AI repair", () => {
  const door = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: ["<"], openingWidthMm: 400, openingHeightMm: 700,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "opening", direction: "left", jHandleCount: 0,
    slantedHandle: true, slantedHandleCount: 1, slantedHandleStyle: "long", includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "unknown", hingeCountPerDoor: 0, evidence: "有斜把但尺寸鏈模糊",
  };
  assert.equal(findInteriorCompletenessErrors(structure([{ ...baseCabinet, doors: [door] }])).some((error) => /24mm/.test(error)), false);
  assert.match(calculateSop([{ ...baseCabinet, doors: [door] }]).notes.join(" "), /24mm斜把縫關係尚未閉合/);
});

test("blocks a width chain that does not close", () => {
  const result = validateCabinetStructure(structure([
    { ...baseCabinet, id: "C1", widthMm: 400 },
    { ...baseCabinet, id: "C2", widthMm: 800 },
    { ...baseCabinet, id: "C3", widthMm: 600 },
  ], {
    dimensionChains: [{ id: "W1", elevationId: "E1", axis: "width", totalMm: 2272, segmentsMm: [400, 800, 600, 24, 617], cabinetIds: ["C1", "C2", "C3"], status: "conflict", evidence: "底部尺寸鏈" }],
  }));
  assert.match(result.questions.join(" "), /尺寸鏈尚未閉合/);
});

const photographedElevationLedger = {
  imageViews: [{ imageName: "drawing.jpeg", viewKind: "door", elevationId: "E1", region: "全圖", rotationToUprightDeg: 270, notes: "照片需旋正" }],
  dimensions: [
    { id: "M_W40", valueMm: 400, orientation: "horizontal", kind: "module_width", rawText: "40" },
    { id: "M_W80", valueMm: 800, orientation: "horizontal", kind: "module_width", rawText: "80" },
    { id: "M_W60", valueMm: 600, orientation: "horizontal", kind: "module_width", rawText: "60" },
    { id: "M_H552", valueMm: 552, orientation: "vertical", kind: "door_height", rawText: "55.2" },
    { id: "M_G24", valueMm: 24, orientation: "vertical", kind: "slanted_handle_gap", rawText: "2.4" },
    { id: "M_H160", valueMm: 160, orientation: "vertical", kind: "door_height", rawText: "16" },
    { id: "M_H1631", valueMm: 1631, orientation: "vertical", kind: "cabinet_height", rawText: "163.1" },
  ],
};

test("recognizes an axis-aware ledger for a rotated photographed drawing", () => {
  assert.equal(hasAxisAwareLedger(photographedElevationLedger), true);
});

test("rejects the observed 55.2 + 2.4 + 16 vertical chain when it is reused as cabinet width", () => {
  const wrong = structure([
    { ...baseCabinet, id: "C_BAD", widthMm: 552, widthDimensionIds: ["M_H552"], heightDimensionIds: ["M_H1631"], evidence: "552寬，24厚水平板" },
  ], {
    dimensionLedger: photographedElevationLedger,
    summary: "用55.2+2.4+16建立736寬，並視為24厚水平板",
    dimensionChains: [{ id: "W_BAD", elevationId: "E1", axis: "width", totalMm: 736, segmentsMm: [552, 24, 160], dimensionIds: ["M_H552", "M_G24", "M_H160"], cabinetIds: ["C_BAD"], status: "matches", evidence: "錯把垂直鏈當寬度" }],
  });
  wrong.cabinets[0].widthChainId = "W_BAD";
  const errors = findSemanticEvidenceErrors(wrong);
  assert.match(errors.join(" "), /垂直尺寸禁止當寬度|但它是vertical尺寸/);
  assert.match(errors.join(" "), /552mm分段只出現在垂直尺寸證據/);
  assert.match(errors.join(" "), /24mm厚板/);
});

test("accepts the photographed drawing's horizontal 40 + 80 + 60 width chain", () => {
  const valid = structure([
    { ...baseCabinet, id: "C1", widthMm: 400, widthDimensionIds: ["M_W40"], heightDimensionIds: ["M_H552"] },
    { ...baseCabinet, id: "C2", widthMm: 800, widthDimensionIds: ["M_W80"], heightDimensionIds: ["M_H552"], widthOrder: 2 },
    { ...baseCabinet, id: "C3", widthMm: 600, widthDimensionIds: ["M_W60"], heightDimensionIds: ["M_H1631"], widthOrder: 3 },
  ], {
    dimensionLedger: photographedElevationLedger,
    dimensionChains: [{ id: "W1", elevationId: "E1", axis: "width", totalMm: 1800, segmentsMm: [400, 800, 600], dimensionIds: ["M_W40", "M_W80", "M_W60"], cabinetIds: ["C1", "C2", "C3"], status: "matches", evidence: "底部水平40+80+60" }],
  });
  assert.deepEqual(findSemanticEvidenceErrors(valid), []);
});

test("accepts 55.2 + 2.4 + 16 as a 736mm height chain, never as width", () => {
  const valid = structure([
    { ...baseCabinet, id: "C1", widthMm: 400, widthDimensionIds: ["M_W40"], heightMm: 736, heightDimensionIds: ["M_H552", "M_G24", "M_H160"] },
    { ...baseCabinet, id: "C2", widthMm: 800, widthDimensionIds: ["M_W80"], heightMm: 736, heightDimensionIds: ["M_H552", "M_G24", "M_H160"], widthOrder: 2 },
  ], {
    dimensionLedger: photographedElevationLedger,
    dimensionChains: [{ id: "H736", elevationId: "E1", axis: "height", totalMm: 736, segmentsMm: [552, 24, 160], dimensionIds: ["M_H552", "M_G24", "M_H160"], cabinetIds: ["C1", "C2"], status: "matches", evidence: "同向首尾相接的垂直鏈" }],
  });
  assert.deepEqual(findSemanticEvidenceErrors(valid), []);
});

test("deterministically binds cabinet dimensions and chains back to ledger IDs", () => {
  const input = structure([
    { ...baseCabinet, id: "C1", widthMm: 400, widthDimensionIds: [], heightMm: 736, heightDimensionIds: [], widthChainId: "" },
    { ...baseCabinet, id: "C2", widthMm: 800, widthDimensionIds: ["BAD"], heightMm: 736, heightDimensionIds: [], widthChainId: "", widthOrder: 2 },
  ], {
    dimensionLedger: photographedElevationLedger,
    dimensionChains: [{ id: "W1", elevationId: "E1", axis: "width", totalMm: 1800, segmentsMm: [400, 800, 600], dimensionIds: [], cabinetIds: ["C1", "C2"], status: "matches", evidence: "底部水平鏈" }],
  });
  const normalized = normalizeSemanticEvidence(input);
  assert.deepEqual(normalized.dimensionChains[0].dimensionIds, ["M_W40", "M_W80", "M_W60"]);
  assert.deepEqual(normalized.cabinets[0].widthDimensionIds, ["M_W40"]);
  assert.deepEqual(normalized.cabinets[0].heightDimensionIds, ["M_H552", "M_G24", "M_H160"]);
  assert.equal(normalized.cabinets[0].widthChainId, "W1");
  assert.equal(findSemanticEvidenceErrors(normalized).some((error) => /沒有綁定|不存在的尺寸ID/.test(error)), false);
});

test("does not mistake a negated 24mm thickness warning for a positive thickness claim", () => {
  const valid = structure([
    { ...baseCabinet, widthMm: 400, widthDimensionIds: ["M_W40"], heightDimensionIds: ["M_H552"], evidence: "2.4cm是斜把縫，不是24mm厚板" },
  ], { dimensionLedger: photographedElevationLedger, summary: "標準板厚18mm，禁止視為24mm厚板" });
  assert.equal(findSemanticEvidenceErrors(valid).some((error) => /24mm厚板/.test(error)), false);
});

test("material notes and internal evidence IDs never become blocking user questions", () => {
  const result = validateCabinetStructure(structure([{ ...baseCabinet }], {
    questions: ["請確認左上2.5#是否為材質或板種註記", "請提供尺寸ID以完成內部尺寸證據綁定"],
  }));
  assert.equal(result.questions.some((question) => /材質或板種註記|尺寸ID/.test(question)), false);
  assert.match(result.questions.join(" "), /踢腳板總長對照/);
});

test("a final audit cannot replace a result with more semantic evidence errors", () => {
  const baseline = structure([{ ...baseCabinet, widthMm: 400, widthDimensionIds: ["M_W40"], heightDimensionIds: ["M_H552"] }], { dimensionLedger: photographedElevationLedger });
  const worse = structure([{ ...baseCabinet, widthMm: 400, widthDimensionIds: [], heightDimensionIds: [] }], { dimensionLedger: photographedElevationLedger });
  assert.equal(selectBetterSemanticResult(baseline, worse, photographedElevationLedger), baseline);
});

test("a later audit cannot silently erase a populated cabinet interior", () => {
  const group = { id: "DG1", count: 1, openingWidthMm: 864, openingHeightMm: 160, drawerWallHeightMm: 100, isInner: false, sideBySide: false, usesCenterlineWidth: false, centerlineBoundaryCount: 0, slantedHandle: false, fixedShelfPositionMm: 0, evidence: "圖上抽屜" };
  const baseline = structure([{ ...baseCabinet, drawerCount: 1, fixedShelves: 1, drawerGroups: [group] }], { dimensionLedger: photographedElevationLedger });
  const emptied = structure([{ ...baseCabinet, drawerCount: 1, fixedShelves: 0, drawerGroups: [] }], { dimensionLedger: photographedElevationLedger });
  assert.equal(selectBetterSemanticResult(baseline, emptied, photographedElevationLedger), baseline);
});

test("blocks dismantling when drawers exist but their internal board data is incomplete", () => {
  const incomplete = structure([{ ...baseCabinet, drawerCount: 1, fixedShelves: 0, doors: [{ type: "4E", count: 1, hingeCountPerDoor: 0 }], drawerGroups: [{ id: "DG1", count: 1, openingWidthMm: 0, openingHeightMm: 0, drawerWallHeightMm: 0, isInner: false }] }]);
  const errors = findInteriorCompletenessErrors(incomplete);
  assert.match(errors.join(" "), /\[抽屜數量對照\].*抽屜格寬.*完成屜頭高度.*自動換算抽牆高/);
  assert.match(errors.join(" "), /實際固格/);
  assert.doesNotMatch(errors.join(" "), /\[鉸鍊數量對照\]/);
  assert.match(errors.join(" "), /\[4E門片數量對照\]/);
  assert.equal(validateCabinetStructure(incomplete).questions.filter((question) => /抽屜數量對照/.test(question)).length, 1);
});

test("removes stale hinge questions because the formal height schedule is automatic", () => {
  const door = (height, count = 1) => ({
    type: "4E", count, countBasis: "symbols", doorSymbols: Array.from({ length: count }, () => "<"), openingWidthMm: 0, openingHeightMm: 0, finishedWidthMm: 397, finishedHeightMm: height,
    dimensionBasis: "finished", direction: "left", jHandleCount: 0, slantedHandle: false,
    slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "none", hingeCountPerDoor: 0, evidence: `門面區內${count}個左開符號，門高${height}`,
  });
  const input = structure([
    { ...baseCabinet, id: "C01", doors: [door(548, 2)] },
    { ...baseCabinet, id: "C02", widthOrder: 2, doors: [door(548), door(1627)] },
  ], { questions: ["C01鉸鍊數請確認", "C02鉸鍊數請確認"] });
  const result = validateCabinetStructure(input);
  const hingeQuestions = result.questions.filter((question) => /鉸鍊/.test(question));
  assert.equal(hingeQuestions.length, 0);
  const hardware = calculateSop(result.cabinets).hardware.filter((row) => row.item === "GS鉸鍊");
  assert.equal(hardware.reduce((sum, row) => sum + row.qty, 0), 10);
});

test("one consolidated blocker replaces the duplicate API and calculation panels", () => {
  const merged = mergeBlockingIssues([
    "抽屜資料請一次補齊：抽牆高度—C01 DG1。",
    "C01 DG1 缺抽牆高度、格寬或可用深度，未自行補抽屜板料。",
    "4E門鉸鍊只需提供一次門高對照：門高548mm。",
    "C01門板鉸鍊需依門高規格表確認。",
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged.filter((item) => /抽牆|抽屜/.test(item)).length, 1);
  assert.equal(merged.filter((item) => /鉸鍊/.test(item)).length, 1);
});

test("accepts a fully specified drawer group and emits all drawer boards", () => {
  const group = { id: "DG1", count: 1, openingWidthMm: 864, openingHeightMm: 160, drawerWallHeightMm: 100, isInner: false, sideBySide: false, usesCenterlineWidth: false, centerlineBoundaryCount: 0, slantedHandle: false, fixedShelfPositionMm: 0, evidence: "圖上抽屜" };
  const cabinet = { ...baseCabinet, drawerCount: 1, fixedShelves: 1, drawerGroups: [group] };
  assert.deepEqual(findInteriorCompletenessErrors(structure([cabinet])), []);
  const items = calculateSop([cabinet]).materials.map((row) => row.item);
  assert.equal(items.includes("固格"), true);
  assert.equal(items.includes("前後抽牆"), true);
  assert.equal(items.includes("邊抽牆"), true);
  assert.equal(items.includes("抽底板"), true);
});

test("overwrites a stale manual drawer-wall value with the finished-front tier", () => {
  const group = { id: "DG1", count: 1, openingWidthMm: 864, openingHeightMm: 240, drawerWallHeightMm: 100, isInner: false, sideBySide: false, usesCenterlineWidth: false, centerlineBoundaryCount: 0, slantedHandle: false, fixedShelfPositionMm: 0, evidence: "完成屜頭240" };
  const normalized = normalizeDeterministicInterior([{ ...baseCabinet, drawerCount: 1, drawerGroups: [group] }]);
  assert.equal(normalized[0].drawerGroups[0].drawerWallHeightMm, 180);
  assert.match(normalized[0].drawerGroups[0].evidence, /240mm.*180mm/);
});

test("uses -99, -90 and -81 drawer deductions from the number of centerline boundaries", () => {
  const makeGroup = (id, count) => ({
    id, count: 1, openingWidthMm: 400, openingHeightMm: 160, drawerWallHeightMm: 100,
    isInner: false, sideBySide: count > 0, usesCenterlineWidth: count > 0, centerlineBoundaryCount: count,
    slantedHandle: false, fixedShelfPositionMm: 0, evidence: "抽屜格寬400",
  });
  const result = calculateSop([{ ...baseCabinet, drawerCount: 3, drawerGroups: [makeGroup("D99", 0), makeGroup("D90", 1), makeGroup("D81", 2)] }]);
  const specs = result.materials.filter((row) => row.item === "前後抽牆").map((row) => row.spec).sort();
  assert.deepEqual(specs, ["100 × 301", "100 × 310", "100 × 319"]);
  assert.match(result.materials.find((row) => row.spec === "100 × 310").note, /格寬400-90=310/);
});

test("inner drawers apply the centerline deduction first and then subtract 50mm", () => {
  const group = {
    id: "INNER", count: 1, openingWidthMm: 400, openingHeightMm: 160, drawerWallHeightMm: 100,
    isInner: true, sideBySide: true, usesCenterlineWidth: true, centerlineBoundaryCount: 1,
    slantedHandle: false, fixedShelfPositionMm: 552, evidence: "內抽，一側到中立中心線",
  };
  const result = calculateSop([{ ...baseCabinet, drawerCount: 1, innerDrawerCount: 1, fixedShelves: 1, fixedShelfPositionsMm: [552], drawerGroups: [group] }]);
  assert.equal(result.materials.find((row) => row.item === "內抽前後抽牆").spec, "100 × 260");
  assert.equal(result.hardware.find((row) => row.item === "三節滑軌 300").qty, 1);
  assert.match(result.materials.find((row) => row.item === "內抽前後抽牆").note, /400-90-50=260/);
});

test("calculates all fixed material and hardware quantities from one deterministic source", () => {
  const divider = {
    depthMm: 0, heightMm: 0, referenceSpanMm: 552,
    depthBasis: "standard_d_minus_29", heightBasis: "connection_span", region: "抽屜分隔區",
    topConnection: "top_board", bottomConnection: "fixed_shelf_centerline", evidence: "F552",
  };
  const group = {
    id: "DG1", count: 2, openingWidthMm: 400, openingHeightMm: 160, drawerWallHeightMm: 100,
    isInner: false, sideBySide: true, usesCenterlineWidth: true, centerlineBoundaryCount: 1,
    slantedHandle: false, fixedShelfPositionMm: 0, evidence: "兩抽",
  };
  const door = {
    type: "4E", count: 2, countBasis: "symbols", doorSymbols: ["<", ">"], openingWidthMm: 0, openingHeightMm: 0, finishedWidthMm: 397, finishedHeightMm: 548,
    dimensionBasis: "finished", direction: "mixed", jHandleCount: 0, slantedHandle: false,
    slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "none", hingeCountPerDoor: 3, evidence: "門面區內一左開、一右開符號",
  };
  const result = calculateSop({
    cabinets: [{ ...baseCabinet, fixedShelves: 2, adjustableShelves: 3, drawerCount: 2, sideBySideDrawers: true, middleDividers: [divider], drawerGroups: [group], doors: [door] }],
    mirrors: [{ id: "M1", count: 1, evidence: "一面明鏡" }],
  });
  const material = (item) => result.materials.find((row) => row.item === item)?.qty;
  const hardware = (item) => result.hardware.find((row) => row.item === item)?.qty;
  assert.equal(material("側板"), 2);
  assert.equal(material("頂底板"), 2);
  assert.equal(material("背板"), 1);
  assert.equal(material("固格"), 2);
  assert.equal(material("活格板"), 3);
  assert.equal(material("中立板"), 1);
  assert.equal(material("前後抽牆"), 4);
  assert.equal(material("邊抽牆"), 4);
  assert.equal(material("抽底板"), 2);
  assert.equal(hardware("KD"), 8);
  assert.equal(hardware("白固格器"), 12);
  assert.equal(hardware("活格利"), 12);
  assert.equal(hardware("A10"), 4);
  assert.equal(hardware("三節滑軌 350"), 2);
  assert.equal(hardware("抽木榫"), 32);
  assert.equal(hardware("油壓器"), 2);
  assert.equal(hardware("GS鉸鍊"), 4);
  assert.equal(hardware("鏡珠"), 4);
});

test("matches every material and hardware line in the supplied corrected BOM for storage cabinet 1", () => {
  const fullDivider = {
    depthMm: 0, heightMm: 0, referenceSpanMm: 1472,
    depthBasis: "standard_d_minus_29", heightBasis: "connection_span", region: "全高中立",
    topConnection: "top_board", bottomConnection: "bottom_board", evidence: "上18、下18",
  };
  const finishedDoor = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"], openingWidthMm: 0, openingHeightMm: 0,
    finishedWidthMm: 507, finishedHeightMm: 1468, dimensionBasis: "finished", direction: "right", jHandleCount: 0,
    slantedHandle: true, slantedHandleCount: 1, slantedHandleStyle: "long", includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "none", hingeCountPerDoor: 0, evidence: "門面葉片內>；完成門面507×1468；長斜把",
  };
  const widths = [360, 1000, 1000, 500];
  const cabinets = widths.map((width, index) => ({
    ...baseCabinet,
    id: `C0${index + 1}`, name: `第${index + 1}桶`, widthMm: width, widthOrder: index + 1,
    heightMm: 1472, depthMm: 350, adjustableShelves: width === 1000 ? 6 : 3,
    middleDividers: width === 1000 ? [fullDivider] : [],
    doors: width === 1000 ? [finishedDoor] : [],
    footHeightMm: 100, footState: "present", underCountertop: false,
  }));
  const result = calculateCompleteSop({
    cabinets,
    independentPanels: [{ id: "P01", name: "填縫板", count: 1, widthMm: 100, heightMm: 1472, thicknessMm: 18, grainDirection: "vertical", dimensionOrder: "width_height", note: "", evidence: "圖面填縫" }],
    kickboards: [{ id: "K01", siteLengthMm: 5900, evidence: "正確料單現場總長" }],
  });
  const materialLines = result.materials.map((row) => `${row.item}|${row.spec}|${row.qty}`).sort();
  const expectedMaterials = [
    "側板|350 × 1472|8",
    "頂底板|350 × 964|4", "頂底板|350 × 464|2", "頂底板|350 × 324|2",
    "中立板|321 × 1436|2",
    "活格板|310 × 472|12", "活格板|310 × 463|3", "活格板|310 × 323|3",
    "填縫板|100 × 1472|1",
    "4E門板|507 × 1468|2",
    "背板|974 × 1446|2", "背板|474 × 1446|1", "背板|334 × 1446|1",
    "踢腳板|120 × 2800|2", "踢腳板|120 × 800|1",
    "背條|110 × 964|2", "背條|110 × 464|1", "背條|110 × 324|1",
  ].sort();
  assert.deepEqual(materialLines, expectedMaterials);
  assert.equal(result.materials.reduce((sum, row) => sum + row.qty, 0), 50);

  const hardwareLines = result.hardware.map((row) => `${row.item}|${row.qty}`).sort();
  assert.deepEqual(hardwareLines, [
    "A10|18", "KD|32", "抽木榫|32", "白固格器|8", "活格利|72", "GS鉸鍊|6", "油壓器|2", "斜手把|2",
  ].sort());
  assert.equal(result.hardware.find((row) => row.item === "斜手把")?.qty, 2);
  assert.match(result.materials.find((row) => row.item === "4E門板").note, /長斜把×1.*完整模式另列斜手把五金/);
  assert.match(result.materials.find((row) => row.item === "踢腳板" && row.spec === "120 × 800").note, /餘長300\+固定預留500/);
});

test("same item and specification merge while preserving both cabinet notes", () => {
  const result = calculateSop([{ ...baseCabinet, id: "C1", name: "左櫃" }, { ...baseCabinet, id: "C2", name: "右櫃", widthOrder: 2 }]);
  const side = result.materials.find((row) => row.item === "側板");
  assert.equal(side.qty, 4);
  assert.match(side.note, /左櫃.*右櫃/);
});

test("every emitted material and hardware row carries an SOP rule trace", () => {
  const result = calculateSop([{ ...baseCabinet, fixedShelves: 1, adjustableShelves: 1 }]);
  assert.equal(result.materials.every((row) => /\[R\d/.test(row.note)), true);
  assert.equal(result.hardware.every((row) => /\[R\d/.test(row.note)), true);
});

test("internal evidence errors block output without becoming user questions", () => {
  const result = validateCabinetStructure(structure([{ ...baseCabinet, widthDimensionIds: [], heightDimensionIds: [] }], { dimensionLedger: photographedElevationLedger }));
  assert.equal(result.requiresSystemRetry, true);
  assert.equal(result.questions.some((question) => /尺寸ID|尺寸軸向硬檢查/.test(question)), false);
});

test("the photographed reference elevation cannot split the continuous 600mm column", () => {
  const fullLedger = {
    ...photographedElevationLedger,
    dimensions: [
      ...photographedElevationLedger.dimensions,
      { id: "M_H617", valueMm: 617, orientation: "vertical", kind: "door_height", rawText: "61.7" },
      { id: "M_H2272", valueMm: 2272, orientation: "vertical", kind: "total_height", rawText: "227.2" },
      { id: "M_D426", valueMm: 426, orientation: "note", kind: "depth", rawText: "D42.6" },
    ],
  };
  const wrong = structure([
    { ...baseCabinet, id: "C1", widthMm: 400, heightMm: 736, depthMm: 426 },
    { ...baseCabinet, id: "C2", widthMm: 800, heightMm: 736, depthMm: 426, widthOrder: 2 },
    { ...baseCabinet, id: "C3", widthMm: 600, heightMm: 1631, depthMm: 426, widthOrder: 3 },
    { ...baseCabinet, id: "C4", widthMm: 600, heightMm: 617, depthMm: 426, widthOrder: 3, cabinetKind: "stacked" },
  ], { dimensionLedger: fullLedger });
  assert.match(findSemanticEvidenceErrors(wrong).join(" "), /只能有3個桶身|連續側板禁止拆成上下兩桶/);

  const valid = structure([
    { ...baseCabinet, id: "C1", widthMm: 400, heightMm: 736, depthMm: 426 },
    { ...baseCabinet, id: "C2", widthMm: 800, heightMm: 736, depthMm: 426, widthOrder: 2 },
    { ...baseCabinet, id: "C3", widthMm: 600, heightMm: 2272, depthMm: 426, widthOrder: 3 },
  ], { dimensionLedger: fullLedger });
  assert.equal(findSemanticEvidenceErrors(valid).some((error) => /基準立面|W600桶身高度/.test(error)), false);
});

test("does not turn an unknown floor-cabinet foot state into zero hardware", () => {
  const cabinet = { ...baseCabinet, footState: "unknown", footHeightMm: 0 };
  const errors = findInteriorCompletenessErrors(structure([cabinet]));
  assert.match(errors.join(" "), /調整腳數量對照.*有無調整腳.*未知不是0個/);
  const result = calculateSop([cabinet]);
  assert.equal(result.hardware.some((row) => /A10|A12/.test(row.item)), false);
  assert.match(result.notes.join(" "), /目前未知（不是0個）.*請回答有／無/);
});

test("requires an explicit special-cabinet back-strip count even when the answer is zero", () => {
  const unknown = { ...baseCabinet, cabinetKind: "tv", specialBackStripState: "unknown", specialBackStripCount: 0 };
  assert.match(findInteriorCompletenessErrors(structure([unknown])).join(" "), /背條數量對照.*特殊櫃背條數.*未知不是0支/);
  const confirmed = { ...unknown, specialBackStripState: "confirmed" };
  assert.equal(findInteriorCompletenessErrors(structure([confirmed])).some((error) => /特殊櫃背條/.test(error)), false);
  assert.equal(calculateSop([confirmed]).materials.some((row) => row.item === "背條"), false);
});

test("counts every physical baffle segment and fixes standard baffle heights", () => {
  const oneOnly = {
    id: "BF1", heightMm: 60, widthMm: 400, kind: "drawer_60", widthBasis: "finished_segment",
    splitAtMiddleDivider: true, segmentGroupId: "BG1", segmentIndex: 1, segmentCount: 2, evidence: "中立左段",
  };
  assert.match(findInteriorCompletenessErrors(structure([{ ...baseCabinet, baffles: [oneOnly] }])).join(" "), /應有2支實體擋板/);
  const both = [oneOnly, { ...oneOnly, id: "BF2", widthMm: 464, segmentIndex: 2, evidence: "中立右段" }];
  assert.equal(findInteriorCompletenessErrors(structure([{ ...baseCabinet, baffles: both }])).some((error) => /擋板/.test(error)), false);
  assert.equal(calculateSop([{ ...baseCabinet, baffles: both }]).materials.filter((row) => row.item === "前上擋板").reduce((sum, row) => sum + row.qty, 0), 2);
  const wrongHeight = { ...oneOnly, splitAtMiddleDivider: false, segmentCount: 1, segmentGroupId: "", widthBasis: "cabinet_inner", widthMm: 0, heightMm: 50 };
  assert.match(findInteriorCompletenessErrors(structure([{ ...baseCabinet, baffles: [wrongHeight] }])).join(" "), /高度/);
});

test("blocks every incomplete divider and derives N minus one dividers for side-by-side drawers", () => {
  const incomplete = {
    depthMm: 0, heightMm: 0, referenceSpanMm: 552, depthBasis: "unknown", heightBasis: "unknown", region: "抽屜區",
    topConnection: "unknown", bottomConnection: "unknown", evidence: "只見線",
  };
  const incompleteCabinet = { ...baseCabinet, middleDividers: [incomplete] };
  assert.match(findInteriorCompletenessErrors(structure([incompleteCabinet])).join(" "), /中立板.*尚未完整/);
  assert.equal(calculateSop([incompleteCabinet]).hardware.some((row) => row.item === "固格器"), false);

  const complete = { ...incomplete, depthBasis: "standard_d_minus_29", heightBasis: "connection_span", topConnection: "top_board", bottomConnection: "fixed_shelf_centerline" };
  const group = { id: "DG3", count: 3, openingWidthMm: 864, openingHeightMm: 160, drawerWallHeightMm: 100, isInner: false, sideBySide: true, usesCenterlineWidth: true, centerlineBoundaryCount: 1, slantedHandle: false, fixedShelfPositionMm: 0, evidence: "三列並排" };
  const errors = findInteriorCompletenessErrors(structure([{ ...baseCabinet, drawerCount: 3, sideBySideDrawers: true, middleDividers: [complete], drawerGroups: [group] }]));
  assert.match(errors.join(" "), /並排3列需2片／已完整1片/);
});

test("closes drawer totals, inner-drawer totals and usable slide depth", () => {
  const group = { id: "DG1", count: 1, openingWidthMm: 864, openingHeightMm: 160, drawerWallHeightMm: 100, isInner: true, sideBySide: false, usesCenterlineWidth: false, centerlineBoundaryCount: 0, slantedHandle: false, fixedShelfPositionMm: 552, evidence: "一個內抽" };
  const zeroTotal = findInteriorCompletenessErrors(structure([{ ...baseCabinet, drawerCount: 0, innerDrawerCount: 0, drawerGroups: [group] }]));
  assert.match(zeroTotal.join(" "), /桶身總數0抽／逐組合計1抽/);
  assert.match(zeroTotal.join(" "), /桶身內抽0抽／逐組內抽1抽/);
  const shallow = findInteriorCompletenessErrors(structure([{ ...baseCabinet, depthMm: 300, drawerCount: 1, innerDrawerCount: 1, drawerGroups: [group] }]));
  assert.match(shallow.join(" "), /滑軌可用深度不足/);
});

test("closes door symbols, handle quantities and the 24mm gap context", () => {
  const door = {
    type: "4E", count: 2, countBasis: "symbols", doorSymbols: ["<"], openingWidthMm: 900, openingHeightMm: 700,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "opening", direction: "mixed", jHandleCount: 3,
    slantedHandle: true, slantedHandleCount: 3, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "unknown", hingeCountPerDoor: 2, evidence: "一個開向符號",
  };
  const errors = findInteriorCompletenessErrors(structure([{ ...baseCabinet, doors: [door] }]));
  assert.match(errors.join(" "), /數量2片／開向符號1個/);
  assert.doesNotMatch(errors.join(" "), /J把3／斜把3|24mm斜把縫扣法未確認|鉸鍊/);

  const baseOne = { ...door, count: 1, doorSymbols: ["<"], direction: "left", jHandleCount: 0, slantedHandle: false, slantedHandleCount: 0 };
  const included = calculateSop([{ ...baseCabinet, doors: [{ ...baseOne, includesSlantedGap24: true, slantedGap24Context: "door_chain_included" }] }]);
  const stacked = calculateSop([{ ...baseCabinet, doors: [{ ...baseOne, includesSlantedGap24: false, slantedGap24Context: "stacked_lift" }] }]);
  assert.equal(included.materials.find((row) => row.item === "4E門板").spec, "897 × 672");
  assert.equal(stacked.materials.find((row) => row.item === "4E門板").spec, "897 × 696");
});

test("a slanted door cannot enter production until its handle style is known", () => {
  const door = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"], openingWidthMm: 400, openingHeightMm: 700,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "opening", direction: "right", jHandleCount: 0,
    slantedHandle: true, slantedHandleCount: 1, slantedHandleStyle: "unknown", includesBottom30: false,
    includesSlantedGap24: false, slantedGap24Context: "already_separate", hingeCountPerDoor: 0, evidence: "只確定有斜把",
  };
  assert.match(findInteriorCompletenessErrors(structure([{ ...baseCabinet, doors: [door] }])).join(" "), /尚未確認上斜把／下斜把／長斜把/);
  const result = calculateCompleteSop({ cabinets: [{ ...baseCabinet, doors: [door] }] });
  assert.equal(result.materials.some((row) => row.item === "4E門板"), false);
  assert.equal(result.hardware.some((row) => /斜手把|鉸鍊|油壓器/.test(row.item)), false);
});

test("blocks unknown board deductions and accepts a complete user-confirmed nonstandard profile", () => {
  const unknownProfile = { ...standardBoardProfile, deductionBasis: "unknown", bodyThicknessMm: 19 };
  const unknown = { ...baseCabinet, boardProfile: unknownProfile };
  assert.match(findInteriorCompletenessErrors(structure([unknown])).join(" "), /板厚／扣數組合未通過/);
  assert.equal(calculateSop([unknown]).materials.length, 0);
  const customProfile = { ...standardBoardProfile, deductionBasis: "user_confirmed", bodyThicknessMm: 19, topBottomWidthDeductionMm: 38 };
  const custom = calculateSop([{ ...baseCabinet, boardProfile: customProfile }]);
  assert.equal(custom.materials.find((row) => row.item === "頂底板").spec, "426 × 862");
});

test("hard-checks original units before a converted dimension can enter a chain", () => {
  const ledger = {
    imageViews: [{ imageName: "x", viewKind: "internal", elevationId: "E1", region: "all", rotationToUprightDeg: 0, notes: "" }],
    dimensions: [
      { id: "M_W900", rawText: "90", sourceValue: 90, sourceUnit: "cm", valueMm: 900, orientation: "horizontal", kind: "module_width" },
      { id: "M_H800", rawText: "80", sourceValue: 80, sourceUnit: "cm", valueMm: 80, orientation: "vertical", kind: "cabinet_height" },
    ],
  };
  const input = structure([{ ...baseCabinet }], { dimensionLedger: ledger });
  assert.match(findSemanticEvidenceErrors(input).join(" "), /M_H800 單位換算不符.*應為800mm.*80mm/);
});

test("requires quantities for independent panels and detected special hardware", () => {
  const invalid = validateCabinetStructure(structure([baseCabinet], {
    independentPanels: [{ id: "P1", name: "封板", count: 0, widthMm: 100, heightMm: 800, thicknessMm: 18, grainDirection: "vertical", dimensionOrder: "height_width", note: "", evidence: "圖示" }],
    specialHardware: [{ item: "特殊吊架", qty: 0, unit: "", evidence: "圖註" }],
  }));
  assert.match(invalid.questions.join(" "), /P1.*片數尚未確認/);
  assert.match(invalid.questions.join(" "), /特殊吊架.*數量或單位尚未確認/);
  const calculated = calculateSop({ cabinets: [baseCabinet], independentPanels: [{ id: "P1", name: "封板", count: 2, widthMm: 100, heightMm: 800, thicknessMm: 18, grainDirection: "vertical", dimensionOrder: "height_width", note: "", evidence: "圖示" }] });
  assert.equal(calculated.materials.find((row) => row.item === "封板").qty, 2);
});

test("multi-elevation global items must retain a valid elevation before calculation", () => {
  const invalid = validateCabinetStructure(structure([
    { ...baseCabinet, id: "E1-C1", elevationId: "E01" },
    { ...baseCabinet, id: "E2-C1", elevationId: "E02" },
  ], {
    independentPanels: [{ id: "P1", elevationId: "", name: "封板", count: 1, widthMm: 100, heightMm: 800, thicknessMm: 18, grainDirection: "vertical", dimensionOrder: "height_width", note: "", evidence: "圖示" }],
    specialHardware: [{ elevationId: "E99", item: "特殊吊架", qty: 1, unit: "支", evidence: "圖註" }],
  }));
  assert.match(invalid.questions.join(" "), /立面歸屬.*P1.*特殊吊架.*跨立面不得合併/);
});

test("a numeric door callout deterministically produces the finished 4E size and door hardware", () => {
  const door = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: ["<"], openingWidthMm: 0, openingHeightMm: 0,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "unknown", direction: "left", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "none", hingeCountPerDoor: 0, evidence: "門面內清楚<",
    symbolRegions: [{ symbol: "<", cropName: "C02__door__p1.jpg", region: "左半門面", xPermille: 300, yPermille: 500, evidence: "尖端在左" }],
  };
  const result = validateCabinetStructure(structure([{ ...baseCabinet, id: "C02", name: "C02", doors: [door], drawingNotes: ["門509"] }]));
  assert.equal(result.questions.some((question) => /門板標記與完成尺寸|4E門尚未分清/.test(question)), false);
  assert.equal(result.cabinets[0].doors[0].dimensionBasis, "finished");
  assert.equal(result.cabinets[0].doors[0].finishedWidthMm, 507);
  assert.equal(result.cabinets[0].doors[0].finishedHeightMm, 796);
  const calculated = calculateSop({ cabinets: result.cabinets });
  const calculatedDoor = calculated.materials.find((row) => row.item === "4E門板");
  assert.equal(calculatedDoor.spec, "507 × 796");
  assert.equal(calculatedDoor.qty, 1);
  assert.equal(calculated.hardware.find((row) => row.item === "油壓器").qty, 1);
  assert.equal(calculated.hardware.find((row) => row.item === "GS鉸鍊").qty, 2);
});

test("an alphanumeric door callout remains a door type or identifier", () => {
  const door = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: ["<"], openingWidthMm: 0, openingHeightMm: 0,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "unknown", direction: "left", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "none", hingeCountPerDoor: 0, evidence: "門面內清楚<",
  };
  const result = validateCabinetStructure(structure([{ ...baseCabinet, id: "C02", name: "C02", doors: [door], drawingNotes: ["門A12"] }]));
  assert.match(result.questions.join(" "), /門板標記與完成尺寸/);
  assert.match(result.questions.join(" "), /門＋英文字母／代碼/);
});

test("numeric door height deducts a 24mm slanted gap exactly once when it belongs to the same chain", () => {
  const door = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"], openingWidthMm: 0, openingHeightMm: 0,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "unknown", direction: "right", jHandleCount: 0,
    slantedHandle: true, slantedHandleCount: 1, slantedHandleStyle: "long", includesBottom30: false, includesSlantedGap24: true,
    slantedGap24Context: "door_chain_included", hingeCountPerDoor: 0, evidence: "門面內清楚>；24mm在同一門高鏈",
  };
  const result = validateCabinetStructure(structure([{ ...baseCabinet, heightMm: 1472, doors: [door], drawingNotes: ["門509"] }]));
  assert.equal(result.cabinets[0].doors[0].finishedWidthMm, 507);
  assert.equal(result.cabinets[0].doors[0].finishedHeightMm, 1444);
  const calculated = calculateSop({ cabinets: result.cabinets });
  assert.equal(calculated.hardware.some((row) => row.item === "斜手把"), false);
  assert.match(calculated.materials.find((row) => row.item === "4E門板").note, /長斜把×1.*完整模式另列斜手把五金/);
});

test("detected edge trim automatically becomes a standard filler while kickboard length stays explicit", () => {
  const result = validateCabinetStructure(structure([{
    ...baseCabinet,
    componentRegions: [{ region: "腳座區", classification: "kickboard", sopRuleIds: ["R36"], quantity: 1, widthMm: 0, heightMm: 100, depthMm: 0, confidence: "medium", evidence: "圖上100mm離地區" }],
  }], {
    cropEvidenceHints: [{ cabinetId: "C01", region: "左外側另有一條與櫃身分離的全高牆／收口線；依SOP檢查是否存在獨立填縫板" }],
    independentPanels: [], kickboards: [],
  }));
  assert.equal(result.questions.some((question) => /獨立填縫板對照/.test(question)), false);
  assert.deepEqual(
    { name: result.independentPanels[0].name, count: result.independentPanels[0].count, widthMm: result.independentPanels[0].widthMm, heightMm: result.independentPanels[0].heightMm },
    { name: "填縫板", count: 1, widthMm: 100, heightMm: 800 },
  );
  assert.match(result.questions.join(" "), /踢腳板總長對照/);
  assert.match(result.questions.join(" "), /不可直接把桶寬合計900mm/);
});

test("left and right exterior trim lines count as two standard filler panels", () => {
  const result = validateCabinetStructure(structure([{ ...baseCabinet, id: "C01", heightMm: 1472 }], {
    cropEvidenceHints: [
      { cabinetId: "C01", region: "左外側另有一條與櫃身分離的全高牆／收口線" },
      { cabinetId: "C01", region: "右外側另有一條與櫃身分離的全高牆／收口線" },
    ],
  }));
  assert.deepEqual(
    { name: result.independentPanels[0].name, count: result.independentPanels[0].count, widthMm: result.independentPanels[0].widthMm, heightMm: result.independentPanels[0].heightMm },
    { name: "填縫板", count: 2, widthMm: 100, heightMm: 1472 },
  );
});

test("backend filler recovery never merges identical edge lines across elevations", () => {
  const result = validateCabinetStructure(structure([
    { ...baseCabinet, id: "E01-C01", elevationId: "E01", widthOrder: 1, heightMm: 1400 },
    { ...baseCabinet, id: "E02-C01", elevationId: "E02", widthOrder: 1, heightMm: 1400 },
  ], {
    cropEvidenceHints: [
      { cabinetId: "E01-C01", region: "左外側另有一條與牆分離的收口線" },
      { cabinetId: "E02-C01", region: "右外側另有一條與牆分離的收口線" },
      { cabinetId: "不存在", region: "左外側另有一條與牆分離的收口線" },
    ],
  }));
  assert.deepEqual(result.independentPanels.map((panel) => [panel.elevationId, panel.count, panel.heightMm]), [
    ["E01", 1, 1400], ["E02", 1, 1400],
  ]);
});

test("keeps every blocker instead of silently truncating the list at six", () => {
  const badDoor = { type: "4E", count: 0, countBasis: "unknown", doorSymbols: [], openingWidthMm: 0, openingHeightMm: 0, finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "unknown", direction: "unknown", jHandleCount: 2, slantedHandle: false, slantedHandleCount: 1, includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "unknown", hingeCountPerDoor: 0, evidence: "" };
  const bad = { ...baseCabinet, cabinetKind: "special", widthMm: 0, heightMm: 0, depthMm: 0, footState: "unknown", topBoardRetreatMm: 12, specialBackStripState: "unknown", boardProfile: { ...standardBoardProfile, deductionBasis: "unknown" }, doors: [badDoor], baffles: [{ id: "B", heightMm: 0, widthMm: 0, kind: "other", widthBasis: "unknown", splitAtMiddleDivider: true, segmentGroupId: "", segmentIndex: 1, segmentCount: 2, evidence: "" }] };
  const result = validateCabinetStructure(structure([bad], { independentPanels: [{ id: "P", name: "封板", count: 0, widthMm: 0, heightMm: 0 }], specialHardware: [{ item: "X", qty: 0, unit: "" }] }));
  assert.ok(result.questions.length > 6, `expected more than six blockers, got ${result.questions.length}`);
});

test("keeps all 30 formal quantity rules available while the visible table only shows applicable items", () => {
  assert.equal(quantityAuditCoverageIsComplete(), true);
  const rows = buildQuantityAudit({ cabinets: [{ ...baseCabinet, footState: "absent", footHeightMm: 0 }] });
  assert.deepEqual(rows.map((row) => row.item), ["側板", "頂板／底板", "背板", "KD", "抽木榫（桶身連接）"]);
});

test("shows existing back strips and unknown special strips but hides confirmed zero", () => {
  const rows = buildQuantityAudit({
    cabinets: [
      { ...baseCabinet, id: "LOW", heightMm: 1200 },
      { ...baseCabinet, id: "MID", heightMm: 1500 },
      { ...baseCabinet, id: "TALL", heightMm: 1900 },
      { ...baseCabinet, id: "TV-U", cabinetKind: "tv", specialBackStripState: "unknown", specialBackStripCount: 0 },
      { ...baseCabinet, id: "TV-0", cabinetKind: "tv", specialBackStripState: "confirmed", specialBackStripCount: 0 },
    ],
  });
  const strip = (scope) => rows.find((row) => row.scope === scope && row.item === "背條");
  assert.equal(strip("LOW"), undefined);
  assert.equal(strip("MID").current, "1支");
  assert.equal(strip("TALL").current, "2支");
  assert.equal(strip("TV-U").current, "未知（不是0支）");
  assert.equal(strip("TV-U").status, "needs_input");
  assert.equal(strip("TV-0"), undefined);
  assert.match(buildQuantityAuditBlockers(rows).join(" "), /\[背條數量對照\].*目前未知（不是0支）.*不能當 0 支/);
});

test("hides absent optional cabinet items from the summary", () => {
  assert.deepEqual(cabinetQuantitySummary({ ...baseCabinet, footState: "absent", footHeightMm: 0 }), [
    "側板 2片", "頂板 1片", "底板 1片", "背板 1片",
  ]);
  assert.deepEqual(cabinetQuantitySummary({ ...baseCabinet, heightMm: 1500, fixedShelves: 1, adjustableShelves: 2 }), [
    "側板 2片", "頂板 1片", "底板 1片", "背板 1片", "背條 1支", "固格 1片", "活格 2片",
  ]);
});

test("removes stale questions for components that are not present", () => {
  const issues = [
    "C1 的4E門尚未分清開口尺寸或完成門面尺寸。",
    "請補抽牆高度與抽屜格寬。",
    "C1 斜把擋板數量待確認。",
    "C1 調整腳有無待確認。",
    "C1 尚缺共用或個別深度。",
  ];
  const visible = filterApplicableBlockingIssues(issues, {
    cabinets: [{ ...baseCabinet, footState: "absent", footHeightMm: 0, doors: [], drawerGroups: [], baffles: [] }],
  });
  assert.deepEqual(visible, ["C1 尚缺共用或個別深度。"]) ;
});

test("door-only gaps become one non-blocking reminder while cabinet materials can continue", () => {
  const issues = [
    "C01、C02 的4E門尚未分清開口尺寸或完成門面尺寸，不能安全套用-3／-4。",
    "C01 已鎖定1片<／>門片；門尺寸或24mm斜把縫關係尚未閉合，所以只暫停該門板尺寸與門用五金，不取消片數。",
  ];
  const analysis = { cabinets: [
    { ...baseCabinet, id: "C01", doors: [{ type: "4E", count: 1 }] },
    { ...baseCabinet, id: "C02", doors: [{ type: "4E", count: 1 }] },
  ] };
  const applicable = filterApplicableBlockingIssues(issues, analysis);
  assert.deepEqual(filterBlockingIssues(issues, analysis), []);
  const reminders = mergeDoorAdvisoryIssues(applicable);
  assert.equal(reminders.length, 1);
  assert.match(reminders[0], /C01、C02.*開口尺寸／完成門面尺寸.*24mm斜把縫關係/);
  assert.match(reminders[0], /桶身及其他已確認料件照常拆料/);
});

test("a stale request for an already locked door count and direction is removed", () => {
  const lockedDoor = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: ["<"], openingWidthMm: 0, openingHeightMm: 0,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "unknown", direction: "left", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "none", hingeCountPerDoor: 0, evidence: "第一輪清楚符號已鎖定",
  };
  const result = validateCabinetStructure(structure([{ ...baseCabinet, doors: [lockedDoor], drawingNotes: ["門509"], doorLock: { locked: true, status: "confirmed_4e", attemptsUsed: 1, evidence: "第一輪鎖定" } }], {
    questions: [
      "請補此桶門片的已鎖定結果：門片片數、左右開向，以及是否為4E門。",
      "C01、C04 是否有門片無法由現有裁切可靠確認；若需要門板與門五金，請補各門面近距離裁切。",
    ],
  }));
  assert.equal(result.questions.some((question) => /已鎖定結果|門片片數、左右開向|無法由現有裁切可靠確認/.test(question)), false);
  assert.equal(result.questions.some((question) => /門板標記與完成尺寸|4E門尚未分清/.test(question)), false);
  assert.equal(result.cabinets[0].doors[0].finishedWidthMm, 507);
  assert.equal(result.cabinets[0].doors[0].finishedHeightMm, 796);
});

test("a door scan failure remains visible even when no door was added", () => {
  const issue = "C03 無法偵測門板，門板掃描已提早結束；其他尺寸與桶內結構照常顯示。";
  const analysis = { cabinets: [{ ...baseCabinet, id: "C03", doors: [] }] };
  assert.deepEqual(filterBlockingIssues([issue], analysis), []);
  assert.deepEqual(mergeDoorAdvisoryIssues(filterApplicableBlockingIssues([issue], analysis)), [
    "C03 無法偵測門板；本次不列該桶門板與門用五金，桶身及其他已確認料件照常拆料。",
  ]);
});

test("automatically restores the one top-region divider proven by H736 and F552", () => {
  const group = {
    id: "DG-TOP", count: 2, openingWidthMm: 764, openingHeightMm: 160, drawerWallHeightMm: 100,
    isInner: false, sideBySide: true, usesCenterlineWidth: true, centerlineBoundaryCount: 1,
    slantedHandle: false, fixedShelfPositionMm: 552, regionPosition: "top", evidence: "上方兩抽並排",
  };
  const cabinet = { ...baseCabinet, id: "C2", widthMm: 800, heightMm: 736, fixedShelves: 1, fixedShelfPositionsMm: [552], drawerCount: 2, sideBySideDrawers: true, drawerGroups: [group], middleDividers: [] };
  const normalized = normalizeDeterministicInterior([cabinet]);
  assert.equal(normalized[0].middleDividers.length, 1);
  const divider = normalized[0].middleDividers[0];
  assert.equal(divider.referenceSpanMm, 184);
  const material = calculateSop(normalized).materials.find((row) => row.item === "中立板");
  assert.equal(material.spec, "397 × 157");
  const validated = validateCabinetStructure(structure([cabinet]));
  assert.equal(validated.questions.some((question) => /中立/.test(question)), false);
});

test("removes a stale AI divider question after the backend has completed that divider", () => {
  const group = {
    id: "DG-TOP", count: 2, openingWidthMm: 764, openingHeightMm: 160, drawerWallHeightMm: 100,
    isInner: false, sideBySide: true, usesCenterlineWidth: true, centerlineBoundaryCount: 1,
    slantedHandle: false, fixedShelfPositionMm: 552, regionPosition: "top", evidence: "上方兩抽並排",
  };
  const cabinet = { ...baseCabinet, id: "C2", widthMm: 800, heightMm: 736, fixedShelves: 1, fixedShelfPositionsMm: [552], drawerCount: 2, sideBySideDrawers: true, drawerGroups: [group], middleDividers: [] };
  const result = validateCabinetStructure(structure([cabinet], {
    questions: ["C2 的中立板D扣數、完成深度、實際跨度或上下接點尚未完整，請確認。"],
  }));
  assert.equal(result.questions.some((question) => /中立/.test(question)), false);
  assert.equal(result.cabinets[0].middleDividers.length, 1);
});

test("does not close a door count from geometry without visible symbols", () => {
  const door = {
    type: "4E", count: 2, countBasis: "unknown", doorSymbols: [], openingWidthMm: 800, openingHeightMm: 552,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "opening", direction: "unknown", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "unknown", hingeCountPerDoor: 2, evidence: "逐片獨立門面；第1片：左側門格有獨立框線；第2片：右側門格有獨立框線，兩片互不重疊",
  };
  const result = validateCabinetStructure(structure([{ ...baseCabinet, doors: [door] }], {
    questions: ["C1 4E門片數量或開向依據未閉合。", "C1 24mm斜把縫扣法未確認。"],
  }));
  assert.equal(result.cabinets[0].doors[0].countBasis, "unknown");
  assert.equal(result.cabinets[0].doors[0].slantedGap24Context, "none");
  assert.equal(result.questions.some((question) => /4E門片數量/.test(question)), true);
  assert.equal(result.questions.some((question) => /24mm/.test(question)), false);
});

test("counts clear door symbols even when the AI left the count at zero", () => {
  const door = {
    type: "4E", count: 0, countBasis: "unknown", doorSymbols: ["<", ">"], openingWidthMm: 800, openingHeightMm: 552,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "opening", direction: "unknown", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "unknown", hingeCountPerDoor: 2, evidence: "圖上有兩個開向符號",
  };
  const result = validateCabinetStructure(structure([{ ...baseCabinet, doors: [door] }]));
  assert.equal(result.cabinets[0].doors[0].count, 2);
  assert.equal(result.cabinets[0].doors[0].countBasis, "symbols");
  assert.equal(result.cabinets[0].doors[0].direction, "mixed");
  assert.equal(result.questions.some((question) => /4E門片數量/.test(question)), false);
});

test("rejects door-leaf geometry as a count basis even when the rectangle is precise", () => {
  const door = {
    type: "4E", count: 2, countBasis: "leaf_geometry", doorSymbols: [], openingWidthMm: 800, openingHeightMm: 552,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "opening", direction: "unknown", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "none", hingeCountPerDoor: 2, evidence: "逐片獨立門面；第1片：左側門格有獨立框線；第2片：右側門格有獨立框線，兩片互不重疊",
  };
  const result = validateCabinetStructure(structure([{ ...baseCabinet, doors: [door] }]));
  assert.equal(result.questions.some((question) => /4E門片數量/.test(question)), true);
  const audit = buildQuantityAudit({ cabinets: result.cabinets });
  assert.equal(audit.find((row) => row.item === "4E門片").status, "needs_input");
});

test("forces a baffle mounted on a fixed shelf to 60mm instead of retaining door_50", () => {
  const baffle = {
    id: "B3", heightMm: 50, widthMm: 0, kind: "door_50", mountBasis: "fixed_shelf", widthBasis: "cabinet_inner",
    splitAtMiddleDivider: false, segmentGroupId: "", segmentIndex: 1, segmentCount: 1, evidence: "圖面鎖在固格",
  };
  const normalized = normalizeDeterministicInterior([{ ...baseCabinet, baffles: [baffle] }]);
  assert.equal(normalized[0].baffles[0].heightMm, 60);
  assert.equal(normalized[0].baffles[0].kind, "drawer_60");
  assert.equal(calculateSop(normalized).materials.find((row) => row.item === "前上擋板").spec, "60 × 864");
});

test("uses the formal hinge formula without asking for a per-door count", () => {
  const door = {
    type: "4E", count: 3, countBasis: "symbols", doorSymbols: ["<", ">", ">"], openingWidthMm: 0, openingHeightMm: 0,
    finishedWidthMm: 397, finishedHeightMm: 548, dimensionBasis: "finished", direction: "mixed", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "none", hingeCountPerDoor: 0, evidence: "逐片獨立門面；第1片：左側；第2片：中間；第3片：右側，三片門面框線互不重疊",
  };
  const rows = buildQuantityAudit({ cabinets: [{ ...baseCabinet, doors: [door] }] });
  const hinge = rows.find((row) => row.item === "鉸鍊（門高548mm）");
  assert.equal(hinge.current, "3片門 × 2顆 = 6顆");
  assert.equal(hinge.status, "automatic");
  assert.doesNotMatch(buildQuantityAuditBlockers(rows).join(" "), /鉸鍊/);
});

test("does not accept a vague door-like rectangle as closed leaf geometry", () => {
  const vague = {
    type: "4E", count: 1, countBasis: "leaf_geometry", doorSymbols: [],
    evidence: "看起來像一片門，看到一個矩形區域",
  };
  const precise = {
    ...vague,
    evidence: "逐片獨立門面；第1片：右側下方門格有獨立框線與開門弧",
  };
  assert.equal(doorCountEvidenceIsClosed(vague), false);
  assert.equal(doorCountEvidenceIsClosed(precise), false);
});

test("a partial door audit locks every clear symbol without waiting for dimensions", () => {
  const confirmedDoor = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"], openingWidthMm: 0, openingHeightMm: 0,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "unknown", direction: "right", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "unknown", hingeCountPerDoor: 0, evidence: "門面區內右開符號>",
    symbolRegions: [{ symbol: ">", cropName: "C1__door__p2_下.png", region: "右下門面", xPermille: 630, yPermille: 570, evidence: "門面葉片內右開符號" }],
  };
  const audited = applyDoorRecognition(structure([{ ...baseCabinet, doors: [confirmedDoor] }]), {
    cabinetDoors: [{
      cabinetId: "C1", status: "partial", sourceImageName: "door.jpeg", region: "C1門面", doors: [confirmedDoor],
      excludedSurfaces: [{ classification: "drawer_front", region: "上方", evidence: "圖上標抽" }],
      unresolvedDoorRegions: ["右側另一門樣區"], confidence: "medium", evidence: "只閉合一個符號，其餘門樣區仍模糊",
    }],
    unresolved: ["C1右側另一門樣區"],
  });
  const validated = validateCabinetStructure(audited);
  assert.doesNotMatch(validated.questions.join(" "), /4E門片數量對照/);
  assert.match(validated.questions.join(" "), /開口尺寸.*完成門面尺寸/);
  assert.equal(validated.cabinets[0].doors.length, 1);
  assert.equal(validated.cabinets[0].doors[0].doorSymbols[0], ">");
  assert.equal(validated.cabinets[0].doorLock.locked, true);
  assert.match(validated.warnings.join(" "), /已鎖定1片清楚的<／>門片.*不會清除/);
  const auditRows = buildQuantityAudit({ cabinets: validated.cabinets });
  assert.equal(auditRows.find((row) => row.item === "4E門片").status, "confirmed");
  assert.equal(auditRows.some((row) => /鉸鍊|油壓器|斜手把|J型手把/.test(row.item)), false);
});

test("later dimension reading fills a symbol-locked door without changing its symbols", () => {
  const symbolDoor = {
    type: "4E", count: 2, countBasis: "symbols", doorSymbols: ["<", ">"], openingWidthMm: 0, openingHeightMm: 0,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "unknown", direction: "mixed", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "unknown", hingeCountPerDoor: 0, evidence: "只鎖定兩個符號",
    symbolRegions: [
      { symbol: "<", cropName: "C1__door__p3_左下.png", region: "左門", xPermille: 440, yPermille: 520, evidence: "左門葉片內<" },
      { symbol: ">", cropName: "C1__door__p3_右下.png", region: "右門", xPermille: 560, yPermille: 520, evidence: "右門葉片內>" },
    ],
  };
  const dimensionDoor = {
    ...symbolDoor,
    doorSymbols: [">", ">"],
    direction: "right",
    openingWidthMm: 800,
    openingHeightMm: 552,
    dimensionBasis: "opening",
    slantedGap24Context: "none",
    evidence: "後續尺寸鏈確認800×552開口",
  };
  const audit = { cabinetDoors: [{ cabinetId: "C1", status: "partial", doors: [symbolDoor], unresolvedDoorRegions: [], attemptsUsed: 3 }], unresolved: [] };
  const restored = restoreLockedDoors(structure([{ ...baseCabinet, doors: [dimensionDoor] }]), audit);
  const door = restored.cabinets[0].doors[0];
  assert.deepEqual(door.doorSymbols, ["<", ">"]);
  assert.equal(door.direction, "mixed");
  assert.equal(door.openingWidthMm, 800);
  assert.equal(door.openingHeightMm, 552);
  assert.equal(door.slantedGap24Context, "none");
  assert.equal(door.hingeCountPerDoor, 2);
});

test("later structure reading preserves slanted-handle style through the symbol lock", () => {
  const symbolDoor = {
    type: "4E", count: 2, countBasis: "symbols", doorSymbols: ["<", ">"], openingWidthMm: 0, openingHeightMm: 0,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "unknown", direction: "mixed", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, slantedHandleStyle: "unknown",
    includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "unknown", hingeCountPerDoor: 0,
    evidence: "只鎖定兩個門向符號",
    symbolRegions: [
      { symbol: "<", cropName: "C1__door__p3_左下.png", region: "左門", xPermille: 420, yPermille: 520, evidence: "左門葉片內<" },
      { symbol: ">", cropName: "C1__door__p3_右下.png", region: "右門", xPermille: 580, yPermille: 520, evidence: "右門葉片內>" },
    ],
  };
  const detailDoor = {
    ...symbolDoor,
    doorSymbols: [">", ">"], direction: "right",
    openingWidthMm: 920, openingHeightMm: 640, dimensionBasis: "opening",
    slantedHandle: true, slantedHandleCount: 2, slantedHandleStyle: "top",
    slantedGap24Context: "already_separate", evidence: "後段局部裁切確認兩片上斜把",
  };
  const audit = { cabinetDoors: [{ cabinetId: "C1", status: "confirmed_4e", doors: [symbolDoor], unresolvedDoorRegions: [], attemptsUsed: 3 }], unresolved: [] };
  const restored = restoreLockedDoors(structure([{ ...baseCabinet, doors: [detailDoor] }]), audit);
  const door = restored.cabinets[0].doors[0];
  assert.deepEqual(door.doorSymbols, ["<", ">"]);
  assert.equal(door.slantedHandleStyle, "top");
  assert.equal(door.slantedHandleCount, 2);
  assert.equal(calculateCompleteSop(restored).hardware.find((row) => row.item === "斜手把")?.qty, 2);
});

test("a confirmed symbol-and-dimension door lock survives every later overwrite", () => {
  const lockedDoor = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"], openingWidthMm: 400, openingHeightMm: 552,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "opening", direction: "right", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "none", hingeCountPerDoor: 0, evidence: "放大裁切內右開符號>與400×552開口尺寸線均清楚",
    symbolRegions: [{ symbol: ">", cropName: "C1__door__p2_下.jpg", region: "右下門面", xPermille: 630, yPermille: 570, evidence: "門面葉片內右開符號" }],
  };
  const audit = { cabinetDoors: [{ cabinetId: "C1", status: "confirmed_4e", sourceImageName: "C1__door.jpg", region: "全門面", doors: [lockedDoor], excludedSurfaces: [], unresolvedDoorRegions: [], confidence: "high", evidence: "像素與尺寸閉合", attemptsUsed: 2 }], unresolved: [] };
  const overwritten = structure([{ ...baseCabinet, doors: [] }]);
  const restored = restoreLockedDoors(overwritten, audit);
  assert.equal(restored.cabinets[0].doors.length, 1);
  assert.equal(restored.cabinets[0].doors[0].countBasis, "symbols");
  assert.equal(restored.cabinets[0].doors[0].hingeCountPerDoor, 2);
  assert.equal(restored.cabinets[0].doorLock.locked, true);
});

test("a door symbol cannot lock unless every pixel has a crop name and coordinate", () => {
  const door = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"], openingWidthMm: 400, openingHeightMm: 552,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "opening", direction: "right", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
    slantedGap24Context: "none", hingeCountPerDoor: 0, evidence: "只寫有符號，未標裁圖位置",
    symbolRegions: [],
  };
  const read = { cabinetId: "C1", status: "confirmed_4e", doors: [door], unresolvedDoorRegions: [] };
  assert.equal(lockableDoorRead(read).locked, false);
});

test("one detected pixel cannot be duplicated into two door leaves", () => {
  const duplicateDoor = {
    type: "4E", count: 2, countBasis: "symbols", doorSymbols: ["<", "<"], direction: "left",
    symbolRegions: [
      { symbol: "<", cropName: "p1.png", region: "左門", xPermille: 400, yPermille: 500, evidence: "第一筆" },
      { symbol: "<", cropName: "p1.png", region: "左門", xPermille: 412, yPermille: 506, evidence: "同一像素重複" },
    ],
  };
  assert.equal(lockableDoorRead({ status: "confirmed_4e", doors: [duplicateDoor] }).locked, false);
});

test("a locked door direction is derived from symbols instead of the model label", () => {
  const door = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: ["<"], direction: "right",
    symbolRegions: [{ symbol: "<", cropName: "p1.png", region: "左門", xPermille: 300, yPermille: 500, evidence: "尖端在左" }],
  };
  const resolution = lockableDoorRead({ status: "confirmed_4e", doors: [door] });
  assert.equal(resolution.status, "confirmed_4e");
  assert.equal(resolution.doors[0].direction, "left");
});

test("door evidence may only cite crops that were actually sent", () => {
  const read = {
    doors: [{ symbolRegions: [{ symbol: ">", cropName: "invented.png", region: "右門", xPermille: 700, yPermille: 500, evidence: "符號" }] }],
  };
  assert.equal(doorReadUsesOnlyKnownSymbolCrops(read, ["actual.png"]), false);
  assert.equal(doorReadUsesOnlyKnownSymbolCrops(read, ["invented.png"]), true);
});

test("the first clear door direction cannot be flipped by a later enhanced crop", () => {
  const read = (symbol, status, cropName) => ({
    cabinetId: "C02", status, unresolvedDoorRegions: status === "partial" ? ["其餘區域待掃"] : [],
    doors: [{
      type: "4E", count: 1, countBasis: "symbols", doorSymbols: [symbol], openingWidthMm: 0, openingHeightMm: 0,
      finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "unknown", direction: symbol === "<" ? "left" : "right",
      jHandleCount: 0, slantedHandle: false, slantedHandleCount: 0, includesBottom30: false, includesSlantedGap24: false,
      slantedGap24Context: "unknown", hingeCountPerDoor: 0, evidence: `${symbol}清楚`,
      symbolRegions: [{ symbol, cropName, region: "門面葉片中央", xPermille: 500, yPermille: 500, evidence: `${symbol}像素` }],
    }],
  });
  const merged = preserveFirstDoorSymbolLock(read("<", "partial", "p1.jpg"), read(">", "confirmed_4e", "p2.png"));
  assert.deepEqual(merged.doors[0].doorSymbols, ["<"]);
  assert.equal(merged.doors[0].direction, "left");
  assert.equal(merged.symbolConflictRejected, true);
  assert.equal(lockableDoorRead(merged).locked, true);
});

test("a later door crop may add a new symbol only when it retains every prior lock", () => {
  const firstDoor = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: ["<"], direction: "left", symbolRegions: [{ symbol: "<", cropName: "p1.jpg", region: "左門", xPermille: 300, yPermille: 500, evidence: "<" }],
  };
  const expandedDoor = {
    type: "4E", count: 2, countBasis: "symbols", doorSymbols: ["<", ">"], direction: "mixed", symbolRegions: [
      { symbol: "<", cropName: "p1.jpg", region: "左門", xPermille: 300, yPermille: 500, evidence: "<" },
      { symbol: ">", cropName: "p2.png", region: "右門", xPermille: 700, yPermille: 500, evidence: ">" },
    ],
  };
  const merged = preserveFirstDoorSymbolLock({ cabinetId: "C1", status: "partial", doors: [firstDoor], unresolvedDoorRegions: ["右門"] }, { cabinetId: "C1", status: "confirmed_4e", doors: [expandedDoor], unresolvedDoorRegions: [] });
  assert.deepEqual(merged.doors[0].doorSymbols, ["<", ">"]);
  assert.equal(merged.firstSymbolLockPreserved, true);
});

test("a confirmed no-4E audit removes false doors without changing body structure", () => {
  const falseDoor = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"], openingWidthMm: 400, openingHeightMm: 552,
    finishedWidthMm: 0, finishedHeightMm: 0, dimensionBasis: "opening", direction: "right", jHandleCount: 0,
    slantedHandle: true, slantedHandleCount: 1, includesBottom30: false, includesSlantedGap24: true,
    slantedGap24Context: "door_chain_included", hingeCountPerDoor: 2, evidence: "先前誤判",
  };
  const result = applyDoorRecognition(structure([{ ...baseCabinet, doors: [falseDoor], baffles: [{ id: "B1" }], topBoardRetreatMm: 19 }]), {
    cabinetDoors: [{
      cabinetId: "C1", status: "confirmed_no_4e", sourceImageName: "internal.jpeg", region: "C1", doors: [],
      excludedSurfaces: [{ classification: "drawer_front", region: "上方", evidence: "圖上標抽" }],
      unresolvedDoorRegions: [], confidence: "high", evidence: "本次圖面只有抽面，沒有4E門符號或門面葉片",
    }],
    unresolved: [],
  });
  assert.equal(result.cabinets[0].doors.length, 0);
  assert.equal(result.cabinets[0].baffles.length, 1);
  assert.equal(result.cabinets[0].topBoardRetreatMm, 19);
});
