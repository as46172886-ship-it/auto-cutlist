const boardProfile = {
  bodyThicknessMm: 18,
  backThicknessMm: 8,
  drawerBottomThicknessMm: 8,
  deductionBasis: "standard_sop",
  topBottomWidthDeductionMm: 36,
  backWidthDeductionMm: 26,
  backHeightDeductionMm: 26,
  fixedShelfDepthDeductionMm: 29,
  fixedShelfWidthDeductionMm: 36,
  adjustableShelfDepthDeductionMm: 40,
  adjustableShelfWidthDeductionMm: 37,
};

function cabinet(id, order, widthMm, depthMm, extra = {}) {
  return {
    id,
    name: id,
    cabinetKind: "floor",
    elevationId: "E01",
    widthChainId: "W01",
    widthOrder: order,
    widthMm,
    heightMm: 640,
    depthMm,
    depthGroupId: depthMm === 500 ? "D500" : "D350",
    depthSource: "explicit",
    depthEvidence: `圖面D${depthMm}`,
    isHanging: false,
    underCountertop: false,
    fixedShelves: 0,
    fixedShelfPositionsMm: [],
    adjustableShelves: 0,
    slantedFixedShelfCount: 0,
    drawerCount: 0,
    sideBySideDrawers: false,
    innerDrawerCount: 0,
    footHeightMm: 0,
    footState: "absent",
    topBoardRetreatMm: 0,
    bottomBoardRetreatMm: 0,
    specialBackStripCount: 0,
    specialBackStripState: "not_applicable",
    boardProfile,
    middleDividers: [],
    baffles: [],
    drawerGroups: [],
    doors: [],
    drawingNotes: [],
    confidence: "high",
    evidence: "佛斯特置物櫃2完整桶身圖據",
    ...extra,
  };
}

function door(symbols, heightMm, slantedHandleStyle) {
  return {
    type: "4E",
    count: symbols.length,
    countBasis: "symbols",
    doorSymbols: symbols,
    openingWidthMm: 0,
    openingHeightMm: 0,
    finishedWidthMm: 457,
    finishedHeightMm: heightMm,
    dimensionBasis: "finished",
    direction: symbols.every((symbol) => symbol === "<") ? "left"
      : symbols.every((symbol) => symbol === ">") ? "right" : "mixed",
    jHandleCount: 0,
    slantedHandle: true,
    slantedHandleCount: symbols.length,
    slantedHandleStyle,
    includesBottom30: false,
    includesSlantedGap24: false,
    slantedGap24Context: "already_separate",
    hingeCountPerDoor: 0,
    evidence: `圖面完成門面457×${heightMm}及${symbols.join("")}符號`,
  };
}

function drawerGroup(id, count, centerlineBoundaryCount) {
  return {
    id,
    count,
    openingWidthMm: 460,
    openingHeightMm: 201,
    drawerWallHeightMm: 0,
    isInner: false,
    sideBySide: count > 1,
    usesCenterlineWidth: centerlineBoundaryCount > 0,
    centerlineBoundaryCount,
    slantedHandle: true,
    fixedShelfPositionMm: 0,
    regionPosition: "top",
    evidence: "圖面完成屜頭201，下斜把",
  };
}

function baffle(id) {
  return {
    id,
    heightMm: 60,
    widthMm: 0,
    kind: "drawer_60",
    mountBasis: "fixed_shelf",
    widthBasis: "cabinet_inner",
    splitAtMiddleDivider: false,
    segmentGroupId: id,
    segmentIndex: 1,
    segmentCount: 1,
    evidence: "抽屜斜把擋板",
  };
}

function lowerCabinet(id, order, widthMm, symbols, count, centerlineBoundaryCount, extra = {}) {
  return cabinet(id, order, widthMm, 500, {
    footHeightMm: 100,
    footState: "present",
    adjustableShelves: 1,
    drawerCount: count,
    sideBySideDrawers: count > 1,
    drawerGroups: [drawerGroup(`${id}-drawer`, count, centerlineBoundaryCount)],
    baffles: [baffle(`${id}-baffle`)],
    doors: [door(symbols, 415, "top")],
    ...extra,
  });
}

const shortDivider = (id) => ({
  depthMm: 0,
  heightMm: 0,
  referenceSpanMm: 201,
  depthBasis: "standard_d_minus_29",
  heightBasis: "connection_span",
  region: "並排抽屜區",
  topConnection: "top_board",
  bottomConnection: "fixed_shelf_full",
  evidence: `${id}上接頂板、下接固格`,
});

export const fosterStorage2Structured = {
  cabinets: [
    lowerCabinet("C01", 1, 460, ["<"], 1, 0),
    lowerCabinet("C02", 2, 920, ["<", ">"], 2, 1, {
      fixedShelves: 1,
      fixedShelfPositionsMm: [201],
      slantedFixedShelfCount: 1,
      middleDividers: [shortDivider("C02")],
    }),
    lowerCabinet("C03", 3, 920, ["<", ">"], 2, 1, {
      fixedShelves: 1,
      fixedShelfPositionsMm: [201],
      slantedFixedShelfCount: 1,
      middleDividers: [shortDivider("C03")],
    }),
    cabinet("C04", 4, 460, 350, { adjustableShelves: 1, doors: [door(["<"], 634, "long")] }),
    cabinet("C05", 5, 460, 350, { adjustableShelves: 1, doors: [door([">"], 634, "long")] }),
  ],
  independentPanels: [
    { id: "FP1", elevationId: "E01", name: "假門板", count: 2, widthMm: 120, heightMm: 636, thicknessMm: 18, grainDirection: "none", dimensionOrder: "width_height", note: "", evidence: "圖面固定飾板" },
    { id: "T1", elevationId: "E01", name: "檯面", count: 1, widthMm: 540, heightMm: 2348, thicknessMm: 25, grainDirection: "none", dimensionOrder: "width_height", note: "1L2SA", evidence: "圖面完成尺寸" },
    { id: "T2", elevationId: "E01", name: "檯面", count: 1, widthMm: 390, heightMm: 2348, thicknessMm: 25, grainDirection: "none", dimensionOrder: "width_height", note: "1L2SA", evidence: "圖面完成尺寸" },
  ],
  kickboards: [{ id: "K1", elevationId: "E01", siteLengthMm: 2348, evidence: "底部總長2348" }],
  mirrors: [],
  specialHardware: [],
};
