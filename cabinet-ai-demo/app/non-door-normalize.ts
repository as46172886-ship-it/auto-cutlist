import { STANDARD_BOARD_PROFILE, type AnalysisForSop, type CabinetRead } from "./sop.ts";
import type { SegmentationPlan } from "./segmentation.ts";

type JsonRecord = Record<string, unknown>;
const DOOR_ONLY_HARDWARE = /GS鉸鍊|油壓器|J型?手把|斜手把|長斜把/i;
const DETERMINISTIC_HARDWARE = /^(?:A10|A12|KD|抽?木榫|白?固格器|黃固格器|活格利|活格粒|\d+滑軌|三節滑軌(?:\s+\d+)?|鏡珠)$/i;
const UNCONFIRMED_PANEL = /疑似|可能|待確認|不確定|未見.{0,16}(?:命名|標註|文字)|(?:僅|只).{0,12}(?:依|憑).{0,20}(?:線條|尺寸關係).{0,10}(?:判|推)/;

function rounded(value: unknown) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function normalizedBoardProfile(value: unknown) {
  const profile = asRecord(value);
  if (!profile || profile.deductionBasis === "standard_sop") return { ...STANDARD_BOARD_PROFILE };
  if (profile.deductionBasis === "user_confirmed" || profile.deductionBasis === "unknown") return { ...profile };
  return { ...STANDARD_BOARD_PROFILE };
}

const compareSegments = (left: SegmentationPlan["cabinets"][number], right: SegmentationPlan["cabinets"][number]) =>
  left.elevationId.localeCompare(right.elevationId, undefined, { numeric: true }) || left.widthOrder - right.widthOrder;

function records(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[];
}

function normalizeSpecialHardware(item: JsonRecord) {
  const name = String(item.item || "").trim();
  if (/^(?:35)?伸縮衣(?:架|桿)$/.test(name)) return { ...item, item: "35伸縮衣桿", unit: String(item.unit || "支") || "支" };
  return item;
}

function normalizeIndependentPanel(panel: JsonRecord) {
  const text = `${String(panel.name || "")} ${String(panel.note || "")} ${String(panel.evidence || "")}`;
  if (UNCONFIRMED_PANEL.test(text)) return null;
  const name = String(panel.name || "").trim();
  if (/填縫板|封邊板|收口板/.test(name)) return {
    ...panel,
    name: "填縫板",
    widthMm: rounded(panel.widthMm) || 100,
    heightMm: rounded(panel.heightMm),
    dimensionOrder: "width_height",
  };
  return panel;
}

function recoverFillersFromCropEvidence(raw: JsonRecord, cabinets: CabinetRead[], panels: JsonRecord[]) {
  const fillerPattern = /(?:填縫板|封邊板|收口板|收邊板)/;
  const elevations = new Set(cabinets.map((cabinet) => cabinet.elevationId));
  const multiElevation = elevations.size > 1;
  const orderedCabinets = [...cabinets].sort((a, b) =>
    a.elevationId.localeCompare(b.elevationId, undefined, { numeric: true }) || a.widthOrder - b.widthOrder);
  const cabinetById = new Map(cabinets.map((cabinet) => [cabinet.id, cabinet]));
  const edges = new Map<string, { cabinetId: string; elevationId: string; side: "left" | "right"; heightMm: number }>();

  for (const hint of records(raw.cropEvidenceHints)) {
    const evidence = String(hint.region || "");
    if (!/(?:填縫板|收口線|牆.{0,8}分離|分離.{0,8}牆)/.test(evidence)) continue;
    const side = /右外側|右側/.test(evidence) ? "right" : "left";
    const requestedId = String(hint.cabinetId || "");
    const adjacent = cabinetById.get(requestedId) || (!multiElevation ? (side === "left" ? orderedCabinets[0] : orderedCabinets.at(-1)) : undefined);
    if (!adjacent || rounded(adjacent.heightMm) <= 0) continue;
    edges.set(`${adjacent.id}:${side}`, { cabinetId: adjacent.id, elevationId: adjacent.elevationId, side, heightMm: rounded(adjacent.heightMm) });
  }

  if (!edges.size) return panels;
  const edgeList = [...edges.values()];
  const existingFillers = panels.filter((panel) => fillerPattern.test(String(panel.name || panel.id || "")));
  if (existingFillers.length) {
    return panels.map((panel) => {
      if (!fillerPattern.test(String(panel.name || panel.id || ""))) return panel;
      const panelElevation = String(panel.elevationId || "");
      const eligibleEdges = multiElevation ? edgeList.filter((edge) => edge.elevationId === panelElevation) : edgeList;
      const matchingEdges = eligibleEdges.filter((edge) => !rounded(panel.heightMm) || edge.heightMm === rounded(panel.heightMm));
      return {
        ...panel,
        name: "填縫板",
        count: rounded(panel.count) || matchingEdges.length || eligibleEdges.length,
        widthMm: rounded(panel.widthMm) || 100,
        heightMm: rounded(panel.heightMm) || (matchingEdges[0]?.heightMm || eligibleEdges[0]?.heightMm || 0),
        thicknessMm: rounded(panel.thicknessMm) || 18,
        grainDirection: panel.grainDirection || "vertical",
        dimensionOrder: "width_height",
        note: `${String(panel.note || "")}；標準填縫寬100mm；高度取相鄰桶身外高；現場修邊`.replace(/^；/, ""),
        evidence: `${String(panel.evidence || "")}；[R34] 瀏覽器直線偵測確認櫃身與牆／收口線分離`.replace(/^；/, ""),
      };
    });
  }

  const byElevationAndHeight = new Map<string, typeof edgeList>();
  for (const edge of edgeList) {
    const key = `${edge.elevationId}|${edge.heightMm}`;
    byElevationAndHeight.set(key, [...(byElevationAndHeight.get(key) || []), edge]);
  }
  for (const matchingEdges of byElevationAndHeight.values()) {
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
      evidence: `[R34] ${matchingEdges.map((edge) => `${edge.cabinetId}${edge.side === "left" ? "左" : "右"}側`).join("、")}直線偵測到與櫃身分離的牆／收口線`,
    });
  }
  return panels;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function fullHeightDividerEvidence(divider: CabinetRead["middleDividers"][number]) {
  const text = `${divider.region || ""} ${divider.evidence || ""}`;
  return (divider.topConnection === "top_board" && divider.bottomConnection === "bottom_board")
    || /全高|通高|頂板.{0,12}(?:到底板|至底板|接底板)|上接頂板.{0,20}下接底板|由頂.{0,12}到底/.test(text);
}

function repairFullHeightMiddleDividers(cabinet: CabinetRead) {
  const heightMm = rounded(cabinet.heightMm);
  cabinet.middleDividers = (cabinet.middleDividers || []).map((divider) => {
    if (!fullHeightDividerEvidence(divider) || heightMm <= 36) return divider;
    if (divider.heightBasis === "finished" && rounded(divider.heightMm) > 0
      && divider.depthBasis === "finished" && rounded(divider.depthMm) > 0) return divider;
    return {
      ...divider,
      referenceSpanMm: heightMm,
      depthBasis: divider.depthBasis === "finished" && rounded(divider.depthMm) > 0 ? "finished" : "standard_d_minus_29",
      heightBasis: "connection_span",
      topConnection: "top_board",
      bottomConnection: "bottom_board",
      evidence: `${divider.evidence || divider.region || "連續中立線"}；全高中立閉合為桶身H，上接頂板、下接底板`,
    };
  });
}

function hasStrongHangingEvidence(cabinet: CabinetRead) {
  const text = `${cabinet.evidence || ""} ${(cabinet.drawingNotes || []).join(" ")}`;
  const uncertain = /是否|疑似|可能|待確認|無法確認|未見.{0,12}(?:吊櫃|懸空)|沒有.{0,12}(?:吊櫃|懸空)/.test(text);
  return !uncertain && /圖面.{0,8}(?:明確|標註).{0,8}(?:吊櫃|懸空)|獨立懸空|壁掛|掛牆/.test(text);
}

function propagateMajorityFootConsensus(cabinets: CabinetRead[]) {
  const byElevation = new Map<string, CabinetRead[]>();
  for (const cabinet of cabinets) byElevation.set(cabinet.elevationId, [...(byElevation.get(cabinet.elevationId) || []), cabinet]);
  for (const group of byElevation.values()) {
    const present = group.filter((cabinet) => cabinet.footState === "present" && rounded(cabinet.footHeightMm) > 0);
    if (present.length < 2 || present.length <= group.length / 2) continue;
    const heights = new Map<number, number>();
    for (const cabinet of present) heights.set(rounded(cabinet.footHeightMm), (heights.get(rounded(cabinet.footHeightMm)) || 0) + 1);
    // A single elevation can legitimately contain different floor offsets.
    // Never let a statistical majority overwrite an explicitly read A10/A12
    // height or fill an unknown cabinet while the baseline is conflicted.
    if (heights.size !== 1) continue;
    const [sharedHeight, supportCount] = [...heights.entries()].sort((a, b) => b[1] - a[1])[0] || [0, 0];
    if (!sharedHeight || supportCount < 2) continue;
    const commonCarcassHeight = new Set(group.map((cabinet) => rounded(cabinet.heightMm))).size === 1;
    if (!commonCarcassHeight) continue;
    for (const cabinet of group) {
      if (hasStrongHangingEvidence(cabinet)) continue;
      cabinet.isHanging = false;
      cabinet.cabinetKind = "floor";
      cabinet.footState = "present";
      cabinet.footHeightMm = sharedHeight;
    }
  }
}

export function normalizeNonDoorAnalysis(raw: JsonRecord, segmentation: SegmentationPlan): AnalysisForSop & JsonRecord {
  const reads = (Array.isArray(raw.cabinets) ? raw.cabinets : []).map(asRecord).filter(Boolean) as JsonRecord[];
  if (reads.length !== segmentation.cabinets.length) throw new Error(`AI回傳${reads.length}桶，但前置分桶已鎖定${segmentation.cabinets.length}桶；本次不產生料單。`);
  const elevationCount = new Set(segmentation.cabinets.map((segment) => segment.elevationId)).size;
  const specialHardware = records(raw.specialHardware)
    .filter((item) => {
      const name = String(item.item || "").trim();
      return !DOOR_ONLY_HARDWARE.test(name) && !DETERMINISTIC_HARDWARE.test(name);
    })
    .map(normalizeSpecialHardware);
  const soleElevation = elevationCount === 1 ? segmentation.cabinets[0]?.elevationId || "" : "";
  const wardrobeRodElevations = new Set(specialHardware.flatMap((item) => {
    const present = /伸縮衣桿/.test(String(item.item || "")) && rounded(item.qty) > 0;
    const elevationId = String(item.elevationId || soleElevation);
    return present && elevationId ? [elevationId] : [];
  }));
  const sortedSegments = segmentation.cabinets.slice().sort(compareSegments);
  const readForSegment = (items: JsonRecord[], segment: SegmentationPlan["cabinets"][number], legacyIndex: number) => {
    const exact = items.find((item) => String(item.id || "") === segment.cabinetId);
    if (exact) return exact;
    if (elevationCount === 1) return items[legacyIndex];
    return items.find((item) => String(item.elevationId || "") === segment.elevationId
      && rounded(item.widthOrder) === segment.widthOrder);
  };
  const observedFootHeightsByElevation = new Map<string, Set<number>>();
  for (const [index, segment] of sortedSegments.entries()) {
    const source = readForSegment(reads, segment, index);
    if (source?.footState === "present" && rounded(source.footHeightMm) > 0) {
      const heights = observedFootHeightsByElevation.get(segment.elevationId) || new Set<number>();
      heights.add(rounded(source.footHeightMm));
      observedFootHeightsByElevation.set(segment.elevationId, heights);
    }
  }
  const sharedFootHeightByElevation = new Map([...observedFootHeightsByElevation.entries()]
    .filter(([, heights]) => heights.size === 1)
    .map(([elevationId, heights]) => [elevationId, [...heights][0]]));
  const unused = [...reads];
  const cabinets = sortedSegments.map((segment, index) => {
    let matchIndex = unused.findIndex((item) => String(item.id || "") === segment.cabinetId);
    if (matchIndex < 0 && elevationCount > 1) matchIndex = unused.findIndex((item) =>
      String(item.elevationId || "") === segment.elevationId && rounded(item.widthOrder) === segment.widthOrder);
    if (matchIndex < 0 && elevationCount > 1) throw new Error(`${segment.cabinetId}缺少同立面、同順序的逐桶辨識結果；本次不產生料單。`);
    const source = unused.splice(matchIndex >= 0 ? matchIndex : 0, 1)[0] || reads[index];
    const cabinet = {
      ...source, id: segment.cabinetId, name: String(source.name || segment.label || segment.cabinetId), elevationId: segment.elevationId,
      widthChainId: `LOCK-${segment.elevationId}`, widthOrder: segment.widthOrder, widthMm: Math.round(segment.bottomSegmentMm),
      boardProfile: normalizedBoardProfile(source.boardProfile), doors: [],
      topBoardRetreatMm: 0, bottomBoardRetreatMm: 0, slantedFixedShelfCount: 0, baffles: [],
    } as unknown as CabinetRead;
    repairFullHeightMiddleDividers(cabinet);
    let groups = Array.isArray(cabinet.drawerGroups) ? cabinet.drawerGroups : [];
    const declaredDrawerCount = rounded(cabinet.drawerCount);
    const groupedDrawerCount = groups.reduce((sum, group) => sum + rounded(group.count), 0);
    if (declaredDrawerCount !== groupedDrawerCount) {
      throw new Error(`${segment.cabinetId}抽屜總數${declaredDrawerCount}與逐組合計${groupedDrawerCount}不一致；本次不產生料單。`);
    }
    const declaredInnerDrawerCount = rounded(cabinet.innerDrawerCount);
    const groupedInnerDrawerCount = groups
      .filter((group) => Boolean(group.isInner))
      .reduce((sum, group) => sum + rounded(group.count), 0);
    if (declaredInnerDrawerCount !== groupedInnerDrawerCount) {
      throw new Error(`${segment.cabinetId}內抽總數${declaredInnerDrawerCount}與逐組合計${groupedInnerDrawerCount}不一致；本次不產生料單。`);
    }
    const drawerTotal = declaredDrawerCount;
    if (groups.length && drawerTotal > 0) {
      groups = groups.map((group) => {
        const count = rounded(group.count);
        const hasOwnCenterline = count > 1 && rounded(group.centerlineBoundaryCount) > 0;
        const onlyGroupCabinetLock = groups.length === 1 && count > 1 && Boolean(cabinet.sideBySideDrawers);
        const groupSideBySide = Boolean(group.sideBySide) || hasOwnCenterline || onlyGroupCabinetLock;
        return {
          ...group,
          sideBySide: groupSideBySide,
          openingWidthMm: rounded(group.openingWidthMm) > 0
            ? rounded(group.openingWidthMm)
            : Math.round(rounded(cabinet.widthMm) / (groupSideBySide ? count : 1)),
          centerlineBoundaryCount: groupSideBySide ? Math.max(1, rounded(group.centerlineBoundaryCount)) : rounded(group.centerlineBoundaryCount),
          usesCenterlineWidth: groupSideBySide || Boolean(group.usesCenterlineWidth),
          slantedHandle: false,
        };
      });
      cabinet.drawerGroups = groups;
    }
    const sideBySide = Boolean(cabinet.sideBySideDrawers) || groups.some((group) => Boolean(group.sideBySide) || (rounded(group.count) > 1 && rounded(group.centerlineBoundaryCount) > 0));
    if (sideBySide && rounded(cabinet.fixedShelves) === 0) cabinet.fixedShelves = 1;

    if (sideBySide) {
      const sideBySideGroups = groups.filter((group) => Boolean(group.sideBySide)
        || (rounded(group.count) > 1 && rounded(group.centerlineBoundaryCount) > 0));
      const existingDividers = cabinet.middleDividers || [];
      const preservedFullHeight = existingDividers.filter(fullHeightDividerEvidence);
      const regionalCandidates = existingDividers.filter((divider) => !fullHeightDividerEvidence(divider));
      const completed = [...preservedFullHeight];
      let fullHeightCredits = preservedFullHeight.length;

      for (const group of sideBySideGroups) {
        const required = Math.max(0, rounded(group.count) - 1);
        const span = rounded(group.openingHeightMm);
        if (required === 0 || span <= 36) continue;
        const coveredByFullHeight = Math.min(required, fullHeightCredits);
        fullHeightCredits -= coveredByFullHeight;
        let missing = required - coveredByFullHeight;

        for (let index = regionalCandidates.length - 1; index >= 0 && missing > 0; index -= 1) {
          const divider = regionalCandidates[index];
          const completeForSpan = rounded(divider.referenceSpanMm) === span
            && divider.heightBasis === "connection_span"
            && divider.depthBasis !== "unknown"
            && divider.topConnection !== "unknown"
            && divider.bottomConnection !== "unknown";
          if (!completeForSpan) continue;
          completed.push(divider);
          regionalCandidates.splice(index, 1);
          missing -= 1;
        }

        for (let index = 0; index < missing; index += 1) completed.push({
          depthMm: 0, heightMm: 0, referenceSpanMm: span, depthBasis: "standard_d_minus_29", heightBasis: "connection_span",
          region: `${group.id || "並排抽屜區"}中立${required - missing + index + 1}`,
          topConnection: "top_board", bottomConnection: "fixed_shelf_centerline",
          evidence: `並排${rounded(group.count)}列需${required}片中立；中心線已確認；依標準連接跨度完成短中立板`,
        });
      }
      cabinet.middleDividers = completed;
    }

    const hasWardrobeRod = wardrobeRodElevations.has(segment.elevationId);
    const tallTwoZone = rounded(cabinet.heightMm) >= 1800 && hasWardrobeRod;
    if (tallTwoZone && hasWardrobeRod) cabinet.adjustableShelves = Math.max(2, rounded(cabinet.adjustableShelves));
    if (tallTwoZone && rounded(cabinet.fixedShelves) === 0) cabinet.fixedShelves = 1;
    const sharedFootHeight = sharedFootHeightByElevation.get(segment.elevationId) || 0;
    if (!cabinet.isHanging && cabinet.cabinetKind === "floor" && sharedFootHeight > 0 && (cabinet.footState !== "present" || rounded(cabinet.footHeightMm) === 0)) {
      cabinet.footState = "present";
      cabinet.footHeightMm = sharedFootHeight;
    }
    return cabinet;
  });
  propagateMajorityFootConsensus(cabinets);
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).filter((question) => {
    const text = String(question);
    // Only retire a width-only question for one explicitly identified cabinet
    // after every drawer group has a usable width. Preserve questions about
    // unequal divisions, layout, height, depth and other missing evidence.
    if (!/openingWidthMm|抽屜格寬|抽屜開口寬/.test(text)
      || /不等|等分|左右|並排|中立|高度|屜頭高|深度|斜把/.test(text)) return true;
    const mentioned = cabinets.filter((cabinet) => text.startsWith(`${cabinet.id}：`)
      || text.startsWith(`${cabinet.id} `));
    if (mentioned.length !== 1) return true;
    const groups = mentioned[0].drawerGroups || [];
    return !groups.length || groups.some((group) => rounded(group.openingWidthMm) <= 0);
  });
  const independentPanels = records(raw.independentPanels)
    .map(normalizeIndependentPanel)
    .filter(Boolean) as JsonRecord[];
  return {
    ...raw, cabinets, questions,
    independentPanels: recoverFillersFromCropEvidence(raw, cabinets, independentPanels) as AnalysisForSop["independentPanels"],
    kickboards: Array.isArray(raw.kickboards) ? raw.kickboards as AnalysisForSop["kickboards"] : [],
    mirrors: Array.isArray(raw.mirrors) ? raw.mirrors as AnalysisForSop["mirrors"] : [],
    specialHardware: specialHardware as AnalysisForSop["specialHardware"],
  };
}
