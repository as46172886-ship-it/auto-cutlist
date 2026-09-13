import { displayProjectName } from "../../display-text.ts";
import type { OrientationAudit } from "../../orientation-audit.ts";
import { BOARD_PROFILE, EXCLUDED_COMPONENTS } from "./knowledge.ts";
import { dimensionTextToMm, formatMillimeterFormula, measurementToMm, normalizeDrawingUnit } from "./dimensions.ts";
import type {
  CabinetObservation,
  CarcassCabinet,
  CarcassMaterialRow,
  CarcassObservationRead,
  CarcassResult,
  Confidence,
  DepthGroupObservation,
} from "./model.ts";

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function confidenceRank(value: Confidence) {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

export function lockedWidthTexts(orientation: OrientationAudit | undefined) {
  if (!orientation?.images?.length) return [];
  return [...orientation.images]
    .sort((a, b) => b.bottomHorizontalDimensionTexts.length - a.bottomHorizontalDimensionTexts.length
      || confidenceRank(b.confidence) - confidenceRank(a.confidence))[0]?.bottomHorizontalDimensionTexts || [];
}

export function lockedHeightTexts(orientation: OrientationAudit | undefined) {
  if (!orientation?.images?.length) return [];
  return [...orientation.images]
    .sort((a, b) => b.sideVerticalDimensionTexts.length - a.sideVerticalDimensionTexts.length
      || confidenceRank(b.confidence) - confidenceRank(a.confidence))[0]?.sideVerticalDimensionTexts || [];
}

type ResolvedHeight = {
  heightMm: number;
  formula: string;
  rawTexts: string[];
  evidence: string;
  source: CarcassCabinet["heightSource"];
  warning: string;
};

/**
 * A photographed elevation can place short installation clearances immediately
 * before and after one complete carcass-height dimension.  The labels are
 * collinear but are not three internal carcass segments.  Only collapse this
 * pattern when the middle span overwhelmingly dominates and both end spans are
 * small.  Requiring the dominant value to be internal preserves real chains
 * such as 552+24+160 and 1631+24+617.
 */
function dominantInternalBodySpan(segments: number[]) {
  if (segments.length !== 3) return -1;
  const total = segments.reduce((sum, value) => sum + value, 0);
  const dominantIndex = segments.indexOf(Math.max(...segments));
  const dominant = segments[dominantIndex];
  if (dominantIndex !== 1 || dominant < 600 || !total) return -1;
  const [before, , after] = segments;
  if (before > 150 || after > 150) return -1;
  return dominant / total >= 0.82 ? dominantIndex : -1;
}

function resolveHeight(
  observation: CabinetObservation | undefined,
  drawingUnit: CarcassObservationRead["drawingUnit"],
  resolvedByOrder: Map<number, ResolvedHeight>,
  orientationHeightTexts: string[],
): ResolvedHeight {
  if (!observation) return { heightMm: 0, formula: "", rawTexts: [], evidence: "", source: "missing", warning: "" };
  if (observation.heightMode === "explicit_total") {
    const value = measurementToMm(observation.heightTotal, drawingUnit);
    return {
      heightMm: value,
      formula: value ? `${observation.heightTotal.rawText || value}＝${value} mm` : "",
      rawTexts: observation.heightTotal.rawText ? [observation.heightTotal.rawText] : [],
      evidence: observation.heightEvidence || observation.heightTotal.evidence,
      source: value ? "explicit_total" : "missing",
      warning: "",
    };
  }
  if (observation.heightMode === "segment_chain") {
    const hardLockedSegments = orientationHeightTexts
      .map((rawText) => ({ rawText, valueMm: dimensionTextToMm(rawText, drawingUnit) }))
      .filter((item) => item.valueMm > 0);
    const reconciled = observation.heightSegments.map((item) => {
      const observedMm = measurementToMm(item, drawingUnit);
      const candidate = hardLockedSegments
        .map((locked) => ({ ...locked, distanceMm: Math.abs(locked.valueMm - observedMm) }))
        .filter((locked) => locked.distanceMm <= 5)
        .sort((a, b) => a.distanceMm - b.distanceMm)[0];
      return candidate || { rawText: item.rawText, valueMm: observedMm, distanceMm: 0 };
    });
    const segments = reconciled.map((item) => item.valueMm);
    const rawTexts = reconciled.map((item) => item.rawText).filter(Boolean);
    if (!segments.length || segments.some((item) => item <= 0)) {
      return { heightMm: 0, formula: "", rawTexts, evidence: observation.heightEvidence, source: "missing", warning: "高度分段存在無法換算的數值或單位。" };
    }
    if (!observation.sidePanelsContinuous) {
      return { heightMm: 0, formula: "", rawTexts, evidence: observation.heightEvidence, source: "missing", warning: "高度分段尚未證明位於同一對連續側板內。" };
    }
    const bodySpanIndex = dominantInternalBodySpan(segments);
    if (bodySpanIndex >= 0) {
      const heightMm = segments[bodySpanIndex];
      const rawText = rawTexts[bodySpanIndex] || String(heightMm);
      return {
        heightMm,
        formula: `${heightMm}＝${heightMm} mm`,
        rawTexts: [rawText],
        evidence: `${observation.heightEvidence}；相鄰端部短尺寸判為桶外安裝間隙，完整中段尺寸直接鎖定桶高`.replace(/^；/, ""),
        source: "segment_chain",
        warning: "",
      };
    }
    const heightMm = segments.reduce((sum, value) => sum + value, 0);
    return { heightMm, formula: formatMillimeterFormula(segments, heightMm), rawTexts, evidence: observation.heightEvidence, source: "segment_chain", warning: "" };
  }
  if (observation.heightMode === "shared_height") {
    const shared = resolvedByOrder.get(positiveInteger(observation.heightSharedWithOrder));
    return shared?.heightMm
      ? { ...shared, evidence: observation.heightEvidence || `與第${observation.heightSharedWithOrder}桶共用相同桶底、桶頂線。`, source: "shared_height", warning: "" }
      : { heightMm: 0, formula: "", rawTexts: [], evidence: observation.heightEvidence, source: "missing", warning: "共用桶高的來源桶尚未閉合。" };
  }
  return { heightMm: 0, formula: "", rawTexts: [], evidence: observation.heightEvidence, source: "missing", warning: "" };
}

function depthByOrder(groups: DepthGroupObservation[], drawingUnit: CarcassObservationRead["drawingUnit"]) {
  const result = new Map<number, { depthMm: number; rawText: string; evidence: string; confidence: Confidence }>();
  for (const group of groups || []) {
    const depthMm = measurementToMm(group.measurement, drawingUnit);
    if (!depthMm) continue;
    for (const order of group.appliesToOrders || []) {
      const widthOrder = positiveInteger(order);
      if (!widthOrder) continue;
      const existing = result.get(widthOrder);
      if (!existing || confidenceRank(group.confidence) > confidenceRank(existing.confidence)) {
        result.set(widthOrder, { depthMm, rawText: group.measurement.rawText, evidence: group.evidence || group.measurement.evidence, confidence: group.confidence });
      }
    }
  }
  return result;
}

function mergeMaterials(rows: CarcassMaterialRow[]) {
  const merged = new Map<string, CarcassMaterialRow>();
  for (const row of rows) {
    const key = `${row.item}|${row.spec}|${row.thicknessMm}`;
    const existing = merged.get(key);
    if (existing) {
      existing.qty += row.qty;
      existing.cabinetIds = [...new Set([...existing.cabinetIds, ...row.cabinetIds])];
    } else merged.set(key, { ...row, cabinetIds: [...row.cabinetIds] });
  }
  const itemOrder = { 側板: 1, 頂底板: 2, 背板: 3 } as const;
  const dimensions = (spec: string) => spec.split("×").map((part) => Number(part.trim()) || 0);
  return [...merged.values()].sort((a, b) => {
    if (itemOrder[a.item] !== itemOrder[b.item]) return itemOrder[a.item] - itemOrder[b.item];
    const [aLeft, aRight] = dimensions(a.spec);
    const [bLeft, bRight] = dimensions(b.spec);
    return bLeft - aLeft || bRight - aRight;
  });
}

export function calculateCarcassMaterials(cabinets: CarcassCabinet[]) {
  const rows: CarcassMaterialRow[] = [];
  for (const cabinet of cabinets.filter((item) => item.complete)) {
    const { cabinetId, widthMm: width, heightMm: height, depthMm: depth } = cabinet;
    rows.push({ item: "側板", spec: `${depth} × ${height}`, thicknessMm: BOARD_PROFILE.bodyThicknessMm, qty: 2, cabinetIds: [cabinetId], formula: "D × H", ruleId: "C10", note: "每個獨立桶身固定2片，不共用側板。" });
    rows.push({ item: "頂底板", spec: `${depth} × ${width - BOARD_PROFILE.topBottomWidthDeductionMm}`, thicknessMm: BOARD_PROFILE.bodyThicknessMm, qty: 2, cabinetIds: [cabinetId], formula: "D × (W − 36)", ruleId: "C11", note: "頂板1片＋底板1片。" });
    rows.push({ item: "背板", spec: `${width - BOARD_PROFILE.backWidthDeductionMm} × ${height - BOARD_PROFILE.backHeightDeductionMm}`, thicknessMm: BOARD_PROFILE.backThicknessMm, qty: 1, cabinetIds: [cabinetId], formula: "(W − 26) × (H − 26)", ruleId: "C12", note: "每個獨立桶身1片。" });
  }
  return mergeMaterials(rows);
}

export function buildCarcassResult(observations: CarcassObservationRead, orientation: OrientationAudit): CarcassResult {
  const drawingUnit = normalizeDrawingUnit(observations.drawingUnit);
  const widthTexts = lockedWidthTexts(orientation);
  const heightTexts = lockedHeightTexts(orientation);
  const lockedWidths = widthTexts.map((text) => dimensionTextToMm(text, drawingUnit));
  const observationByOrder = new Map((observations.cabinets || []).map((item) => [positiveInteger(item.widthOrder), item]));
  const depthMap = depthByOrder(observations.depthGroups || [], drawingUnit);
  const resolvedHeights = new Map<number, ResolvedHeight>();
  const unresolved = new Set((observations.unresolved || []).filter(Boolean));
  const warnings = new Set<string>();
  const cabinets: CarcassCabinet[] = [];

  if (drawingUnit === "unknown") unresolved.add("圖面單位無法確認；cm與mm未鎖定前不能計算桶身。");
  for (let index = 0; index < lockedWidths.length; index += 1) {
    const widthOrder = index + 1;
    const cabinetId = `C${String(widthOrder).padStart(2, "0")}`;
    const observation = observationByOrder.get(widthOrder);
    const widthMm = positiveInteger(lockedWidths[index]);
    const height = resolveHeight(observation, drawingUnit, resolvedHeights, heightTexts);
    if (height.heightMm) resolvedHeights.set(widthOrder, height);
    if (height.warning) warnings.add(`${cabinetId}：${height.warning}`);
    const depth = depthMap.get(widthOrder);
    const depthMm = positiveInteger(depth?.depthMm);
    if (!widthMm) unresolved.add(`${cabinetId} 無法辨識桶身外寬 W；請確認底部水平分段尺寸。`);
    if (!height.heightMm) unresolved.add(`${cabinetId} 無法閉合桶身外高 H；需有桶底到桶頂的外總高，或同一對連續側板內的完整垂直分段鏈。`);
    if (!depthMm) unresolved.add(`${cabinetId} 無法辨識桶身深度 D；需有 D／深度標註及其適用範圍。`);
    cabinets.push({
      widthOrder,
      cabinetId,
      widthMm,
      heightMm: height.heightMm,
      depthMm,
      widthRawText: widthTexts[index] || "",
      heightRawTexts: height.rawTexts,
      depthRawText: depth?.rawText || "",
      heightFormula: height.formula,
      widthEvidence: `方向關卡鎖定的底部水平第${widthOrder}段：${widthTexts[index] || "未讀到"}`,
      heightEvidence: height.evidence,
      depthEvidence: depth?.evidence || "",
      confidence: observation?.confidence || "low",
      widthSource: widthMm ? "orientation_lock" : "missing",
      heightSource: height.source,
      depthSource: depthMm ? "depth_group" : "missing",
      complete: widthMm > BOARD_PROFILE.topBottomWidthDeductionMm && height.heightMm > BOARD_PROFILE.backHeightDeductionMm && depthMm > 0,
    });
  }

  if (!lockedWidths.length) unresolved.add("無法從旋正後的底部水平尺寸鏈建立桶身；不產生板件。");
  const materials = calculateCarcassMaterials(cabinets);
  return {
    mode: "carcass_only",
    projectName: displayProjectName(observations.projectName),
    drawingUnit,
    cabinets,
    materials,
    unresolved: [...unresolved].map((item) => item.trim()).filter(Boolean),
    warnings: [...warnings],
    excluded: [...EXCLUDED_COMPONENTS],
    complete: cabinets.length > 0 && cabinets.every((cabinet) => cabinet.complete) && unresolved.size === 0,
  };
}
