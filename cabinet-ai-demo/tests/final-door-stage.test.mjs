import assert from "node:assert/strict";
import test from "node:test";
import { finalDoorReadIssues, finalDoorStageIssues, installFinalDoorReads, scanFinalDoorStage } from "../app/final-door-stage.ts";
import { applyFaceMachining, prepareCarcassStage } from "../app/face-machining.ts";
import { calculateCompleteSop } from "../app/sop.ts";

const crop = { name: "face.png", dataUrl: "data:image/png;base64,AA==", cabinetId: "C01", cropId: "C01-face", role: "door", sourceImageName: "drawing.png", region: "完整門面", scanPass: 1 };
const cabinet = () => ({
  id: "C01", name: "最後門面測試", cabinetKind: "floor", elevationId: "E01", widthOrder: 1,
  widthMm: 800, heightMm: 736, depthMm: 500, footHeightMm: 100, footState: "present",
  fixedShelves: 1, adjustableShelves: 0, fixedShelfPositionsMm: [], middleDividers: [],
  drawerCount: 0, drawerGroups: [], doors: [], drawingNotes: [], baffles: [],
});
const door = (overrides = {}) => ({
  type: "4E", count: 1, countBasis: "symbols", doorSymbols: ["<"],
  symbolRegions: [{ symbol: "<", cropName: "face.png", region: "左门", xPermille: 250, yPermille: 500, evidence: "原圖<" }],
  dimensionBasis: "opening", openingWidthMm: 400, openingHeightMm: 700, finishedWidthMm: 0, finishedHeightMm: 0,
  direction: "left", slantedHandle: false, slantedHandleCount: 0, slantedHandleStyle: "none", jHandleCount: 0,
  includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "none", evidence: "完整門面", ...overrides,
});
const read = (overrides = {}) => ({ cabinetId: "C01", status: "confirmed_4e", doors: [door()], drawerHandles: [], machining: [], unresolvedDoorRegions: [], ...overrides });
const effect = (sourceIndex = 0) => ({ openingId: "OPEN", sourceType: "door", sourceIndex, targetBoard: "top", baffleMount: "top_board", widthBasis: "cabinet_inner", widthMm: 0, segmentIndex: 1, segmentCount: 1, cropName: "face.png", evidence: "上門斜把頂板" });

test("second full read replaces the incomplete first draft and stops further door scans", async () => {
  let calls = 0;
  const first = read({ status: "partial", doors: [door({ openingWidthMm: 0, openingHeightMm: 0, slantedHandleStyle: "unknown" })], unresolvedDoorRegions: ["尺寸"] });
  const second = read({ doors: [door({ slantedHandle: true, slantedHandleCount: 1, slantedHandleStyle: "top" })], machining: [effect()] });
  const actual = await scanFinalDoorStage(cabinet(), [crop], async () => [first, second][calls++]);
  assert.equal(calls, 2);
  assert.equal(actual.finalDoorStageConfirmed, true);
  assert.equal(actual.doors[0].openingWidthMm, 400);
  assert.equal(actual.doors[0].openingHeightMm, 700);
  assert.equal(actual.doors[0].slantedHandleStyle, "top");
  assert.deepEqual(actual.machining, second.machining);
  assert.equal(first.doors[0].openingWidthMm, 0);
});

test("partial status, unresolved regions and silently filtered door groups cannot pass", () => {
  assert.match(finalDoorReadIssues(read({ status: "partial" })).join(" "), /整桶門面/);
  assert.match(finalDoorReadIssues(read({ unresolvedDoorRegions: ["右上門"] })).join(" "), /右上門/);
  assert.match(finalDoorReadIssues(read({ doors: [door(), door({ symbolRegions: [] })] })).join(" "), /部分門片/);
});

test("diagnostics identify width, height, handle position and contradictory quantities separately", () => {
  const issues = finalDoorReadIssues(read({ doors: [door({ openingWidthMm: 0, openingHeightMm: 0, slantedHandle: true, slantedHandleCount: 2, slantedHandleStyle: "unknown" })] })).join(" ");
  for (const text of ["缺開口寬", "缺開口高", "手把數量", "上／下／長斜把位置"]) assert.ok(issues.includes(text));
  assert.match(finalDoorReadIssues(read({ doors: [door({ slantedHandleStyle: "unknown" })] })).join(" "), /是否有斜把空隙/);
  assert.deepEqual(finalDoorReadIssues(read()), []);
});

test("a complete later snapshot wins over an earlier larger partial result without mixing groups", async () => {
  const right = door({ doorSymbols: [">"], symbolRegions: [{ symbol: ">", cropName: "face.png", region: "右門", xPermille: 750, yPermille: 500, evidence: "原圖>" }] });
  const extraDraftGroup = door({ symbolRegions: [{ symbol: "<", cropName: "face.png", region: "尚未確認分組", xPermille: 250, yPermille: 800, evidence: "前輪草稿<" }] });
  const draft = read({ status: "partial", doors: [door(), right, extraDraftGroup], unresolvedDoorRegions: ["分組未確認"] });
  const complete = read({ doors: [right, door({ slantedHandle: true, slantedHandleCount: 1, slantedHandleStyle: "top" })], machining: [effect(1)] });
  let calls = 0;
  const actual = await scanFinalDoorStage(cabinet(), [crop], async () => [draft, complete][calls++]);
  assert.equal(calls, 2);
  assert.equal(actual.finalDoorStageConfirmed, true);
  assert.deepEqual(actual.doors.map(d => d.doorSymbols[0]), [">", "<"]);
  assert.equal(actual.machining[0].sourceIndex, 1);
  assert.deepEqual(finalDoorStageIssues(actual, cabinet(), [crop]), []);
});

test("old cabinet doors cannot overwrite the final dimensions or machining during calculation", async () => {
  const source = { cabinets: [{ ...cabinet(), doors: [door({ openingWidthMm: 999, openingHeightMm: 999 })], doorLock: { locked: true }, topBoardRetreatMm: 19 }] };
  const baseline = prepareCarcassStage(source);
  assert.deepEqual(baseline.cabinets[0].doors, []);
  assert.equal(baseline.cabinets[0].doorLock, undefined);
  const confirmed = await scanFinalDoorStage(baseline.cabinets[0], [crop], async () => read());
  const installed = installFinalDoorReads(source, [confirmed]);
  const snapshot = structuredClone(installed.cabinets[0].doors);
  const final = applyFaceMachining(installed, [confirmed], [crop]);
  const result = calculateCompleteSop(final);
  assert.deepEqual(final.cabinets[0].doors, snapshot);
  assert.equal(result.materials.find(row => row.item === "4E門板").spec, "397 × 696");
  assert.equal(final.cabinets[0].fixedShelves, 1);
  assert.equal(source.cabinets[0].doors[0].openingWidthMm, 999);
  confirmed.doors[0].openingWidthMm = 111;
  assert.equal(installed.cabinets[0].doors[0].openingWidthMm, 400);
});

test("no-door confirmation needs two consistent full reads and never erases observed door pixels", async () => {
  const noDoor = read({ status: "confirmed_no_4e", doors: [] });
  let calls = 0;
  const confirmed = await scanFinalDoorStage(cabinet(), [crop], async () => { calls++; return noDoor; });
  assert.equal(calls, 2);
  assert.equal(confirmed.finalDoorStageConfirmed, true);
  calls = 0;
  const conflicting = await scanFinalDoorStage(cabinet(), [crop], async () => [read({ status: "partial" }), noDoor, noDoor][calls++]);
  assert.equal(conflicting.finalDoorStageConfirmed, false);
  assert.throws(() => installFinalDoorReads({ cabinets: [cabinet()] }, [conflicting]), /尚未完整確認/);
});

test("three incomplete reads remain blocked with exact fields, without freezing a symbol-only result", async () => {
  let calls = 0;
  const actual = await scanFinalDoorStage(cabinet(), [crop], async () => { calls++; return read({ doors: [door({ openingHeightMm: 0 })] }); });
  assert.equal(calls, 3);
  assert.equal(actual.finalDoorStageConfirmed, false);
  assert.match(finalDoorReadIssues(actual).join(" "), /缺開口高/);
});

test("a 24mm positive hint needs actual machining but never requires a 24mm relationship", async () => {
  const hint = door({ includesSlantedGap24: true, slantedGap24Context: "unknown", slantedHandleStyle: "top" });
  let calls = 0;
  const actual = await scanFinalDoorStage(cabinet(), [crop], async () => { calls++; return read({ doors: [hint], machining: calls === 1 ? [] : [effect()] }); });
  assert.equal(calls, 2);
  assert.equal(actual.finalDoorStageConfirmed, true);
  const final = applyFaceMachining(installFinalDoorReads({ cabinets: [cabinet()] }, [actual]), [actual], [crop]);
  assert.equal(calculateCompleteSop(final).materials.find(row => row.item === "4E門板").spec, "397 × 696");
});

test("unknown source crop and wrong cabinet cannot become a confirmed result", async () => {
  const invalid = read({ doors: [door({ symbolRegions: [{ symbol: "<", cropName: "invented.png", region: "門", xPermille: 250, yPermille: 500, evidence: "<" }] })] });
  const result = await scanFinalDoorStage(cabinet(), [crop], async () => invalid);
  assert.equal(result.finalDoorStageConfirmed, false);
  assert.match(result.unresolvedDoorRegions.join(" "), /不存在的原始裁切/);
  const wrong = await scanFinalDoorStage(cabinet(), [crop], async () => read({ cabinetId: "OTHER" }));
  assert.equal(wrong.finalDoorStageConfirmed, false);
});

test("excluded aluminum surfaces never shift machining indices inside the final 4E snapshot", async () => {
  const mixed = read({ doors: [door({ type: "aluminum" }), door({ slantedHandle: true, slantedHandleCount: 1, slantedHandleStyle: "top" })], machining: [effect(1)] });
  assert.match(finalDoorReadIssues(mixed).join(" "), /混入鋁框門/);
  const clean = read({ doors: [door({ slantedHandle: true, slantedHandleCount: 1, slantedHandleStyle: "top" })], excludedSurfaces: ["上層鋁框門不拆料"], machining: [effect(0)] });
  let calls = 0;
  const actual = await scanFinalDoorStage(cabinet(), [crop], async () => [mixed, clean][calls++]);
  assert.equal(calls, 2);
  assert.equal(actual.finalDoorStageConfirmed, true);
  assert.equal(actual.doors.length, 1);
  assert.equal(actual.machining[0].sourceIndex, 0);
  assert.deepEqual(actual.excludedSurfaces, clean.excludedSurfaces);
});
