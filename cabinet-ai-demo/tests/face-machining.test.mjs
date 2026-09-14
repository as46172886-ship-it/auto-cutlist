import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFaceMachining,
  faceMachiningReadIsComplete,
  prepareCarcassStage,
} from "../app/face-machining.ts";
import { calculateCompleteSop } from "../app/sop.ts";

const boardProfile = {
  bodyThicknessMm: 18, backThicknessMm: 8, drawerBottomThicknessMm: 8, deductionBasis: "standard_sop",
  topBottomWidthDeductionMm: 36, backWidthDeductionMm: 26, backHeightDeductionMm: 26,
  fixedShelfDepthDeductionMm: 29, fixedShelfWidthDeductionMm: 36,
  adjustableShelfDepthDeductionMm: 40, adjustableShelfWidthDeductionMm: 37,
};

const drawer = (overrides = {}) => ({
  id: "DG1", count: 1, openingWidthMm: 460, openingHeightMm: 201, drawerWallHeightMm: 0,
  isInner: false, sideBySide: false, usesCenterlineWidth: false, centerlineBoundaryCount: 0,
  slantedHandle: false, fixedShelfPositionMm: 0, regionPosition: "top", evidence: "單格460、完成屜頭201",
  ...overrides,
});

const symbolRegion = (symbol = "<") => ({
  symbol, cropName: "face.png", region: "門面中央", xPermille: 500, yPermille: 500, evidence: `原圖${symbol}`,
});

const door = (slantedHandle, style = "none") => ({
  type: "4E", count: 1, countBasis: "symbols", doorSymbols: ["<"], symbolRegions: [symbolRegion()],
  openingWidthMm: 0, openingHeightMm: 0, finishedWidthMm: 457, finishedHeightMm: 636,
  dimensionBasis: "finished", direction: "left", jHandleCount: 0,
  slantedHandle, slantedHandleCount: slantedHandle ? 1 : 0, slantedHandleStyle: style,
  includesBottom30: false, includesSlantedGap24: false,
  slantedGap24Context: slantedHandle ? "already_separate" : "none",
  hingeCountPerDoor: 0, evidence: slantedHandle ? "原圖上門斜把" : "原圖普通門",
});

function cabinet(overrides = {}) {
  return {
    id: "C01", name: "門面流程測試桶", cabinetKind: "floor", elevationId: "E01", widthChainId: "W1", widthOrder: 1,
    widthMm: 920, heightMm: 736, depthMm: 500, depthGroupId: "D1", depthSource: "explicit", depthEvidence: "D500",
    isHanging: false, underCountertop: false, fixedShelves: 0, fixedShelfPositionsMm: [], adjustableShelves: 0,
    slantedFixedShelfCount: 0, drawerCount: 1, sideBySideDrawers: false, innerDrawerCount: 0,
    footHeightMm: 100, footState: "present", topBoardRetreatMm: 0, bottomBoardRetreatMm: 0,
    specialBackStripCount: 0, specialBackStripState: "not_applicable", boardProfile,
    middleDividers: [], baffles: [], drawerGroups: [drawer()], doors: [], drawingNotes: [], confidence: "high", evidence: "完整桶身",
    ...overrides,
  };
}

const crop = {
  name: "face.png", dataUrl: "data:image/png;base64,AA==", cabinetId: "C01", cropId: "C01-face",
  role: "door", sourceImageName: "drawing.png", region: "完整門面", scanPass: 1,
};

const effect = (overrides = {}) => ({
  openingId: "OPEN-1", sourceType: "drawer", sourceIndex: 0,
  targetBoard: "bottom", baffleMount: "raised_bottom", widthBasis: "cabinet_inner", widthMm: 0,
  segmentIndex: 1, segmentCount: 1, cropName: "face.png", evidence: "原圖屜頭下方斜把及上升底板",
  ...overrides,
});

test("carcass stage removes every face-derived value without mutating its input", () => {
  const source = { cabinets: [cabinet({
    fixedShelves: 2, slantedFixedShelfCount: 1,
    topBoardRetreatMm: 19, bottomBoardRetreatMm: 19,
    baffles: [{ id: "OLD" }], drawerGroups: [drawer({ slantedHandle: true })],
  })], warnings: ["保留"] };
  const actual = prepareCarcassStage(source);
  assert.deepEqual([
    actual.cabinets[0].topBoardRetreatMm,
    actual.cabinets[0].bottomBoardRetreatMm,
    actual.cabinets[0].slantedFixedShelfCount,
    actual.cabinets[0].baffles.length,
    actual.cabinets[0].drawerGroups[0].slantedHandle,
  ], [0, 0, 0, 0, false]);
  assert.equal(actual.cabinets[0].fixedShelves, 2);
  assert.deepEqual([
    source.cabinets[0].topBoardRetreatMm,
    source.cabinets[0].bottomBoardRetreatMm,
    source.cabinets[0].slantedFixedShelfCount,
    source.cabinets[0].baffles.length,
    source.cabinets[0].drawerGroups[0].slantedHandle,
  ], [19, 19, 1, 1, true]);
});

test("a slanted door never makes a plain drawer front slanted", () => {
  const source = cabinet({ doors: [door(true, "top")] });
  const read = {
    cabinetId: "C01", status: "confirmed_4e", doors: source.doors,
    drawerHandles: [{ drawerGroupId: "DG1", status: "plain", style: "none", cropName: "face.png", evidence: "原圖普通屜頭" }],
    machining: [effect({ sourceType: "door", targetBoard: "top", baffleMount: "top_board", evidence: "原圖上門斜把對應頂板" })],
    unresolvedDoorRegions: [],
  };
  assert.equal(faceMachiningReadIsComplete(read, source, [crop]), true);
  const actual = applyFaceMachining({ cabinets: [source] }, [read], [crop]);
  const result = calculateCompleteSop(actual);
  assert.equal(actual.cabinets[0].drawerGroups[0].slantedHandle, false);
  assert.equal(actual.cabinets[0].doors[0].slantedHandle, true);
  assert.deepEqual([actual.cabinets[0].topBoardRetreatMm, actual.cabinets[0].bottomBoardRetreatMm], [19, 0]);
  assert.deepEqual(actual.cabinets[0].baffles.map((item) => [item.heightMm, item.kind, item.mountBasis]), [[50, "door_50", "top_board"]]);
  assert.doesNotMatch(result.materials.find((row) => row.item === "屜頭")?.note || "", /斜把/);
  assert.match(result.materials.find((row) => row.item === "4E門板")?.note || "", /上斜把×1/);
  assert.equal(result.hardware.find((row) => row.item === "斜手把")?.qty, 1);
});

test("a slanted drawer front never makes a plain door slanted", () => {
  const source = cabinet({ doors: [door(false)] });
  const read = {
    cabinetId: "C01", status: "confirmed_4e", doors: source.doors,
    drawerHandles: [{ drawerGroupId: "DG1", status: "slanted", style: "bottom", cropName: "face.png", evidence: "原圖屜頭下斜把" }],
    machining: [effect()], unresolvedDoorRegions: [],
  };
  assert.equal(faceMachiningReadIsComplete(read, source, [crop]), true);
  const actual = applyFaceMachining({ cabinets: [source] }, [read], [crop]);
  const result = calculateCompleteSop(actual);
  assert.equal(actual.cabinets[0].drawerGroups[0].slantedHandle, true);
  assert.equal(actual.cabinets[0].doors[0].slantedHandle, false);
  assert.deepEqual([actual.cabinets[0].topBoardRetreatMm, actual.cabinets[0].bottomBoardRetreatMm], [0, 19]);
  assert.deepEqual(actual.cabinets[0].baffles.map((item) => [item.heightMm, item.kind, item.mountBasis]), [[60, "drawer_60", "raised_bottom"]]);
  assert.match(result.materials.find((row) => row.item === "屜頭")?.note || "", /下斜把×1/);
  assert.doesNotMatch(result.materials.find((row) => row.item === "4E門板")?.note || "", /斜把/);
  assert.equal(result.hardware.find((row) => row.item === "斜手把")?.qty, 1);
});

test("one opening may create a complete pair of physical baffle segments", () => {
  const divider = {
    depthMm: 471, heightMm: 201, referenceSpanMm: 237, depthBasis: "standard_d_minus_29", heightBasis: "connection_span",
    region: "抽屜區", topConnection: "top_board", bottomConnection: "fixed_shelf_centerline", evidence: "中立將開口分成兩段",
  };
  const source = cabinet({ middleDividers: [divider] });
  const read = {
    cabinetId: "C01", status: "confirmed_no_4e", doors: [], unresolvedDoorRegions: [],
    drawerHandles: [{ drawerGroupId: "DG1", status: "slanted", style: "long", cropName: "face.png", evidence: "原圖屜頭長斜把" }],
    machining: [
      effect({ openingId: "DG1-OPENING", targetBoard: "none", baffleMount: "fixed_shelf", widthBasis: "finished_segment", widthMm: 382, segmentIndex: 1, segmentCount: 2, evidence: "左開口完成寬382" }),
      effect({ openingId: "DG1-OPENING", targetBoard: "none", baffleMount: "fixed_shelf", widthBasis: "finished_segment", widthMm: 364, segmentIndex: 2, segmentCount: 2, evidence: "右開口完成寬364" }),
    ],
  };
  assert.equal(faceMachiningReadIsComplete(read, source, [crop]), true);
  const actual = applyFaceMachining({ cabinets: [source] }, [read], [crop]);
  assert.deepEqual(actual.cabinets[0].baffles.map((item) => [
    item.widthMm, item.segmentGroupId, item.segmentIndex, item.segmentCount, item.splitAtMiddleDivider,
  ]), [
    [382, "DG1-OPENING", 1, 2, true],
    [364, "DG1-OPENING", 2, 2, true],
  ]);
  const rows = calculateCompleteSop(actual).materials.filter((row) => row.item === "擋板");
  assert.deepEqual(rows.map((row) => [row.spec, row.qty]).sort(), [["60 × 364", 1], ["60 × 382", 1]]);
});
