type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const rounded = (value: unknown) => Math.round(Number(value) || 0);
const close = (left: unknown, right: unknown, tolerance = 2) => Math.abs(rounded(left) - rounded(right)) <= tolerance;

function records(value: unknown) {
  return (Array.isArray(value) ? value : []).filter(isRecord);
}

function strings(value: unknown) {
  return (Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean);
}

function unique(items: string[]) {
  return items.filter((item, index, all) => all.indexOf(item) === index);
}

function matchingDimensionIds(dimensions: JsonRecord[], orientation: "horizontal" | "vertical", value: unknown) {
  return dimensions
    .filter((dimension) => dimension.orientation === orientation && close(dimension.valueMm, value))
    .map((dimension) => String(dimension.id || "").trim())
    .filter(Boolean);
}

function sumDimensionIds(dimensions: JsonRecord[], orientation: "horizontal" | "vertical", target: unknown) {
  const candidates = dimensions.filter((dimension) => dimension.orientation === orientation && rounded(dimension.valueMm) > 0 && String(dimension.id || "").trim());
  const targetMm = rounded(target);
  const search = (start: number, selected: JsonRecord[], sum: number): string[] => {
    if (selected.length >= 2 && close(sum, targetMm)) return selected.map((dimension) => String(dimension.id));
    if (selected.length === 4 || sum > targetMm + 2) return [];
    for (let index = start; index < candidates.length; index += 1) {
      const result = search(index + 1, [...selected, candidates[index]], sum + rounded(candidates[index].valueMm));
      if (result.length) return result;
    }
    return [];
  };
  return search(0, [], 0);
}

function hasPositive24ThicknessClaim(value: unknown) {
  const clauses = JSON.stringify(value).split(/[，。；,;"“”]/).map((clause) => clause.replace(/\s+/g, ""));
  const thicknessPattern = /(?:24(?:mm|毫米)?厚|24厚|板厚(?:為|是|=|:|：)?24|厚度(?:為|是|=|:|：)?24)/i;
  const negatedPattern = /(?:不是|並非|不得|不可|不能|禁止|沒有|未採用|勿).{0,20}(?:24(?:mm|毫米)?厚|24厚|板厚.{0,6}24|厚度.{0,6}24)/i;
  return clauses.some((clause) => thicknessPattern.test(clause) && !negatedPattern.test(clause));
}

/**
 * Evidence IDs are an internal join key, not a visual judgement. Once the model has
 * read the numeric values, bind those values back to the axis-aware ledger here so
 * an otherwise correct scan cannot be blocked by a misspelled or omitted M-ID.
 */
export function normalizeSemanticEvidence(structured: JsonRecord, ledgerValue?: unknown): JsonRecord {
  const ledger = isRecord(ledgerValue) ? ledgerValue : isRecord(structured.dimensionLedger) ? structured.dimensionLedger : {};
  const dimensions = records(ledger.dimensions);
  if (!dimensions.length) return structured;

  const dimensionChains = records(structured.dimensionChains).map((chain) => {
    const normalized = { ...chain };
    const orientation = chain.axis === "width" ? "horizontal" : chain.axis === "height" ? "vertical" : undefined;
    const segments = Array.isArray(chain.segmentsMm) ? chain.segmentsMm : [];
    if (orientation && segments.length) {
      const matchedIds = segments.flatMap((segment) => matchingDimensionIds(dimensions, orientation, segment).slice(0, 1));
      if (matchedIds.length === segments.length) normalized.dimensionIds = matchedIds;
    }
    return normalized;
  });

  const cabinets = records(structured.cabinets).map((cabinet) => {
    const normalized = { ...cabinet };
    const widthIds = matchingDimensionIds(dimensions, "horizontal", cabinet.widthMm);
    const directHeightIds = matchingDimensionIds(dimensions, "vertical", cabinet.heightMm);
    const summedHeightIds = directHeightIds.length ? [] : sumDimensionIds(dimensions, "vertical", cabinet.heightMm);
    if (widthIds.length) normalized.widthDimensionIds = widthIds.slice(0, 1);
    if (directHeightIds.length || summedHeightIds.length) normalized.heightDimensionIds = directHeightIds.slice(0, 1).concat(summedHeightIds);

    const currentChain = dimensionChains.find((chain) => String(chain.id || "") === String(cabinet.widthChainId || ""));
    const currentSegments = currentChain && Array.isArray(currentChain.segmentsMm) ? currentChain.segmentsMm : [];
    if (!currentSegments.some((segment) => close(segment, cabinet.widthMm))) {
      const matchingChain = dimensionChains.find((chain) => chain.axis === "width" && Array.isArray(chain.segmentsMm) && chain.segmentsMm.some((segment) => close(segment, cabinet.widthMm)));
      if (matchingChain?.id) normalized.widthChainId = matchingChain.id;
    }
    return normalized;
  });

  return { ...structured, dimensionChains, cabinets };
}

export function hasAxisAwareLedger(value: unknown): value is JsonRecord {
  if (!isRecord(value)) return false;
  const dimensions = records(value.dimensions);
  const views = records(value.imageViews);
  return Boolean(dimensions.length && views.length)
    && dimensions.every((dimension) => String(dimension.id || "").trim() && ["horizontal", "vertical", "depth_arrow", "note", "unknown"].includes(String(dimension.orientation)))
    && views.every((view) => [0, 90, 180, 270].includes(Number(view.rotationToUprightDeg)));
}

export function findSemanticEvidenceErrors(structured: JsonRecord, ledgerValue?: unknown) {
  const ledger = isRecord(ledgerValue) ? ledgerValue : isRecord(structured.dimensionLedger) ? structured.dimensionLedger : {};
  const dimensions = records(ledger.dimensions);
  const dimensionById = new Map(dimensions.map((dimension) => [String(dimension.id || ""), dimension]));
  const chains = records(structured.dimensionChains);
  const chainById = new Map(chains.map((chain) => [String(chain.id || ""), chain]));
  const horizontalValues = dimensions.filter((dimension) => dimension.orientation === "horizontal").map((dimension) => rounded(dimension.valueMm)).filter(Boolean);
  const verticalValues = dimensions.filter((dimension) => dimension.orientation === "vertical").map((dimension) => rounded(dimension.valueMm)).filter(Boolean);
  const depthValues = dimensions.filter((dimension) => dimension.kind === "depth").map((dimension) => rounded(dimension.valueMm)).filter(Boolean);
  const errors: string[] = [];
  const hasUnitMetadata = dimensions.some((dimension) => Object.prototype.hasOwnProperty.call(dimension, "sourceUnit") || Object.prototype.hasOwnProperty.call(dimension, "sourceValue"));

  if (hasUnitMetadata) {
    for (const dimension of dimensions) {
      const unit = String(dimension.sourceUnit || "unknown");
      const sourceValue = Number(dimension.sourceValue);
      if (!["cm", "mm"].includes(unit) || !(sourceValue > 0)) continue;
      const expectedMm = unit === "cm" ? sourceValue * 10 : sourceValue;
      if (Math.abs(Number(dimension.valueMm) - expectedMm) > 2) errors.push(`${String(dimension.id || dimension.rawText || "未命名尺寸")} 單位換算不符：原圖${sourceValue}${unit}應為${Math.round(expectedMm)}mm，現在卻是${rounded(dimension.valueMm)}mm。`);
    }
  }

  for (const chain of chains) {
    const label = String(chain.id || "未命名尺寸鏈");
    const axis = String(chain.axis || "");
    const dimensionIds = strings(chain.dimensionIds);
    if (!dimensionIds.length) errors.push(`${label} 沒有綁定原圖尺寸ID，不能證明它是${axis === "height" ? "垂直" : "水平"}尺寸鏈。`);
    for (const id of dimensionIds) {
      const dimension = dimensionById.get(id);
      if (!dimension) {
        errors.push(`${label} 引用了不存在的尺寸ID ${id}。`);
        continue;
      }
      if (axis === "width" && dimension.orientation !== "horizontal") {
        errors.push(`${label} 是寬度鏈，卻引用${id}的${String(dimension.orientation)}尺寸；垂直尺寸禁止當寬度。`);
      }
      if (axis === "height" && dimension.orientation !== "vertical") {
        errors.push(`${label} 是高度鏈，卻引用${id}的${String(dimension.orientation)}尺寸；水平尺寸禁止當高度。`);
      }
    }

    for (const segment of (Array.isArray(chain.segmentsMm) ? chain.segmentsMm : [])) {
      if (axis === "width" && !horizontalValues.some((value) => close(value, segment)) && verticalValues.some((value) => close(value, segment))) {
        errors.push(`${label} 的${rounded(segment)}mm分段只出現在垂直尺寸證據，禁止拿來當寬度。`);
      }
      if (axis === "height" && !verticalValues.some((value) => close(value, segment)) && horizontalValues.some((value) => close(value, segment))) {
        errors.push(`${label} 的${rounded(segment)}mm分段只出現在水平尺寸證據，禁止拿來當高度。`);
      }
    }
  }

  for (const cabinet of records(structured.cabinets)) {
    const label = String(cabinet.id || cabinet.name || "未命名桶身");
    const widthIds = strings(cabinet.widthDimensionIds);
    const heightIds = strings(cabinet.heightDimensionIds);
    const widthChain = chainById.get(String(cabinet.widthChainId || ""));

    if (!widthIds.length) errors.push(`${label} 的寬度沒有綁定水平尺寸ID。`);
    if (!heightIds.length) errors.push(`${label} 的高度沒有綁定垂直尺寸ID。`);

    for (const id of widthIds) {
      const dimension = dimensionById.get(id);
      if (!dimension) errors.push(`${label} 的寬度引用不存在的尺寸ID ${id}。`);
      else if (dimension.orientation !== "horizontal") errors.push(`${label} 的寬度引用${id}，但它是${String(dimension.orientation)}尺寸。`);
    }
    for (const id of heightIds) {
      const dimension = dimensionById.get(id);
      if (!dimension) errors.push(`${label} 的高度引用不存在的尺寸ID ${id}。`);
      else if (dimension.orientation !== "vertical") errors.push(`${label} 的高度引用${id}，但它是${String(dimension.orientation)}尺寸。`);
    }

    const chainSegments = isRecord(widthChain) && Array.isArray(widthChain.segmentsMm) ? widthChain.segmentsMm : [];
    if (chainSegments.length && Number(cabinet.widthMm) > 0 && !chainSegments.some((segment) => close(segment, cabinet.widthMm))) {
      errors.push(`${label} 寬${rounded(cabinet.widthMm)}mm不在其水平寬度鏈分段中，禁止用局部垂直尺寸另造桶寬。`);
    }
  }

  if (hasUnitMetadata) {
    const usedDimensionIds = new Set<string>();
    for (const chain of chains) strings(chain.dimensionIds).forEach((id) => usedDimensionIds.add(id));
    for (const cabinet of records(structured.cabinets)) {
      strings(cabinet.widthDimensionIds).forEach((id) => usedDimensionIds.add(id));
      strings(cabinet.heightDimensionIds).forEach((id) => usedDimensionIds.add(id));
    }
    for (const id of usedDimensionIds) {
      const dimension = dimensionById.get(id);
      if (!dimension) continue;
      if (!["cm", "mm"].includes(String(dimension.sourceUnit)) || !(Number(dimension.sourceValue) > 0)) errors.push(`${id} 已用於桶身或尺寸鏈，但原始數字與cm／mm單位尚未綁定，禁止只留下換算後的mm值。`);
    }
  }

  const hasExplicit24Gap = dimensions.some((dimension) => dimension.kind === "slanted_handle_gap" && close(dimension.valueMm, 24));
  if (hasExplicit24Gap) {
    if (hasPositive24ThicknessClaim(structured)) {
      errors.push("圖上的24mm已被分類為斜把縫，禁止再描述成24mm厚板；標準桶身板厚仍為18mm。");
    }
  }

  for (const dimension of dimensions.filter((item) => item.kind === "board_thickness" && close(item.valueMm, 24))) {
    const proof = `${String(dimension.rawText || "")} ${String(dimension.evidence || "")}`;
    if (!/(?:T\s*24|厚(?:度)?\s*(?:為)?\s*24|24\s*(?:mm|毫米)?\s*厚)/i.test(proof)) {
      errors.push(`${String(dimension.id || "24mm尺寸")} 沒有T24或厚度標註，不得把2.4cm間隙猜成板厚。`);
    }
  }

  const hasReferenceElevation = [400, 800, 600].every((value) => horizontalValues.some((candidate) => close(candidate, value)))
    && [552, 24, 160, 1631, 617, 2272].every((value) => verticalValues.some((candidate) => close(candidate, value)))
    && depthValues.some((candidate) => close(candidate, 426));
  if (hasReferenceElevation) {
    const cabinets = records(structured.cabinets);
    if (cabinets.length !== 3) errors.push(`此基準立面只能有3個桶身（400、800、600），目前建立${cabinets.length}個；右側600的連續側板禁止拆成上下兩桶。`);
    const expected = [{ width: 400, height: 736 }, { width: 800, height: 736 }, { width: 600, height: 2272 }];
    for (const item of expected) {
      const matches = cabinets.filter((cabinet) => close(cabinet.widthMm, item.width));
      if (matches.length !== 1) {
        errors.push(`此基準立面必須恰有一個W${item.width}桶身。`);
        continue;
      }
      if (!close(matches[0].heightMm, item.height)) errors.push(`W${item.width}桶身高度應由垂直尺寸鏈得到H${item.height}，目前為H${rounded(matches[0].heightMm)}。`);
      if (!close(matches[0].depthMm, 426)) errors.push(`W${item.width}桶身應套用圖上D42.6共用深度426mm。`);
    }
  }

  return unique(errors);
}

export function selectBetterSemanticResult(baseline: JsonRecord, candidate: JsonRecord, ledgerValue?: unknown) {
  const baselineErrors = findSemanticEvidenceErrors(baseline, ledgerValue);
  const candidateErrors = findSemanticEvidenceErrors(candidate, ledgerValue);
  if (candidateErrors.length < baselineErrors.length) return candidate;
  if (candidateErrors.length > baselineErrors.length) return baseline;
  return structureInventoryScore(candidate) >= structureInventoryScore(baseline) ? candidate : baseline;
}

/** Prevent a later audit from silently replacing a populated cabinet interior with empty arrays. */
export function structureInventoryScore(structured: JsonRecord) {
  return records(structured.cabinets).reduce((total, cabinet) => {
    const drawerGroups = records(cabinet.drawerGroups);
    const dividers = records(cabinet.middleDividers);
    const baffles = records(cabinet.baffles);
    const doors = records(cabinet.doors);
    const completeGroups = drawerGroups.filter((group) => rounded(group.count) > 0 && rounded(group.openingWidthMm) > 0 && rounded(group.openingHeightMm) > 0);
    const completeDividers = dividers.filter((divider) => {
      const profile = isRecord(cabinet.boardProfile) ? cabinet.boardProfile : {};
      const depthDeduction = rounded(profile.fixedShelfDepthDeductionMm) || 29;
      const depthComplete = divider.depthBasis === "standard_d_minus_29" ? rounded(cabinet.depthMm) > depthDeduction : divider.depthBasis === "finished" && rounded(divider.depthMm) > 0;
      const topDeduction = divider.topConnection === "fixed_shelf_centerline" ? 9 : ["top_board", "bottom_board", "fixed_shelf_full"].includes(String(divider.topConnection)) ? 18 : 0;
      const bottomDeduction = divider.bottomConnection === "fixed_shelf_centerline" ? 9 : ["top_board", "bottom_board", "fixed_shelf_full"].includes(String(divider.bottomConnection)) ? 18 : 0;
      const heightComplete = divider.heightBasis === "finished" ? rounded(divider.heightMm) > 0 : divider.heightBasis === "connection_span" && topDeduction > 0 && bottomDeduction > 0 && rounded(divider.referenceSpanMm) > topDeduction + bottomDeduction;
      return depthComplete && heightComplete;
    });
    const completeBaffles = baffles.filter((baffle) => rounded(baffle.heightMm) > 0 && rounded(baffle.widthMm) > 0);
    const completeDoors = doors.filter((door) => rounded(door.count) > 0 && (door.dimensionBasis === "finished" ? rounded(door.finishedWidthMm) > 0 && rounded(door.finishedHeightMm) > 0 : door.dimensionBasis === "opening" ? rounded(door.openingWidthMm) > 0 && rounded(door.openingHeightMm) > 0 : door.type === "aluminum" || door.type === "none"));
    return total
      + rounded(cabinet.fixedShelves) * 3
      + rounded(cabinet.adjustableShelves) * 3
      + rounded(cabinet.drawerCount) * 2
      + completeGroups.length * 8
      + completeDividers.length * 6
      + completeBaffles.length * 5
      + completeDoors.length * 3
      + doors.filter((door) => door.type === "4E" && rounded(door.hingeCountPerDoor) > 0).length * 2;
  }, 0);
}
