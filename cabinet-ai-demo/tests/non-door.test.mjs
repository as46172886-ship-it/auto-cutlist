import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { calculateNonDoorSop } from "../app/sop.ts";
import { normalizeNonDoorAnalysis } from "../app/non-door-normalize.ts";

const boardProfile = {
  bodyThicknessMm: 18, backThicknessMm: 8, drawerBottomThicknessMm: 8, deductionBasis: "standard_sop",
  topBottomWidthDeductionMm: 36, backWidthDeductionMm: 26, backHeightDeductionMm: 26,
  fixedShelfDepthDeductionMm: 29, fixedShelfWidthDeductionMm: 36,
  adjustableShelfDepthDeductionMm: 40, adjustableShelfWidthDeductionMm: 37,
};

function cabinet(id, order, widthMm, heightMm, extra = {}) {
  return {
    id, name: id, cabinetKind: "floor", elevationId: "E01", widthChainId: "W01", widthOrder: order,
    widthMm, widthDimensionIds: [], heightMm, heightDimensionIds: [], depthMm: 426,
    depthGroupId: "D01", depthSource: "shared_group", depthEvidence: "D42.6共用",
    isHanging: false, underCountertop: false, fixedShelves: 0, fixedShelfPositionsMm: [], adjustableShelves: 0,
    slantedFixedShelfCount: 0, drawerCount: 0, sideBySideDrawers: false, innerDrawerCount: 0,
    footHeightMm: 95, footState: "present", topBoardRetreatMm: 0, bottomBoardRetreatMm: 0,
    specialBackStripCount: 0, specialBackStripState: "not_applicable", boardProfile,
    middleDividers: [], baffles: [], drawerGroups: [], doors: [], drawingNotes: [], confidence: "high", evidence: "圖面尺寸閉合",
    ...extra,
  };
}

const drawer = (id, count, centerlineBoundaryCount) => ({
  id, count, openingWidthMm: 400, openingHeightMm: 160, drawerWallHeightMm: 0,
  isInner: false, sideBySide: count > 1, usesCenterlineWidth: centerlineBoundaryCount > 0,
  centerlineBoundaryCount, slantedHandle: true, fixedShelfPositionMm: 0, regionPosition: "top", evidence: "160完成屜頭與單格400",
});

const baffle = (id) => ({
  id, heightMm: 60, widthMm: 0, kind: "drawer_60", mountBasis: "fixed_shelf",
  widthBasis: "cabinet_inner", splitAtMiddleDivider: false, segmentGroupId: id, segmentIndex: 1, segmentCount: 1, evidence: "斜把擋板",
});

test("locked full-width drawers produce all boards and retire only resolved width questions", () => {
  const plan = { cabinets: [{ cabinetId: "E01-C01", elevationId: "E01", widthOrder: 1, bottomSegmentMm: 400 }] };
  const raw = {
    cabinets: [cabinet("E01-C01", 1, 400, 736, {
      drawerCount: 2,
      drawerGroups: [{ ...drawer("D1", 2, 0), sideBySide: false, slantedHandle: false, openingWidthMm: 0 }],
    })],
    questions: ["E01-C01：openingWidthMm為0，請提供抽屜格寬。", "E01-C01：左右抽屜是否不等寬？", "請確認固格標記。"],
  };
  const analysis = normalizeNonDoorAnalysis(raw, plan);
  assert.equal(analysis.cabinets[0].drawerGroups[0].openingWidthMm, 400);
  assert.deepEqual(analysis.questions, raw.questions.slice(1));
  const result = calculateNonDoorSop(analysis);
  for (const [item, spec, qty] of [["前抽牆", "100 × 301", 4], ["邊抽牆", "100 × 350", 4], ["抽底板", "311 × 324", 2]]) {
    assert.equal(result.materials.find((row) => row.item === item && row.spec === spec)?.qty, qty, item);
  }
  assert.equal(result.materials.some((row) => row.item === "屜頭"), false);
  assert.equal(result.materials.some((row) => row.item === "擋板"), false);
});

test("YCX non-door fixture matches every deterministic material and hardware row", () => {
  const c01 = cabinet("C01", 1, 400, 736, { adjustableShelves: 1, drawerCount: 1, drawerGroups: [drawer("D1", 1, 0)], baffles: [baffle("B1")] });
  const c02 = cabinet("C02", 2, 800, 736, {
    fixedShelves: 1, fixedShelfPositionsMm: [552], slantedFixedShelfCount: 1, adjustableShelves: 1,
    drawerCount: 2, sideBySideDrawers: true, drawerGroups: [drawer("D2", 2, 1)], baffles: [baffle("B2")],
    middleDividers: [{ depthMm: 0, heightMm: 0, referenceSpanMm: 160, depthBasis: "standard_d_minus_29", heightBasis: "connection_span", region: "並排抽屜區", topConnection: "top_board", bottomConnection: "fixed_shelf_centerline", evidence: "上接頂板、下接F中心線" }],
  });
  const c03 = cabinet("C03", 3, 600, 2272, { fixedShelves: 1, slantedFixedShelfCount: 1, adjustableShelves: 2, baffles: [baffle("B3")] });
  const result = calculateNonDoorSop({
    cabinets: [c01, c02, c03],
    independentPanels: [
      { id: "P1", name: "封板", count: 1, widthMm: 180, heightMm: 1100, thicknessMm: 18, grainDirection: "vertical", dimensionOrder: "width_height", note: "4P", evidence: "圖註" },
      { id: "P2", name: "檯面", count: 1, widthMm: 450, heightMm: 1200, thicknessMm: 25, grainDirection: "none", dimensionOrder: "width_height", note: "1L2SA", evidence: "圖註" },
      { id: "P3", name: "假門板", count: 1, widthMm: 120, heightMm: 636, thicknessMm: 18, grainDirection: "none", dimensionOrder: "width_height", note: "固定飾板", evidence: "非功能門" },
      { id: "P4", name: "4E門板", count: 2, widthMm: 397, heightMm: 522, thicknessMm: 18, grainDirection: "none", dimensionOrder: "width_height", note: "應排除", evidence: "功能門" },
    ],
    kickboards: [{ id: "K1", siteLengthMm: 1800, evidence: "底寬總長" }],
    mirrors: [{ id: "M1", count: 1, widthMm: 350, heightMm: 1300, evidence: "鏡子35×130" }],
    specialHardware: [
      { item: "35伸縮衣桿", qty: 1, unit: "支", evidence: "圖註" },
      { item: "GS鉸鍊", qty: 12, unit: "個", evidence: "門專用，應排除" },
      { item: "斜手把", qty: 7, unit: "支", evidence: "只作計價，應排除" },
    ],
  });
  assert.deepEqual(result.materials.map((row) => `${row.item}|${row.spec}|${row.qty}`).sort(), [
    "側板|426 × 2272|2", "側板|426 × 736|4",
    "頂底板|426 × 764|2", "頂底板|426 × 564|2", "頂底板|426 × 364|2",
    "中立板|397 × 133|1", "固格板|397 × 764|1", "固格板|397 × 564|1",
    "活格板|386 × 763|1", "活格板|386 × 563|2", "活格板|386 × 363|1",
    "前抽牆|100 × 310|4", "前抽牆|100 × 301|2", "邊抽牆|100 × 350|6",
    "抽底板|320 × 324|2", "抽底板|311 × 324|1",
    "封板|180 × 1100|1", "假門板|120 × 636|1",
    "背板|774 × 710|1", "背板|574 × 2246|1", "背板|374 × 710|1",
    "踢腳板|120 × 2800|1", "檯面|450 × 1200|1", "背條|110 × 564|2", "明鏡|350 × 1300|1",
  ].sort());
  assert.deepEqual(result.hardware.map((row) => `${row.item}|${row.qty}`).sort(), [
    "A10|12", "KD|24", "抽木榫|60", "白固格器|12", "活格利|16", "35滑軌|3", "35伸縮衣桿|1", "鏡珠|4",
  ].sort());
  assert.equal(result.materials.some((row) => row.item === "4E門板"), false);
  assert.equal(result.hardware.some((row) => /鉸鍊|油壓器|J.*手把|斜手把/.test(row.item)), false);
  assert.equal(result.materials.some((row) => row.item === "屜頭" || row.item === "擋板"), false);
});

test("project names never retrieve or overwrite a labelled answer", () => {
  const plan = {
    projectName: "四維路置物櫃", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [400, 800, 600].map((width, index) => ({ cabinetId: `C0${index + 1}`, elevationId: "E01", label: `第${index + 1}桶`, widthOrder: index + 1, bottomSegmentMm: width, bottomDimensionText: String(width), sourceCrops: [], confidence: "high", evidence: "底寬鏈" })),
  };
  const raw = {
    projectName: "四維路置物櫃",
    cabinets: [cabinet("C01", 1, 400, 711), cabinet("C02", 2, 800, 711), cabinet("C03", 3, 600, 2272)],
    independentPanels: [], kickboards: [], mirrors: [], specialHardware: [], questions: [], warnings: [],
  };
  const normalized = normalizeNonDoorAnalysis(raw, plan);
  assert.deepEqual(normalized.cabinets.map((item) => item.heightMm), [711, 711, 2272]);
  assert.equal("referenceCaseId" in normalized, false);
});

test("non-door normalization cannot change locked cabinet widths or deductions", () => {
  const plan = {
    projectName: "測試", drawingUnit: "cm", views: [], unresolved: [],
    cabinets: [400, 800].map((width, index) => ({ cabinetId: `C0${index + 1}`, elevationId: "E01", label: `第${index + 1}桶`, widthOrder: index + 1, bottomSegmentMm: width, bottomDimensionText: String(width / 10), sourceCrops: [], confidence: "high", evidence: "底寬" })),
  };
  const raw = {
    cabinets: [cabinet("WRONG-A", 9, 999, 736, { boardProfile: { ...boardProfile, fixedShelfDepthDeductionMm: 44 } }), cabinet("WRONG-B", 10, 999, 736)],
    independentPanels: [], kickboards: [], mirrors: [], specialHardware: [{ item: "油壓器", qty: 99, unit: "個", evidence: "錯誤" }],
  };
  const normalized = normalizeNonDoorAnalysis(raw, plan);
  assert.deepEqual(normalized.cabinets.map((item) => [item.id, item.widthOrder, item.widthMm]), [["C01", 1, 400], ["C02", 2, 800]]);
  assert.equal(normalized.cabinets.every((item) => item.boardProfile.fixedShelfDepthDeductionMm === 29), true);
  assert.deepEqual(normalized.specialHardware, []);
});

test("non-door normalization preserves a user-confirmed nonstandard board profile", () => {
  const plan = {
    projectName: "非標準板厚", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [{ cabinetId: "C01", elevationId: "E01", label: "第1桶", widthOrder: 1, bottomSegmentMm: 900, bottomDimensionText: "900", sourceCrops: [], confidence: "high", evidence: "底寬" }],
  };
  const customProfile = { ...boardProfile, deductionBasis: "user_confirmed", bodyThicknessMm: 19, topBottomWidthDeductionMm: 38 };
  const normalized = normalizeNonDoorAnalysis({ cabinets: [cabinet("C01", 1, 900, 736, { boardProfile: customProfile })] }, plan);
  assert.equal(normalized.cabinets[0].boardProfile.bodyThicknessMm, 19);
  const result = calculateNonDoorSop(normalized);
  assert.equal(result.materials.find((row) => row.item === "側板").thicknessMm, 19);
  assert.equal(result.materials.find((row) => row.item === "頂底板").spec, "426 × 862");
});

test("multi-elevation non-door fallback cannot exchange same-order cabinet contents", () => {
  const plan = {
    projectName: "雙立面", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [
      { cabinetId: "E02-C01", elevationId: "E02", label: "第二立面第一桶", widthOrder: 1, bottomSegmentMm: 500, bottomDimensionText: "500", sourceCrops: [], confidence: "high", evidence: "第二立面" },
      { cabinetId: "E01-C01", elevationId: "E01", label: "第一立面第一桶", widthOrder: 1, bottomSegmentMm: 500, bottomDimensionText: "500", sourceCrops: [], confidence: "high", evidence: "第一立面" },
    ],
  };
  const raw = { cabinets: [
    cabinet("wrong-e2", 1, 500, 1500, { elevationId: "E02", adjustableShelves: 7, evidence: "第二立面內容" }),
    cabinet("wrong-e1", 1, 500, 900, { elevationId: "E01", adjustableShelves: 3, evidence: "第一立面內容" }),
  ] };
  const normalized = normalizeNonDoorAnalysis(raw, plan);
  assert.deepEqual(normalized.cabinets.map((item) => [item.id, item.heightMm, item.adjustableShelves]), [
    ["E01-C01", 900, 3], ["E02-C01", 1500, 7],
  ]);

  const missingOwnership = structuredClone(raw);
  missingOwnership.cabinets[0].elevationId = "";
  assert.throws(() => normalizeNonDoorAnalysis(missingOwnership, plan), /E02-C01缺少同立面、同順序/);
});

test("non-door recognition completion restores drawer compartments, short divider and tall-zone shelf", () => {
  const plan = {
    projectName: "校正", drawingUnit: "cm", views: [], unresolved: [],
    cabinets: [400, 800, 600].map((width, index) => ({ cabinetId: `C0${index + 1}`, elevationId: "E01", label: `第${index + 1}桶`, widthOrder: index + 1, bottomSegmentMm: width, bottomDimensionText: String(width / 10), sourceCrops: [], confidence: "high", evidence: "底寬" })),
  };
  const c01 = cabinet("C01", 1, 400, 736, { adjustableShelves: 1, drawerCount: 1, drawerGroups: [{ ...drawer("D1", 1, 0), regionPosition: "middle" }] });
  const c02 = cabinet("C02", 2, 800, 736, {
    adjustableShelves: 1, drawerCount: 2, sideBySideDrawers: true, drawerGroups: [{ ...drawer("D2", 2, 1), regionPosition: "middle" }],
    middleDividers: [{ depthMm: 0, heightMm: 0, referenceSpanMm: 552, depthBasis: "standard_d_minus_29", heightBasis: "connection_span", region: "錯誤延伸", topConnection: "top_board", bottomConnection: "fixed_shelf_centerline", evidence: "視覺誤讀" }],
  });
  const c03 = cabinet("C03", 3, 600, 2272, { adjustableShelves: 2 });
  const normalized = normalizeNonDoorAnalysis({ cabinets: [c01, c02, c03], dimensionChains: [], specialHardware: [{ item: "伸縮衣架", qty: 1, unit: "支", evidence: "圖註" }] }, plan);
  assert.deepEqual(normalized.cabinets.map((item) => [item.fixedShelves, item.adjustableShelves]), [[0, 1], [1, 1], [1, 2]]);
  assert.equal(normalized.cabinets[1].middleDividers[0].referenceSpanMm, 160);
  assert.deepEqual(normalized.cabinets.map((item) => item.baffles.length), [0, 0, 0]);
  assert.equal(normalized.specialHardware[0].item, "35伸縮衣桿");
});

test("wide vertically stacked drawers are not inferred as side-by-side", () => {
  const plan = {
    projectName: "上下雙抽", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [{ cabinetId: "C01", elevationId: "E01", label: "雙抽櫃", widthOrder: 1, bottomSegmentMm: 800, bottomDimensionText: "800", sourceCrops: [], confidence: "high", evidence: "單桶寬800" }],
  };
  const normalized = normalizeNonDoorAnalysis({
    cabinets: [cabinet("C01", 1, 800, 736, {
      drawerCount: 2,
      sideBySideDrawers: false,
      drawerGroups: [{
        ...drawer("D1", 1, 0),
        count: 2,
        openingWidthMm: 0,
        sideBySide: false,
        usesCenterlineWidth: false,
        centerlineBoundaryCount: 0,
        evidence: "兩個抽屜上下排列，未見中立中心線",
      }],
    })],
  }, plan);
  const result = normalized.cabinets[0];
  assert.equal(result.drawerGroups[0].openingWidthMm, 800);
  assert.equal(result.drawerGroups[0].centerlineBoundaryCount, 0);
  assert.equal(result.drawerGroups[0].usesCenterlineWidth, false);
  assert.equal(result.fixedShelves, 0);
  assert.equal(result.adjustableShelves, 0);
  assert.deepEqual(result.middleDividers, []);
});

test("three side-by-side drawer columns create N minus one dividers without erasing a full-height divider", () => {
  const plan = {
    projectName: "三欄並排抽", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [{ cabinetId: "C01", elevationId: "E01", label: "三欄抽櫃", widthOrder: 1, bottomSegmentMm: 1200, bottomDimensionText: "1200", sourceCrops: [], confidence: "high", evidence: "單桶寬1200" }],
  };
  const fullHeight = {
    depthMm: 0, heightMm: 0, referenceSpanMm: 736, depthBasis: "standard_d_minus_29", heightBasis: "connection_span",
    region: "全高中立", topConnection: "top_board", bottomConnection: "bottom_board", evidence: "由頂到底",
  };
  const normalized = normalizeNonDoorAnalysis({
    cabinets: [cabinet("C01", 1, 1200, 736, {
      drawerCount: 3,
      sideBySideDrawers: true,
      drawerGroups: [{ ...drawer("D3", 3, 2), openingHeightMm: 160 }],
      middleDividers: [fullHeight],
    })],
  }, plan);
  const dividers = normalized.cabinets[0].middleDividers;
  assert.equal(dividers.length, 2);
  assert.equal(dividers.filter((divider) => divider.bottomConnection === "bottom_board").length, 1);
  assert.equal(dividers.filter((divider) => divider.referenceSpanMm === 160).length, 1);
});

test("three side-by-side drawer columns create two short dividers when none were recognized", () => {
  const plan = {
    projectName: "三欄並排抽", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [{ cabinetId: "C01", elevationId: "E01", label: "三欄抽櫃", widthOrder: 1, bottomSegmentMm: 1200, bottomDimensionText: "1200", sourceCrops: [], confidence: "high", evidence: "單桶寬1200" }],
  };
  const normalized = normalizeNonDoorAnalysis({
    cabinets: [cabinet("C01", 1, 1200, 736, {
      drawerCount: 3,
      sideBySideDrawers: true,
      drawerGroups: [{ ...drawer("D3", 3, 2), openingHeightMm: 160 }],
    })],
  }, plan);
  assert.equal(normalized.cabinets[0].middleDividers.length, 2);
  assert.equal(new Set(normalized.cabinets[0].middleDividers.map((divider) => divider.region)).size, 2);
});

test("carcass normalization clears pre-existing face-derived baffles", () => {
  const plan = {
    projectName: "分段擋板", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [{ cabinetId: "C01", elevationId: "E01", label: "雙抽櫃", widthOrder: 1, bottomSegmentMm: 800, bottomDimensionText: "800", sourceCrops: [], confidence: "high", evidence: "單桶寬800" }],
  };
  const segments = [1, 2].map((segmentIndex) => ({
    id: `BF-${segmentIndex}`, heightMm: 60, widthMm: 382, kind: "drawer_60", mountBasis: "fixed_shelf",
    widthBasis: "finished_segment", splitAtMiddleDivider: true, segmentGroupId: "BF-G1", segmentIndex, segmentCount: 2,
    evidence: `中立${segmentIndex === 1 ? "左" : "右"}側完成分段`,
  }));
  const normalized = normalizeNonDoorAnalysis({
    cabinets: [cabinet("C01", 1, 800, 736, {
      fixedShelves: 1,
      drawerCount: 2,
      sideBySideDrawers: true,
      drawerGroups: [{ ...drawer("D2", 2, 1), openingHeightMm: 160 }],
      baffles: segments,
    })],
  }, plan);
  assert.deepEqual(normalized.cabinets[0].baffles, []);
});

test("each vertical drawer group calculates its own side-by-side opening width", () => {
  const plan = {
    projectName: "混合抽屜排列", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [{ cabinetId: "C01", elevationId: "E01", label: "混合抽櫃", widthOrder: 1, bottomSegmentMm: 800, bottomDimensionText: "800", sourceCrops: [], confidence: "high", evidence: "單桶寬800" }],
  };
  const normalized = normalizeNonDoorAnalysis({
    cabinets: [cabinet("C01", 1, 800, 900, {
      drawerCount: 3,
      sideBySideDrawers: true,
      drawerGroups: [
        { ...drawer("D-TOP", 2, 1), openingWidthMm: 0, evidence: "上層兩抽並排，有中心線" },
        { ...drawer("D-BOTTOM", 1, 0), openingWidthMm: 0, sideBySide: false, slantedHandle: false, evidence: "下層單抽，沒有中心線" },
      ],
    })],
  }, plan);
  assert.deepEqual(normalized.cabinets[0].drawerGroups.map((group) => [group.openingWidthMm, group.sideBySide, group.centerlineBoundaryCount]), [
    [400, true, 1],
    [800, false, 0],
  ]);
});

test("non-door normalization closes full-height dividers and propagates majority foot evidence across one elevation", () => {
  const plan = {
    projectName: "跨桶共識", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [300, 900, 900, 450].map((width, index) => ({ cabinetId: `C0${index + 1}`, elevationId: "E01", label: `第${index + 1}桶`, widthOrder: index + 1, bottomSegmentMm: width, bottomDimensionText: String(width), sourceCrops: [], confidence: "high", evidence: "同一底寬鏈" })),
  };
  const incompleteDivider = { depthMm: 0, heightMm: 0, referenceSpanMm: 0, depthBasis: "unknown", heightBasis: "unknown", region: "全高中立", topConnection: "unknown", bottomConnection: "unknown", evidence: "實體中立由頂板連續到底板" };
  const c01 = cabinet("C01", 1, 300, 1400, { depthMm: 350, footHeightMm: 100, footState: "present" });
  const c02 = cabinet("C02", 2, 900, 1400, { depthMm: 350, isHanging: true, cabinetKind: "hanging", footHeightMm: 0, footState: "absent", adjustableShelves: 6, middleDividers: [incompleteDivider], evidence: "是否為吊櫃尚待確認，未見明確吊櫃標註" });
  const c03 = cabinet("C03", 3, 900, 1400, { depthMm: 350, footHeightMm: 100, footState: "present", adjustableShelves: 6, middleDividers: [incompleteDivider] });
  const c04 = cabinet("C04", 4, 450, 1400, { depthMm: 350, footHeightMm: 100, footState: "present" });
  const normalized = normalizeNonDoorAnalysis({ cabinets: [c01, c02, c03, c04], independentPanels: [], kickboards: [], mirrors: [], specialHardware: [] }, plan);
  assert.equal(normalized.cabinets.every((item) => item.cabinetKind === "floor" && !item.isHanging && item.footState === "present" && item.footHeightMm === 100), true);
  assert.deepEqual(normalized.cabinets.slice(1, 3).map((item) => item.middleDividers[0]).map((divider) => [divider.referenceSpanMm, divider.depthBasis, divider.heightBasis, divider.topConnection, divider.bottomConnection]), [
    [1400, "standard_d_minus_29", "connection_span", "top_board", "bottom_board"],
    [1400, "standard_d_minus_29", "connection_span", "top_board", "bottom_board"],
  ]);
  const result = calculateNonDoorSop(normalized);
  assert.deepEqual(result.materials.filter((row) => row.item === "中立板").map((row) => `${row.spec}|${row.qty}`), ["321 × 1364|2"]);
  assert.deepEqual(result.materials.filter((row) => row.item === "活格板").map((row) => `${row.spec}|${row.qty}`), ["310 × 422|12"]);
  assert.equal(result.hardware.find((row) => row.item === "A10").qty, 18);
  assert.equal(result.hardware.find((row) => row.item === "白固格器").qty, 8);
});

test("majority foot consensus preserves a cabinet with explicit hanging evidence", () => {
  const plan = {
    projectName: "明確吊櫃", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [400, 400, 400].map((width, index) => ({ cabinetId: `C0${index + 1}`, elevationId: "E01", label: `第${index + 1}桶`, widthOrder: index + 1, bottomSegmentMm: width, bottomDimensionText: String(width), sourceCrops: [], confidence: "high", evidence: "同一立面" })),
  };
  const floorA = cabinet("C01", 1, 400, 700, { footHeightMm: 100, footState: "present" });
  const hanging = cabinet("C02", 2, 400, 700, { cabinetKind: "hanging", isHanging: true, footHeightMm: 0, footState: "absent", evidence: "圖面明確標註吊櫃，獨立懸空安裝" });
  const floorB = cabinet("C03", 3, 400, 700, { footHeightMm: 100, footState: "present" });
  const normalized = normalizeNonDoorAnalysis({ cabinets: [floorA, hanging, floorB] }, plan);
  assert.equal(normalized.cabinets[1].cabinetKind, "hanging");
  assert.equal(normalized.cabinets[1].footState, "absent");
});

test("conflicting foot heights in one elevation are never overwritten or propagated", () => {
  const plan = {
    projectName: "同立面不同腳高", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [
      { cabinetId: "C01", elevationId: "E01", label: "低腳櫃", widthOrder: 1, bottomSegmentMm: 400, bottomDimensionText: "400", sourceCrops: [], confidence: "high", evidence: "第一桶" },
      { cabinetId: "C02", elevationId: "E01", label: "高腳櫃", widthOrder: 2, bottomSegmentMm: 400, bottomDimensionText: "400", sourceCrops: [], confidence: "high", evidence: "第二桶" },
      { cabinetId: "C03", elevationId: "E01", label: "待確認櫃", widthOrder: 3, bottomSegmentMm: 400, bottomDimensionText: "400", sourceCrops: [], confidence: "high", evidence: "第三桶" },
    ],
  };
  const normalized = normalizeNonDoorAnalysis({
    cabinets: [
      cabinet("C01", 1, 400, 1400, { footHeightMm: 100, footState: "present" }),
      cabinet("C02", 2, 400, 1400, { footHeightMm: 150, footState: "present" }),
      cabinet("C03", 3, 400, 1400, { footHeightMm: 0, footState: "unknown" }),
    ],
  }, plan);
  assert.deepEqual(normalized.cabinets.map((item) => [item.footState, item.footHeightMm]), [
    ["present", 100], ["present", 150], ["unknown", 0],
  ]);
});

test("independent-panel normalization merges filler synonyms and rejects a guessed clearance panel", () => {
  const plan = {
    projectName: "獨立件正規化", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [{ cabinetId: "C01", elevationId: "E01", label: "第1桶", widthOrder: 1, bottomSegmentMm: 500, bottomDimensionText: "500", sourceCrops: [], confidence: "high", evidence: "底寬" }],
  };
  const base = cabinet("C01", 1, 500, 1400);
  const normalized = normalizeNonDoorAnalysis({
    cabinets: [base],
    independentPanels: [
      { id: "L", name: "左側填縫板", count: 1, widthMm: 100, heightMm: 1400, thicknessMm: 18, grainDirection: "vertical", dimensionOrder: "width_height", note: "外側收口", evidence: "獨立全高板外框" },
      { id: "R", name: "右側收口板", count: 1, widthMm: 100, heightMm: 1400, thicknessMm: 18, grainDirection: "vertical", dimensionOrder: "height_width", note: "外側收口", evidence: "獨立全高板外框" },
      { id: "G", name: "上方封板/飾板", count: 1, widthMm: 500, heightMm: 80, thicknessMm: 18, grainDirection: "none", dimensionOrder: "width_height", note: "未見文字直接命名", evidence: "只依櫃頂至天花尺寸關係推定" },
    ],
  }, plan);
  assert.deepEqual(normalized.independentPanels.map((panel) => panel.name), ["填縫板", "填縫板"]);
  assert.equal(normalized.independentPanels.every((panel) => panel.dimensionOrder === "width_height"), true);
  const result = calculateNonDoorSop(normalized);
  assert.deepEqual(result.materials.filter((row) => row.item === "填縫板").map((row) => `${row.spec}|${row.qty}`), ["100 × 1400|2"]);
  assert.equal(result.materials.some((row) => /封板|飾板/.test(row.item)), false);
});

test("browser edge-line evidence recovers one standard filler without a model guess", () => {
  const plan = {
    projectName: "通用邊界證據", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [360, 1000].map((width, index) => ({ cabinetId: `C0${index + 1}`, elevationId: "E01", label: `第${index + 1}桶`, widthOrder: index + 1, bottomSegmentMm: width, bottomDimensionText: String(width), sourceCrops: [], confidence: "high", evidence: "底寬" })),
  };
  const normalized = normalizeNonDoorAnalysis({
    cabinets: [cabinet("C01", 1, 360, 1472), cabinet("C02", 2, 1000, 1472)],
    independentPanels: [],
    cropEvidenceHints: [{ cabinetId: "C01", region: "左外側另有一條與櫃身分離的全高牆／收口線" }],
  }, plan);
  assert.deepEqual(
    normalized.independentPanels.map((panel) => ({ name: panel.name, count: panel.count, widthMm: panel.widthMm, heightMm: panel.heightMm })),
    [{ name: "填縫板", count: 1, widthMm: 100, heightMm: 1472 }],
  );
});

test("distinct left and right edge-line evidence creates two fillers, while no evidence creates none", () => {
  const plan = {
    projectName: "雙側邊界", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [{ cabinetId: "C01", elevationId: "E01", label: "第1桶", widthOrder: 1, bottomSegmentMm: 500, bottomDimensionText: "500", sourceCrops: [], confidence: "high", evidence: "底寬" }],
  };
  const source = cabinet("C01", 1, 500, 1400);
  const none = normalizeNonDoorAnalysis({ cabinets: [source], independentPanels: [] }, plan);
  assert.equal(none.independentPanels.length, 0);
  const both = normalizeNonDoorAnalysis({
    cabinets: [source], independentPanels: [],
    cropEvidenceHints: [
      { cabinetId: "C01", region: "左外側另有一條與櫃身分離的全高牆／收口線" },
      { cabinetId: "C01", region: "右外側另有一條與櫃身分離的全高牆／收口線" },
    ],
  }, plan);
  assert.deepEqual(
    both.independentPanels.map((panel) => ({ count: panel.count, widthMm: panel.widthMm, heightMm: panel.heightMm })),
    [{ count: 2, widthMm: 100, heightMm: 1400 }],
  );
});

test("same-height filler evidence remains separated by elevation", () => {
  const plan = {
    projectName: "雙立面填縫", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [
      { cabinetId: "E01-C01", elevationId: "E01", label: "第一立面", widthOrder: 1, bottomSegmentMm: 500, bottomDimensionText: "500", sourceCrops: [], confidence: "high", evidence: "第一立面" },
      { cabinetId: "E02-C01", elevationId: "E02", label: "第二立面", widthOrder: 1, bottomSegmentMm: 500, bottomDimensionText: "500", sourceCrops: [], confidence: "high", evidence: "第二立面" },
    ],
  };
  const normalized = normalizeNonDoorAnalysis({
    cabinets: [
      cabinet("E01-C01", 1, 500, 1400, { elevationId: "E01" }),
      cabinet("E02-C01", 1, 500, 1400, { elevationId: "E02" }),
    ], independentPanels: [],
    cropEvidenceHints: [
      { cabinetId: "E01-C01", region: "左外側與牆分離的收口線" },
      { cabinetId: "E02-C01", region: "右外側與牆分離的收口線" },
      { cabinetId: "不存在", region: "左外側與牆分離的收口線" },
    ],
  }, plan);
  assert.deepEqual(normalized.independentPanels.map((panel) => [panel.elevationId, panel.count, panel.heightMm]), [
    ["E01", 1, 1400], ["E02", 1, 1400],
  ]);
});

test("a 24mm carcass height segment does not mark a drawer front as slanted", () => {
  const plan = {
    projectName: "斜把高度鏈", drawingUnit: "cm", views: [], unresolved: [],
    cabinets: [{ cabinetId: "C01", elevationId: "E01", label: "第1桶", widthOrder: 1, bottomSegmentMm: 400, bottomDimensionText: "40", sourceCrops: [], confidence: "high", evidence: "底寬" }],
  };
  const source = cabinet("C01", 1, 400, 736, { drawerCount: 1, drawerGroups: [{ ...drawer("D1", 1, 0), slantedHandle: false }], baffles: [] });
  const normalized = normalizeNonDoorAnalysis({
    cabinets: [source],
    carcassDimensionLocks: [{ cabinetId: "C01", heightRawTexts: ["55.2", "2.4", "16"] }],
  }, plan);
  assert.equal(normalized.cabinets[0].drawerGroups[0].slantedHandle, false);
  assert.equal(normalized.cabinets[0].baffles.length, 0);
});

test("24mm chains and slanted drawer patterns never propagate across elevations", () => {
  const plan = {
    projectName: "雙立面斜把", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [
      { cabinetId: "E01-C01", elevationId: "E01", label: "第一立面", widthOrder: 1, bottomSegmentMm: 500, bottomDimensionText: "500", sourceCrops: [], confidence: "high", evidence: "第一立面" },
      { cabinetId: "E02-C01", elevationId: "E02", label: "第二立面", widthOrder: 1, bottomSegmentMm: 500, bottomDimensionText: "500", sourceCrops: [], confidence: "high", evidence: "第二立面" },
    ],
  };
  const plainDrawer = (id, slantedHandle) => ({ ...drawer(id, 1, 0), slantedHandle });
  const rawCabinets = [
    cabinet("E01-C01", 1, 500, 736, { elevationId: "E01", drawerCount: 1, drawerGroups: [plainDrawer("D1", true)], baffles: [] }),
    cabinet("E02-C01", 1, 500, 736, { elevationId: "E02", drawerCount: 1, drawerGroups: [plainDrawer("D2", false)], baffles: [] }),
  ];
  const patternOnly = normalizeNonDoorAnalysis({ cabinets: rawCabinets }, plan);
  assert.deepEqual(patternOnly.cabinets.map((item) => item.baffles.length), [0, 0]);

  rawCabinets[0].drawerGroups[0].slantedHandle = false;
  const chainOwned = normalizeNonDoorAnalysis({
    cabinets: rawCabinets,
    dimensionChains: [{ id: "H-E01", elevationId: "E01", axis: "height", segmentsMm: [552, 24, 160], cabinetIds: [] }],
  }, plan);
  assert.deepEqual(chainOwned.cabinets.map((item) => [item.drawerGroups[0].slantedHandle, item.baffles.length]), [[false, 0], [false, 0]]);

  const unowned = normalizeNonDoorAnalysis({
    cabinets: rawCabinets,
    dimensionChains: [{ id: "H-UNKNOWN", elevationId: "", axis: "height", segmentsMm: [552, 24, 160], cabinetIds: [] }],
  }, plan);
  assert.deepEqual(unowned.cabinets.map((item) => [item.drawerGroups[0].slantedHandle, item.baffles.length]), [[false, 0], [false, 0]]);
});

test("slanted evidence never propagates between cabinets in the same elevation", () => {
  const plan = {
    projectName: "同立面不同把手", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [1, 2].map((order) => ({ cabinetId: `C0${order}`, elevationId: "E01", label: `第${order}桶`, widthOrder: order, bottomSegmentMm: 500, bottomDimensionText: "500", sourceCrops: [], confidence: "high", evidence: "底寬" })),
  };
  const plainDrawer = (id, slantedHandle) => ({ ...drawer(id, 1, 0), slantedHandle });
  const cabinets = [
    cabinet("C01", 1, 500, 736, { drawerCount: 1, drawerGroups: [plainDrawer("D1", true)], baffles: [] }),
    cabinet("C02", 2, 500, 736, { drawerCount: 1, drawerGroups: [plainDrawer("D2", false)], baffles: [] }),
  ];
  const patternOnly = normalizeNonDoorAnalysis({ cabinets }, plan);
  assert.deepEqual(patternOnly.cabinets.map((item) => [item.drawerGroups[0].slantedHandle, item.baffles.length]), [[false, 0], [false, 0]]);

  cabinets[0].drawerGroups[0].slantedHandle = false;
  const unownedChain = normalizeNonDoorAnalysis({
    cabinets,
    dimensionChains: [{ id: "H-AMBIGUOUS", elevationId: "E01", axis: "height", segmentsMm: [552, 24, 160], cabinetIds: [] }],
  }, plan);
  assert.deepEqual(unownedChain.cabinets.map((item) => [item.drawerGroups[0].slantedHandle, item.baffles.length]), [[false, 0], [false, 0]]);

  const ownedChain = normalizeNonDoorAnalysis({
    cabinets,
    dimensionChains: [{ id: "H-C01", elevationId: "E01", axis: "height", segmentsMm: [552, 24, 160], cabinetIds: ["C01"] }],
  }, plan);
  assert.deepEqual(ownedChain.cabinets.map((item) => [item.drawerGroups[0].slantedHandle, item.baffles.length]), [[false, 0], [false, 0]]);
});

test("a wardrobe rod only completes the tall cabinet zone in its own elevation", () => {
  const plan = {
    projectName: "雙立面衣櫃", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [
      { cabinetId: "E01-C01", elevationId: "E01", label: "衣櫃立面", widthOrder: 1, bottomSegmentMm: 600, bottomDimensionText: "600", sourceCrops: [], confidence: "high", evidence: "第一立面" },
      { cabinetId: "E02-C01", elevationId: "E02", label: "普通高櫃", widthOrder: 1, bottomSegmentMm: 600, bottomDimensionText: "600", sourceCrops: [], confidence: "high", evidence: "第二立面" },
    ],
  };
  const normalized = normalizeNonDoorAnalysis({
    cabinets: [
      cabinet("E01-C01", 1, 600, 2000, { elevationId: "E01", adjustableShelves: 0, fixedShelves: 0 }),
      cabinet("E02-C01", 1, 600, 2000, { elevationId: "E02", adjustableShelves: 3, fixedShelves: 0 }),
    ],
    specialHardware: [{ elevationId: "E01", item: "35伸縮衣桿", qty: 1, unit: "支", evidence: "第一立面圖註" }],
  }, plan);
  assert.deepEqual(normalized.cabinets.map((item) => [item.adjustableShelves, item.fixedShelves, item.baffles.length]), [
    [2, 1, 0], [3, 0, 0],
  ]);
});

test("non-door normalization rejects a drawer total that does not close against its groups", () => {
  const plan = {
    projectName: "抽屜數量閉合", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [{ cabinetId: "C01", elevationId: "E01", label: "三抽櫃", widthOrder: 1, bottomSegmentMm: 800, bottomDimensionText: "800", sourceCrops: [], confidence: "high", evidence: "單桶寬800" }],
  };
  const inconsistent = cabinet("C01", 1, 800, 736, {
    drawerCount: 3,
    drawerGroups: [drawer("D1", 2, 1)],
  });
  assert.throws(
    () => normalizeNonDoorAnalysis({ cabinets: [inconsistent] }, plan),
    /C01抽屜總數3與逐組合計2不一致；本次不產生料單/,
  );
});

test("non-door normalization rejects an inner-drawer total that does not close against its groups", () => {
  const plan = {
    projectName: "內抽數量閉合", drawingUnit: "mm", views: [], unresolved: [],
    cabinets: [{ cabinetId: "C01", elevationId: "E01", label: "內抽櫃", widthOrder: 1, bottomSegmentMm: 600, bottomDimensionText: "600", sourceCrops: [], confidence: "high", evidence: "單桶寬600" }],
  };
  const inconsistent = cabinet("C01", 1, 600, 736, {
    drawerCount: 2,
    innerDrawerCount: 1,
    drawerGroups: [{ ...drawer("D1", 2, 1), isInner: false }],
  });
  assert.throws(
    () => normalizeNonDoorAnalysis({ cabinets: [inconsistent] }, plan),
    /C01內抽總數1與逐組合計0不一致；本次不產生料單/,
  );
});

test("production non-door prompt contains no case answer leakage", () => {
  const NON_DOOR_INSTRUCTIONS = readFileSync(new URL("../app/api/non-door/route.ts", import.meta.url), "utf8");
  for (const leaked of ["55.2", "163.1", "227.2", "507×1468", "400×736", "YCX", "佛斯特"]) {
    assert.equal(NON_DOOR_INSTRUCTIONS.includes(leaked), false, leaked);
  }
  assert.match(NON_DOOR_INSTRUCTIONS, /門以外|固定SOP|D42\.6|抽屜|踢腳|鏡子/);
});
