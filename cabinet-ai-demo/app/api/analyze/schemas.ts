const confidence = { type: "string", enum: ["high", "medium", "low"] };

export const orientationAuditSchema = {
  type: "object",
  additionalProperties: false,
  required: ["images"],
  properties: {
    images: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["imageName", "rotationToUprightDeg", "uprightTextEvidence", "numberDirectionEvidence", "widthDirectionEvidence", "bottomHorizontalDimensionTexts", "sideVerticalDimensionTexts", "orientationBasis", "confidence"],
        properties: {
          imageName: { type: "string" },
          rotationToUprightDeg: { type: "integer", enum: [0, 90, 180, 270] },
          uprightTextEvidence: { type: "string" },
          numberDirectionEvidence: { type: "string" },
          widthDirectionEvidence: { type: "string" },
          bottomHorizontalDimensionTexts: { type: "array", items: { type: "string" } },
          sideVerticalDimensionTexts: { type: "array", items: { type: "string" } },
          orientationBasis: { type: "string", enum: ["numbers_and_width_agree", "numbers_only", "width_only", "conflict", "insufficient"] },
          confidence,
        },
      },
    },
  },
};

const normalizedCropBoxSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "width", "height"],
  properties: {
    x: { type: "integer", minimum: 0, maximum: 1000 },
    y: { type: "integer", minimum: 0, maximum: 1000 },
    width: { type: "integer", minimum: 1, maximum: 1000 },
    height: { type: "integer", minimum: 1, maximum: 1000 },
  },
};

export const cabinetSegmentationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["projectName", "drawingUnit", "views", "cabinets", "unresolved"],
  properties: {
    projectName: { type: "string" },
    drawingUnit: { type: "string", enum: ["cm", "mm", "mixed", "unknown"] },
    views: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["imageName", "viewKind", "elevationId", "rotationToUprightDeg", "evidence"],
        properties: {
          imageName: { type: "string" },
          viewKind: { type: "string", enum: ["internal", "door", "front", "side", "detail", "dimension", "unknown"] },
          elevationId: { type: "string" },
          rotationToUprightDeg: { type: "integer", enum: [0, 90, 180, 270] },
          evidence: { type: "string" },
        },
      },
    },
    cabinets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cabinetId", "elevationId", "label", "widthOrder", "bottomSegmentMm", "bottomDimensionText", "sourceCrops", "confidence", "evidence"],
        properties: {
          cabinetId: { type: "string" },
          elevationId: { type: "string" },
          label: { type: "string" },
          widthOrder: { type: "integer", minimum: 1 },
          bottomSegmentMm: { type: "number" },
          bottomDimensionText: { type: "string" },
          sourceCrops: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["cropId", "sourceImageName", "role", "rotationToUprightDeg", "box", "region", "evidence"],
              properties: {
                cropId: { type: "string" },
                sourceImageName: { type: "string" },
                role: { type: "string", enum: ["door", "internal", "front", "dimension", "detail"] },
                rotationToUprightDeg: { type: "integer", enum: [0, 90, 180, 270] },
                box: normalizedCropBoxSchema,
                region: { type: "string" },
                evidence: { type: "string" },
              },
            },
          },
          confidence,
          evidence: { type: "string" },
        },
      },
    },
    unresolved: { type: "array", items: { type: "string" } },
  },
};

export const internalCropRepairSchema = {
  type: "object",
  additionalProperties: false,
  required: ["repairs", "unresolved"],
  properties: {
    repairs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cabinetId", "sourceImageName", "rotationToUprightDeg", "box", "region", "evidence"],
        properties: {
          cabinetId: { type: "string" },
          sourceImageName: { type: "string" },
          rotationToUprightDeg: { type: "integer", enum: [0, 90, 180, 270] },
          box: normalizedCropBoxSchema,
          region: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    unresolved: { type: "array", items: { type: "string" } },
  },
};

const dimensionMarkSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "imageName", "rawText", "sourceValue", "sourceUnit", "valueMm", "kind", "orientation", "region", "targets", "confidence", "evidence"],
  properties: {
    id: { type: "string" },
    imageName: { type: "string" },
    rawText: { type: "string" },
    sourceValue: { type: "number" },
    sourceUnit: { type: "string", enum: ["cm", "mm", "unknown"] },
    valueMm: { type: "number" },
    kind: { type: "string", enum: ["total_width", "module_width", "total_height", "cabinet_height", "depth", "foot_height", "door_height", "opening_height", "fixed_shelf_position", "slanted_handle_gap", "clearance_gap", "board_thickness", "countertop_thickness", "panel", "other", "unknown"] },
    orientation: { type: "string", enum: ["horizontal", "vertical", "depth_arrow", "note", "unknown"] },
    region: { type: "string" },
    targets: { type: "array", items: { type: "string" } },
    confidence,
    evidence: { type: "string" },
  },
};

const depthGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "elevationId", "region", "depthMm", "appliesTo", "source", "confidence", "evidence"],
  properties: {
    id: { type: "string" },
    elevationId: { type: "string" },
    region: { type: "string" },
    depthMm: { type: "number" },
    appliesTo: { type: "array", items: { type: "string" } },
    source: { type: "string", enum: ["explicit_dimension", "shared_note", "side_view", "matching_view", "user_confirmed", "unknown"] },
    confidence,
    evidence: { type: "string" },
  },
};

export const dimensionLedgerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["projectName", "drawingUnit", "imageViews", "dimensions", "depthGroups", "unresolved"],
  properties: {
    projectName: { type: "string" },
    drawingUnit: { type: "string", enum: ["cm", "mm", "mixed", "unknown"] },
    imageViews: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["imageName", "viewKind", "elevationId", "region", "rotationToUprightDeg", "notes"],
        properties: {
          imageName: { type: "string" },
          viewKind: { type: "string", enum: ["internal", "door", "front", "side", "detail", "dimension", "unknown"] },
          elevationId: { type: "string" },
          region: { type: "string" },
          rotationToUprightDeg: { type: "integer", enum: [0, 90, 180, 270] },
          notes: { type: "string" },
        },
      },
    },
    dimensions: { type: "array", items: dimensionMarkSchema },
    depthGroups: { type: "array", items: depthGroupSchema },
    unresolved: { type: "array", items: { type: "string" } },
  },
};

export const doorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "count", "countBasis", "doorSymbols", "openingWidthMm", "openingHeightMm", "finishedWidthMm", "finishedHeightMm", "dimensionBasis", "direction", "jHandleCount", "slantedHandle", "slantedHandleCount", "slantedHandleStyle", "includesBottom30", "includesSlantedGap24", "slantedGap24Context", "hingeCountPerDoor", "evidence"],
  properties: {
    type: { type: "string", enum: ["4E", "aluminum", "none"] },
    count: { type: "integer", minimum: 0 },
    countBasis: { type: "string", enum: ["symbols", "leaf_geometry", "explicit_note", "user_confirmed", "unknown"] },
    doorSymbols: { type: "array", items: { type: "string", enum: ["<", ">"] } },
    openingWidthMm: { type: "number" },
    openingHeightMm: { type: "number" },
    finishedWidthMm: { type: "number" },
    finishedHeightMm: { type: "number" },
    dimensionBasis: { type: "string", enum: ["opening", "finished", "unknown"] },
    direction: { type: "string", enum: ["left", "right", "mixed", "unknown"] },
    jHandleCount: { type: "integer", minimum: 0 },
    slantedHandle: { type: "boolean" },
    slantedHandleCount: { type: "integer", minimum: 0 },
    slantedHandleStyle: { type: "string", enum: ["top", "bottom", "long", "none", "unknown"] },
    includesBottom30: { type: "boolean" },
    includesSlantedGap24: { type: "boolean" },
    slantedGap24Context: { type: "string", enum: ["none", "door_chain_included", "already_separate", "stacked_lift", "unknown"] },
    hingeCountPerDoor: { type: "integer", minimum: 0 },
    evidence: { type: "string" },
  },
};

const excludedDoorSurfaceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["classification", "region", "evidence"],
  properties: {
    classification: { type: "string", enum: ["drawer_front", "aluminum_frame", "internal_board_line", "fixed_panel", "dimension_mark", "other_not_door"] },
    region: { type: "string" },
    evidence: { type: "string" },
  },
};

const doorSymbolRegionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["symbol", "cropName", "region", "xPermille", "yPermille", "evidence"],
  properties: {
    symbol: { type: "string", enum: ["<", ">"] },
    cropName: { type: "string" },
    region: { type: "string" },
    xPermille: { type: "integer", minimum: 0, maximum: 1000 },
    yPermille: { type: "integer", minimum: 0, maximum: 1000 },
    evidence: { type: "string" },
  },
};

const doorRecognitionDoorSchema = {
  ...doorSchema,
  required: [...doorSchema.required, "symbolRegions"],
  properties: {
    ...doorSchema.properties,
    symbolRegions: { type: "array", items: doorSymbolRegionSchema },
  },
};

export const doorRecognitionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cabinetDoors", "unresolved"],
  properties: {
    cabinetDoors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cabinetId", "status", "sourceImageName", "region", "doors", "excludedSurfaces", "unresolvedDoorRegions", "confidence", "evidence"],
        properties: {
          cabinetId: { type: "string" },
          status: { type: "string", enum: ["confirmed_4e", "confirmed_no_4e", "partial", "unknown"] },
          sourceImageName: { type: "string" },
          region: { type: "string" },
          doors: { type: "array", items: doorRecognitionDoorSchema },
          excludedSurfaces: { type: "array", items: excludedDoorSurfaceSchema },
          unresolvedDoorRegions: { type: "array", items: { type: "string" } },
          confidence,
          evidence: { type: "string" },
        },
      },
    },
    unresolved: { type: "array", items: { type: "string" } },
  },
};

const dividerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["depthMm", "heightMm", "referenceSpanMm", "depthBasis", "heightBasis", "region", "topConnection", "bottomConnection", "evidence"],
  properties: {
    depthMm: { type: "number" },
    heightMm: { type: "number" },
    referenceSpanMm: { type: "number" },
    depthBasis: { type: "string", enum: ["standard_d_minus_29", "finished", "unknown"] },
    heightBasis: { type: "string", enum: ["connection_span", "finished", "unknown"] },
    region: { type: "string" },
    topConnection: { type: "string", enum: ["top_board", "bottom_board", "fixed_shelf_full", "fixed_shelf_centerline", "unknown"] },
    bottomConnection: { type: "string", enum: ["top_board", "bottom_board", "fixed_shelf_full", "fixed_shelf_centerline", "unknown"] },
    evidence: { type: "string" },
  },
};

const baffleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "heightMm", "widthMm", "kind", "mountBasis", "widthBasis", "splitAtMiddleDivider", "segmentGroupId", "segmentIndex", "segmentCount", "evidence"],
  properties: {
    id: { type: "string" },
    heightMm: { type: "number" },
    widthMm: { type: "number" },
    kind: { type: "string", enum: ["drawer_60", "door_50", "other"] },
    mountBasis: { type: "string", enum: ["top_board", "fixed_shelf", "raised_bottom", "other", "unknown"] },
    widthBasis: { type: "string", enum: ["cabinet_inner", "finished_segment", "unknown"] },
    splitAtMiddleDivider: { type: "boolean" },
    segmentGroupId: { type: "string" },
    segmentIndex: { type: "integer", minimum: 1 },
    segmentCount: { type: "integer", minimum: 1 },
    evidence: { type: "string" },
  },
};

const boardProfileSchema = {
  type: "object",
  additionalProperties: false,
  required: ["bodyThicknessMm", "backThicknessMm", "drawerBottomThicknessMm", "deductionBasis", "topBottomWidthDeductionMm", "backWidthDeductionMm", "backHeightDeductionMm", "fixedShelfDepthDeductionMm", "fixedShelfWidthDeductionMm", "adjustableShelfDepthDeductionMm", "adjustableShelfWidthDeductionMm"],
  properties: {
    bodyThicknessMm: { type: "number" },
    backThicknessMm: { type: "number" },
    drawerBottomThicknessMm: { type: "number" },
    deductionBasis: { type: "string", enum: ["standard_sop", "user_confirmed", "unknown"] },
    topBottomWidthDeductionMm: { type: "number" },
    backWidthDeductionMm: { type: "number" },
    backHeightDeductionMm: { type: "number" },
    fixedShelfDepthDeductionMm: { type: "number" },
    fixedShelfWidthDeductionMm: { type: "number" },
    adjustableShelfDepthDeductionMm: { type: "number" },
    adjustableShelfWidthDeductionMm: { type: "number" },
  },
};

const drawerGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "count", "openingWidthMm", "openingHeightMm", "drawerWallHeightMm", "isInner", "sideBySide", "usesCenterlineWidth", "centerlineBoundaryCount", "slantedHandle", "fixedShelfPositionMm", "regionPosition", "evidence"],
  properties: {
    id: { type: "string" },
    count: { type: "integer", minimum: 0 },
    openingWidthMm: { type: "number" },
    openingHeightMm: { type: "number" },
    drawerWallHeightMm: { type: "number" },
    isInner: { type: "boolean" },
    sideBySide: { type: "boolean" },
    usesCenterlineWidth: { type: "boolean" },
    centerlineBoundaryCount: { type: "integer", minimum: 0, maximum: 2 },
    slantedHandle: { type: "boolean" },
    fixedShelfPositionMm: { type: "number" },
    regionPosition: { type: "string", enum: ["top", "middle", "bottom", "unknown"] },
    evidence: { type: "string" },
  },
};

const componentRegionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["region", "classification", "sopRuleIds", "quantity", "widthMm", "heightMm", "depthMm", "confidence", "evidence"],
  properties: {
    region: { type: "string" },
    classification: {
      type: "string",
      enum: ["side_panel", "top_board", "bottom_board", "back_panel", "back_strip", "fixed_shelf", "adjustable_shelf", "middle_divider", "baffle", "drawer", "drawer_front", "four_e_door", "aluminum_door", "fixed_panel", "mirror", "kickboard", "independent_panel", "hardware", "dimension_mark", "unknown"],
    },
    sopRuleIds: { type: "array", items: { type: "string" } },
    quantity: { type: "integer", minimum: 0 },
    widthMm: { type: "number" },
    heightMm: { type: "number" },
    depthMm: { type: "number" },
    confidence,
    evidence: { type: "string" },
  },
};

const cabinetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "cabinetKind", "elevationId", "widthChainId", "widthOrder", "widthMm", "widthDimensionIds", "heightMm", "heightDimensionIds", "depthMm", "depthGroupId", "depthSource", "depthEvidence", "isHanging", "underCountertop", "fixedShelves", "fixedShelfPositionsMm", "adjustableShelves", "slantedFixedShelfCount", "drawerCount", "sideBySideDrawers", "innerDrawerCount", "footHeightMm", "footState", "topBoardRetreatMm", "bottomBoardRetreatMm", "specialBackStripCount", "specialBackStripState", "boardProfile", "middleDividers", "baffles", "drawerGroups", "doors", "componentRegions", "drawingNotes", "confidence", "evidence"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    cabinetKind: { type: "string", enum: ["floor", "hanging", "stacked", "tv", "mirror", "special"] },
    elevationId: { type: "string" },
    widthChainId: { type: "string" },
    widthOrder: { type: "integer" },
    widthMm: { type: "number" },
    widthDimensionIds: { type: "array", items: { type: "string" } },
    heightMm: { type: "number" },
    heightDimensionIds: { type: "array", items: { type: "string" } },
    depthMm: { type: "number" },
    depthGroupId: { type: "string" },
    depthSource: { type: "string", enum: ["explicit", "shared_group", "user_confirmed", "unknown"] },
    depthEvidence: { type: "string" },
    isHanging: { type: "boolean" },
    underCountertop: { type: "boolean" },
    fixedShelves: { type: "integer", minimum: 0 },
    fixedShelfPositionsMm: { type: "array", items: { type: "number" } },
    adjustableShelves: { type: "integer", minimum: 0 },
    slantedFixedShelfCount: { type: "integer", minimum: 0 },
    drawerCount: { type: "integer", minimum: 0 },
    sideBySideDrawers: { type: "boolean" },
    innerDrawerCount: { type: "integer", minimum: 0 },
    footHeightMm: { type: "number" },
    footState: { type: "string", enum: ["present", "absent", "unknown"] },
    topBoardRetreatMm: { type: "number" },
    bottomBoardRetreatMm: { type: "number" },
    specialBackStripCount: { type: "integer", minimum: 0 },
    specialBackStripState: { type: "string", enum: ["not_applicable", "confirmed", "unknown"] },
    boardProfile: boardProfileSchema,
    middleDividers: { type: "array", items: dividerSchema },
    baffles: { type: "array", items: baffleSchema },
    drawerGroups: { type: "array", items: drawerGroupSchema },
    doors: { type: "array", items: doorSchema },
    componentRegions: { type: "array", items: componentRegionSchema },
    drawingNotes: { type: "array", items: { type: "string" } },
    confidence,
    evidence: { type: "string" },
  },
};

export const cabinetReadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["projectName", "drawingUnit", "summary", "elevations", "dimensionChains", "cabinets", "independentPanels", "kickboards", "mirrors", "specialHardware", "questions", "warnings"],
  properties: {
    projectName: { type: "string" },
    drawingUnit: { type: "string", enum: ["cm", "mm", "mixed", "unknown"] },
    summary: { type: "string" },
    elevations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "totalWidthMm", "totalHeightMm", "evidence"],
        properties: {
          id: { type: "string" }, name: { type: "string" }, totalWidthMm: { type: "number" }, totalHeightMm: { type: "number" }, evidence: { type: "string" },
        },
      },
    },
    dimensionChains: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "elevationId", "axis", "totalMm", "segmentsMm", "dimensionIds", "cabinetIds", "status", "evidence"],
        properties: {
          id: { type: "string" }, elevationId: { type: "string" }, axis: { type: "string", enum: ["width", "height"] }, totalMm: { type: "number" },
          segmentsMm: { type: "array", items: { type: "number" } }, dimensionIds: { type: "array", items: { type: "string" } }, cabinetIds: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["matches", "conflict", "unknown"] }, evidence: { type: "string" },
        },
      },
    },
    cabinets: { type: "array", items: cabinetSchema },
    independentPanels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "elevationId", "name", "count", "widthMm", "heightMm", "thicknessMm", "grainDirection", "dimensionOrder", "note", "evidence"],
        properties: {
          id: { type: "string" }, elevationId: { type: "string" }, name: { type: "string" }, count: { type: "integer", minimum: 0 }, widthMm: { type: "number" }, heightMm: { type: "number" }, thicknessMm: { type: "number" },
          grainDirection: { type: "string", enum: ["vertical", "horizontal", "none", "unknown"] },
          dimensionOrder: { type: "string", enum: ["width_height", "height_width"] }, note: { type: "string" }, evidence: { type: "string" },
        },
      },
    },
    kickboards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "elevationId", "siteLengthMm", "evidence"],
        properties: { id: { type: "string" }, elevationId: { type: "string" }, siteLengthMm: { type: "number" }, evidence: { type: "string" } },
      },
    },
    mirrors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "elevationId", "count", "widthMm", "heightMm", "dimensionIds", "evidence"],
        properties: {
          id: { type: "string" }, elevationId: { type: "string" }, count: { type: "integer" }, widthMm: { type: "number" }, heightMm: { type: "number" },
          dimensionIds: { type: "array", items: { type: "string" } }, evidence: { type: "string" },
        },
      },
    },
    specialHardware: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["elevationId", "item", "qty", "unit", "evidence"],
        properties: { elevationId: { type: "string" }, item: { type: "string" }, qty: { type: "number" }, unit: { type: "string" }, evidence: { type: "string" } },
      },
    },
    questions: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
};
