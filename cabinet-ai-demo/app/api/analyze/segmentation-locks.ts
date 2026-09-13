import type { SegmentationPlan } from "../../segmentation.ts";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const records = (value: unknown) => (Array.isArray(value) ? value : []).filter(isRecord);
const rounded = (value: unknown) => Math.round(Number(value) || 0);
const close = (left: unknown, right: unknown, tolerance = 2) => Math.abs(rounded(left) - rounded(right)) <= tolerance;
const unique = <T>(items: T[]) => items.filter((item, index, all) => all.indexOf(item) === index);
const rawNumber = (value: unknown) => String(value || "").replace(/[^\d.\-]/g, "");
const compareSegments = (left: SegmentationPlan["cabinets"][number], right: SegmentationPlan["cabinets"][number]) =>
  left.elevationId.localeCompare(right.elevationId, undefined, { numeric: true }) || left.widthOrder - right.widthOrder;

function activePlan(value: unknown): SegmentationPlan | undefined {
  if (!isRecord(value) || !Array.isArray(value.cabinets) || !value.cabinets.length) return undefined;
  return value as unknown as SegmentationPlan;
}

function widthDimensionId(cabinetId: string) {
  return `SEG-W-${cabinetId}`;
}

function widthChainId(elevationId: string) {
  return `SEG-W-${elevationId}`;
}

/**
 * The first-stage orientation/segmentation result is pixel evidence, not an AI
 * suggestion.  Later model passes may enrich it, but may never rotate it again
 * or reinterpret the bottom width chain as a vertical height chain.
 */
export function normalizeLedgerToSegmentationLocks(ledger: JsonRecord, segmentation: SegmentationPlan): JsonRecord {
  const auditByImage = new Map((segmentation.orientationAudit?.images || []).map((item) => [item.imageName, item]));
  const viewByImage = new Map(segmentation.views.map((item) => [item.imageName, item]));
  const imageViews: JsonRecord[] = records(ledger.imageViews).map((view) => {
    const imageName = String(view.imageName || "");
    const audit = auditByImage.get(imageName);
    const planned = viewByImage.get(imageName);
    return {
      ...view,
      rotationToUprightDeg: audit?.rotationToUprightDeg ?? planned?.rotationToUprightDeg ?? view.rotationToUprightDeg,
      elevationId: planned?.elevationId || view.elevationId,
      notes: `${String(view.notes || "")}；方向已由前置數字方向與底部寬度鏈鎖定，後段不得重判。`,
    };
  });

  for (const planned of segmentation.views) {
    if (imageViews.some((view) => String(view.imageName) === planned.imageName)) continue;
    imageViews.push({
      imageName: planned.imageName,
      viewKind: planned.viewKind,
      elevationId: planned.elevationId,
      region: "完整來源圖",
      rotationToUprightDeg: auditByImage.get(planned.imageName)?.rotationToUprightDeg ?? planned.rotationToUprightDeg,
      notes: "由前置方向核對鎖定。",
    });
  }

  const dimensions = records(ledger.dimensions)
    .filter((dimension) => !(/(?:未見|不存在|推測缺席|低信心占位)/.test(`${String(dimension.region || "")} ${String(dimension.evidence || "")}`) && dimension.confidence === "low"))
    .map((dimension) => ({ ...dimension }));
  const used = new Set<number>();
  for (const segment of [...segmentation.cabinets].sort(compareSegments)) {
    const sourceImages = new Set(segment.sourceCrops.map((crop) => crop.sourceImageName));
    const matchIndex = dimensions.findIndex((dimension, index) => !used.has(index)
      && sourceImages.has(String(dimension.imageName || ""))
      && (rawNumber(dimension.rawText) === rawNumber(segment.bottomDimensionText) || close(dimension.valueMm, segment.bottomSegmentMm)));
    if (matchIndex >= 0) {
      const dimension = dimensions[matchIndex];
      used.add(matchIndex);
      dimensions[matchIndex] = {
        ...dimension,
        id: widthDimensionId(segment.cabinetId),
        rawText: segment.bottomDimensionText || String(segment.bottomSegmentMm),
        sourceValue: segment.bottomSegmentMm,
        sourceUnit: "mm",
        valueMm: segment.bottomSegmentMm,
        kind: "module_width",
        orientation: "horizontal",
        region: `${segment.elevationId} 底部水平尺寸鏈第${segment.widthOrder}段`,
        targets: [segment.cabinetId],
        confidence: segment.confidence,
        evidence: `${segment.evidence}；由前置底部水平尺寸鏈鎖定，後段不得改作高度。`,
      };
    } else {
      const sourceImageName = segment.sourceCrops[0]?.sourceImageName || segmentation.views[0]?.imageName || "";
      dimensions.push({
        id: widthDimensionId(segment.cabinetId),
        imageName: sourceImageName,
        rawText: segment.bottomDimensionText || String(segment.bottomSegmentMm),
        sourceValue: segment.bottomSegmentMm,
        sourceUnit: "mm",
        valueMm: segment.bottomSegmentMm,
        kind: "module_width",
        orientation: "horizontal",
        region: `${segment.elevationId} 底部水平尺寸鏈第${segment.widthOrder}段`,
        targets: [segment.cabinetId],
        confidence: segment.confidence,
        evidence: `${segment.evidence}；由前置真裁切尺寸段補入尺寸證據表。`,
      });
    }
  }

  for (const audit of segmentation.orientationAudit?.images || []) {
    const orderedVerticalTexts = audit.sideVerticalDimensionTexts.map(rawNumber);
    const verticalTexts = new Set(orderedVerticalTexts);
    const largestIndex = orderedVerticalTexts.reduce((best, value, index, all) => Number(value) > Number(all[best] || 0) ? index : best, 0);
    const targetIds = segmentation.cabinets
      .filter((segment) => segment.sourceCrops.some((crop) => crop.sourceImageName === audit.imageName))
      .map((segment) => segment.cabinetId);
    for (const dimension of dimensions) {
      if (String(dimension.imageName || "") !== audit.imageName) continue;
      if (verticalTexts.has(rawNumber(dimension.rawText)) && !String(dimension.id || "").startsWith("SEG-W-")) {
        const position = orderedVerticalTexts.indexOf(rawNumber(dimension.rawText));
        dimension.orientation = "vertical";
        if (position === largestIndex) {
          dimension.kind = "cabinet_height";
          dimension.targets = targetIds;
        } else if (position === 0 && Number(rawNumber(dimension.rawText)) > 0 && Number(rawNumber(dimension.rawText)) <= 300) {
          // The orientation audit records the photographed side chain from the
          // drawing baseline upward.  A short first segment below the cabinet
          // body is the floor/leg zone; it is not a width or a filler board.
          dimension.kind = "foot_height";
          dimension.targets = targetIds;
        } else dimension.kind = "clearance_gap";
        dimension.evidence = `${String(dimension.evidence || "")}；由前置側邊垂直尺寸鏈鎖定，禁止改作寬度${position === largestIndex ? "；此為桶身外高" : position === 0 ? "；此為桶底下方離地／腳高段" : "；此為桶頂外留空段"}。`;
      }
    }
  }

  const depthGroups = records(ledger.depthGroups).map((group) => {
    const elevationId = String(group.elevationId || "");
    const cabinetIds = segmentation.cabinets.filter((segment) => segment.elevationId === elevationId).map((segment) => segment.cabinetId);
    const shared = ["shared_note", "side_view", "matching_view", "user_confirmed"].includes(String(group.source || ""))
      || /(?:整排|全排|full|共用)/i.test(`${String(group.region || "")} ${String(group.evidence || "")}`);
    return shared && rounded(group.depthMm) > 0
      ? { ...group, appliesTo: unique([...(Array.isArray(group.appliesTo) ? group.appliesTo.map(String) : []), ...cabinetIds]) }
      : group;
  });

  return {
    ...ledger,
    projectName: /^[0-9a-f-]{20,}$/i.test(String(ledger.projectName || "")) ? "本次圖面" : ledger.projectName,
    drawingUnit: segmentation.drawingUnit === "unknown" ? ledger.drawingUnit : segmentation.drawingUnit,
    imageViews,
    dimensions,
    depthGroups,
  };
}

function dedupeObjects(items: unknown[], key: (item: JsonRecord) => string) {
  const seen = new Set<string>();
  return items.filter(isRecord).filter((item) => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function mergeCabinetStructureReads(reads: JsonRecord[], segmentation: SegmentationPlan, ledger: JsonRecord): JsonRecord {
  const first = reads[0] || {};
  const cabinets = reads.flatMap((read) => records(read.cabinets));
  const elevations = [...new Map(segmentation.cabinets.map((segment) => [segment.elevationId, segment.elevationId])).keys()].map((elevationId) => {
    const segments = segmentation.cabinets.filter((segment) => segment.elevationId === elevationId);
    const candidates = reads.flatMap((read) => records(read.elevations)).filter((item) => String(item.id || "") === elevationId);
    const totalHeightMm = Math.max(0, ...candidates.map((item) => rounded(item.totalHeightMm)));
    return {
      id: elevationId,
      name: String(candidates[0]?.name || elevationId),
      totalWidthMm: segments.reduce((sum, segment) => sum + segment.bottomSegmentMm, 0),
      totalHeightMm,
      evidence: "總寬由前置底部水平尺寸鏈逐段相加；總高保留側邊垂直尺寸證據。",
    };
  });
  return {
    ...first,
    projectName: /^[0-9a-f-]{20,}$/i.test(segmentation.projectName) ? "本次圖面" : segmentation.projectName,
    drawingUnit: segmentation.drawingUnit,
    summary: unique(reads.map((read) => String(read.summary || "")).filter(Boolean)).join("；"),
    elevations,
    cabinets,
    independentPanels: dedupeObjects(reads.flatMap((read) => Array.isArray(read.independentPanels) ? read.independentPanels : []), (item) => `${item.elevationId || "GLOBAL"}|${item.name}|${rounded(item.widthMm)}|${rounded(item.heightMm)}|${rounded(item.count)}`),
    kickboards: dedupeObjects(reads.flatMap((read) => Array.isArray(read.kickboards) ? read.kickboards : []), (item) => `${item.elevationId || "GLOBAL"}|${rounded(item.siteLengthMm)}`),
    mirrors: dedupeObjects(reads.flatMap((read) => Array.isArray(read.mirrors) ? read.mirrors : []), (item) => `${item.elevationId || "GLOBAL"}|${rounded(item.widthMm)}|${rounded(item.heightMm)}|${rounded(item.count)}`),
    specialHardware: dedupeObjects(reads.flatMap((read) => Array.isArray(read.specialHardware) ? read.specialHardware : []), (item) => `${item.elevationId || "GLOBAL"}|${item.item}|${rounded(item.qty)}|${item.unit}`),
    questions: unique(reads.flatMap((read) => Array.isArray(read.questions) ? read.questions.map(String) : [])),
    warnings: unique(reads.flatMap((read) => Array.isArray(read.warnings) ? read.warnings.map(String) : [])),
    dimensionLedger: ledger,
  };
}

/** Preserve one real cabinet per locked segment.  Missing cabinets fall back to
 * the previous complete stage; a collapsed audit can therefore never erase
 * three already-read cabinets. */
export function applySegmentationLocks(
  structured: JsonRecord,
  segmentationValue?: SegmentationPlan | unknown,
  ledgerValue?: JsonRecord,
  fallbackValue?: JsonRecord,
): JsonRecord {
  const segmentation = activePlan(segmentationValue) || activePlan(structured.segmentationPlan);
  if (!segmentation) return structured;
  const ledger = ledgerValue || (isRecord(structured.dimensionLedger) ? structured.dimensionLedger : {});
  const ledgerDimensions = records(ledger.dimensions);
  const ledgerDepthGroups = records(ledger.depthGroups);
  const candidates = records(structured.cabinets);
  const fallback = records(fallbackValue?.cabinets);
  const used = new Set<JsonRecord>();
  const cabinets = [...segmentation.cabinets].sort(compareSegments).map((segment) => {
    let candidate = candidates.find((item) => !used.has(item) && String(item.id || "") === segment.cabinetId);
    if (!candidate && segmentation.cabinets.length === 1 && candidates.length === 1) candidate = candidates[0];
    if (!candidate) candidate = candidates.find((item) => !used.has(item)
      && String(item.elevationId || "") === segment.elevationId
      && close(item.widthMm, segment.bottomSegmentMm)
      && rounded(item.widthOrder) === segment.widthOrder);
    if (!candidate) candidate = fallback.find((item) => String(item.id || "") === segment.cabinetId);
    if (candidate) used.add(candidate);
    const current = candidate || {};
    const profile = isRecord(current.boardProfile) ? { ...current.boardProfile } : {};
    if (profile.deductionBasis === "standard_sop") profile.adjustableShelfDepthDeductionMm = 40;
    const heightDimension = ledgerDimensions.find((dimension) => dimension.kind === "cabinet_height"
      && Array.isArray(dimension.targets) && dimension.targets.map(String).includes(segment.cabinetId)
      && rounded(dimension.valueMm) > 0);
    const footDimension = ledgerDimensions.find((dimension) => dimension.kind === "foot_height"
      && Array.isArray(dimension.targets) && dimension.targets.map(String).includes(segment.cabinetId)
      && rounded(dimension.valueMm) > 0);
    const depthGroup = ledgerDepthGroups.find((group) => rounded(group.depthMm) > 0
      && (String(group.elevationId || "") === segment.elevationId
        || (Array.isArray(group.appliesTo) && group.appliesTo.map(String).includes(segment.cabinetId))));
    return {
      ...current,
      id: segment.cabinetId,
      name: String(current.name || segment.label || segment.cabinetId),
      elevationId: segment.elevationId,
      widthChainId: widthChainId(segment.elevationId),
      widthOrder: segment.widthOrder,
      widthMm: segment.bottomSegmentMm,
      widthDimensionIds: [widthDimensionId(segment.cabinetId)],
      heightMm: heightDimension ? rounded(heightDimension.valueMm) : current.heightMm,
      heightDimensionIds: heightDimension ? [String(heightDimension.id)] : current.heightDimensionIds,
      depthMm: depthGroup ? rounded(depthGroup.depthMm) : current.depthMm,
      depthGroupId: depthGroup ? String(depthGroup.id || current.depthGroupId || "") : current.depthGroupId,
      depthSource: depthGroup ? "shared_group" : current.depthSource,
      depthEvidence: depthGroup ? String(depthGroup.evidence || current.depthEvidence || "") : current.depthEvidence,
      footHeightMm: footDimension ? rounded(footDimension.valueMm) : current.footHeightMm,
      footState: footDimension ? "present" : current.footState,
      cabinetKind: footDimension ? "floor" : current.cabinetKind,
      isHanging: footDimension ? false : current.isHanging,
      boardProfile: profile,
      evidence: `${String(current.evidence || "")}；${segment.evidence}；桶號、左右順序與寬度由前置水平尺寸段鎖定。`,
    };
  });

  const otherChains = records(structured.dimensionChains).filter((chain) => chain.axis !== "width");
  const lockedChains = unique(segmentation.cabinets.map((segment) => segment.elevationId)).map((elevationId) => {
    const segments = segmentation.cabinets.filter((segment) => segment.elevationId === elevationId).sort((a, b) => a.widthOrder - b.widthOrder);
    return {
      id: widthChainId(elevationId), elevationId, axis: "width",
      totalMm: segments.reduce((sum, segment) => sum + segment.bottomSegmentMm, 0),
      segmentsMm: segments.map((segment) => segment.bottomSegmentMm),
      dimensionIds: segments.map((segment) => widthDimensionId(segment.cabinetId)),
      cabinetIds: segments.map((segment) => segment.cabinetId), status: "matches",
      evidence: "前置方向核對後的底部水平尺寸鏈；後段不得改軸、合桶或換序。",
    };
  });
  return { ...structured, cabinets, dimensionChains: [...lockedChains, ...otherChains], dimensionLedger: ledger, segmentationPlan: segmentation };
}

export function findSegmentationLockErrors(structured: JsonRecord, segmentationValue?: SegmentationPlan | unknown, ledgerValue?: JsonRecord) {
  const segmentation = activePlan(segmentationValue) || activePlan(structured.segmentationPlan);
  if (!segmentation) return [];
  const errors: string[] = [];
  const cabinets = records(structured.cabinets);
  const expected = [...segmentation.cabinets].sort(compareSegments);
  if (cabinets.length !== expected.length) errors.push(`前置已鎖定${expected.length}個桶身，後段卻輸出${cabinets.length}個；禁止合桶或漏桶。`);
  for (const segment of expected) {
    const cabinet = cabinets.find((item) => String(item.id || "") === segment.cabinetId);
    if (!cabinet) { errors.push(`缺少前置已鎖定的${segment.cabinetId}。`); continue; }
    if (String(cabinet.elevationId || "") !== segment.elevationId) errors.push(`${segment.cabinetId}立面被改寫。`);
    if (rounded(cabinet.widthOrder) !== segment.widthOrder) errors.push(`${segment.cabinetId}左右順序被改寫。`);
    if (!close(cabinet.widthMm, segment.bottomSegmentMm)) errors.push(`${segment.cabinetId}寬度應鎖定${segment.bottomSegmentMm}mm，現在為${rounded(cabinet.widthMm)}mm。`);
  }
  const actualIds = cabinets.map((item) => String(item.id || ""));
  const expectedIds = expected.map((item) => item.cabinetId);
  if (actualIds.join("|") !== expectedIds.join("|")) errors.push(`桶身順序必須為${expectedIds.join("、")}。`);

  const ledger = ledgerValue || (isRecord(structured.dimensionLedger) ? structured.dimensionLedger : {});
  const views = records(ledger.imageViews);
  for (const audit of segmentation.orientationAudit?.images || []) {
    const view = views.find((item) => String(item.imageName || "") === audit.imageName);
    if (!view || rounded(view.rotationToUprightDeg) !== audit.rotationToUprightDeg) errors.push(`${audit.imageName}方向必須鎖定順時針${audit.rotationToUprightDeg}°。`);
  }
  return unique(errors);
}

export function segmentationLockSummary(segmentation: SegmentationPlan) {
  return {
    orientation: (segmentation.orientationAudit?.images || []).map((item) => ({
      imageName: item.imageName,
      rotationToUprightDeg: item.rotationToUprightDeg,
      bottomHorizontalWidthChain: item.bottomHorizontalDimensionTexts,
      sideVerticalHeightChain: item.sideVerticalDimensionTexts,
      basis: item.orientationBasis,
    })),
    cabinets: [...segmentation.cabinets].sort(compareSegments).map((item) => ({
      id: item.cabinetId, elevationId: item.elevationId, leftToRightOrder: item.widthOrder,
      lockedWidthMm: item.bottomSegmentMm, sourceText: item.bottomDimensionText,
    })),
  };
}
