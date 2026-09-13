import { drawerDowelsPerDrawerForDepth, QUANTITY, QUANTITY_RULES } from "./quantity-rules.ts";
import { doorCountEvidenceIsClosed, doorIsReadyForHardware } from "./door-recognition.ts";
import { hingesPerDoorForFinishedHeight } from "./hinge-rules.ts";
import type { AnalysisForSop, CabinetRead } from "./sop.ts";
import {
  calculateMiddleDividerDimensions,
  resolveBackStripQuantity,
  resolveBaffleHeight,
  resolveBoardProfile,
  resolveDoorFinishedHeight,
  resolvedFootState,
  fullHeightMiddleDividerCount,
} from "./sop.ts";

export type QuantityAuditStatus = "automatic" | "confirmed" | "needs_input" | "conflict";

export type QuantityAuditRow = {
  id: string;
  scope: string;
  item: string;
  current: string;
  expected: string;
  difference: string;
  status: QuantityAuditStatus;
  detail: string;
  ruleIds: string[];
};

export const QUANTITY_AUDIT_COVERAGE: Record<string, string> = Object.freeze({
  Q01: "每桶側板",
  Q02: "每桶頂板與底板",
  Q03: "每桶背板",
  Q04: "一般落地櫃背條",
  Q05: "吊櫃與特殊櫃背條",
  Q06: "KD",
  Q07: "抽木榫（桶身連接）",
  Q08: "調整腳",
  Q09: "白固格器",
  Q10: "活格利",
  Q11: "中立板固格器",
  Q12: "4E門片",
  Q13: "GS鉸鍊",
  Q14: "油壓器",
  Q15: "斜把加工備註",
  Q16: "J型手把",
  Q17: "三節滑軌",
  Q18: "前後抽牆",
  Q19: "邊抽牆",
  Q20: "抽底板",
  Q21: "內抽抽補板",
  Q22: "抽木榫",
  Q23: "鏡珠",
  Q24: "斜把擋板",
  Q25: "踢腳板",
  Q26: "特殊五金",
  Q27: "獨立封板／板件",
  Q28: "抽屜總數閉合",
  Q29: "內抽數量閉合",
  Q30: "並排抽中立板",
});

const n = (value: number | undefined) => Math.max(0, Math.round(Number(value) || 0));
const label = (cabinet: CabinetRead) => cabinet.id || cabinet.name || "未命名桶身";
const diffText = (current: number, expected: number, unit: string) => current === expected
  ? `相符（差 0${unit}）`
  : `${current < expected ? "缺" : "多"} ${Math.abs(expected - current)}${unit}`;

function completeDividerCount(cabinet: CabinetRead) {
  const profile = resolveBoardProfile(cabinet);
  return (cabinet.middleDividers || []).filter((divider) => calculateMiddleDividerDimensions(cabinet.depthMm, divider, profile.fixedShelfDepthDeductionMm).complete).length;
}

function requiredDividerCount(cabinet: CabinetRead) {
  return (cabinet.drawerGroups || []).reduce((sum, group) => sum + (group.sideBySide ? Math.max(0, n(group.count) - 1) : 0), 0);
}

function baffleExpectedCount(cabinet: CabinetRead) {
  const groups = new Map<string, number>();
  let singles = 0;
  for (const baffle of cabinet.baffles || []) {
    if (n(baffle.segmentCount) > 1) {
      const groupId = baffle.segmentGroupId || `__missing_${baffle.id}`;
      groups.set(groupId, Math.max(groups.get(groupId) || 0, n(baffle.segmentCount)));
    } else singles += 1;
  }
  return singles + [...groups.values()].reduce((sum, count) => sum + count, 0);
}

function pushCabinetRows(rows: QuantityAuditRow[], cabinet: CabinetRead) {
  const scope = label(cabinet);
  const profile = resolveBoardProfile(cabinet);
  const D = n(cabinet.depthMm);
  const connectorPerBoard = D >= 500 ? QUANTITY.CONNECTORS_PER_TOP_BOTTOM_BOARD_DEEP : QUANTITY.CONNECTORS_PER_TOP_BOTTOM_BOARD_SHALLOW;
  const connectorTotal = connectorPerBoard * (QUANTITY.TOP_BOARDS_PER_CABINET + QUANTITY.BOTTOM_BOARDS_PER_CABINET);
  const baseId = `${scope.replaceAll(" ", "-")}-${rows.length}`;
  const add = (row: Omit<QuantityAuditRow, "id" | "scope">) => rows.push({ id: `${baseId}-${rows.length}`, scope, ...row });

  add({ item: "側板", current: "後端建立 2片", expected: "每個獨立桶身 2片", difference: "相符（差 0片）", status: "automatic", detail: "共側板註記也不減量。", ruleIds: ["Q01"] });
  add({ item: "頂板／底板", current: "頂板1片／底板1片", expected: "每桶各1片", difference: "相符（差 0片）", status: "automatic", detail: "若斜把成立，只改相關橫板深度，不改片數。", ruleIds: ["Q02"] });
  add({ item: "背板", current: "後端建立 1片", expected: "每桶1片", difference: "相符（差 0片）", status: "automatic", detail: `規格固定用(W-${profile.backWidthDeductionMm})×(H-${profile.backHeightDeductionMm})。`, ruleIds: ["Q03"] });

  const strip = resolveBackStripQuantity(cabinet);
  if (strip.count === null || strip.count > 0) add({
    item: "背條",
    current: strip.count === null ? "未知（不是0支）" : `${strip.count}支`,
    expected: strip.explanation,
    difference: strip.count === null ? "待補實際數量" : "已按最新級距／圖面閉合",
    status: strip.count === null ? "needs_input" : strip.basis === "special_confirmed" ? "confirmed" : "automatic",
    detail: "一般落地櫃不再跟固格數；H≤1200為0、1200<H≤1800為1、H>1800為2。",
    ruleIds: strip.basis === "height_tier" ? ["Q04"] : ["Q05"],
  });

  add({ item: "KD", current: `${connectorTotal}個`, expected: `頂／底共2片 × 每片${connectorPerBoard}個`, difference: "相符（差 0個）", status: "automatic", detail: D >= 500 ? "D≥500，每片6個。" : "D<500，每片4個。", ruleIds: ["Q06"] });
  add({ item: "抽木榫（桶身連接）", current: `${connectorTotal}個`, expected: `必須等於KD ${connectorTotal}個`, difference: "相符（差 0個）", status: "automatic", detail: "規則計算與抽屜木榫分開，最終料單同品項合併。", ruleIds: ["Q07"] });

  const foot = resolvedFootState(cabinet);
  const hanging = cabinet.isHanging || cabinet.cabinetKind === "hanging";
  const supportFeet = fullHeightMiddleDividerCount(cabinet) * QUANTITY.SUPPORT_FEET_PER_FULL_HEIGHT_MIDDLE_DIVIDER;
  const footQty = foot === "present" ? QUANTITY.FEET_PER_FLOOR_CABINET + supportFeet : 0;
  const footModel = cabinet.footHeightMm > 120 ? "A12" : cabinet.footHeightMm > 0 ? "A10" : "型號待定";
  if (!hanging && foot !== "absent") add({
    item: "調整腳",
    current: foot === "unknown" ? "未知（不是0支）" : `${footQty}支${footQty ? `／${footModel}` : ""}`,
    expected: hanging ? "吊櫃0個" : `落地櫃基本4個${supportFeet ? `＋全高中立支撐${supportFeet}個` : ""}；≤120用A10，>120用A12`,
    difference: foot === "unknown" ? "待回答有／無" : foot === "present" && !(cabinet.footHeightMm > 0) ? "數量已知，型號待腳高" : "已閉合",
    status: foot === "unknown" || (foot === "present" && !(cabinet.footHeightMm > 0)) ? "needs_input" : "confirmed",
    detail: "獨立封板不計腳；從頂板直達底板的全高中立每片在底板下另加1個支撐腳。",
    ruleIds: ["Q08"],
  });

  const fixed = n(cabinet.fixedShelves);
  if (fixed > 0) add({ item: "固格／固格器", current: `固格${fixed}片／固格器${fixed * QUANTITY.FIXED_SHELF_FITTINGS_PER_BOARD}個`, expected: `圖面固格逐片 × 每片4個固格器`, difference: "片數與五金已連動", status: "automatic", detail: "固格位置F量至中心線9mm；數量以圖面逐片盤點。", ruleIds: ["Q09"] });
  const adjustable = n(cabinet.adjustableShelves);
  if (adjustable > 0) add({ item: "活格板／活格利", current: `活格板${adjustable}片／活格利${adjustable * QUANTITY.ADJUSTABLE_SHELF_PINS_PER_BOARD}個`, expected: `圖面活格板逐片 × 每片4個`, difference: "片數與五金已連動", status: "automatic", detail: `現行公式D-${profile.adjustableShelfDepthDeductionMm}、W-${profile.adjustableShelfWidthDeductionMm}；D-44停用。`, ruleIds: ["Q10"] });

  const requiredDividers = requiredDividerCount(cabinet);
  const detectedDividers = (cabinet.middleDividers || []).length;
  const completeDividers = completeDividerCount(cabinet);
  const dividerNeedsInput = requiredDividers > completeDividers || detectedDividers !== completeDividers || (cabinet.sideBySideDrawers && !(cabinet.drawerGroups || []).length);
  const dividerConflict = completeDividers > requiredDividers && requiredDividers >= 0;
  if (requiredDividers > 0 || detectedDividers > 0 || cabinet.sideBySideDrawers) add({
    item: "中立板／固格器",
    current: `辨識${detectedDividers}片／尺寸完整${completeDividers}片／固格器${completeDividers * QUANTITY.MIDDLE_DIVIDER_FITTINGS_PER_BOARD}個`,
    expected: requiredDividers || cabinet.sideBySideDrawers ? `各並排組N−1，合計應有${requiredDividers || "待讀"}片；每片4個固格器` : "本桶無並排抽，應有0片",
    difference: requiredDividers || detectedDividers ? diffText(completeDividers, requiredDividers, "片") : "相符（差 0片）",
    status: dividerConflict ? "conflict" : dividerNeedsInput ? "needs_input" : completeDividers ? "automatic" : "confirmed",
    detail: "中立只做到實際分隔區；高度按上、下接點各扣18或中心線9，不套H−36。",
    ruleIds: ["Q11", "Q30"],
  });

  const doors = (cabinet.doors || []).filter((door) => door.type === "4E");
  const doorCount = doors.reduce((sum, door) => sum + n(door.count), 0);
  const doorCountKnown = doors.length > 0 && doors.every(doorCountEvidenceIsClosed);
  const hardwareDoors = doorCountKnown ? doors.filter(doorIsReadyForHardware) : [];
  const allDoorsReadyForHardware = doors.length > 0 && hardwareDoors.length === doors.length;
  const directionPending = doors.some((door) => door.count > 0 && door.direction === "unknown");
  if (doors.length > 0) add({
    item: "4E門片",
    current: doorCountKnown ? `${doorCount}片` : doorCount > 0 ? `至少${doorCount}片` : "片數待確認",
    expected: "門面葉片內每個<或>=1片",
    difference: doors.length && !doorCountKnown ? "片數依據待補" : "片數已閉合",
    status: doors.length && !doorCountKnown ? "needs_input" : "confirmed",
    detail: directionPending ? "清楚符號先鎖片數；開向資料不完整另列提醒，不會把已讀到的門片歸零。" : "片數與開向只依<／>；尺寸另行核對，不會反向取消門片。",
    ruleIds: ["Q12"],
  });

  const hingeGroups = new Map<number, { doors: number }>();
  for (const door of hardwareDoors) {
    const height = resolveDoorFinishedHeight(door);
    const group = hingeGroups.get(height) || { doors: 0 };
    group.doors += n(door.count);
    hingeGroups.set(height, group);
  }
  if (hingeGroups.size) {
    for (const [height, group] of [...hingeGroups.entries()].sort(([a], [b]) => a - b)) {
      const perDoor = hingesPerDoorForFinishedHeight(height);
      add({
        item: `鉸鍊${height ? `（門高${height}mm）` : "（門高待確認）"}`,
        current: perDoor ? `${group.doors}片門 × ${perDoor}顆 = ${group.doors * perDoor}顆` : "完成門高待確認",
        expected: "正式公式：<960=2、960–1599=3、1600–2239=4、≥2240=5顆／片",
        difference: perDoor ? "已由正式公式閉合" : "缺完成門高",
        status: perDoor ? "automatic" : "needs_input",
        detail: "依公式防錯確認版工作簿「自動拆料V2_單櫃」H16自動計算，不向使用者猜問顆數。",
        ruleIds: ["Q13"],
      });
    }
  }

  if (allDoorsReadyForHardware) add({ item: "油壓器", current: `${doorCount * QUANTITY.DAMPERS_PER_STANDARD_DOOR}個`, expected: `${doorCount}片普通門 × 每片1個`, difference: "相符（差 0個）", status: "automatic", detail: "門片數、門型與完成尺寸確認後才列；特殊門型另依圖面。", ruleIds: ["Q14"] });
  const readyDoorCount = hardwareDoors.reduce((sum, door) => sum + n(door.count), 0);
  const slantedHandles = hardwareDoors.reduce((sum, door) => sum + n(door.slantedHandleCount), 0) + (cabinet.drawerGroups || []).filter((group) => group.slantedHandle).reduce((sum, group) => sum + n(group.count), 0);
  const slantedMaximum = readyDoorCount + (cabinet.drawerGroups || []).reduce((sum, group) => sum + n(group.count), 0);
  const hasSlantedOpening = slantedHandles > 0 || hardwareDoors.some((door) => door.slantedHandle) || (cabinet.drawerGroups || []).some((group) => group.slantedHandle);
  if (hasSlantedOpening) add({ item: "斜手把", current: slantedHandles > 0 ? `${slantedHandles}個` : "片數待確認", expected: "實際加工4E門片＋屜頭逐片註記，並以相同總數列斜手把五金", difference: slantedHandles <= slantedMaximum && slantedHandles > 0 ? "備註片數與五金來源已閉合" : slantedHandles > slantedMaximum ? `多${slantedHandles - slantedMaximum}片` : "已辨識斜把加工，片數待補", status: slantedHandles > slantedMaximum ? "conflict" : slantedHandles > 0 ? "confirmed" : "needs_input", detail: "上門、下門與屜頭都要逐片註記；完整模式的斜手把五金數量必須等於這個加工總數。", ruleIds: ["Q15"] });
  const jHandles = hardwareDoors.reduce((sum, door) => sum + n(door.jHandleCount), 0);
  if (jHandles > 0) add({ item: "J型手把", current: `${jHandles}支`, expected: "實際J把加工門片逐片計", difference: jHandles <= readyDoorCount ? "數量未超過門片" : `多${jHandles - readyDoorCount}支`, status: jHandles <= readyDoorCount ? "confirmed" : "conflict", detail: directionPending ? "J把有加工方向需求，開向仍需補。" : "需保留起開位置與開向註記。", ruleIds: ["Q16"] });

  const declaredDrawers = n(cabinet.drawerCount);
  const groupedDrawers = (cabinet.drawerGroups || []).reduce((sum, group) => sum + n(group.count), 0);
  const hasDrawers = declaredDrawers > 0 || groupedDrawers > 0 || (cabinet.drawerGroups || []).length > 0;
  const drawerClosed = declaredDrawers === groupedDrawers;
  if (hasDrawers) add({ item: "抽屜總數", current: `桶身${declaredDrawers}抽／逐組${groupedDrawers}抽`, expected: "兩者必須完全相同", difference: diffText(groupedDrawers, declaredDrawers, "抽"), status: drawerClosed ? "confirmed" : "conflict", detail: "未知數量不能填0假裝沒有。", ruleIds: ["Q28"] });
  const declaredInner = n(cabinet.innerDrawerCount);
  const groupedInner = (cabinet.drawerGroups || []).filter((group) => group.isInner).reduce((sum, group) => sum + n(group.count), 0);
  const hasInnerDrawers = declaredInner > 0 || groupedInner > 0 || (cabinet.drawerGroups || []).some((group) => group.isInner);
  const innerClosed = declaredInner === groupedInner && declaredInner <= declaredDrawers;
  if (hasInnerDrawers) add({ item: "內抽總數", current: `桶身${declaredInner}抽／逐組${groupedInner}抽`, expected: `兩者相同且不得大於總抽${declaredDrawers}`, difference: innerClosed ? "相符（差 0抽）" : "數量未閉合", status: innerClosed ? "confirmed" : "conflict", detail: "每個內抽另有4片抽補板。", ruleIds: ["Q29"] });

  const derivedStatus: QuantityAuditStatus = drawerClosed && innerClosed ? "automatic" : "needs_input";
  if (hasDrawers) {
    add({ item: "三節滑軌", current: `${groupedDrawers}組`, expected: `${groupedDrawers}抽 × 每抽1組（1組=左右各1支）`, difference: drawerClosed ? "相符（差 0組）" : "先閉合抽屜總數", status: derivedStatus, detail: "單位固定用組，不用支。", ruleIds: ["Q17"] });
    add({ item: "前後抽牆", current: `${groupedDrawers * QUANTITY.FRONT_BACK_WALLS_PER_DRAWER}片`, expected: `${groupedDrawers}抽 × 每抽2片`, difference: drawerClosed ? "相符（差 0片）" : "先閉合抽屜總數", status: derivedStatus, detail: "抽牆高由完成屜頭高固定套級距：≤200用100；201–239用120；≥240用180。", ruleIds: ["Q18", "R67"] });
    add({ item: "邊抽牆", current: `${groupedDrawers * QUANTITY.SIDE_WALLS_PER_DRAWER}片`, expected: `${groupedDrawers}抽 × 每抽2片`, difference: drawerClosed ? "相符（差 0片）" : "先閉合抽屜總數", status: derivedStatus, detail: "深度由標準滑軌級距決定。", ruleIds: ["Q19"] });
    add({ item: "抽底板", current: `${groupedDrawers * QUANTITY.BOTTOMS_PER_DRAWER}片`, expected: `${groupedDrawers}抽 × 每抽1片`, difference: drawerClosed ? "相符（差 0片）" : "先閉合抽屜總數", status: derivedStatus, detail: "規格固定寬×深。", ruleIds: ["Q20"] });
    const dowelsPerDrawer = drawerDowelsPerDrawerForDepth(D);
    add({ item: "抽木榫", current: `${groupedDrawers * dowelsPerDrawer}顆`, expected: `${groupedDrawers}抽 × 每抽${dowelsPerDrawer}顆`, difference: drawerClosed ? "相符（差 0顆）" : "先閉合抽屜總數", status: derivedStatus, detail: D >= 500 ? "D≥500每抽4顆。" : "D<500每抽12顆。", ruleIds: ["Q22"] });
  }
  if (hasInnerDrawers) add({ item: "內抽抽補板", current: `${groupedInner * QUANTITY.SUPPLEMENT_BOARDS_PER_INNER_DRAWER}片`, expected: `${groupedInner}內抽 × 每抽4片`, difference: innerClosed ? "相符（差 0片）" : "先閉合內抽數", status: derivedStatus, detail: "規格120×(F−27)，F=含頂底至固格中心線。", ruleIds: ["Q21"] });

  const baffles = cabinet.baffles || [];
  const expectedBaffles = baffleExpectedCount(cabinet);
  const baffleIncomplete = baffles.some((baffle) => !resolveBaffleHeight(baffle) || baffle.widthBasis === "unknown" || (n(baffle.segmentCount) > 1 && !baffle.segmentGroupId));
  const baffleMissing = hasSlantedOpening && baffles.length === 0;
  const baffleMismatch = baffles.length !== expectedBaffles;
  if (baffles.length > 0 || hasSlantedOpening) add({
    item: "斜把擋板",
    current: baffles.length ? `${baffles.length}支實體` : "0支",
    expected: baffles.length ? `依分段資料應有${expectedBaffles}支；每個需要擋板的開口1支` : hasSlantedOpening ? "已辨識斜把加工，擋板開口數待確認" : "目前無斜把開口",
    difference: baffleMissing ? "缺擋板數量／鎖附位置" : baffleMismatch ? diffText(baffles.length, expectedBaffles, "支") : baffleIncomplete ? "支數已讀，尺寸或鎖附位置待補" : "已閉合",
    status: baffleMismatch ? "conflict" : baffleMissing || baffleIncomplete ? "needs_input" : "confirmed",
    detail: baffles.length ? baffles.map((baffle, index) => `第${index + 1}支：${resolveBaffleHeight(baffle) || "?"}mm`).join("；") : "鎖固格／上升底板通常60mm；純門斜把且確認門櫃擋板才50mm。",
    ruleIds: ["Q24"],
  });
}

export function buildQuantityAudit(input: AnalysisForSop): QuantityAuditRow[] {
  const rows: QuantityAuditRow[] = [];
  for (const cabinet of input.cabinets || []) pushCabinetRows(rows, cabinet);

  const addGlobal = (row: Omit<QuantityAuditRow, "id" | "scope">) => rows.push({ id: `global-${rows.length}`, scope: "全案", ...row });
  const mirrorCount = (input.mirrors || []).reduce((sum, mirror) => sum + n(mirror.count), 0);
  if ((input.mirrors || []).length > 0) addGlobal({ item: "明鏡／鏡珠", current: mirrorCount > 0 ? `${mirrorCount}面／${mirrorCount * QUANTITY.MIRROR_BEADS_PER_MIRROR}顆` : "面數待確認", expected: "每面明鏡4顆鏡珠", difference: mirrorCount > 0 ? "片數與五金已連動" : "已辨識明鏡，面數待補", status: mirrorCount > 0 ? "automatic" : "needs_input", detail: "鏡子本體不列cabinet，但鏡珠不能漏。", ruleIds: ["Q23"] });

  const siteLength = (input.kickboards || []).reduce((sum, kickboard) => sum + n(kickboard.siteLengthMm), 0);
  const kickboardPieces = (input.kickboards || []).reduce((sum, kickboard) => {
    const length = n(kickboard.siteLengthMm);
    if (!length) return sum;
    return sum + Math.floor(length / 2800) + (length % 2800 ? 1 : 0);
  }, 0);
  if ((input.kickboards || []).length > 0) addGlobal({ item: "踢腳板", current: `${(input.kickboards || []).length}段現場長／${kickboardPieces}支料`, expected: siteLength ? `標準120×2800；總現場長${siteLength}mm，最後餘長固定加500mm` : "現場長度待確認", difference: siteLength ? "已依每段現場長換算" : "已辨識踢腳板，長度待補", status: siteLength ? "automatic" : "needs_input", detail: "不可直接把現場總寬當標準下料長；500mm是固定修正空間。", ruleIds: ["Q25"] });

  const hardware = input.specialHardware || [];
  const incompleteHardware = hardware.filter((item) => item.item && (!(item.qty > 0) || !item.unit));
  if (hardware.length > 0) addGlobal({ item: "特殊五金", current: hardware.map((item) => `${item.item || "未命名"}${item.qty > 0 ? `×${n(item.qty)}${item.unit}` : "×數量待確認"}`).join("；"), expected: "圖面每一項逐數列入", difference: incompleteHardware.length ? `${incompleteHardware.length}項待補數量／單位` : "已閉合", status: incompleteHardware.length ? "needs_input" : "confirmed", detail: "伸縮衣桿、拉盤等不可因沒有板料而省略。", ruleIds: ["Q26"] });

  const panels = input.independentPanels || [];
  const incompletePanels = panels.filter((panel) => !(panel.count > 0 && panel.widthMm > 0 && panel.heightMm > 0));
  if (panels.length > 0) addGlobal({ item: "獨立封板／板件", current: panels.map((panel) => `${panel.id || panel.name}:${panel.count > 0 ? `${n(panel.count)}片` : "片數待確認"}`).join("；"), expected: "每一實體板件依圖面逐片", difference: incompletePanels.length ? `${incompletePanels.length}項待補片數或尺寸` : "已閉合", status: incompletePanels.length ? "needs_input" : "confirmed", detail: "獨立封板不併桶身，也不計調整腳。", ruleIds: ["Q27"] });

  return rows;
}

export function quantityAuditCoverageIsComplete() {
  const expected = QUANTITY_RULES.map((rule) => rule.id).sort();
  const mapped = Object.keys(QUANTITY_AUDIT_COVERAGE).sort();
  return expected.length === mapped.length && expected.every((id, index) => id === mapped[index]);
}

const PRIMARY_BLOCKING_RULES = new Set(["Q05", "Q08", "Q24", "Q26", "Q27", "Q28", "Q29", "Q30"]);

export function buildQuantityAuditBlockers(rows: QuantityAuditRow[]) {
  return rows
    .filter((row) => (row.status === "needs_input" || row.status === "conflict") && row.ruleIds.some((id) => PRIMARY_BLOCKING_RULES.has(id)))
    .map((row) => `[${row.item}數量對照] ${row.scope}：目前${row.current}；SOP應為${row.expected}；差異：${row.difference}。`);
}
