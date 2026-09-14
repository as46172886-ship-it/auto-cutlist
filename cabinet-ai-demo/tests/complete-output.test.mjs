import assert from "node:assert/strict";
import test from "node:test";
import { calculateCompleteSop, doorHardwareClosureNote } from "../app/sop.ts";
import { compactProductionNote } from "../app/xlsx-export.ts";

function cabinet(overrides = {}) {
  return {
    id: "C01", name: "門板測試桶", cabinetKind: "floor", elevationId: "E01", widthChainId: "W1", widthOrder: 1,
    widthMm: 920, heightMm: 640, depthMm: 500, depthGroupId: "D1", depthSource: "explicit", depthEvidence: "D500",
    isHanging: false, underCountertop: false, fixedShelves: 0, fixedShelfPositionsMm: [], adjustableShelves: 0,
    slantedFixedShelfCount: 0, drawerCount: 0, sideBySideDrawers: false, innerDrawerCount: 0,
    footHeightMm: 100, footState: "present", topBoardRetreatMm: 0, bottomBoardRetreatMm: 0,
    specialBackStripCount: 0, specialBackStripState: "not_applicable", middleDividers: [], baffles: [], drawerGroups: [],
    doors: [], drawingNotes: [], confidence: "high", evidence: "完整桶身", ...overrides,
  };
}

test("complete mode includes 4E doors, hinges, dampers and slanted handles", () => {
  const result = calculateCompleteSop({ cabinets: [cabinet({
    doors: [{
      type: "4E", count: 2, countBasis: "symbols", doorSymbols: ["<", ">"],
      openingWidthMm: 920, openingHeightMm: 640, finishedWidthMm: 0, finishedHeightMm: 0,
      dimensionBasis: "opening", direction: "mixed", jHandleCount: 0,
      slantedHandle: true, slantedHandleCount: 2, slantedHandleStyle: "long",
      includesBottom30: false, includesSlantedGap24: true, slantedGap24Context: "door_chain_included",
      hingeCountPerDoor: 0, evidence: "兩個門面符號及2.4cm斜把縫",
    }],
  })] });
  const door = result.materials.find((row) => row.item === "4E門板");
  assert.deepEqual({ item: door?.item, spec: door?.spec, qty: door?.qty }, { item: "4E門板", spec: "457 × 612", qty: 2 });
  assert.match(door?.note || "", /長斜把×2/);
  assert.equal(result.hardware.find((row) => row.item === "GS鉸鍊")?.qty, 4);
  assert.equal(result.hardware.find((row) => row.item === "油壓器")?.qty, 2);
  assert.equal(result.hardware.find((row) => row.item === "斜手把")?.qty, 2);
  assert.match(result.notes.join("\n"), /門板／門五金閉合通過：4E門2片、GS鉸鍊4個、油壓器2個、J型手把0支、斜手把2個/);
});

test("door and hardware closure audit reports a transformed-output mismatch without rewriting it", () => {
  const source = cabinet({
    doors: [{
      type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"],
      openingWidthMm: 0, openingHeightMm: 0, finishedWidthMm: 457, finishedHeightMm: 636,
      dimensionBasis: "finished", direction: "right", jHandleCount: 1,
      slantedHandle: false, slantedHandleCount: 0, slantedHandleStyle: "none",
      includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "none",
      hingeCountPerDoor: 0, evidence: "完成門面與J把",
    }],
  });
  const note = doorHardwareClosureNote([source], [
    { item: "4E門板", spec: "457 × 636", qty: 1, note: "右開" },
  ], [
    { item: "GS鉸鍊", qty: 2, unit: "個", note: "" },
    { item: "油壓器", qty: 1, unit: "個", note: "" },
    { item: "J型手把", qty: 1, unit: "支", note: "" },
  ], 0, 0);
  assert.match(note, /J把備註0／應1/);
  assert.match(note, /保留原始數量並要求人工確認/);
});

test("locked door symbols override a stale direction field in production notes", () => {
  const result = calculateCompleteSop({ cabinets: [cabinet({
    doors: [{
      type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"],
      openingWidthMm: 0, openingHeightMm: 0, finishedWidthMm: 457, finishedHeightMm: 636,
      dimensionBasis: "finished", direction: "left", jHandleCount: 1,
      slantedHandle: false, slantedHandleCount: 0, slantedHandleStyle: "none",
      includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "none",
      hingeCountPerDoor: 0, evidence: "原圖門面葉片內右開符號>清楚",
    }],
  })] });
  const door = result.materials.find((row) => row.item === "4E門板");
  assert.match(door?.note || "", /右開／J把×1/);
  assert.doesNotMatch(door?.note || "", /左開/);
  assert.equal(result.hardware.find((row) => row.item === "GS鉸鍊")?.qty, 2);
  assert.equal(result.hardware.find((row) => row.item === "油壓器")?.qty, 1);
  assert.equal(result.hardware.find((row) => row.item === "J型手把")?.qty, 1);
});

test("complete mode combines drawer and door slanted-handle quantities", () => {
  const result = calculateCompleteSop({ cabinets: [cabinet({
    drawerCount: 5,
    drawerGroups: [{ id: "DG1", count: 5, openingWidthMm: 460, openingHeightMm: 201, drawerWallHeightMm: 120, isInner: false, sideBySide: false, usesCenterlineWidth: false, centerlineBoundaryCount: 0, slantedHandle: true, fixedShelfPositionMm: 0, evidence: "圖註下斜把" }],
    doors: [{
      type: "4E", count: 2, countBasis: "symbols", doorSymbols: ["<", ">"],
      openingWidthMm: 920, openingHeightMm: 640, finishedWidthMm: 0, finishedHeightMm: 0,
      dimensionBasis: "opening", direction: "mixed", jHandleCount: 0,
      slantedHandle: true, slantedHandleCount: 2, slantedHandleStyle: "long",
      includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "already_separate",
      hingeCountPerDoor: 0, evidence: "長斜把",
    }],
  })] });
  assert.equal(result.hardware.find((row) => row.item === "斜手把")?.qty, 7);
  assert.match(result.materials.find((row) => row.item === "屜頭")?.note || "", /下斜把×5/);
});

test("reliable color-marker evidence cross-checks but never changes slanted-handle output", () => {
  const result = calculateCompleteSop({
    slantedHandleMarkerEvidence: { count: 3, reliable: true, sourceImageName: "彩色門面" },
    cabinets: [cabinet({
      drawerCount: 2,
      drawerGroups: [{ id: "DG1", count: 2, openingWidthMm: 460, openingHeightMm: 201, drawerWallHeightMm: 120, isInner: false, sideBySide: false, usesCenterlineWidth: false, centerlineBoundaryCount: 0, slantedHandle: true, fixedShelfPositionMm: 0, evidence: "圖註下斜把" }],
    })],
  });
  assert.equal(result.hardware.find((row) => row.item === "斜手把")?.qty, 2);
  assert.match(result.notes.join("\n"), /彩色加工標記3、門板／屜頭備註2、斜手把五金2/);
  assert.match(result.notes.join("\n"), /不自動改數量/);
});

test("D500 drawers use the corrected dowel tier while shallow drawers keep the prior tier", () => {
  const group = {
    id: "DG1", count: 1, openingWidthMm: 460, openingHeightMm: 201, drawerWallHeightMm: 0,
    isInner: false, sideBySide: false, usesCenterlineWidth: false, centerlineBoundaryCount: 0,
    slantedHandle: false, fixedShelfPositionMm: 0, evidence: "一抽",
  };
  const deep = calculateCompleteSop({ cabinets: [cabinet({ drawerCount: 1, drawerGroups: [group] })] });
  const shallow = calculateCompleteSop({ cabinets: [cabinet({ depthMm: 426, drawerCount: 1, drawerGroups: [group] })] });
  assert.equal(deep.hardware.find((row) => row.item === "抽木榫")?.qty, 16);
  assert.equal(shallow.hardware.find((row) => row.item === "抽木榫")?.qty, 20);
  assert.match(deep.hardware.find((row) => row.item === "抽木榫")?.note || "", /不再拆成櫃體8＋抽屜12/);
});

test("complete mode aggregates mixed door directions across cabinets with the same finished size", () => {
  const lowerDoor = (symbols) => ({
    type: "4E", count: symbols.length, countBasis: "symbols", doorSymbols: symbols,
    openingWidthMm: 0, openingHeightMm: 0, finishedWidthMm: 457, finishedHeightMm: 415,
    dimensionBasis: "finished", direction: symbols.every((symbol) => symbol === "<") ? "left"
      : symbols.every((symbol) => symbol === ">") ? "right" : "mixed",
    jHandleCount: 0, slantedHandle: true, slantedHandleCount: symbols.length, slantedHandleStyle: "top",
    includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "already_separate",
    hingeCountPerDoor: 0, evidence: `門面符號${symbols.join("")}`,
  });
  const result = calculateCompleteSop({
    cabinets: [
      cabinet({ id: "C01", name: "下櫃1", widthMm: 460, doors: [lowerDoor(["<"])] }),
      cabinet({ id: "C02", name: "下櫃2", widthOrder: 2, doors: [lowerDoor(["<", ">"])] }),
      cabinet({ id: "C03", name: "下櫃3", widthOrder: 3, doors: [lowerDoor(["<", ">"])] }),
    ],
  });
  const door = result.materials.find((row) => row.item === "4E門板" && row.spec === "457 × 415");
  assert.deepEqual({ qty: door?.qty, note: compactProductionNote(door?.note || "", door?.item, door?.spec) }, {
    qty: 5,
    note: "3左、2右，上斜把",
  });
  assert.equal(result.hardware.find((row) => row.item === "GS鉸鍊")?.qty, 10);
  assert.equal(result.hardware.find((row) => row.item === "油壓器")?.qty, 5);
  assert.equal(result.hardware.find((row) => row.item === "斜手把")?.qty, 5);
});

test("complete mode merges within an elevation but preserves identical rows across elevations", () => {
  const oneDoor = (symbol) => ({
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [symbol],
    openingWidthMm: 0, openingHeightMm: 0, finishedWidthMm: 457, finishedHeightMm: 636,
    dimensionBasis: "finished", direction: symbol === "<" ? "left" : "right", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, slantedHandleStyle: "none",
    includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "none",
    hingeCountPerDoor: 0, evidence: `門面符號${symbol}`,
  });
  const result = calculateCompleteSop({
    cabinets: [
      cabinet({ id: "E1-C1", elevationId: "E01", doors: [oneDoor("<")] }),
      cabinet({ id: "E1-C2", elevationId: "E01", widthOrder: 2, doors: [oneDoor(">")], footState: "absent", footHeightMm: 0 }),
      cabinet({ id: "E2-C1", elevationId: "E02", doors: [oneDoor("<")] }),
    ],
    kickboards: [
      { id: "E1-K", elevationId: "E01", siteLengthMm: 1000, evidence: "立面1" },
      { id: "E2-K", elevationId: "E02", siteLengthMm: 1000, evidence: "立面2" },
    ],
    specialHardware: [
      { elevationId: "E01", item: "測試五金", qty: 2, unit: "個", evidence: "立面1" },
      { elevationId: "E02", item: "測試五金", qty: 3, unit: "個", evidence: "立面2" },
    ],
  });
  assert.deepEqual(result.hardware.filter((row) => row.item === "KD").map((row) => row.qty), [24, 12]);
  assert.deepEqual(result.hardware.filter((row) => row.item === "GS鉸鍊").map((row) => row.qty), [4, 2]);
  assert.deepEqual(result.hardware.filter((row) => row.item === "測試五金").map((row) => row.qty), [2, 3]);
  assert.deepEqual(result.materials.filter((row) => row.item === "踢腳板").map((row) => row.qty), [1, 1]);
  assert.deepEqual(result.materials.filter((row) => row.item === "4E門板").map((row) => row.qty), [2, 1]);
  assert.equal(result.materials.some((row) => "groupId" in row), false);
  assert.equal(result.hardware.some((row) => "groupId" in row), false);
});

test("complete mode never emits slanted-handle hardware without its finished door", () => {
  const unresolvedDoor = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [">"],
    openingWidthMm: 0, openingHeightMm: 0, finishedWidthMm: 0, finishedHeightMm: 0,
    dimensionBasis: "unknown", direction: "right", jHandleCount: 0,
    slantedHandle: true, slantedHandleCount: 1, slantedHandleStyle: "long",
    includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "unknown",
    hingeCountPerDoor: 0, evidence: "只有門向，尺寸未閉合",
  };
  const result = calculateCompleteSop({
    cabinets: [cabinet({
      doors: [unresolvedDoor],
    })],
  });
  assert.equal(result.materials.some((row) => row.item === "4E門板"), false);
  assert.equal(result.hardware.some((row) => row.item === "斜手把"), false);
});

test("complete mode blocks a cut list when declared drawers cannot all produce drawer fronts", () => {
  assert.throws(
    () => calculateCompleteSop({
      cabinets: [cabinet({
        drawerCount: 2,
        drawerGroups: [{ id: "DG-X", count: 2, openingWidthMm: 460, openingHeightMm: 0, slantedHandle: false, evidence: "屜頭高度未讀到" }],
      })],
    }),
    (error) => error?.code === "drawer_front_incomplete"
      && error?.status === 422
      && /C01.*抽屜2.*可產生屜頭0片/.test(error.message),
  );
});

test("every declared drawer closes to exactly one finished drawer front", () => {
  const completeGroup = {
    drawerWallHeightMm: 0, isInner: false, sideBySide: false, usesCenterlineWidth: false,
    centerlineBoundaryCount: 0, slantedHandle: false, fixedShelfPositionMm: 0, evidence: "圖面完成屜頭",
  };
  const result = calculateCompleteSop({
    cabinets: [cabinet({
      drawerCount: 3,
      drawerGroups: [
        { ...completeGroup, id: "DG-A", count: 2, openingWidthMm: 460, openingHeightMm: 201 },
        { ...completeGroup, id: "DG-B", count: 1, openingWidthMm: 920, openingHeightMm: 180 },
      ],
    })],
  });
  assert.equal(result.materials.filter((row) => row.item === "屜頭").reduce((sum, row) => sum + row.qty, 0), 3);
});

test("an impossible J-handle count is blocked from production hardware", () => {
  const door = {
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: ["<"],
    openingWidthMm: 400, openingHeightMm: 700, finishedWidthMm: 0, finishedHeightMm: 0,
    dimensionBasis: "opening", direction: "left", jHandleCount: 2,
    slantedHandle: false, slantedHandleCount: 0, slantedHandleStyle: "none",
    includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "none",
    hingeCountPerDoor: 0, evidence: "一片門卻誤讀兩個J把",
  };
  const result = calculateCompleteSop({ cabinets: [cabinet({ doors: [door] })] });
  assert.equal(result.hardware.some((row) => row.item === "J型手把"), false);
  assert.match(result.notes.join(" "), /J把加工數2支超過4E門1片/);
});

test("J-handle and slanted-handle counts cannot reuse the same door leaf", () => {
  const door = {
    type: "4E", count: 2, countBasis: "symbols", doorSymbols: ["<", ">"],
    openingWidthMm: 800, openingHeightMm: 700, finishedWidthMm: 0, finishedHeightMm: 0,
    dimensionBasis: "opening", direction: "mixed", jHandleCount: 1,
    slantedHandle: true, slantedHandleCount: 2, slantedHandleStyle: "long",
    includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "already_separate",
    hingeCountPerDoor: 0, evidence: "兩片門卻合計三個互斥手把加工",
  };
  const result = calculateCompleteSop({ cabinets: [cabinet({ doors: [door] })] });
  assert.equal(result.materials.some((row) => row.item === "4E門板"), false);
  assert.equal(result.hardware.some((row) => /GS鉸鍊|油壓器|J型手把|斜手把/.test(row.item)), false);
  assert.match(result.notes.join(" "), /J把1支＋斜把2支超過4E門2片/);
  assert.match(result.notes.join(" "), /同一門片不可重複套兩種手把/);
});

test("hinges are calculated per finished door height before hardware rows merge", () => {
  const door = (finishedHeightMm, symbol) => ({
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [symbol],
    openingWidthMm: 0, openingHeightMm: 0, finishedWidthMm: 400, finishedHeightMm,
    dimensionBasis: "finished", direction: symbol === "<" ? "left" : "right", jHandleCount: 0,
    slantedHandle: false, slantedHandleCount: 0, slantedHandleStyle: "none",
    includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "none",
    hingeCountPerDoor: 0, evidence: `完成門高${finishedHeightMm}`,
  });
  const result = calculateCompleteSop({ cabinets: [cabinet({ doors: [door(959, "<"), door(960, ">")] })] });
  assert.equal(result.hardware.find((row) => row.item === "GS鉸鍊")?.qty, 5);
  assert.equal(result.hardware.find((row) => row.item === "油壓器")?.qty, 2);
  assert.match(result.hardware.find((row) => row.item === "GS鉸鍊")?.note || "", /門高959mm：1片×每片2個=2/);
  assert.match(result.hardware.find((row) => row.item === "GS鉸鍊")?.note || "", /門高960mm：1片×每片3個=3/);
  assert.match(result.hardware.find((row) => row.item === "油壓器")?.note || "", /普通4E門2片×每片1個=2/);
});

test("merged same-size doors keep closed hinge, damper and J-handle provenance", () => {
  const door = (symbol, jHandleCount) => ({
    type: "4E", count: 1, countBasis: "symbols", doorSymbols: [symbol],
    openingWidthMm: 0, openingHeightMm: 0, finishedWidthMm: 457, finishedHeightMm: 636,
    dimensionBasis: "finished", direction: symbol === "<" ? "left" : "right", jHandleCount,
    slantedHandle: false, slantedHandleCount: 0, slantedHandleStyle: "none",
    includesBottom30: false, includesSlantedGap24: false, slantedGap24Context: "none",
    hingeCountPerDoor: 0, evidence: "完成門面與門向",
  });
  const result = calculateCompleteSop({ cabinets: [cabinet({ doors: [door("<", 1), door(">", 0)] })] });
  const doorRow = result.materials.find((row) => row.item === "4E門板" && row.spec === "457 × 636");
  assert.equal(doorRow?.qty, 2);
  assert.match(doorRow?.note || "", /左開.*J把×1/);
  assert.match(doorRow?.note || "", /右開/);
  assert.deepEqual(result.hardware.filter((row) => /GS鉸鍊|油壓器|J型手把/.test(row.item)).map((row) => [row.item, row.qty]), [
    ["油壓器", 2], ["GS鉸鍊", 4], ["J型手把", 1],
  ]);
  assert.match(result.hardware.find((row) => row.item === "GS鉸鍊")?.note || "", /門高636mm：2片×每片2個=4；合計4個/);
  assert.match(result.hardware.find((row) => row.item === "油壓器")?.note || "", /普通4E門2片×每片1個=2/);
  assert.match(result.hardware.find((row) => row.item === "J型手把")?.note || "", /實際J把加工門片1片=1支/);
  assert.equal(compactProductionNote(doorRow?.note || "", doorRow?.item, doorRow?.spec), "右開；左開J把×1");
});

test("fake door panels remain material-only and never create door hardware", () => {
  const result = calculateCompleteSop({
    cabinets: [cabinet()],
    independentPanels: [{
      id: "FP1", name: "假門板", count: 2, widthMm: 120, heightMm: 636, thicknessMm: 18,
      grainDirection: "none", dimensionOrder: "width_height", note: "固定飾板", evidence: "圖面確認非功能門",
    }],
  });
  assert.deepEqual(result.materials.find((row) => row.item === "假門板"), {
    item: "假門板", spec: "120 × 636", thicknessMm: 18, qty: 2,
    note: "[R34/R35/R65] 圖面確認2片／18mm／固定飾板",
  });
  assert.equal(result.hardware.some((row) => /鉸鍊|油壓器|J.*手把|斜手把/.test(row.item)), false);
});
