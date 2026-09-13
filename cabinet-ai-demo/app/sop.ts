import { drawerDowelsPerDrawerForDepth, QUANTITY } from "./quantity-rules.ts";
import { doorCountEvidenceIsClosed, doorIsReadyForHardware } from "./door-recognition.ts";
import { hingesPerDoorForFinishedHeight } from "./hinge-rules.ts";
import { drawerWallHeightForFrontHeight, drawerWallHeightFormulaText } from "./drawer-rules.ts";
import { slantedHandleConsistencyNote, type SlantedHandleMarkerEvidence } from "./slanted-handle-audit.ts";

export type DoorRead = {
  type: "4E" | "aluminum" | "none";
  count: number;
  countBasis: "symbols" | "leaf_geometry" | "explicit_note" | "user_confirmed" | "unknown";
  doorSymbols: Array<"<" | ">">;
  openingWidthMm: number;
  openingHeightMm: number;
  finishedWidthMm: number;
  finishedHeightMm: number;
  dimensionBasis: "opening" | "finished" | "unknown";
  direction: "left" | "right" | "mixed" | "unknown";
  jHandleCount: number;
  slantedHandle: boolean;
  slantedHandleCount: number;
  slantedHandleStyle?: "top" | "bottom" | "long" | "none" | "unknown";
  includesBottom30: boolean;
  includesSlantedGap24: boolean;
  slantedGap24Context: "none" | "door_chain_included" | "already_separate" | "stacked_lift" | "unknown";
  hingeCountPerDoor: number;
  evidence: string;
};

export type MiddleDividerRead = {
  depthMm: number;
  heightMm: number;
  referenceSpanMm: number;
  depthBasis: "standard_d_minus_29" | "finished" | "unknown";
  heightBasis: "connection_span" | "finished" | "unknown";
  region: string;
  topConnection: "top_board" | "bottom_board" | "fixed_shelf_full" | "fixed_shelf_centerline" | "unknown";
  bottomConnection: "top_board" | "bottom_board" | "fixed_shelf_full" | "fixed_shelf_centerline" | "unknown";
  evidence: string;
};

export type BaffleRead = {
  id: string;
  heightMm: number;
  widthMm: number;
  kind: "drawer_60" | "door_50" | "other";
  mountBasis?: "top_board" | "fixed_shelf" | "raised_bottom" | "other" | "unknown";
  widthBasis: "cabinet_inner" | "finished_segment" | "unknown";
  splitAtMiddleDivider: boolean;
  segmentGroupId: string;
  segmentIndex: number;
  segmentCount: number;
  evidence: string;
};

export type BoardProfileRead = {
  bodyThicknessMm: number;
  backThicknessMm: number;
  drawerBottomThicknessMm: number;
  deductionBasis: "standard_sop" | "user_confirmed" | "unknown";
  topBottomWidthDeductionMm: number;
  backWidthDeductionMm: number;
  backHeightDeductionMm: number;
  fixedShelfDepthDeductionMm: number;
  fixedShelfWidthDeductionMm: number;
  adjustableShelfDepthDeductionMm: number;
  adjustableShelfWidthDeductionMm: number;
};

export type DrawerGroupRead = {
  id: string;
  count: number;
  openingWidthMm: number;
  openingHeightMm: number;
  drawerWallHeightMm: number;
  isInner: boolean;
  sideBySide: boolean;
  usesCenterlineWidth: boolean;
  centerlineBoundaryCount: number;
  slantedHandle: boolean;
  fixedShelfPositionMm: number;
  regionPosition?: "top" | "middle" | "bottom" | "unknown";
  evidence: string;
};

export type CabinetRead = {
  id: string;
  name: string;
  cabinetKind: "floor" | "hanging" | "stacked" | "tv" | "mirror" | "special";
  elevationId: string;
  widthChainId: string;
  widthOrder: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  depthGroupId: string;
  depthSource: "explicit" | "shared_group" | "user_confirmed" | "unknown";
  depthEvidence: string;
  isHanging: boolean;
  underCountertop: boolean;
  fixedShelves: number;
  fixedShelfPositionsMm: number[];
  adjustableShelves: number;
  slantedFixedShelfCount: number;
  drawerCount: number;
  sideBySideDrawers: boolean;
  innerDrawerCount: number;
  footHeightMm: number;
  footState: "present" | "absent" | "unknown";
  topBoardRetreatMm: number;
  bottomBoardRetreatMm: number;
  specialBackStripCount: number;
  specialBackStripState: "not_applicable" | "confirmed" | "unknown";
  boardProfile: BoardProfileRead;
  middleDividers: MiddleDividerRead[];
  baffles: BaffleRead[];
  drawerGroups: DrawerGroupRead[];
  doors: DoorRead[];
  componentRegions?: Array<{ region: string; classification: string; sopRuleIds: string[]; quantity: number; widthMm: number; heightMm: number; depthMm: number; confidence: "high" | "medium" | "low"; evidence: string }>;
  doorLock?: { locked: boolean; status: "confirmed_4e" | "confirmed_no_4e" | "omitted"; attemptsUsed: number; evidence: string };
  drawingNotes: string[];
  confidence: "high" | "medium" | "low";
  evidence: string;
};

export type IndependentPanelRead = {
  id: string;
  elevationId?: string;
  name: string;
  count: number;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  grainDirection: "vertical" | "horizontal" | "none" | "unknown";
  dimensionOrder: "width_height" | "height_width";
  note: string;
  evidence: string;
};

export type AnalysisForSop = {
  cabinets: CabinetRead[];
  independentPanels?: IndependentPanelRead[];
  kickboards?: Array<{ id: string; elevationId?: string; siteLengthMm: number; evidence: string }>;
  mirrors?: Array<{ id: string; elevationId?: string; count: number; widthMm?: number; heightMm?: number; evidence: string }>;
  specialHardware?: Array<{ elevationId?: string; item: string; qty: number; unit: string; evidence: string }>;
  slantedHandleMarkerEvidence?: SlantedHandleMarkerEvidence;
};

export type CutRow = { item: string; spec: string; qty: number; note: string; thicknessMm?: number; groupId?: string };
export type HardwareRow = { item: string; qty: number; unit: string; note: string; groupId?: string };

const n = (value: number) => Math.max(0, Math.round(Number(value) || 0));
const spec = (first: number, second: number) => `${n(first)} × ${n(second)}`;

export const STANDARD_BOARD_PROFILE: BoardProfileRead = Object.freeze({
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
});

export function resolveBoardProfile(cabinet: Partial<CabinetRead>): BoardProfileRead {
  const profile = cabinet.boardProfile;
  if (!profile) return { ...STANDARD_BOARD_PROFILE };
  return {
    bodyThicknessMm: n(profile.bodyThicknessMm),
    backThicknessMm: n(profile.backThicknessMm),
    drawerBottomThicknessMm: n(profile.drawerBottomThicknessMm),
    deductionBasis: profile.deductionBasis,
    topBottomWidthDeductionMm: n(profile.topBottomWidthDeductionMm),
    backWidthDeductionMm: n(profile.backWidthDeductionMm),
    backHeightDeductionMm: n(profile.backHeightDeductionMm),
    fixedShelfDepthDeductionMm: n(profile.fixedShelfDepthDeductionMm),
    fixedShelfWidthDeductionMm: n(profile.fixedShelfWidthDeductionMm),
    adjustableShelfDepthDeductionMm: n(profile.adjustableShelfDepthDeductionMm),
    adjustableShelfWidthDeductionMm: n(profile.adjustableShelfWidthDeductionMm),
  };
}

export function boardProfileIsComplete(profile: BoardProfileRead) {
  return profile.deductionBasis !== "unknown"
    && profile.bodyThicknessMm > 0
    && profile.backThicknessMm > 0
    && profile.drawerBottomThicknessMm > 0
    && profile.topBottomWidthDeductionMm > 0
    && profile.backWidthDeductionMm > 0
    && profile.backHeightDeductionMm > 0
    && profile.fixedShelfDepthDeductionMm > 0
    && profile.fixedShelfWidthDeductionMm > 0
    && profile.adjustableShelfDepthDeductionMm > 0
    && profile.adjustableShelfWidthDeductionMm > 0;
}

function mergeNote(current: string, next: string) {
  if (!current) return next;
  if (!next || current === next) return current;
  return `${current}；${next}`;
}

function mergeCuts(rows: CutRow[]) {
  const map = new Map<string, CutRow>();
  for (const row of rows.filter((item) => item.qty > 0)) {
    const key = `${row.groupId || ""}|${row.item}|${row.spec}|${row.thicknessMm || ""}`;
    const old = map.get(key);
    if (old) {
      old.qty += row.qty;
      old.note = mergeNote(old.note, row.note);
    }
    else map.set(key, { ...row });
  }
  return [...map.values()].sort((a, b) =>
    a.item.localeCompare(b.item, "zh-Hant") ||
    Number(b.spec.split("×")[0]) - Number(a.spec.split("×")[0]) ||
    Number(b.spec.split("×")[1]) - Number(a.spec.split("×")[1]),
  );
}

function mergeHardware(rows: HardwareRow[]) {
  const map = new Map<string, HardwareRow>();
  for (const row of rows.filter((item) => item.qty > 0)) {
    const key = `${row.groupId || ""}|${row.item}|${row.unit}`;
    const old = map.get(key);
    if (old) {
      old.qty += row.qty;
      old.note = mergeNote(old.note, row.note);
    }
    else map.set(key, { ...row });
  }
  return [...map.values()].sort((a, b) => a.item.localeCompare(b.item, "zh-Hant"));
}

function slideDepth(depthMm: number, depthDeductionMm = STANDARD_BOARD_PROFILE.fixedShelfDepthDeductionMm) {
  const available = Math.min(500, n(depthMm) - n(depthDeductionMm));
  if (available < 300) return 0;
  return Math.min(500, Math.floor(available / 50) * 50);
}

export type BackStripResolution = {
  count: number | null;
  basis: "height_tier" | "hanging_minimum" | "special_confirmed" | "special_unknown";
  explanation: string;
};

export function resolveBackStripQuantity(cabinet: CabinetRead): BackStripResolution {
  if (cabinet.specialBackStripState === "confirmed") {
    const count = n(cabinet.specialBackStripCount);
    return { count, basis: "special_confirmed", explanation: `特殊櫃圖面／人工已確認 ${count} 支` };
  }
  if (!cabinet.specialBackStripState && cabinet.specialBackStripCount > 0) {
    const count = n(cabinet.specialBackStripCount);
    return { count, basis: "special_confirmed", explanation: `舊資料保留已確認 ${count} 支` };
  }
  if (cabinet.isHanging || cabinet.cabinetKind === "hanging" || cabinet.cabinetKind === "stacked") {
    return { count: 1, basis: "hanging_minimum", explanation: "吊櫃／疊櫃每桶至少 1 支" };
  }
  if (["tv", "mirror", "special"].includes(cabinet.cabinetKind)) {
    return { count: null, basis: "special_unknown", explanation: "特殊櫃依圖面；目前未知，不能當 0 支" };
  }
  const H = n(cabinet.heightMm);
  const count = H <= 1200 ? 0 : H <= 1800 ? 1 : 2;
  return { count, basis: "height_tier", explanation: `一般落地櫃 H${H}mm：${H <= 1200 ? "H≤1200" : H <= 1800 ? "1200<H≤1800" : "H>1800"}，應為 ${count} 支` };
}

export function resolvedFootState(cabinet: CabinetRead) {
  if (cabinet.footState) return cabinet.footState;
  if (cabinet.isHanging || cabinet.cabinetKind === "hanging") return "absent";
  return cabinet.footHeightMm > 0 ? "present" : "unknown";
}

export function fullHeightMiddleDividerCount(cabinet: CabinetRead) {
  return (cabinet.middleDividers || []).filter((divider) =>
    divider.heightBasis === "connection_span"
    && divider.topConnection === "top_board"
    && divider.bottomConnection === "bottom_board"
    && divider.referenceSpanMm > 36,
  ).length;
}

export function calculateAdjustableShelfWidth(cabinet: CabinetRead) {
  const profile = resolveBoardProfile(cabinet);
  const W = n(cabinet.widthMm);
  const innerWidth = W - profile.topBottomWidthDeductionMm;
  const dividerCount = fullHeightMiddleDividerCount(cabinet);
  if (!dividerCount) return {
    widthMm: W - profile.adjustableShelfWidthDeductionMm,
    openingCount: 1,
    dividerCount: 0,
    formula: `W-${profile.adjustableShelfWidthDeductionMm}=${W - profile.adjustableShelfWidthDeductionMm}`,
  };
  const openingCount = dividerCount + 1;
  const widthMm = Math.floor((innerWidth - dividerCount * profile.bodyThicknessMm) / openingCount) - 1;
  return {
    widthMm, openingCount, dividerCount,
    formula: `(內寬${innerWidth}-全高中立${dividerCount}×${profile.bodyThicknessMm})÷${openingCount}-1=${widthMm}`,
  };
}

function deductSlantedGap24(door: DoorRead) {
  if (door.slantedGap24Context) return door.slantedGap24Context === "door_chain_included";
  return Boolean(door.includesSlantedGap24);
}

export function resolveDoorFinishedHeight(door: DoorRead) {
  if (door.dimensionBasis === "finished") return n(door.finishedHeightMm);
  if (door.dimensionBasis !== "opening") return 0;
  return n(door.openingHeightMm - (door.includesBottom30 ? 30 : 0) - (deductSlantedGap24(door) ? 24 : 0) - 4);
}

export function resolveBaffleHeight(baffle: BaffleRead) {
  if (baffle.mountBasis === "fixed_shelf" || baffle.mountBasis === "raised_bottom") return 60;
  if (baffle.mountBasis === "top_board" && baffle.kind === "door_50") return 50;
  if (baffle.kind === "drawer_60") return 60;
  if (baffle.kind === "door_50") return 50;
  return n(baffle.heightMm);
}

function cabinetDoorNote(door: DoorRead) {
  const leftCount = (door.doorSymbols || []).filter((symbol) => symbol === "<").length;
  const rightCount = (door.doorSymbols || []).filter((symbol) => symbol === ">").length;
  const symbolsClosed = leftCount + rightCount === n(door.count);
  const direction = symbolsClosed && leftCount === n(door.count)
    ? "左開"
    : symbolsClosed && rightCount === n(door.count)
      ? "右開"
      : symbolsClosed && leftCount > 0 && rightCount > 0
        ? n(door.count) >= 3 ? `${leftCount}左、${rightCount}右` : "左右開"
        : door.direction === "right" ? "右開" : door.direction === "left" ? "左開" : door.direction === "mixed" ? "左右開" : "開向待核";
  const slantedCount = door.slantedHandleCount > 0 ? n(door.slantedHandleCount) : door.slantedHandle ? n(door.count) : 0;
  const slantedLabel = door.slantedHandleStyle === "top" ? "上斜把"
    : door.slantedHandleStyle === "bottom" ? "下斜把"
      : door.slantedHandleStyle === "long" ? "長斜把" : "斜把樣式待核";
  const includeDirection = door.count >= 3 || Boolean(door.jHandleCount) || !slantedCount;
  return `${includeDirection ? direction : ""}${includeDirection && door.jHandleCount ? "／" : ""}${door.jHandleCount ? `J把×${n(door.jHandleCount)}` : ""}${(includeDirection || door.jHandleCount) && slantedCount ? "／" : ""}${slantedCount ? `${slantedLabel}×${slantedCount}（加工備註；完整模式另列斜手把五金）` : ""}${door.dimensionBasis === "finished" ? "／完成門面尺寸未再扣4" : ""}`;
}

function doorFinishedSpec(door: DoorRead) {
  if (door.dimensionBasis === "finished") return spec(door.finishedWidthMm, door.finishedHeightMm);
  if (door.dimensionBasis !== "opening") return "";
  const widthMm = n(door.openingWidthMm / n(door.count) - 3);
  const heightMm = resolveDoorFinishedHeight(door);
  return widthMm > 0 && heightMm > 0 ? spec(widthMm, heightMm) : "";
}

function mixedDoorDirectionsBySpec(cabinets: CabinetRead[]) {
  const totals = new Map<string, { left: number; right: number }>();
  for (const cabinet of cabinets) {
    const fourEDoors = (cabinet.doors || []).filter((door) => door.type === "4E");
    if (!fourEDoors.length || !fourEDoors.every(doorCountEvidenceIsClosed)) continue;
    for (const door of fourEDoors) {
      if (!doorIsReadyForHardware(door)) continue;
      const finishedSpec = doorFinishedSpec(door);
      const symbols = door.doorSymbols || [];
      if (!finishedSpec || symbols.length !== n(door.count)) continue;
      const key = `${cabinet.elevationId || "GLOBAL"}|${finishedSpec}`;
      const old = totals.get(key) || { left: 0, right: 0 };
      old.left += symbols.filter((symbol) => symbol === "<").length;
      old.right += symbols.filter((symbol) => symbol === ">").length;
      totals.set(key, old);
    }
  }
  return totals;
}

function rewriteMergedDoorHardwareNotes(cabinets: CabinetRead[], hardware: HardwareRow[]) {
  const groupIds = [...new Set(cabinets.map((cabinet) => cabinet.elevationId || "GLOBAL"))];
  for (const groupId of groupIds) {
    const hingeGroups = new Map<number, number>();
    let ordinaryDoors = 0;
    let jHandles = 0;
    for (const cabinet of cabinets.filter((item) => (item.elevationId || "GLOBAL") === groupId)) {
      const fourEDoors = (cabinet.doors || []).filter((door) => door.type === "4E");
      if (!fourEDoors.length || !fourEDoors.every(doorCountEvidenceIsClosed)) continue;
      for (const door of fourEDoors) {
        if (!doorIsReadyForHardware(door)) continue;
        const count = n(door.count);
        const height = resolveDoorFinishedHeight(door);
        if (!count || !height) continue;
        ordinaryDoors += count;
        hingeGroups.set(height, (hingeGroups.get(height) || 0) + count);
        const jHandleCount = n(door.jHandleCount);
        if (jHandleCount > 0 && jHandleCount <= count) jHandles += jHandleCount;
      }
    }
    const hinges = hardware.find((row) => row.groupId === groupId && row.item === "GS鉸鍊");
    if (hinges && hingeGroups.size) {
      const groups = [...hingeGroups.entries()].sort(([left], [right]) => left - right).map(([height, doors]) => {
        const perDoor = hingesPerDoorForFinishedHeight(height);
        return `門高${height}mm：${doors}片×每片${perDoor}個=${doors * perDoor}`;
      });
      hinges.note = `[R61] ${groups.join("；")}；合計${hinges.qty}個`;
    }
    const dampers = hardware.find((row) => row.groupId === groupId && row.item === "油壓器");
    if (dampers && ordinaryDoors) dampers.note = `[R61] 普通4E門${ordinaryDoors}片×每片${QUANTITY.DAMPERS_PER_STANDARD_DOOR}個=${dampers.qty}`;
    const jHandleRow = hardware.find((row) => row.groupId === groupId && row.item === "J型手把");
    if (jHandleRow && jHandles) jHandleRow.note = `[R43/R44] 實際J把加工門片${jHandles}片=${jHandleRow.qty}支；逐片保留開向與起開註記`;
  }
}

export function doorHardwareClosureNote(cabinets: CabinetRead[], materials: CutRow[], hardware: HardwareRow[], materialSlantedHandles: number, expectedSlantedHandles: number) {
  let readyDoors = 0;
  let expectedHinges = 0;
  let expectedJHandles = 0;
  for (const cabinet of cabinets) {
    for (const door of (cabinet.doors || []).filter((item) => item.type === "4E")) {
      if (!doorCountEvidenceIsClosed(door) || !doorIsReadyForHardware(door)) continue;
      const count = n(door.count);
      const height = resolveDoorFinishedHeight(door);
      readyDoors += count;
      expectedHinges += count * hingesPerDoorForFinishedHeight(height);
      const jHandles = n(door.jHandleCount);
      if (jHandles > 0 && jHandles <= count) expectedJHandles += jHandles;
    }
  }
  const hardwareQty = (item: string) => hardware.filter((row) => row.item === item).reduce((sum, row) => sum + n(row.qty), 0);
  const actualSlantedHandles = hardwareQty("斜手把");
  const materialDoors = materials.filter((row) => row.item === "4E門板").reduce((sum, row) => sum + n(row.qty), 0);
  const materialJHandles = materials.filter((row) => row.item === "4E門板").reduce((sum, row) => {
    return sum + [...row.note.matchAll(/J把×(\d+)/g)].reduce((subtotal, match) => subtotal + n(Number(match[1])), 0);
  }, 0);
  const actualHinges = hardwareQty("GS鉸鍊");
  const actualDampers = hardwareQty("油壓器");
  const actualJHandles = hardwareQty("J型手把");
  const checks = [
    ["門板", materialDoors, readyDoors],
    ["GS鉸鍊", actualHinges, expectedHinges],
    ["油壓器", actualDampers, readyDoors * QUANTITY.DAMPERS_PER_STANDARD_DOOR],
    ["J把備註", materialJHandles, expectedJHandles],
    ["J型手把", actualJHandles, expectedJHandles],
    ["斜把備註", materialSlantedHandles, expectedSlantedHandles],
    ["斜手把", actualSlantedHandles, expectedSlantedHandles],
  ] as const;
  const active = checks.some(([, actual, expected]) => actual > 0 || expected > 0);
  if (!active) return "";
  const mismatches = checks.filter(([, actual, expected]) => actual !== expected);
  if (mismatches.length) {
    return `門板／門五金閉合不一致：${mismatches.map(([item, actual, expected]) => `${item}${actual}／應${expected}`).join("；")}；保留原始數量並要求人工確認。`;
  }
  return `門板／門五金閉合通過：4E門${readyDoors}片、GS鉸鍊${actualHinges}個、油壓器${actualDampers}個、J型手把${actualJHandles}支、斜手把${actualSlantedHandles}個。`;
}

function drawingNoteSuffix(cabinet: CabinetRead) {
  const notes = (cabinet.drawingNotes || []).map(String).map((item) => item.trim()).filter(Boolean);
  return notes.length ? `／圖註：${notes.join("、")}` : "";
}

function cutNote(cabinet: CabinetRead, ruleIds: string, formula: string) {
  return `${cabinet.name}／[${ruleIds}] ${formula}${drawingNoteSuffix(cabinet)}`;
}

function connectionDeduction(connection: MiddleDividerRead["topConnection"]) {
  if (connection === "fixed_shelf_centerline") return 9;
  if (["top_board", "bottom_board", "fixed_shelf_full"].includes(connection)) return 18;
  return 0;
}

function connectionLabel(connection: MiddleDividerRead["topConnection"]) {
  return connection === "top_board" ? "頂板18" : connection === "bottom_board" ? "底板18" : connection === "fixed_shelf_full" ? "固格完整板18" : connection === "fixed_shelf_centerline" ? "固格中心線9" : "接點待確認";
}

export function calculateMiddleDividerDimensions(cabinetDepthMm: number, divider: MiddleDividerRead, depthDeductionMm = STANDARD_BOARD_PROFILE.fixedShelfDepthDeductionMm) {
  const D = n(cabinetDepthMm);
  const topDeduction = connectionDeduction(divider.topConnection);
  const bottomDeduction = connectionDeduction(divider.bottomConnection);
  const standardDepth = n(D - n(depthDeductionMm));
  const depthMm = divider.depthBasis === "standard_d_minus_29" ? standardDepth : divider.depthBasis === "finished" ? n(divider.depthMm) : 0;
  const heightMm = divider.heightBasis === "connection_span"
    ? n(divider.referenceSpanMm - topDeduction - bottomDeduction)
    : divider.heightBasis === "finished" ? n(divider.heightMm) : 0;
  const depthFormula = divider.depthBasis === "standard_d_minus_29" ? `深D-${n(depthDeductionMm)}=${D}-${n(depthDeductionMm)}=${depthMm}` : divider.depthBasis === "finished" ? `圖面完成深${depthMm}` : "深度算法待確認";
  const heightFormula = divider.heightBasis === "connection_span"
    ? `高${n(divider.referenceSpanMm)}-${topDeduction}-${bottomDeduction}=${heightMm}`
    : divider.heightBasis === "finished" ? `圖面完成高${heightMm}` : "高度算法待確認";
  const complete = depthMm > 0 && heightMm > 0
    && divider.depthBasis !== "unknown" && divider.heightBasis !== "unknown"
    && (divider.heightBasis !== "connection_span" || (divider.referenceSpanMm > topDeduction + bottomDeduction && topDeduction > 0 && bottomDeduction > 0));
  return {
    depthMm,
    heightMm,
    complete,
    note: `[R54-R59] 中立只做到${divider.region || "實際分隔區"}／${depthFormula}／${heightFormula}／上接${connectionLabel(divider.topConnection)}、下接${connectionLabel(divider.bottomConnection)}${divider.evidence ? `／圖據：${divider.evidence}` : ""}`,
  };
}

export function calculateSop(input: CabinetRead[] | AnalysisForSop) {
  const analysis: AnalysisForSop = Array.isArray(input) ? { cabinets: input } : input;
  const cabinets = analysis.cabinets || [];
  const cuts: CutRow[] = [];
  const hardware: HardwareRow[] = [];
  const notes: string[] = [];

  for (const cabinet of cabinets) {
    const cutStart = cuts.length;
    const hardwareStart = hardware.length;
    const groupId = cabinet.elevationId || "GLOBAL";
    const W = n(cabinet.widthMm);
    const H = n(cabinet.heightMm);
    const D = n(cabinet.depthMm);
    const label = cabinet.id || cabinet.name;
    if (!W || !H || !D) {
      notes.push(`${label} 尺寸不完整，未計算。`);
      continue;
    }
    const profile = resolveBoardProfile(cabinet);
    if (!boardProfileIsComplete(profile)) {
      notes.push(`${label} 的板厚或非標準扣數尚未確認，未套用18／8mm標準公式。`);
      continue;
    }
    const innerWidth = n(W - profile.topBottomWidthDeductionMm);

    cuts.push({ item: "側板", spec: spec(D, H), qty: QUANTITY.SIDE_PANELS_PER_CABINET, note: cutNote(cabinet, "R08/R13/R16", `${profile.bodyThicknessMm}mm／每桶${QUANTITY.SIDE_PANELS_PER_CABINET}片；側板=D×H=${D}×${H}`) });
    const topRetreat = n(cabinet.topBoardRetreatMm);
    const bottomRetreat = n(cabinet.bottomBoardRetreatMm);
    if (topRetreat || bottomRetreat) {
      cuts.push({ item: "頂板", spec: spec(D - topRetreat, innerWidth), qty: QUANTITY.TOP_BOARDS_PER_CABINET, note: cutNote(cabinet, topRetreat ? "R17/R26-R29" : "R17", `${profile.bodyThicknessMm}mm／頂板=(${D}-${topRetreat})×(${W}-${profile.topBottomWidthDeductionMm})`) });
      cuts.push({ item: "底板", spec: spec(D - bottomRetreat, innerWidth), qty: QUANTITY.BOTTOM_BOARDS_PER_CABINET, note: cutNote(cabinet, bottomRetreat ? "R17/R26-R29" : "R17", `${profile.bodyThicknessMm}mm／底板=(${D}-${bottomRetreat})×(${W}-${profile.topBottomWidthDeductionMm})`) });
    } else {
      cuts.push({ item: "頂底板", spec: spec(D, innerWidth), qty: QUANTITY.TOP_BOARDS_PER_CABINET + QUANTITY.BOTTOM_BOARDS_PER_CABINET, note: cutNote(cabinet, "R13/R17", `${profile.bodyThicknessMm}mm／頂板${QUANTITY.TOP_BOARDS_PER_CABINET}片、底板${QUANTITY.BOTTOM_BOARDS_PER_CABINET}片；頂底板=D×(W-${profile.topBottomWidthDeductionMm})=${D}×${innerWidth}`) });
    }
    cuts.push({ item: "背板", spec: spec(W - profile.backWidthDeductionMm, H - profile.backHeightDeductionMm), qty: QUANTITY.BACK_PANELS_PER_CABINET, note: cutNote(cabinet, "R13/R18", `每桶${QUANTITY.BACK_PANELS_PER_CABINET}片；${profile.backThicknessMm}mm；背板=(W-${profile.backWidthDeductionMm})×(H-${profile.backHeightDeductionMm})=${W - profile.backWidthDeductionMm}×${H - profile.backHeightDeductionMm}`) });

    const slantedFixed = Math.min(n(cabinet.fixedShelves), n(cabinet.slantedFixedShelfCount));
    const normalFixed = Math.max(0, n(cabinet.fixedShelves) - slantedFixed);
    const fixedPositions = (cabinet.fixedShelfPositionsMm || []).filter((value) => Number(value) > 0).map(n);
    const fixedPositionNote = fixedPositions.length ? `；F中心線位置${fixedPositions.join("、")}mm（含頂底量至中心線）` : "；F為含頂底量至中心線，位置依圖面";
    if (normalFixed) cuts.push({ item: "固格", spec: spec(D - profile.fixedShelfDepthDeductionMm, W - profile.fixedShelfWidthDeductionMm), qty: normalFixed, note: cutNote(cabinet, "R13/R23", `${profile.bodyThicknessMm}mm／固格=(D-${profile.fixedShelfDepthDeductionMm})×(W-${profile.fixedShelfWidthDeductionMm})=${D - profile.fixedShelfDepthDeductionMm}×${W - profile.fixedShelfWidthDeductionMm}${fixedPositionNote}`) });
    if (slantedFixed) cuts.push({ item: "固格", spec: spec(D - profile.fixedShelfDepthDeductionMm - 19, W - profile.fixedShelfWidthDeductionMm), qty: slantedFixed, note: cutNote(cabinet, "R23/R28", `斜把相關固格=(D-${profile.fixedShelfDepthDeductionMm}-19)×(W-${profile.fixedShelfWidthDeductionMm})=${D - profile.fixedShelfDepthDeductionMm - 19}×${W - profile.fixedShelfWidthDeductionMm}；固格前縮19mm${fixedPositionNote}`) });
    if (cabinet.adjustableShelves > 0) {
      const adjustable = calculateAdjustableShelfWidth(cabinet);
      const widthFormula = adjustable.dividerCount ? `${adjustable.formula}；依中立分成${adjustable.openingCount}格逐片計` : adjustable.formula;
      cuts.push({ item: "活格板", spec: spec(D - profile.adjustableShelfDepthDeductionMm, adjustable.widthMm), qty: n(cabinet.adjustableShelves), note: cutNote(cabinet, "R13/R24/R54", `${profile.bodyThicknessMm}mm／現行活格深D-${profile.adjustableShelfDepthDeductionMm}=${D - profile.adjustableShelfDepthDeductionMm}；${widthFormula}`) });
    }

    const stripResolution = resolveBackStripQuantity(cabinet);
    const strips = stripResolution.count;
    if (strips) cuts.push({ item: "背條", spec: spec(110, innerWidth), qty: strips, note: cutNote(cabinet, cabinet.isHanging || cabinet.cabinetKind === "hanging" || cabinet.cabinetKind === "stacked" ? "R20" : "R19", `背條=110×(W-${profile.topBottomWidthDeductionMm})=110×${innerWidth}；本桶${strips}支；${stripResolution.explanation}`) });
    else if (strips === null) notes.push(`[背條數量對照] ${label}：目前未知（不是0支）；SOP為特殊櫃依圖面，請回答實際0／1／2…支。`);

    for (const divider of cabinet.middleDividers || []) {
      const calculated = calculateMiddleDividerDimensions(D, divider, profile.fixedShelfDepthDeductionMm);
      if (calculated.complete) cuts.push({ item: "中立板", spec: spec(calculated.depthMm, calculated.heightMm), qty: 1, note: `${cabinet.name}／${calculated.note}${drawingNoteSuffix(cabinet)}` });
      else notes.push(`${label} 的中立板仍缺深度基準、實際跨度或上下接點，未套H-36，也未猜完成尺寸。`);
    }
    for (const baffle of cabinet.baffles || []) {
      const expectedHeight = resolveBaffleHeight(baffle);
      const expectedWidth = baffle.widthBasis === "cabinet_inner" ? innerWidth : n(baffle.widthMm);
      if (expectedHeight > 0 && expectedWidth > 0 && baffle.widthBasis !== "unknown") cuts.push({ item: "前上擋板", spec: spec(expectedHeight, expectedWidth), qty: QUANTITY.BAFFLES_PER_REQUIRED_OPENING, note: cutNote(cabinet, "R30-R33", `${baffle.mountBasis === "fixed_shelf" ? "鎖固格固定60mm" : baffle.mountBasis === "raised_bottom" ? "鎖上升底板固定60mm" : baffle.kind === "drawer_60" ? "60mm抽屜或固格斜把" : baffle.kind === "door_50" ? "50mm純門斜把" : "依圖面鎖附位置"}；${baffle.widthBasis === "cabinet_inner" ? `後端固定算W-${profile.topBottomWidthDeductionMm}=${innerWidth}` : "圖面完成分段寬"}${baffle.segmentCount > 1 ? `；中立分段${baffle.segmentIndex}/${baffle.segmentCount}` : ""}${baffle.evidence ? `；圖據：${baffle.evidence}` : ""}`) });
      else notes.push(`${label} 有擋板但鎖附位置或分段寬度未確認，未自行補尺寸。`);
    }

    const fourEDoors = (cabinet.doors || []).filter((door) => door.type === "4E");
    const allDoorCountsClosed = fourEDoors.length > 0 && fourEDoors.every(doorCountEvidenceIsClosed);
    for (const door of cabinet.doors || []) {
      if (door.type === "aluminum" || door.type === "none" || door.count <= 0) continue;
      if (!allDoorCountsClosed || !doorCountEvidenceIsClosed(door)) {
        notes.push(`${label} 的4E門片數量證據尚未閉合，未先算門板或五金。`);
        continue;
      }
      const jHandleCount = n(door.jHandleCount);
      if (jHandleCount > n(door.count)) notes.push(`${label} 的J把加工數${jHandleCount}支超過4E門${n(door.count)}片，已阻止輸出錯誤門把五金。`);
      if (jHandleCount + n(door.slantedHandleCount) > n(door.count)) notes.push(`${label} 的J把${jHandleCount}支＋斜把${n(door.slantedHandleCount)}支超過4E門${n(door.count)}片，同一門片不可重複套兩種手把；已暫停該組門板與門五金。`);
      if (!doorIsReadyForHardware(door)) {
        notes.push(`${label} 已鎖定${n(door.count)}片<／>門片；門尺寸或24mm斜把縫關係尚未閉合，或手把數量矛盾，所以只暫停該門板尺寸與門用五金，不取消片數。`);
        continue;
      }
      let doorWidth = 0;
      let doorHeight = 0;
      if (door.dimensionBasis === "finished") {
        doorWidth = n(door.finishedWidthMm);
        doorHeight = n(door.finishedHeightMm);
      } else if (door.dimensionBasis === "opening") {
        doorWidth = n(door.openingWidthMm / door.count - 3);
        doorHeight = n(door.openingHeightMm - (door.includesBottom30 ? 30 : 0) - (deductSlantedGap24(door) ? 24 : 0) - 4);
      }
      const doorFormula = door.dimensionBasis === "finished"
        ? `完成門面${doorWidth}×${doorHeight}，不再扣4`
        : `單門寬=${n(door.openingWidthMm)}÷${n(door.count)}-3=${doorWidth}；門高=${n(door.openingHeightMm)}${door.includesBottom30 ? "-30" : ""}${deductSlantedGap24(door) ? "-24" : ""}-4=${doorHeight}`;
      if (doorWidth && doorHeight) cuts.push({ item: "4E門板", spec: spec(doorWidth, doorHeight), qty: n(door.count), note: cutNote(cabinet, "R37-R45", `${doorFormula}／${cabinetDoorNote(door)}${door.evidence ? `／圖據：${door.evidence}` : ""}`) });
      else notes.push(`${label} 的4E門尚未分清開口尺寸或完成門面尺寸，未計門板。`);
      if (jHandleCount > 0 && jHandleCount <= n(door.count)) hardware.push({ item: "J型手把", qty: jHandleCount, unit: "支", note: `[R43/R44] ${cabinet.name}／依實際J把加工門片與起開註記` });
      hardware.push({ item: "油壓器", qty: n(door.count) * QUANTITY.DAMPERS_PER_STANDARD_DOOR, unit: "個", note: `[R61] ${cabinet.name}／一般普通門每片${QUANTITY.DAMPERS_PER_STANDARD_DOOR}個` });
      const hingesPerDoor = hingesPerDoorForFinishedHeight(doorHeight);
      if (hingesPerDoor > 0) hardware.push({ item: "GS鉸鍊", qty: n(door.count) * hingesPerDoor, unit: "個", note: `[R61] ${cabinet.name}／完成門高${doorHeight}mm／${n(door.count)}片×每片${hingesPerDoor}個（正式公式自動算）` });
    }

    const connectorPerBoard = D >= 500 ? QUANTITY.CONNECTORS_PER_TOP_BOTTOM_BOARD_DEEP : QUANTITY.CONNECTORS_PER_TOP_BOTTOM_BOARD_SHALLOW;
    const connectorCount = connectorPerBoard * (QUANTITY.TOP_BOARDS_PER_CABINET + QUANTITY.BOTTOM_BOARDS_PER_CABINET);
    hardware.push(
      { item: "KD", qty: connectorCount, unit: "個", note: `[R21] ${cabinet.name}／${D >= 500 ? "D≥500，頂底每片6個" : "D<500，頂底每片4個"}` },
      { item: "抽木榫", qty: connectorCount, unit: "個", note: `[R21] ${cabinet.name}／桶身連接用，數量與KD相同` },
    );
    if (cabinet.fixedShelves) hardware.push({ item: "白固格器", qty: n(cabinet.fixedShelves) * QUANTITY.FIXED_SHELF_FITTINGS_PER_BOARD, unit: "個", note: `[R23/R60] ${cabinet.name}／固格${n(cabinet.fixedShelves)}片×${QUANTITY.FIXED_SHELF_FITTINGS_PER_BOARD}` });
    const completeDividerCount = (cabinet.middleDividers || []).filter((divider) => calculateMiddleDividerDimensions(D, divider, profile.fixedShelfDepthDeductionMm).complete).length;
    if (completeDividerCount) hardware.push({ item: "白固格器", qty: completeDividerCount * QUANTITY.MIDDLE_DIVIDER_FITTINGS_PER_BOARD, unit: "個", note: `[R58-R60] ${cabinet.name}／完成中立${completeDividerCount}片×${QUANTITY.MIDDLE_DIVIDER_FITTINGS_PER_BOARD}；上18下18不免五金` });
    if (cabinet.adjustableShelves) hardware.push({ item: "活格利", qty: n(cabinet.adjustableShelves) * QUANTITY.ADJUSTABLE_SHELF_PINS_PER_BOARD, unit: "個", note: `[R24/R60] ${cabinet.name}／活格${n(cabinet.adjustableShelves)}片×${QUANTITY.ADJUSTABLE_SHELF_PINS_PER_BOARD}` });
    const footResolution = resolvedFootState(cabinet);
    if (!cabinet.isHanging && cabinet.cabinetKind !== "hanging" && footResolution === "present" && cabinet.footHeightMm > 0) {
      const dividerSupportFeet = fullHeightMiddleDividerCount(cabinet) * QUANTITY.SUPPORT_FEET_PER_FULL_HEIGHT_MIDDLE_DIVIDER;
      hardware.push({ item: cabinet.footHeightMm > 120 ? "A12" : "A10", qty: QUANTITY.FEET_PER_FLOOR_CABINET + dividerSupportFeet, unit: "個", note: `[R22] ${cabinet.name}／離地${n(cabinet.footHeightMm)}mm／基本${QUANTITY.FEET_PER_FLOOR_CABINET}個${dividerSupportFeet ? `＋全高中立支撐${dividerSupportFeet}個` : ""}` });
    }
    else if (!cabinet.isHanging && cabinet.cabinetKind === "floor" && footResolution === "unknown") notes.push(`[調整腳數量對照] ${label}：目前未知（不是0個）；SOP為落地櫃基本4個、全高中立每片另加1個支撐腳；請回答有／無，若有再提供腳高以判A10／A12。`);
    else if (!cabinet.isHanging && cabinet.cabinetKind === "floor" && footResolution === "present" && !(cabinet.footHeightMm > 0)) notes.push(`[調整腳數量對照] ${label}：已確認有調整腳，但缺腳高，無法判斷A10／A12。`);

    const groups = cabinet.drawerGroups || [];
    if (groups.length) {
      for (const [groupIndex, group] of groups.entries()) {
        const count = n(group.count);
        const groupLabel = `第${groupIndex + 1}組抽屜`;
        const outerSlide = slideDepth(D, profile.fixedShelfDepthDeductionMm);
        const innerSlide = outerSlide - 50;
        const selectedSlide = group.isInner ? (innerSlide >= 300 ? innerSlide : 0) : outerSlide;
        if (selectedSlide) hardware.push({ item: `三節滑軌 ${selectedSlide}`, qty: count * QUANTITY.SLIDES_PER_DRAWER, unit: "組", note: `[R46-R48] ${cabinet.name}／D-${profile.fixedShelfDepthDeductionMm}上限${D - profile.fixedShelfDepthDeductionMm}，${group.isInner ? `外抽${outerSlide}-50` : "取不超過上限的50級距"}=${selectedSlide}；1抽=${QUANTITY.SLIDES_PER_DRAWER}組` });
        const centerlineCount = Math.min(2, Math.max(0, n(group.centerlineBoundaryCount ?? (group.usesCenterlineWidth ? 1 : 0))));
        const boundaryDeduction = 99 - centerlineCount * 9;
        const innerDeduction = group.isInner ? 50 : 0;
        const frontBack = n(group.openingWidthMm - boundaryDeduction - innerDeduction);
        const drawerFormula = `格寬${n(group.openingWidthMm)}-${boundaryDeduction}${group.isInner ? "-50" : ""}=${frontBack}；中立中心線邊界${centerlineCount}側（扣${centerlineCount === 0 ? 99 : centerlineCount === 1 ? 90 : 81}）`;
        const drawerWallHeight = drawerWallHeightForFrontHeight(group.openingHeightMm);
        if (frontBack > 0 && drawerWallHeight > 0 && selectedSlide > 0) {
          cuts.push({ item: group.isInner ? "內抽前後抽牆" : "前後抽牆", spec: spec(drawerWallHeight, frontBack), qty: count * QUANTITY.FRONT_BACK_WALLS_PER_DRAWER, note: cutNote(cabinet, group.isInner ? "R50/R57/R67" : "R49/R57/R67", `${groupLabel}／每抽${QUANTITY.FRONT_BACK_WALLS_PER_DRAWER}片／抽牆高×完成寬=${drawerWallHeight}×${frontBack}／${drawerFormula}／${drawerWallHeightFormulaText(group.openingHeightMm)}`) });
          cuts.push({ item: "邊抽牆", spec: spec(drawerWallHeight, selectedSlide), qty: count * QUANTITY.SIDE_WALLS_PER_DRAWER, note: cutNote(cabinet, "R46/R51/R67", `${groupLabel}／每抽${QUANTITY.SIDE_WALLS_PER_DRAWER}片／抽牆高×標準抽深=${drawerWallHeight}×${selectedSlide}／${drawerWallHeightFormulaText(group.openingHeightMm)}`) });
          cuts.push({ item: "抽底板", spec: spec(frontBack + 10, selectedSlide - 26), qty: count * QUANTITY.BOTTOMS_PER_DRAWER, note: cutNote(cabinet, "R13/R51", `${profile.drawerBottomThicknessMm}mm／${groupLabel}／每抽${QUANTITY.BOTTOMS_PER_DRAWER}片／抽底板=(前後抽牆+10)×(抽深-26)=${frontBack + 10}×${selectedSlide - 26}；寬×深`) });
        } else notes.push(`${label} ${groupLabel}缺完成屜頭高度、格寬或可用深度，未產生抽屜板料；抽牆高不另行詢問。`);
        const dowelsPerDrawer = drawerDowelsPerDrawerForDepth(D);
        hardware.push({ item: "抽木榫", qty: count * dowelsPerDrawer, unit: "個", note: `[R52] ${cabinet.name}／${groupLabel}／D${D}每抽${dowelsPerDrawer}個；輸出與桶身連接木榫合併同品項，計算依據仍分開` });
        if (group.isInner) {
          if (group.fixedShelfPositionMm > 27) cuts.push({ item: "抽補板", spec: spec(120, group.fixedShelfPositionMm - 27), qty: count * QUANTITY.SUPPLEMENT_BOARDS_PER_INNER_DRAWER, note: cutNote(cabinet, "R23/R53", `25mm／${groupLabel}／每內抽${QUANTITY.SUPPLEMENT_BOARDS_PER_INNER_DRAWER}片／抽補板=120×(F-27)=120×(${n(group.fixedShelfPositionMm)}-18-9)`) });
          else notes.push(`${label} ${groupLabel}是內抽但缺F中心線高度，未計抽補板。`);
        }
      }
    } else if (cabinet.drawerCount > 0) {
      const selectedSlide = slideDepth(D, profile.fixedShelfDepthDeductionMm);
      if (selectedSlide) hardware.push({ item: `三節滑軌 ${selectedSlide}`, qty: n(cabinet.drawerCount) * QUANTITY.SLIDES_PER_DRAWER, unit: "組", note: `[R46-R48] ${cabinet.name}／每抽${QUANTITY.SLIDES_PER_DRAWER}組；板料待格寬與完成屜頭高度確認` });
      const dowelsPerDrawer = drawerDowelsPerDrawerForDepth(D);
      hardware.push({ item: "抽木榫", qty: n(cabinet.drawerCount) * dowelsPerDrawer, unit: "個", note: `[R52] ${cabinet.name}／D${D}每抽${dowelsPerDrawer}個；輸出與桶身連接木榫合併同品項` });
      notes.push(`${label} 只有抽屜總數，尚缺逐組格寬／完成屜頭高度；抽牆高會由後端級距自動計算。`);
    }
    for (let index = cutStart; index < cuts.length; index += 1) {
      cuts[index].groupId = groupId;
      cuts[index].thicknessMm = cuts[index].item === "背板" ? profile.backThicknessMm
        : cuts[index].item === "抽底板" ? profile.drawerBottomThicknessMm
          : cuts[index].item === "抽補板" ? 25
            : profile.bodyThicknessMm;
    }
    for (let index = hardwareStart; index < hardware.length; index += 1) hardware[index].groupId = groupId;
  }

  for (const panel of analysis.independentPanels || []) {
    if (!(panel.widthMm > 0 && panel.heightMm > 0 && panel.count > 0)) {
      notes.push(`${panel.id || panel.name || "未命名獨立板件"} 缺尺寸或確認數量，未列入板料。`);
      continue;
    }
    const panelSpec = panel.dimensionOrder === "height_width" ? spec(panel.heightMm, panel.widthMm) : spec(panel.widthMm, panel.heightMm);
    cuts.push({ item: panel.name || "獨立封板", spec: panelSpec, thicknessMm: panel.thicknessMm || 18, qty: n(panel.count), note: `[R34/R35/R65] 圖面確認${n(panel.count)}片／${panel.thicknessMm || 18}mm${panel.grainDirection !== "none" ? `／紋向${panel.grainDirection}` : ""}${panel.note ? `／${panel.note}` : ""}`, groupId: panel.elevationId || "GLOBAL" });
  }

  for (const kickboard of analysis.kickboards || []) {
    const remaining = n(kickboard.siteLengthMm);
    if (!remaining) continue;
    if (remaining <= 2800) {
      cuts.push({ item: "踢腳板", spec: spec(120, 2800), thicknessMm: 18, qty: 1, note: `[R36] ${kickboard.id}／標準料長，現場${remaining}`, groupId: kickboard.elevationId || "GLOBAL" });
      continue;
    }
    const fullPieces = Math.floor(remaining / 2800);
    const remainder = remaining % 2800;
    if (fullPieces) cuts.push({ item: "踢腳板", spec: spec(120, 2800), thicknessMm: 18, qty: fullPieces, note: `[R36] ${kickboard.id}／標準料長`, groupId: kickboard.elevationId || "GLOBAL" });
    if (remainder) cuts.push({ item: "踢腳板", spec: spec(120, Math.min(2800, remainder + 500)), thicknessMm: 18, qty: 1, note: `[R36] ${kickboard.id}／餘長${remainder}+固定預留500`, groupId: kickboard.elevationId || "GLOBAL" });
  }

  for (const mirror of analysis.mirrors || []) {
    hardware.push({ item: "鏡珠", qty: n(mirror.count) * QUANTITY.MIRROR_BEADS_PER_MIRROR, unit: "顆", note: `[R62] ${mirror.id}／每面明鏡${QUANTITY.MIRROR_BEADS_PER_MIRROR}顆`, groupId: mirror.elevationId || "GLOBAL" });
  }
  for (const item of analysis.specialHardware || []) {
    if (item.item && item.qty > 0 && item.unit) hardware.push({ item: item.item, qty: n(item.qty), unit: item.unit, note: `[R62/R63] ${item.evidence}`, groupId: item.elevationId || "GLOBAL" });
    else notes.push(`特殊五金「${item.item || "未命名"}」已辨識但數量或單位未確認，未省略也未猜數量。`);
  }

  const mergedHardware = mergeHardware(hardware);
  const correctedGroups = [...new Set((analysis.cabinets || [])
    .filter((cabinet) => n(cabinet.depthMm) >= 500 && n(cabinet.drawerCount) > 0)
    .map((cabinet) => cabinet.elevationId || "GLOBAL"))];
  for (const groupId of correctedGroups) {
    const groupCabinets = (analysis.cabinets || []).filter((cabinet) => (cabinet.elevationId || "GLOBAL") === groupId);
    const legacyBodyCount = groupCabinets.reduce((sum, cabinet) => {
      const legacyPerBoard = n(cabinet.depthMm) > 500
        ? QUANTITY.CONNECTORS_PER_TOP_BOTTOM_BOARD_DEEP
        : QUANTITY.CONNECTORS_PER_TOP_BOTTOM_BOARD_SHALLOW;
      return sum + legacyPerBoard * (QUANTITY.TOP_BOARDS_PER_CABINET + QUANTITY.BOTTOM_BOARDS_PER_CABINET);
    }, 0);
    const legacyDrawerCount = groupCabinets.reduce((sum, cabinet) => sum + n(cabinet.drawerCount) * QUANTITY.DOWELS_PER_DRAWER_SHALLOW, 0);
    const dowels = mergedHardware.find((row) => row.groupId === groupId && row.item === "抽木榫");
    if (dowels) dowels.note = `${dowels.note}／不再拆成櫃體${legacyBodyCount}＋抽屜${legacyDrawerCount}`;
  }

  return { materials: mergeCuts(cuts), hardware: mergedHardware, notes: [...new Set(notes)] };
}

const DOOR_ONLY_MATERIAL = /(?:^|[鋁4E])門板$|鋁框門/i;
const DOOR_ONLY_HARDWARE = /GS鉸鍊|油壓器|J型?手把|斜手把|長斜把/i;

/**
 * Production mode requested by the user: keep every cabinet material and
 * hardware item except functional doors and hardware used only by doors.
 * Vision supplies observations; all dimensions and quantities still flow
 * through the deterministic SOP calculator above.
 */
export function calculateNonDoorSop(input: AnalysisForSop) {
  const drawerFronts: IndependentPanelRead[] = [];
  for (const cabinet of input.cabinets || []) {
    for (const [index, group] of (cabinet.drawerGroups || []).entries()) {
      const widthMm = n(group.openingWidthMm) - 3;
      const heightMm = n(group.openingHeightMm);
      if (widthMm <= 0 || heightMm <= 0 || n(group.count) <= 0) continue;
      drawerFronts.push({
        id: `${cabinet.id || cabinet.name}-drawer-front-${index + 1}`,
        elevationId: cabinet.elevationId,
        name: "屜頭",
        count: n(group.count),
        widthMm,
        heightMm,
        thicknessMm: 18,
        grainDirection: "none",
        dimensionOrder: "width_height",
        note: `[R15/R42/R49] 屜頭寬=單一抽屜開口${n(group.openingWidthMm)}-3=${widthMm}；高採圖面完成屜頭${heightMm}${group.slantedHandle ? `／長斜把×${n(group.count)}（加工備註；完整模式另列斜手把五金）` : ""}`,
        evidence: group.evidence,
      });
    }
  }

  const mirrors: IndependentPanelRead[] = (input.mirrors || [])
    .filter((mirror) => n(mirror.count) > 0 && n(mirror.widthMm || 0) > 0 && n(mirror.heightMm || 0) > 0)
    .map((mirror) => ({
      id: mirror.id,
      elevationId: mirror.elevationId,
      name: "明鏡",
      count: n(mirror.count),
      widthMm: n(mirror.widthMm || 0),
      heightMm: n(mirror.heightMm || 0),
      thicknessMm: 5,
      grainDirection: "none" as const,
      dimensionOrder: "width_height" as const,
      note: `[R62] 圖面完成尺寸；${mirror.evidence}`,
      evidence: mirror.evidence,
    }));

  const sanitized: AnalysisForSop = {
    ...input,
    cabinets: (input.cabinets || []).map((cabinet) => ({ ...cabinet, doors: [] })),
    independentPanels: [...(input.independentPanels || []), ...drawerFronts, ...mirrors],
    specialHardware: (input.specialHardware || []).filter((item) => !DOOR_ONLY_HARDWARE.test(item.item || "")),
  };
  const result = calculateSop(sanitized);
  const materials = mergeCuts(result.materials
    .filter((row) => !DOOR_ONLY_MATERIAL.test(row.item))
    .map((row) => ({
      ...row,
      item: row.item === "固格" ? "固格板"
        : row.item === "前後抽牆" ? "前抽牆"
          : row.item === "內抽前後抽牆" ? "內抽前抽牆"
            : row.item === "前上擋板" ? "擋板"
              : row.item,
    })));
  const hardware = mergeHardware(result.hardware
    .filter((row) => !DOOR_ONLY_HARDWARE.test(row.item))
    .map((row) => {
      const slide = row.item.match(/^三節滑軌\s+(\d+)$/);
      if (slide) return { ...row, item: `${Math.round(Number(slide[1]) / 10)}滑軌` };
      if (/^(?:35)?伸縮衣(?:架|桿)$/.test(row.item.trim())) return { ...row, item: "35伸縮衣桿", unit: row.unit || "支" };
      return row;
    }));
  return {
    materials: materials.map(({ groupId: _groupId, ...row }) => row),
    hardware: hardware.map(({ groupId: _groupId, ...row }) => row),
    notes: [...new Set([
      ...result.notes.filter((note) => !/門板|門片|門用五金|4E門/.test(note)),
      "本模式已排除功能門板、鋁框門與門專用五金；屜頭、假門板等非功能門構件仍保留。",
    ])],
  };
}

/**
 * Complete production mode: keeps the deterministic non-door calculation,
 * adds functional 4E doors and door-only hardware, and preserves drawer fronts
 * and mirrors that are derived outside the core cabinet-body formulas.
 */
export function calculateCompleteSop(input: AnalysisForSop) {
  const drawerFronts: IndependentPanelRead[] = [];
  const slantedHandlesByGroup = new Map<string, number>();
  for (const cabinet of input.cabinets || []) {
    for (const [index, group] of (cabinet.drawerGroups || []).entries()) {
      const widthMm = n(group.openingWidthMm) - 3;
      const heightMm = n(group.openingHeightMm);
      if (widthMm <= 0 || heightMm <= 0 || n(group.count) <= 0) continue;
      const evidenceText = String(group.evidence || "");
      const slantedLabel = /上斜把/.test(evidenceText) ? "上斜把"
        : /下斜把/.test(evidenceText) ? "下斜把"
          : "長斜把";
      drawerFronts.push({
        id: `${cabinet.id || cabinet.name}-drawer-front-${index + 1}`,
        elevationId: cabinet.elevationId,
        name: "屜頭",
        count: n(group.count),
        widthMm,
        heightMm,
        thicknessMm: 18,
        grainDirection: "none",
        dimensionOrder: "width_height",
        note: `[R15/R42/R49] 屜頭寬=單一抽屜開口${n(group.openingWidthMm)}-3=${widthMm}；高採圖面完成屜頭${heightMm}${group.slantedHandle ? `／${slantedLabel}×${n(group.count)}` : ""}`,
        evidence: group.evidence,
      });
      if (group.slantedHandle) {
        const groupId = cabinet.elevationId || "GLOBAL";
        slantedHandlesByGroup.set(groupId, (slantedHandlesByGroup.get(groupId) || 0) + n(group.count));
      }
    }
  }

  const mirrors: IndependentPanelRead[] = (input.mirrors || [])
    .filter((mirror) => n(mirror.count) > 0 && n(mirror.widthMm || 0) > 0 && n(mirror.heightMm || 0) > 0)
    .map((mirror) => ({
      id: mirror.id,
      elevationId: mirror.elevationId,
      name: "明鏡",
      count: n(mirror.count),
      widthMm: n(mirror.widthMm || 0),
      heightMm: n(mirror.heightMm || 0),
      thicknessMm: 5,
      grainDirection: "none" as const,
      dimensionOrder: "width_height" as const,
      note: `[R62] 圖面完成尺寸；${mirror.evidence}`,
      evidence: mirror.evidence,
    }));

  const result = calculateSop({
    ...input,
    independentPanels: [...(input.independentPanels || []), ...drawerFronts, ...mirrors],
  });
  for (const cabinet of input.cabinets || []) {
    const groupId = cabinet.elevationId || "GLOBAL";
    const doorCount = (cabinet.doors || []).reduce((sum, door) => {
      if (door.type !== "4E" || !doorCountEvidenceIsClosed(door) || !doorIsReadyForHardware(door)) return sum;
      const handleCount = door.slantedHandleCount > 0 ? n(door.slantedHandleCount) : door.slantedHandle ? n(door.count) : 0;
      if (handleCount > n(door.count) || Boolean(door.slantedHandle) !== (handleCount > 0)) return sum;
      return sum + handleCount;
    }, 0);
    if (doorCount) slantedHandlesByGroup.set(groupId, (slantedHandlesByGroup.get(groupId) || 0) + doorCount);
  }
  const slantedHandleCount = [...slantedHandlesByGroup.values()].reduce((sum, qty) => sum + qty, 0);
  for (const [groupId, qty] of slantedHandlesByGroup) {
    if (qty) result.hardware.push({ item: "斜手把", qty, unit: "個", note: `[R42-R45] 本立面門片與屜頭斜把加工數合計${qty}`, groupId });
  }

  const mixedDirections = mixedDoorDirectionsBySpec(input.cabinets || []);
  const materials = mergeCuts(result.materials.map((row) => ({
    ...row,
    item: row.item === "固格" ? "固格板"
      : row.item === "前後抽牆" ? "前抽牆"
        : row.item === "內抽前後抽牆" ? "內抽前抽牆"
          : row.item === "前上擋板" ? "擋板"
            : row.item,
  }))).map((row) => {
    const direction = row.item === "4E門板" ? mixedDirections.get(`${row.groupId || "GLOBAL"}|${row.spec}`) : undefined;
    if (!direction || row.qty < 3 || direction.left <= 0 || direction.right <= 0 || direction.left + direction.right !== row.qty) return row;
    const summary = `${direction.left}左、${direction.right}右`;
    return { ...row, note: row.note.includes(summary) ? row.note : `${row.note}／${summary}` };
  });
  const hardware = mergeHardware(result.hardware.map((row) => {
    const slide = row.item.match(/^三節滑軌\s+(\d+)$/);
    if (slide) return { ...row, item: `${Math.round(Number(slide[1]) / 10)}滑軌` };
    if (/^(?:35)?伸縮衣(?:架|桿)$/.test(row.item.trim())) return { ...row, item: "35伸縮衣桿", unit: row.unit || "支" };
    return row;
  }));
  rewriteMergedDoorHardwareNotes(input.cabinets || [], hardware);
  const materialHandleCount = materials.reduce((total, row) => {
    if (row.item !== "4E門板" && row.item !== "屜頭") return total;
    const matches = row.note.match(/(?:上斜把|下斜把|長斜把)(?:×(\d+))?/g) || [];
    if (!matches.length) return total;
    return total + matches.reduce((sum, match) => sum + n(match.match(/×(\d+)/)?.[1] ? Number(match.match(/×(\d+)/)?.[1]) : row.qty), 0);
  }, 0);
  const hardwareHandleCount = hardware.filter((row) => row.item === "斜手把").reduce((sum, row) => sum + n(row.qty), 0);
  const markerNote = slantedHandleConsistencyNote(input.slantedHandleMarkerEvidence, materialHandleCount, hardwareHandleCount);
  const doorHardwareNote = doorHardwareClosureNote(input.cabinets || [], materials, hardware, materialHandleCount, slantedHandleCount);
  return {
    materials: materials.map(({ groupId: _groupId, ...row }) => row),
    hardware: hardware.map(({ groupId: _groupId, ...row }) => row),
    notes: [...new Set([...result.notes, ...(markerNote ? [markerNote] : []), ...(doorHardwareNote ? [doorHardwareNote] : [])])],
  };
}
