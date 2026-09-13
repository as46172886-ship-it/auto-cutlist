import { findSemanticEvidenceErrors } from "./semantic-validation.ts";
import { blockingIssueClass, hasBlockingIssueClass, mergeBlockingIssues } from "../../blocking-issues.ts";
import { STANDARD_BOARD_PROFILE } from "../../sop.ts";
import { doorCountEvidenceIsClosed, normalizeDoorGap24Fields } from "../../door-recognition.ts";
import { drawerWallHeightForFrontHeight, drawerWallHeightFormulaText } from "../../drawer-rules.ts";
import { findSegmentationLockErrors } from "./segmentation-locks.ts";

const positive = (value: unknown) => Number(value) > 0;
const rounded = (value: unknown) => Math.round(Number(value) || 0);
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unique(items: string[]) {
  return items.map((item) => item.trim()).filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
}

function cabinetLabel(cabinet: JsonRecord) {
  return String(cabinet.id || cabinet.name || "未命名桶身");
}

function dividerConnectionDeduction(value: unknown) {
  if (value === "fixed_shelf_centerline") return 9;
  if (["top_board", "bottom_board", "fixed_shelf_full"].includes(String(value))) return 18;
  return 0;
}

function dividerIsComplete(cabinet: JsonRecord, divider: JsonRecord) {
  const profile = isRecord(cabinet.boardProfile) ? cabinet.boardProfile : STANDARD_BOARD_PROFILE as unknown as JsonRecord;
  const depthDeduction = rounded(profile.fixedShelfDepthDeductionMm) || 29;
  const depthComplete = divider.depthBasis === "standard_d_minus_29"
    ? rounded(cabinet.depthMm) > depthDeduction
    : divider.depthBasis === "finished" && positive(divider.depthMm);
  const topDeduction = dividerConnectionDeduction(divider.topConnection);
  const bottomDeduction = dividerConnectionDeduction(divider.bottomConnection);
  const heightComplete = divider.heightBasis === "finished"
    ? positive(divider.heightMm)
    : divider.heightBasis === "connection_span"
      && topDeduction > 0
      && bottomDeduction > 0
      && rounded(divider.referenceSpanMm) > topDeduction + bottomDeduction;
  return depthComplete && heightComplete;
}

function resolvedFootState(cabinet: JsonRecord) {
  if (["present", "absent", "unknown"].includes(String(cabinet.footState))) return String(cabinet.footState);
  if (cabinet.isHanging || cabinet.cabinetKind === "hanging") return "absent";
  return positive(cabinet.footHeightMm) ? "present" : "unknown";
}

function boardProfileProblem(cabinet: JsonRecord) {
  if (!isRecord(cabinet.boardProfile)) return "";
  const profile = cabinet.boardProfile;
  const numbers = ["bodyThicknessMm", "backThicknessMm", "drawerBottomThicknessMm", "topBottomWidthDeductionMm", "backWidthDeductionMm", "backHeightDeductionMm", "fixedShelfDepthDeductionMm", "fixedShelfWidthDeductionMm", "adjustableShelfDepthDeductionMm", "adjustableShelfWidthDeductionMm"];
  if (profile.deductionBasis === "unknown" || numbers.some((key) => !positive(profile[key]))) return "板厚或扣數未確認";
  const isStandardThickness = rounded(profile.bodyThicknessMm) === 18 && rounded(profile.backThicknessMm) === 8 && rounded(profile.drawerBottomThicknessMm) === 8;
  const isStandardDeductions = rounded(profile.topBottomWidthDeductionMm) === 36
    && rounded(profile.backWidthDeductionMm) === 26
    && rounded(profile.backHeightDeductionMm) === 26
    && rounded(profile.fixedShelfDepthDeductionMm) === 29
    && rounded(profile.fixedShelfWidthDeductionMm) === 36
    && rounded(profile.adjustableShelfDepthDeductionMm) === 40
    && rounded(profile.adjustableShelfWidthDeductionMm) === 37;
  if (profile.deductionBasis === "standard_sop" && (!isStandardThickness || !isStandardDeductions)) return "非標板厚卻套用標準扣數";
  return "";
}

function hasPositiveFixedShelfEvidence(text: string) {
  const withoutNegativeClaims = text
    .replace(/(?:未見|沒有|並無|無|未標|未辨識).{0,12}(?:F(?:\s*註記|\s*標記|\s*中心線)?|固格|固定層板)/gi, "")
    .replace(/(?:無法|不能|未能).{0,12}(?:確認|判定).{0,12}(?:F|固格|固定層板)/gi, "")
    .replace(/(?:固格|固定層板).{0,8}(?:或|／).{0,8}(?:活格|活動層板)/gi, "");
  return /(?:\bF\s*[:：=]?\s*\d+|F\s*中心線|(?:明確|清楚|可見|標註|標示|確認|判定|屬於).{0,8}(?:固格|固定層板)|(?:固格|固定層板).{0,8}(?:中心線|高度|標註|標示|確認))/i.test(withoutNegativeClaims);
}

function normalizeVisibleShelfRegion(original: JsonRecord) {
  const region = { ...original };
  const text = `${String(region.region || "")} ${String(region.evidence || "")}`;
  const isVisibleHorizontalShelf = rounded(region.quantity) > 0
    && /(?:水平.{0,8}(?:層板|板線|分隔|板)|(?:層板|活格|活動層板).{0,8}(?:水平|實線|虛線|可見)|(?:實線|虛線).{0,8}水平)/i.test(text);
  if (region.classification !== "unknown" || !isVisibleHorizontalShelf || hasPositiveFixedShelfEvidence(text)) return region;
  region.classification = "adjustable_shelf";
  region.sopRuleIds = unique([...(Array.isArray(region.sopRuleIds) ? region.sopRuleIds.map(String) : []), "R24", "Q10"]);
  region.confidence = region.confidence === "high" ? "high" : "medium";
  region.evidence = `${String(region.evidence || "")}；後端依R24鎖定：已看見實體水平層板，且沒有F中心線、固格或固定層板的肯定標記，因此按活格逐片計。`.replace(/^；/, "");
  return region;
}

function isUnresolvedShelfRegion(region: JsonRecord) {
  if (region.classification !== "unknown" || rounded(region.quantity) <= 0) return false;
  return /(?:水平|層板|固格|活格|活動層板|板線|分隔)/.test(`${String(region.region || "")} ${String(region.evidence || "")}`);
}

function isShelfAmbiguityQuestion(question: string) {
  return /(?:水平|層板|固格|活格|活動層板|虛線).{0,40}(?:確認|判定|性質|固定|活動)|(?:確認|判定).{0,40}(?:水平|層板|固格|活格|活動層板|虛線)/.test(question);
}

export function inheritSharedDepths(structured: JsonRecord) {
  const cabinets = (Array.isArray(structured.cabinets) ? structured.cabinets : []).filter(isRecord).map((cabinet) => ({ ...cabinet }));
  const ledger = isRecord(structured.dimensionLedger) ? structured.dimensionLedger : {};
  const ledgerGroups = (Array.isArray(ledger.depthGroups) ? ledger.depthGroups : []).filter(isRecord);
  const groupCandidates = new Map<string, Array<{ depth: number; priority: number; evidence: string }>>();

  for (const group of ledgerGroups) {
    if (!group?.id || !positive(group.depthMm)) continue;
    groupCandidates.set(String(group.id), [{ depth: rounded(group.depthMm), priority: group.source === "user_confirmed" ? 3 : 2, evidence: String(group.evidence || "尺寸證據表共用深度") }]);
  }
  for (const cabinet of cabinets) {
    const groupId = String(cabinet.depthGroupId || "").trim();
    if (!groupId || !positive(cabinet.depthMm)) continue;
    const current = groupCandidates.get(groupId) || [];
    current.push({
      depth: rounded(cabinet.depthMm),
      priority: cabinet.depthSource === "user_confirmed" ? 4 : cabinet.depthSource === "explicit" ? 3 : 1,
      evidence: String(cabinet.depthEvidence || cabinet.evidence || "同深度群組已確認櫃體"),
    });
    groupCandidates.set(groupId, current);
  }

  const resolvedGroups = new Map<string, { depth: number; evidence: string; conflict: boolean }>();
  for (const [groupId, candidates] of groupCandidates) {
    const highest = Math.max(...candidates.map((candidate) => candidate.priority));
    const preferred = candidates.filter((candidate) => candidate.priority === highest);
    const depths = unique(preferred.map((candidate) => String(candidate.depth))).map(Number);
    resolvedGroups.set(groupId, { depth: depths[0] || 0, evidence: preferred[0]?.evidence || "", conflict: depths.length > 1 });
  }

  const inheritedCabinetIds: string[] = [];
  for (const cabinet of cabinets) {
    if (positive(cabinet.depthMm)) continue;
    const groupId = String(cabinet.depthGroupId || "").trim();
    const resolved = groupId ? resolvedGroups.get(groupId) : undefined;
    if (!resolved || resolved.conflict || !positive(resolved.depth)) continue;
    cabinet.depthMm = resolved.depth;
    cabinet.depthSource = "shared_group";
    cabinet.depthEvidence = resolved.evidence;
    inheritedCabinetIds.push(cabinetLabel(cabinet));
  }

  return { cabinets, resolvedGroups, inheritedCabinetIds };
}

export function normalizeDeterministicInterior(cabinets: JsonRecord[]) {
  return cabinets.map((original) => {
    const cabinet = { ...original };
    const groups = (Array.isArray(cabinet.drawerGroups) ? cabinet.drawerGroups : []).filter(isRecord).map((originalGroup) => {
      const group = { ...originalGroup };
      const calculatedWallHeight = drawerWallHeightForFrontHeight(group.openingHeightMm);
      if (calculatedWallHeight > 0) {
        group.drawerWallHeightMm = calculatedWallHeight;
        const formulaEvidence = `後端固定級距：${drawerWallHeightFormulaText(group.openingHeightMm)}`;
        group.evidence = `${String(group.evidence || "")}；${formulaEvidence}`.replace(/^；/, "");
      } else group.drawerWallHeightMm = 0;
      return group;
    });
    cabinet.drawerGroups = groups;
    const componentRegions = (Array.isArray(cabinet.componentRegions) ? cabinet.componentRegions : []).filter(isRecord).map(normalizeVisibleShelfRegion);
    cabinet.componentRegions = componentRegions;
    const regionAdjustableCount = componentRegions
      .filter((region) => region.classification === "adjustable_shelf")
      .reduce((sum, region) => sum + rounded(region.quantity), 0);
    if (regionAdjustableCount > 0) cabinet.adjustableShelves = regionAdjustableCount;
    const dividers = (Array.isArray(cabinet.middleDividers) ? cabinet.middleDividers : []).filter(isRecord).map((divider) => ({ ...divider }));
    const regionDividerCount = componentRegions
      .filter((region) => region.classification === "middle_divider")
      .reduce((sum, region) => sum + rounded(region.quantity), 0);
    const fullHeightDividerEvidence = componentRegions.filter((region) => region.classification === "middle_divider"
      && (rounded(region.heightMm) >= rounded(cabinet.heightMm) - 50 || /(?:全高|頂板.{0,8}底板|由頂到底|top.{0,8}bottom)/i.test(String(region.evidence || ""))));
    while (dividers.length < regionDividerCount && fullHeightDividerEvidence.length) {
      const evidence = fullHeightDividerEvidence[Math.min(dividers.length, fullHeightDividerEvidence.length - 1)];
      dividers.push({
        depthMm: 0, heightMm: 0, referenceSpanMm: rounded(cabinet.heightMm),
        depthBasis: "standard_d_minus_29", heightBasis: "connection_span",
        region: String(evidence.region || "全高中立"), topConnection: "top_board", bottomConnection: "bottom_board",
        evidence: `${String(evidence.evidence || "")}；後端依componentRegions已確認的全高中立補成上接頂板、下接底板`,
      });
    }
    const completeCount = dividers.filter((divider) => dividerIsComplete(cabinet, divider)).length;
    const topGroups = groups.filter((group) => {
      const explicitTop = group.regionPosition === "top";
      const evidenceTop = /(?:上方|頂部|upper|top)/i.test(String(group.evidence || ""));
      return Boolean(group.sideBySide) && rounded(group.count) > 1 && (explicitTop || evidenceTop);
    });
    const required = topGroups.reduce((sum, group) => sum + Math.max(0, rounded(group.count) - 1), 0);
    let missing = Math.max(0, required - completeCount);
    let incompleteIndex = dividers.findIndex((divider) => !dividerIsComplete(cabinet, divider));

    for (const group of topGroups) {
      if (!missing) break;
      const F = rounded(group.fixedShelfPositionMm);
      const H = rounded(cabinet.heightMm);
      if (!(F > 0 && H > F && rounded(cabinet.depthMm) > 29)) continue;
      const generated: JsonRecord = {
        depthMm: 0,
        heightMm: 0,
        referenceSpanMm: H - F,
        depthBasis: "standard_d_minus_29",
        heightBasis: "connection_span",
        region: `上方並排抽屜區（${String(group.id || "未命名抽屜組")}）`,
        topConnection: "top_board",
        bottomConnection: "fixed_shelf_centerline",
        evidence: `後端依已確認上方並排${rounded(group.count)}列、H${H}與F中心線${F}建立；只做到上方抽屜區`,
      };
      const groupNeed = Math.max(0, rounded(group.count) - 1);
      for (let index = 0; index < groupNeed && missing > 0; index += 1) {
        if (incompleteIndex >= 0) {
          dividers[incompleteIndex] = { ...dividers[incompleteIndex], ...generated, evidence: `${String(dividers[incompleteIndex].evidence || "")}；${generated.evidence}`.replace(/^；/, "") };
          incompleteIndex = dividers.findIndex((divider, candidate) => candidate > incompleteIndex && !dividerIsComplete(cabinet, divider));
        } else dividers.push({ ...generated });
        missing -= 1;
      }
    }

    cabinet.middleDividers = dividers;
    const doorCalloutText = [
      ...(Array.isArray(cabinet.drawingNotes) ? cabinet.drawingNotes.map(String) : []),
      ...componentRegions.flatMap((region) => [String(region.region || ""), String(region.evidence || "")]),
    ].join(" ");
    const numericDoorWidths = unique([...doorCalloutText.matchAll(/門\s*([0-9]{2,4})(?![0-9A-Za-z])/g)].map((match) => match[1]))
      .map(Number)
      .filter((value) => value > 2);
    const nominalDoorWidth = numericDoorWidths.length === 1 ? numericDoorWidths[0] : 0;
    const hasDrawerStructure = rounded(cabinet.drawerCount) > 0 || groups.some((group) => rounded(group.count) > 0);
    cabinet.doors = (Array.isArray(cabinet.doors) ? cabinet.doors : []).filter(isRecord).map((originalDoor) => {
      const door = { ...originalDoor };
      const symbols = (Array.isArray(door.doorSymbols) ? door.doorSymbols : []).map(String).filter((symbol) => symbol === "<" || symbol === ">");
      const count = rounded(door.count);
      if (symbols.length && (count <= 0 || !door.countBasis || door.countBasis === "unknown")) {
        door.count = symbols.length;
        door.countBasis = "symbols";
      } else if (count > 0 && (!door.countBasis || door.countBasis === "unknown") && doorCountEvidenceIsClosed({ ...door, countBasis: "leaf_geometry" })) {
        door.countBasis = "leaf_geometry";
      }
      const resolvedCount = rounded(door.count);
      if (symbols.length === resolvedCount && door.direction === "unknown") {
        door.direction = symbols.every((symbol) => symbol === "<") ? "left" : symbols.every((symbol) => symbol === ">") ? "right" : "mixed";
      }
      const normalizedDoor = normalizeDoorGap24Fields(door);
      const hasFinishedSize = normalizedDoor.dimensionBasis === "finished" && positive(normalizedDoor.finishedWidthMm) && positive(normalizedDoor.finishedHeightMm);
      const hasOpeningSize = normalizedDoor.dimensionBasis === "opening" && positive(normalizedDoor.openingWidthMm) && positive(normalizedDoor.openingHeightMm);
      if (normalizedDoor.type === "4E" && doorCountEvidenceIsClosed(normalizedDoor) && !hasFinishedSize && !hasOpeningSize && nominalDoorWidth) {
        const heightBasis = positive(normalizedDoor.openingHeightMm)
          ? rounded(normalizedDoor.openingHeightMm)
          : !hasDrawerStructure
            ? rounded(cabinet.heightMm)
            : 0;
        if (heightBasis > 4) {
          const bottomDeduction = normalizedDoor.includesBottom30 ? 30 : 0;
          const slantedGapDeduction = normalizedDoor.slantedGap24Context === "door_chain_included" || (!normalizedDoor.slantedGap24Context && normalizedDoor.includesSlantedGap24) ? 24 : 0;
          const finishedHeight = heightBasis - bottomDeduction - slantedGapDeduction - 4;
          if (finishedHeight > 0) {
            normalizedDoor.finishedWidthMm = nominalDoorWidth - 2;
            normalizedDoor.finishedHeightMm = finishedHeight;
            normalizedDoor.dimensionBasis = "finished";
            normalizedDoor.evidence = `${String(normalizedDoor.evidence || "")}；[R38] 純數字門標記門${nominalDoorWidth}：完成門寬${nominalDoorWidth}-2=${nominalDoorWidth - 2}；門高基準${heightBasis}${bottomDeduction ? "-30" : ""}${slantedGapDeduction ? "-24" : ""}-4=${finishedHeight}`.replace(/^；/, "");
          }
        }
      }
      return normalizedDoor;
    });
    cabinet.baffles = (Array.isArray(cabinet.baffles) ? cabinet.baffles : []).filter(isRecord).map((baffle) => {
      if (baffle.mountBasis === "fixed_shelf" || baffle.mountBasis === "raised_bottom") return { ...baffle, kind: "drawer_60", heightMm: 60 };
      if (baffle.mountBasis === "top_board" && baffle.kind === "door_50") return { ...baffle, heightMm: 50 };
      return { ...baffle };
    });
    return cabinet;
  });
}

function normalizeIndependentPanels(structured: JsonRecord, cabinets: JsonRecord[]) {
  const panels = (Array.isArray(structured.independentPanels) ? structured.independentPanels : []).filter(isRecord).map((panel) => ({ ...panel }));
  const cropEvidenceHints = (Array.isArray(structured.cropEvidenceHints) ? structured.cropEvidenceHints : []).filter(isRecord);
  const cabinetById = new Map(cabinets.map((cabinet) => [cabinetLabel(cabinet), cabinet]));
  const elevationIds = new Set(cabinets.map((cabinet) => String(cabinet.elevationId || "")).filter(Boolean));
  const multiElevation = elevationIds.size > 1;
  const orderedCabinets = [...cabinets].sort((a, b) =>
    String(a.elevationId || "").localeCompare(String(b.elevationId || ""), undefined, { numeric: true })
      || rounded(a.widthOrder) - rounded(b.widthOrder));
  const edges = new Map<string, { cabinetId: string; elevationId: string; side: "left" | "right"; heightMm: number; evidence: string }>();

  for (const hint of cropEvidenceHints) {
    const evidence = String(hint.region || "");
    if (!/(?:填縫板|收口線|牆.{0,8}分離|分離.{0,8}牆)/.test(evidence)) continue;
    const side = /右外側|右側/.test(evidence) ? "right" : "left";
    const requestedId = String(hint.cabinetId || "");
    const adjacentCabinet = cabinetById.get(requestedId) || (!multiElevation ? (side === "left" ? orderedCabinets[0] : orderedCabinets.at(-1)) : undefined);
    if (!adjacentCabinet) continue;
    const adjacentId = adjacentCabinet ? cabinetLabel(adjacentCabinet) : requestedId || "未定位桶身";
    const elevationId = String(adjacentCabinet.elevationId || "");
    const heightMm = rounded(adjacentCabinet?.heightMm);
    edges.set(`${adjacentId}:${side}`, { cabinetId: adjacentId, elevationId, side, heightMm, evidence });
  }

  const edgeList = [...edges.values()];
  const fillerPattern = /(?:填縫板|收口板|收邊板)/;
  const existingFillers = panels.filter((panel) => fillerPattern.test(String(panel.name || panel.id || "")));
  if (existingFillers.length) {
    return panels.map((panel) => {
      if (!fillerPattern.test(String(panel.name || panel.id || ""))) return panel;
      const panelElevation = String(panel.elevationId || "");
      const eligibleEdges = multiElevation ? edgeList.filter((edge) => edge.elevationId === panelElevation) : edgeList;
      const eligibleHeights = unique(eligibleEdges.filter((edge) => edge.heightMm > 0).map((edge) => String(edge.heightMm))).map(Number);
      const widthMm = positive(panel.widthMm) ? rounded(panel.widthMm) : 100;
      const heightMm = positive(panel.heightMm) ? rounded(panel.heightMm) : eligibleHeights.length === 1 ? eligibleHeights[0] : 0;
      const count = positive(panel.count) ? rounded(panel.count) : eligibleEdges.length || 0;
      const standardNote = widthMm === 100 ? "標準填縫寬100mm；高度取相鄰桶身外高；現場修邊" : "圖面明標完成寬優先；高度取相鄰桶身外高；現場修邊";
      return {
        ...panel,
        name: String(panel.name || "填縫板"), count, widthMm, heightMm,
        thicknessMm: positive(panel.thicknessMm) ? rounded(panel.thicknessMm) : 18,
        grainDirection: panel.grainDirection || "vertical",
        dimensionOrder: panel.dimensionOrder || "width_height",
        note: `${String(panel.note || "")}；${standardNote}`.replace(/^；/, ""),
        evidence: `${String(panel.evidence || "")}；[R34] 填縫板後端公式核對`.replace(/^；/, ""),
      };
    });
  }

  const groupedEdges = new Map<string, typeof edgeList>();
  for (const edge of edgeList) {
    if (!(edge.heightMm > 0)) continue;
    const key = `${edge.elevationId}|${edge.heightMm}`;
    groupedEdges.set(key, [...(groupedEdges.get(key) || []), edge]);
  }
  for (const matchingEdges of groupedEdges.values()) {
    const { elevationId, heightMm } = matchingEdges[0];
    panels.push({
      id: `AUTO-FILLER-${elevationId}-${heightMm}-${matchingEdges.length}`,
      elevationId,
      name: "填縫板",
      count: matchingEdges.length,
      widthMm: 100,
      heightMm,
      thicknessMm: 18,
      grainDirection: "vertical",
      dimensionOrder: "width_height",
      note: "標準填縫寬100mm；高度取相鄰桶身外高；不含腳高與上方留空；現場修邊",
      evidence: `[R34] ${matchingEdges.map((edge) => `${edge.cabinetId}${edge.side === "left" ? "左" : "右"}側`).join("、")}偵測到與櫃身分離的牆／收口線`,
    });
  }
  return panels;
}

const BACKEND_VERIFIED_QUESTION_CLASSES = new Set([
  "drawer-data", "drawer-separation", "middle-divider", "hinge-schedule", "baffle", "baffle-segments",
  "door-size", "door-count", "door-handles", "door-gap-24", "depth", "width", "height", "cabinet-split",
  "dimension-chain", "panel-data", "feet", "special-back-strip", "board-profile", "drawer-slide-depth",
  "special-hardware", "slanted-retreat",
]);

function isStaleDepthQuestion(question: string) {
  return /(?:缺少|未標|未讀|無法讀取|請提供|請確認).{0,12}(?:桶身)?深度|深度.{0,12}(?:缺少|未知|未確認|未標|請提供)/.test(question);
}

function isInternalEvidenceQuestion(question: string) {
  return /(?:尺寸ID|證據ID|內部尺寸證據|軸向硬檢查|綁定.{0,8}(?:ID|證據))/.test(question);
}

function isMaterialAnnotationQuestion(question: string) {
  return /(?:2\.5#|材質|板種|色號|顏色).{0,20}(?:確認|請問|是否|未明)|(?:確認|請問|是否|未明).{0,20}(?:2\.5#|材質|板種|色號|顏色)/i.test(question);
}

export function findInteriorCompletenessErrors(structured: JsonRecord) {
  const errors: string[] = [];
  const drawerCountGaps: string[] = [];
  const drawerWidthGaps: string[] = [];
  const drawerFrontHeightGaps: string[] = [];
  const drawerCenterlineGaps: string[] = [];
  const drawerCenterlineConflicts: string[] = [];
  const innerDrawerFGaps: string[] = [];
  const innerDrawerCountGaps: string[] = [];
  const drawerSlideGaps: string[] = [];
  const drawerSideBySideConflicts: string[] = [];
  const drawerShelfGaps: string[] = [];
  const shelfClassificationGaps: string[] = [];
  const dividerGaps: string[] = [];
  const dividerCountGaps: string[] = [];
  const baffleGaps: string[] = [];
  const baffleSegmentGaps: string[] = [];
  const doorCountGaps: string[] = [];
  const doorHandleGaps: string[] = [];
  const footGaps: string[] = [];
  const backStripGaps: string[] = [];
  const boardProfileGaps: string[] = [];
  const retreatGaps: string[] = [];

  for (const cabinet of (Array.isArray(structured.cabinets) ? structured.cabinets : []).filter(isRecord)) {
    const label = cabinetLabel(cabinet);
    const drawerCount = rounded(cabinet.drawerCount);
    const groups = (Array.isArray(cabinet.drawerGroups) ? cabinet.drawerGroups : []).filter(isRecord);
    const doors = (Array.isArray(cabinet.doors) ? cabinet.doors : []).filter(isRecord);
    const dividers = (Array.isArray(cabinet.middleDividers) ? cabinet.middleDividers : []).filter(isRecord);
    const baffles = (Array.isArray(cabinet.baffles) ? cabinet.baffles : []).filter(isRecord);
    const componentRegions = (Array.isArray(cabinet.componentRegions) ? cabinet.componentRegions : []).filter(isRecord);
    const unresolvedShelves = componentRegions.filter(isUnresolvedShelfRegion);
    if (unresolvedShelves.length) shelfClassificationGaps.push(`${label} 有${unresolvedShelves.length}個包含水平板線的區域仍標成未知`);
    const regionDividerCount = componentRegions.filter((region) => region.classification === "middle_divider").reduce((sum, region) => sum + rounded(region.quantity), 0);

    const profile = isRecord(cabinet.boardProfile) ? cabinet.boardProfile : STANDARD_BOARD_PROFILE as unknown as JsonRecord;
    const fixedDepthDeduction = rounded(profile.fixedShelfDepthDeductionMm) || STANDARD_BOARD_PROFILE.fixedShelfDepthDeductionMm;
    const innerWidth = rounded(cabinet.widthMm) - (rounded(profile.topBottomWidthDeductionMm) || STANDARD_BOARD_PROFILE.topBottomWidthDeductionMm);
    const groupedCount = groups.reduce((sum, group) => sum + rounded(group.count), 0);
    if ((drawerCount > 0 || groups.length > 0) && groupedCount !== drawerCount) drawerCountGaps.push(`${label} 桶身總數${drawerCount}抽／逐組合計${groupedCount}抽`);

    let groupedInnerCount = 0;
    for (const [groupIndex, group] of groups.entries()) {
      const groupLabel = groups.length > 1 ? `第${groupIndex + 1}組抽屜` : "抽屜區";
      const reference = `${label} ${groupLabel}`;
      const count = rounded(group.count);
      const centerlineCount = Number(group.centerlineBoundaryCount);
      if (count <= 0) drawerCountGaps.push(`${reference} 數量未確認`);
      if (!positive(group.openingWidthMm)) drawerWidthGaps.push(reference);
      if (!positive(group.openingHeightMm)) drawerFrontHeightGaps.push(reference);
      if (!Number.isInteger(centerlineCount) || centerlineCount < 0 || centerlineCount > 2) drawerCenterlineGaps.push(reference);
      if (Number.isInteger(centerlineCount) && Boolean(group.usesCenterlineWidth) !== (centerlineCount > 0)) drawerCenterlineConflicts.push(reference);
      if (group.isInner) {
        groupedInnerCount += count;
        if (!positive(group.fixedShelfPositionMm)) innerDrawerFGaps.push(reference);
      }
      const available = Math.min(500, rounded(cabinet.depthMm) - fixedDepthDeduction);
      const outerSlide = available >= 300 ? Math.floor(available / 50) * 50 : 0;
      const selectedSlide = group.isInner ? outerSlide - 50 : outerSlide;
      if (count > 0 && selectedSlide < 300) drawerSlideGaps.push(`${reference}（D${rounded(cabinet.depthMm)}／可用深${Math.max(0, available)}）`);
    }
    if (rounded(cabinet.innerDrawerCount) !== groupedInnerCount || rounded(cabinet.innerDrawerCount) > drawerCount) {
      innerDrawerCountGaps.push(`${label} 桶身內抽${rounded(cabinet.innerDrawerCount)}抽／逐組內抽${groupedInnerCount}抽`);
    }
    const hasSideBySideGroup = groups.some((group) => Boolean(group.sideBySide));
    if (groups.length && Boolean(cabinet.sideBySideDrawers) !== hasSideBySideGroup) drawerSideBySideConflicts.push(label);
    const requiredDividerCount = groups.reduce((sum, group) => Boolean(group.sideBySide) ? sum + Math.max(0, rounded(group.count) - 1) : sum, 0);
    const completeDividerCount = dividers.filter((divider) => dividerIsComplete(cabinet, divider)).length;
    if (regionDividerCount > dividers.length) dividerCountGaps.push(`${label} 區域盤點已辨識${regionDividerCount}片中立／結構只建立${dividers.length}片`);
    if (dividers.some((divider) => !dividerIsComplete(cabinet, divider))) dividerGaps.push(label);
    if (Boolean(cabinet.sideBySideDrawers) && requiredDividerCount === 0 && completeDividerCount === 0) dividerGaps.push(label);
    if (requiredDividerCount > completeDividerCount) dividerCountGaps.push(`${label} 並排${requiredDividerCount + 1}列需${requiredDividerCount}片／已完整${completeDividerCount}片`);

    const hasDoorRegion = doors.some((door) => rounded(door.count) > 0 && door.type !== "none");
    if (drawerCount > 0 && hasDoorRegion && !positive(cabinet.fixedShelves)) drawerShelfGaps.push(label);

    const baffleGroups = new Map<string, JsonRecord[]>();
    for (const baffle of baffles) {
      const baffleLabel = `${label} ${String(baffle.id || "未命名擋板")}`;
      const expectedHeight = baffle.mountBasis === "fixed_shelf" || baffle.mountBasis === "raised_bottom" || baffle.kind === "drawer_60" ? 60 : baffle.kind === "door_50" ? 50 : rounded(baffle.heightMm);
      if (!positive(expectedHeight) || (baffle.kind === "drawer_60" && rounded(baffle.heightMm) !== 60) || (baffle.kind === "door_50" && rounded(baffle.heightMm) !== 50)) baffleGaps.push(`${baffleLabel} 高度`);
      if (baffle.widthBasis === "cabinet_inner") {
        if (rounded(baffle.widthMm) > 0 && Math.abs(rounded(baffle.widthMm) - innerWidth) > 2) baffleGaps.push(`${baffleLabel} 寬度應由後端固定算W-${rounded(profile.topBottomWidthDeductionMm) || 36}=${innerWidth}`);
      } else if (baffle.widthBasis !== "finished_segment" || !positive(baffle.widthMm)) baffleGaps.push(`${baffleLabel} 分段寬度`);
      if (Boolean(baffle.splitAtMiddleDivider) !== (rounded(baffle.segmentCount) > 1)) baffleSegmentGaps.push(`${baffleLabel} 分段註記矛盾`);
      if (rounded(baffle.segmentCount) > 1) {
        const groupId = String(baffle.segmentGroupId || "").trim();
        if (!groupId) baffleSegmentGaps.push(`${baffleLabel} 缺分段群組ID`);
        else baffleGroups.set(groupId, [...(baffleGroups.get(groupId) || []), baffle]);
      }
    }
    for (const [groupId, members] of baffleGroups) {
      const expected = rounded(members[0]?.segmentCount);
      const indexes = new Set(members.map((member) => rounded(member.segmentIndex)));
      if (members.length !== expected || indexes.size !== expected || [...indexes].some((index) => index < 1 || index > expected)) baffleSegmentGaps.push(`${label} ${groupId} 應有${expected}支實體擋板，現在只有${members.length}筆完整分段`);
    }

    const allDoorCountsClosed = doors.filter((door) => door.type === "4E").every(doorCountEvidenceIsClosed);
    for (const door of doors) {
      if (door.type !== "4E") continue;
      const count = rounded(door.count);
      const doorLabel = `${label} 4E門`;
      const symbols = Array.isArray(door.doorSymbols) ? door.doorSymbols.map(String) : [];
      const countClosed = doorCountEvidenceIsClosed(door);
      if (!countClosed) doorCountGaps.push(`${doorLabel}片數依據未確認`);
      if (door.countBasis === "symbols" && symbols.length !== count) doorCountGaps.push(`${doorLabel}數量${count}片／開向符號${symbols.length}個`);
      if (["leaf_geometry", "explicit_note", "user_confirmed"].includes(String(door.countBasis)) && !String(door.evidence || "").trim()) doorCountGaps.push(`${doorLabel}缺數量證據`);
      if (!countClosed) continue;
      if (!allDoorCountsClosed) continue;
      if (count > 0 && door.direction === "unknown" && rounded(door.jHandleCount) > 0) doorHandleGaps.push(`${doorLabel}有J把加工但開向未確認`);
      if (rounded(door.jHandleCount) > count
        || rounded(door.slantedHandleCount) > count
        || rounded(door.jHandleCount) + rounded(door.slantedHandleCount) > count
        || Boolean(door.slantedHandle) !== (rounded(door.slantedHandleCount) > 0)) {
        doorHandleGaps.push(`${doorLabel}片數${count}／J把${rounded(door.jHandleCount)}／斜把${rounded(door.slantedHandleCount)}`);
      }
      if (rounded(door.slantedHandleCount) > 0 && !["top", "bottom", "long"].includes(String(door.slantedHandleStyle || "unknown"))) doorHandleGaps.push(`${doorLabel}有斜把加工但尚未確認上斜把／下斜把／長斜把`);
    }

    const state = resolvedFootState(cabinet);
    if (cabinet.cabinetKind === "floor" && state === "unknown") footGaps.push(`${label}有無調整腳`);
    if (cabinet.cabinetKind === "floor" && state === "present" && !positive(cabinet.footHeightMm)) footGaps.push(`${label}腳高（≤120用A10、>120用A12）`);
    if ((cabinet.isHanging || cabinet.cabinetKind === "hanging") && (state === "present" || positive(cabinet.footHeightMm))) footGaps.push(`${label}吊櫃不可有調整腳`);
    if (["tv", "mirror", "special"].includes(String(cabinet.cabinetKind)) && cabinet.specialBackStripState !== "confirmed") backStripGaps.push(`${label}特殊櫃背條數（可確認為0）`);
    const profileIssue = boardProfileProblem(cabinet);
    if (profileIssue) boardProfileGaps.push(`${label}${profileIssue}`);
    if (![0, 19].includes(rounded(cabinet.topBoardRetreatMm)) || ![0, 19].includes(rounded(cabinet.bottomBoardRetreatMm)) || rounded(cabinet.slantedFixedShelfCount) > rounded(cabinet.fixedShelves)) retreatGaps.push(label);
  }

  const drawerDetails: string[] = [];
  if (drawerCountGaps.length) drawerDetails.push(`數量分組—${unique(drawerCountGaps).join("、")}`);
  if (drawerWidthGaps.length) drawerDetails.push(`抽屜格寬—${unique(drawerWidthGaps).join("、")}`);
  if (drawerFrontHeightGaps.length) drawerDetails.push(`完成屜頭高度—${unique(drawerFrontHeightGaps).join("、")}（後端會自動換算抽牆高）`);
  if (drawerCenterlineGaps.length) drawerDetails.push(`中立中心線邊界數0／1／2—${unique(drawerCenterlineGaps).join("、")}`);
  if (drawerCenterlineConflicts.length) drawerDetails.push(`中心線註記矛盾—${unique(drawerCenterlineConflicts).join("、")}`);
  if (innerDrawerFGaps.length) drawerDetails.push(`內抽F固格中心線高度—${unique(innerDrawerFGaps).join("、")}`);
  if (innerDrawerCountGaps.length) drawerDetails.push(`內抽數量—${unique(innerDrawerCountGaps).join("、")}`);
  if (drawerSlideGaps.length) drawerDetails.push(`滑軌可用深度不足—${unique(drawerSlideGaps).join("、")}`);
  if (drawerSideBySideConflicts.length) drawerDetails.push(`並排抽註記矛盾—${unique(drawerSideBySideConflicts).join("、")}`);
  if (drawerDetails.length) errors.push(`[抽屜數量對照] 請一次補齊：${drawerDetails.join("；")}。每抽固定應有前後抽牆2片、邊抽牆2片、底板1片、滑軌1組；抽木榫D<500每抽12顆、D≥500每抽4顆；抽牆高度由完成屜頭高固定套級距：≤200mm用100mm、201–239mm用120mm、≥240mm用180mm，不另行猜問。`);
  if (drawerShelfGaps.length) errors.push(`${unique(drawerShelfGaps).join("、")} 同一桶內有抽屜區與門區，但尚未確認兩區之間的實際固格；請一次確認是否有分隔橫板。`);
  if (shelfClassificationGaps.length) errors.push(`[層板逐片對照] ${unique(shelfClassificationGaps).join("、")}；門片開向虛線只是覆蓋標記，不會讓後方已畫出的實體水平層板消失。請逐開口重看並明列每片固格或活格；若仍看不清，必須列為無法確認，不可直接少算。`);
  if (dividerGaps.length) errors.push(`${unique(dividerGaps).join("、")} 的中立板D扣數／完成深度基準、實際跨度或上下接點尚未完整；請一次確認，中立只做到實際分隔區，每片固定計4個固格器。`);
  if (dividerCountGaps.length) errors.push(`[中立數量對照] ${unique(dividerCountGaps).join("、")}；並排N列必須有N−1片完整中立，每片再計4個固格器，未知不能當0。`);
  if (baffleGaps.length) errors.push(`${unique(baffleGaps).join("、")} 的斜把擋板尚缺鎖附位置、高度或分段寬度；每個需要擋板的開口固定1支，有中立時依開口分段。`);
  if (baffleSegmentGaps.length) errors.push(`[擋板數量對照] ${unique(baffleSegmentGaps).join("、")}；每一支實體擋板都必須各有一筆尺寸，不能只用分段註記代替數量。`);
  if (doorCountGaps.length) errors.push(`[4E門片數量對照] ${unique(doorCountGaps).join("、")}；門面葉片內每個<或>固定代表1片門，只以清楚符號計數，未知不能填0。`);
  if (doorHandleGaps.length) errors.push(`門片與手把數量矛盾：${unique(doorHandleGaps).join("、")}；J把、斜把都必須逐片計且不得超過門片數。`);
  if (footGaps.length) errors.push(`[調整腳數量對照] ${unique(footGaps).join("、")}；目前未知不是0個。落地櫃基本4個，全高中立每片另加1個底部支撐腳；腳高≤120mm用A10、>120mm用A12。`);
  if (backStripGaps.length) errors.push(`[背條數量對照] ${unique(backStripGaps).join("、")}；目前未知不是0支。電視櫃、鏡櫃與特殊櫃請回答實際0／1／2…支，不套一般落地櫃級距。`);
  if (boardProfileGaps.length) errors.push(`板厚／扣數組合未通過：${unique(boardProfileGaps).join("、")}；標準為桶身18mm、背板8mm、抽底8mm及SOP固定扣數；非標板厚必須提供整組確認扣數。`);
  if (retreatGaps.length) errors.push(`${unique(retreatGaps).join("、")} 的斜把退縮數或斜固格數矛盾；只有實際形成斜把縫的頂板、底板或固格可退19mm，其餘固定0。`);

  return unique(errors);
}

export function validateCabinetStructure(structured: JsonRecord) {
  const inherited = inheritSharedDepths(structured);
  const cabinets = normalizeDeterministicInterior(inherited.cabinets);
  const panels = normalizeIndependentPanels(structured, cabinets);
  const hardQuestions: string[] = [];
  const warnings = Array.isArray(structured.warnings) ? structured.warnings.map(String) : [];
  const semanticErrors = findSemanticEvidenceErrors(structured);
  const segmentationErrors = findSegmentationLockErrors(structured);
  const interiorErrors = findInteriorCompletenessErrors({ ...structured, cabinets });

  if (!cabinets.length) hardQuestions.push("尚未辨識到任何獨立桶身；請確認圖片是否包含完整內部圖或立面圖。");

  const duplicateIds = cabinets.map(cabinetLabel).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) hardQuestions.push(`桶身編號重複：${unique(duplicateIds).join("、")}；需先重新編號才能核對尺寸鏈。`);

  const missingWidths = cabinets.filter((cabinet) => !positive(cabinet.widthMm)).map(cabinetLabel);
  const missingHeights = cabinets.filter((cabinet) => !positive(cabinet.heightMm)).map(cabinetLabel);
  const missingDepths = cabinets.filter((cabinet) => !positive(cabinet.depthMm));
  const oversized = cabinets.filter((cabinet) => Number(cabinet.widthMm) > 1000).map((cabinet) => `${cabinetLabel(cabinet)} ${rounded(cabinet.widthMm)}mm`);
  const hangingFeet = cabinets.filter((cabinet) => (cabinet.isHanging || cabinet.cabinetKind === "hanging") && (positive(cabinet.footHeightMm) || resolvedFootState(cabinet) === "present")).map(cabinetLabel);

  if (missingWidths.length) hardQuestions.push(`${missingWidths.join("、")} 缺少桶身寬度；請提供對應水平尺寸鏈。`);
  if (missingHeights.length) hardQuestions.push(`${missingHeights.join("、")} 缺少桶身外側總高；門面分段高度不能代替桶身高。`);
  if (missingDepths.length) {
    const groups = new Map<string, string[]>();
    for (const cabinet of missingDepths) {
      const group = String(cabinet.depthGroupId || cabinet.elevationId || "未分群");
      groups.set(group, [...(groups.get(group) || []), cabinetLabel(cabinet)]);
    }
    hardQuestions.push(`仍缺少 ${[...groups.values()].map((ids) => ids.join("、")).join("；")} 的深度；請只需按深度群組回答一次，例如「同一排全部D394」。`);
  }
  if (oversized.length) hardQuestions.push(`${oversized.join("、")} 超過單一桶身通常上限；必須依垂直側板線或尺寸鏈完成分桶。`);
  if (hangingFeet.length) hardQuestions.push(`${hangingFeet.join("、")} 同時被判為吊櫃與有調整腳，結構互相衝突。`);
  const directionWarnings = cabinets.flatMap((cabinet) => {
    const doors = (Array.isArray(cabinet.doors) ? cabinet.doors : []).filter(isRecord);
    return doors.some((door) => door.type === "4E" && doorCountEvidenceIsClosed(door) && door.direction === "unknown" && rounded(door.jHandleCount) === 0)
      ? [`${cabinetLabel(cabinet)} 的4E門片數已由清楚<／>閉合，但個別開向資料仍不完整；不把已鎖定門片歸零。`]
      : [];
  });
  warnings.unshift(...directionWarnings);
  if (segmentationErrors.length) warnings.unshift(`前置方向／分桶硬鎖未通過：${segmentationErrors.join("；")} 這是系統問題，不需要你回答。`);
  if (semanticErrors.length) warnings.unshift("AI 內部尺寸證據尚未完全綁定；這不是圖面問題，也不需要你回答，系統已阻止進入拆料。請直接重新掃描一次。");

  const groupConflicts = [...inherited.resolvedGroups.entries()].filter(([, value]) => value.conflict).map(([id]) => id);
  if (groupConflicts.length) hardQuestions.push(`深度群組 ${groupConflicts.join("、")} 出現互相矛盾的已確認深度，請指出正確值。`);

  const chainProblems: string[] = [];
  const cabinetById = new Map(cabinets.map((cabinet) => [cabinetLabel(cabinet), cabinet]));
  for (const chain of (Array.isArray(structured.dimensionChains) ? structured.dimensionChains : []).filter(isRecord)) {
    if (chain.axis !== "width" || !positive(chain.totalMm)) continue;
    const total = rounded(chain.totalMm);
    const segmentValues = (Array.isArray(chain.segmentsMm) ? chain.segmentsMm : []).map(rounded).filter((value: number) => value > 0);
    const segmentSum = segmentValues.reduce((sum: number, value: number) => sum + value, 0);
    const ids = Array.isArray(chain.cabinetIds) ? chain.cabinetIds.map(String) : [];
    const widthValues = ids.map((id: string) => rounded(cabinetById.get(id)?.widthMm)).filter((value: number) => value > 0);
    const widthSum = widthValues.length === ids.length ? widthValues.reduce((sum: number, value: number) => sum + value, 0) : 0;
    if ((segmentSum && Math.abs(segmentSum - total) > 2) || (widthSum && Math.abs(widthSum - total) > 2) || chain.status === "conflict") {
      chainProblems.push(`${chain.id || "未命名尺寸鏈"}（總${total}／分段${segmentSum || "未知"}／桶寬${widthSum || "未知"}）`);
    }
  }
  if (chainProblems.length) hardQuestions.push(`尺寸鏈尚未閉合：${chainProblems.join("；")}。請先確認總尺寸屬於哪一排或哪一個立面。`);

  const missingDoorSize = cabinets.flatMap((cabinet) => {
    const doors = (Array.isArray(cabinet.doors) ? cabinet.doors : []).filter(isRecord);
    const missing = doors.some((door) => door.type === "4E" && doorCountEvidenceIsClosed(door) && !((door.dimensionBasis === "opening" && positive(door.openingWidthMm) && positive(door.openingHeightMm)) || (door.dimensionBasis === "finished" && positive(door.finishedWidthMm) && positive(door.finishedHeightMm))));
    return missing ? [cabinetLabel(cabinet)] : [];
  });
  const doorIdentifierCabinets = cabinets.filter((cabinet) => {
    if (!missingDoorSize.includes(cabinetLabel(cabinet))) return false;
    const notes = Array.isArray(cabinet.drawingNotes) ? cabinet.drawingNotes.map(String) : [];
    const regions = (Array.isArray(cabinet.componentRegions) ? cabinet.componentRegions : []).filter(isRecord);
    return /門\s*[A-Za-z][A-Za-z0-9-]*/.test([...notes, ...regions.flatMap((region) => [String(region.region || ""), String(region.evidence || "")])].join(" "));
  }).map(cabinetLabel);
  const genericMissingDoorSize = missingDoorSize.filter((id) => !doorIdentifierCabinets.includes(id));
  if (doorIdentifierCabinets.length) hardQuestions.push(`[門板標記與完成尺寸] ${unique(doorIdentifierCabinets).join("、")} 的「門＋英文字母／代碼」屬於門型或門號，不是純數字名義門寬，請從門板圖或原料單補完成門寬×高；清楚的<／>片數與開向仍維持鎖定。`);
  if (genericMissingDoorSize.length) hardQuestions.push(`${unique(genericMissingDoorSize).join("、")} 的4E門尚未分清「開口尺寸」或「完成門面尺寸」，不能安全套用-3／-4。`);

  const missingPanelSize = panels.filter((panel) => !positive(panel.widthMm) || !positive(panel.heightMm)).map((panel) => String(panel.id || panel.name || "未命名封板"));
  const missingPanelCount = panels.filter((panel) => !positive(panel.count)).map((panel) => String(panel.id || panel.name || "未命名封板"));
  if (missingPanelSize.length) hardQuestions.push(`${missingPanelSize.join("、")} 是獨立板件但尺寸邊界未完整，請確認寬與高。`);
  if (missingPanelCount.length) hardQuestions.push(`${missingPanelCount.join("、")} 是獨立板件但片數尚未確認；未知不能當0，請提供實際數量。`);
  const elevationIds = new Set(cabinets.map((cabinet) => String(cabinet.elevationId || "")).filter(Boolean));
  if (elevationIds.size > 1) {
    const ungrouped = [
      ...panels.map((item) => ({ item, label: String(item.id || item.name || "獨立板件") })),
      ...(Array.isArray(structured.kickboards) ? structured.kickboards : []).filter(isRecord).map((item) => ({ item, label: String(item.id || "踢腳板") })),
      ...(Array.isArray(structured.mirrors) ? structured.mirrors : []).filter(isRecord).map((item) => ({ item, label: String(item.id || "明鏡") })),
      ...(Array.isArray(structured.specialHardware) ? structured.specialHardware : []).filter(isRecord).map((item) => ({ item, label: String(item.item || "特殊五金") })),
    ].filter(({ item }) => !elevationIds.has(String(item.elevationId || ""))).map(({ label }) => label);
    if (ungrouped.length) hardQuestions.push(`[立面歸屬] ${unique(ungrouped).join("、")} 未綁定有效立面；跨立面不得合併，請由原圖重新定位。`);
  }
  const cropEvidenceHints = (Array.isArray(structured.cropEvidenceHints) ? structured.cropEvidenceHints : []).filter(isRecord);
  const hasUnresolvedEdgePanel = cropEvidenceHints.some((hint) => /(?:填縫板|收口線|牆.{0,8}分離|分離.{0,8}牆)/.test(String(hint.region || "")));
  const hasNormalizedFiller = panels.some((panel) => /(?:填縫板|收口板|收邊板)/.test(String(panel.name || panel.id || "")) && positive(panel.widthMm) && positive(panel.heightMm) && positive(panel.count));
  if (hasUnresolvedEdgePanel && !hasNormalizedFiller) hardQuestions.push(`[獨立填縫板對照] 已偵測到與櫃身分離的牆／收口線，但相鄰桶身外高仍不明，無法安全建立標準100mm寬填縫板；請只補相鄰桶身外高。`);
  const hasKickboardRegion = cabinets.some((cabinet) => (Array.isArray(cabinet.componentRegions) ? cabinet.componentRegions : []).filter(isRecord).some((region) => region.classification === "kickboard" && rounded(region.quantity) > 0));
  const floorFootHeights = unique(cabinets.filter((cabinet) => cabinet.cabinetKind === "floor" && !cabinet.isHanging && resolvedFootState(cabinet) === "present" && positive(cabinet.footHeightMm)).map((cabinet) => String(rounded(cabinet.footHeightMm))));
  const cabinetWidthTotal = cabinets.reduce((sum, cabinet) => sum + Math.max(0, rounded(cabinet.widthMm)), 0);
  const kickboards = (Array.isArray(structured.kickboards) ? structured.kickboards : []).filter(isRecord);
  if ((hasKickboardRegion || floorFootHeights.length > 0) && kickboards.length === 0) hardQuestions.push(`[踢腳板總長對照] 已確認${floorFootHeights.length ? `${floorFootHeights.join("／")}mm` : "落地櫃"}腳座／離地區，但圖面未標現場踢腳板各段總長；不可直接把桶寬合計${cabinetWidthTotal || "未知"}mm當標準下料長，請依原料單補各段，後端再按120×2800＋補長換算。`);
  const incompleteSpecialHardware = (Array.isArray(structured.specialHardware) ? structured.specialHardware : []).filter(isRecord).filter((item) => String(item.item || "").trim() && (!positive(item.qty) || !String(item.unit || "").trim())).map((item) => String(item.item));
  if (incompleteSpecialHardware.length) hardQuestions.push(`特殊五金 ${unique(incompleteSpecialHardware).join("、")} 已在圖面辨識，但數量或單位尚未確認；不得靜默省略。`);
  hardQuestions.push(...interiorErrors);

  const originalQuestions = Array.isArray(structured.questions) ? structured.questions.map(String) : [];
  const hasUnresolvedShelf = cabinets.some((cabinet) => (Array.isArray(cabinet.componentRegions) ? cabinet.componentRegions : []).filter(isRecord).some(isUnresolvedShelfRegion));
  const filteredQuestions = originalQuestions.filter((question: string) => {
    if (isStaleDepthQuestion(question)) return false;
    if (isInternalEvidenceQuestion(question)) return false;
    if (isMaterialAnnotationQuestion(question)) return false;
    if (!hasUnresolvedShelf && isShelfAmbiguityQuestion(question)) return false;
    if (/超過.{0,8}1000|分桶/.test(question) && oversized.length) return false;
    if (/尺寸鏈.{0,8}(?:不符|矛盾|閉合)/.test(question) && chainProblems.length) return false;
    if (hasBlockingIssueClass(hardQuestions, question)) return false;
    if (BACKEND_VERIFIED_QUESTION_CLASSES.has(blockingIssueClass(question))) return false;
    return true;
  });

  const questions = mergeBlockingIssues([...hardQuestions, ...filteredQuestions]);
  if (inherited.inheritedCabinetIds.length) warnings.unshift(`${inherited.inheritedCabinetIds.join("、")} 已依同一深度群組的圖面證據自動帶入深度，不再逐桶詢問。`);

  return {
    ...structured,
    cabinets,
    independentPanels: panels,
    kickboards: Array.isArray(structured.kickboards) ? structured.kickboards : [],
    mirrors: Array.isArray(structured.mirrors) ? structured.mirrors : [],
    specialHardware: Array.isArray(structured.specialHardware) ? structured.specialHardware : [],
    dimensionChains: Array.isArray(structured.dimensionChains) ? structured.dimensionChains : [],
    elevations: Array.isArray(structured.elevations) ? structured.elevations : [],
    questions,
    warnings: unique(warnings).slice(0, 8),
    validationErrors: unique([...hardQuestions, ...segmentationErrors]),
    requiresSystemRetry: semanticErrors.length > 0 || segmentationErrors.length > 0,
    depthInheritance: inherited.inheritedCabinetIds,
  };
}
