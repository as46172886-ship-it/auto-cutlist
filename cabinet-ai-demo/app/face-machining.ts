import { doorIsReadyForHardware, lockableDoorRead } from "./door-recognition.ts";
import type { AnalysisForSop, BaffleRead, CabinetRead, DoorRead } from "./sop.ts";
import type { CabinetCropInput } from "./segmentation.ts";

type RecordValue = Record<string, unknown>;
type FaceSourceType = "drawer" | "door";

type ValidFaceEffect = {
  raw: RecordValue;
  sourceType: FaceSourceType;
  sourceIndex: number;
  openingId: string;
  targetBoard: "top" | "bottom" | "none";
  baffleMount: "none" | "top_board" | "fixed_shelf" | "raised_bottom";
  widthBasis: "cabinet_inner" | "finished_segment" | "unknown";
  widthMm: number;
  segmentIndex: number;
  segmentCount: number;
};

const records = (value: unknown): RecordValue[] => Array.isArray(value)
  ? value.filter((item): item is RecordValue => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  : [];

const integer = (value: unknown) => Number.isInteger(Number(value)) ? Number(value) : -1;

function sourceCropNames(cabinetId: string, crops: CabinetCropInput[]) {
  return new Set(crops.filter((crop) => crop.cabinetId === cabinetId
    && (crop.scanPass || 1) === 1
    && ["internal", "front", "door"].includes(crop.role)).map((crop) => crop.name));
}

function hasSource(item: RecordValue, allowedCropNames: Set<string>) {
  return allowedCropNames.has(String(item.cropName || "")) && Boolean(String(item.evidence || "").trim());
}

function doorsForRead(read: RecordValue, cabinet: CabinetRead) {
  const resolved = lockableDoorRead(read);
  return (resolved.status === "confirmed_4e" ? resolved.doors : (cabinet.doors || [])) as DoorRead[];
}

function validateFaceRead(read: RecordValue, cabinet: CabinetRead, crops: CabinetCropInput[]) {
  const issues: string[] = [];
  const allowedCropNames = sourceCropNames(cabinet.id, crops);
  if (String(read.cabinetId || "") !== cabinet.id) issues.push("桶身ID不一致");
  if (!allowedCropNames.size) issues.push("缺第一輪門面或桶內原圖");

  const drawerHandles = records(read.drawerHandles);
  const confirmedSlantedSources = new Set<string>();
  const knownFaceSources = new Set<string>();
  cabinet.drawerGroups.forEach((group, index) => {
    const observations = drawerHandles.filter((item) => String(item.drawerGroupId || "") === group.id);
    const item = observations.length === 1 ? observations[0] : undefined;
    if (!item || !hasSource(item, allowedCropNames)) {
      issues.push(`屜頭${group.id}缺唯一原圖判讀`);
      return;
    }
    const status = String(item.status || "");
    const style = String(item.style || "");
    if (status !== "plain" && status !== "slanted") {
      issues.push(`屜頭${group.id}斜把狀態未確認`);
      return;
    }
    if ((status === "slanted" && !["top", "bottom", "long"].includes(style))
      || (status === "plain" && style !== "none")) {
      issues.push(`屜頭${group.id}斜把樣式不完整`);
      return;
    }
    const sourceKey = `drawer:${index}`;
    knownFaceSources.add(sourceKey);
    if (status === "slanted") confirmedSlantedSources.add(sourceKey);
  });
  for (const item of drawerHandles) {
    if (!(cabinet.drawerGroups || []).some((group) => group.id === String(item.drawerGroupId || ""))) {
      issues.push(`出現不屬於${cabinet.id}的屜頭判讀`);
    }
  }

  const doors = doorsForRead(read, cabinet);
  doors.forEach((door, index) => {
    const sourceKey = `door:${index}`;
    knownFaceSources.add(sourceKey);
    if (door.slantedHandle && doorIsReadyForHardware(door)) confirmedSlantedSources.add(sourceKey);
  });

  const preliminary: ValidFaceEffect[] = [];
  for (const raw of records(read.machining)) {
    const sourceType = String(raw.sourceType || "") as FaceSourceType;
    const sourceIndex = integer(raw.sourceIndex);
    const sourceKey = `${sourceType}:${sourceIndex}`;
    const openingId = String(raw.openingId || "").trim();
    const targetBoard = String(raw.targetBoard || "") as ValidFaceEffect["targetBoard"];
    const baffleMount = String(raw.baffleMount || "") as ValidFaceEffect["baffleMount"];
    const widthBasis = String(raw.widthBasis || "") as ValidFaceEffect["widthBasis"];
    const widthMm = integer(raw.widthMm);
    const segmentIndex = integer(raw.segmentIndex);
    const segmentCount = integer(raw.segmentCount);
    const hasBaffle = baffleMount !== "none";

    if (!confirmedSlantedSources.has(sourceKey) || !knownFaceSources.has(sourceKey)) {
      issues.push(`${openingId || "未命名開口"}沒有對應的已確認斜把門／屜頭`);
      continue;
    }
    if (!hasSource(raw, allowedCropNames)) {
      issues.push(`${openingId || "未命名開口"}缺第一輪原圖證據`);
      continue;
    }
    if (!openingId || !["top", "bottom", "none"].includes(targetBoard)
      || !["none", "top_board", "fixed_shelf", "raised_bottom"].includes(baffleMount)
      || (targetBoard === "none" && baffleMount === "none")) {
      issues.push(`${openingId || "未命名開口"}的退縮／擋板位置不完整`);
      continue;
    }
    if (segmentIndex < 1 || segmentCount < 1 || segmentIndex > segmentCount) {
      issues.push(`${openingId}的擋板分段編號不完整`);
      continue;
    }
    if (hasBaffle && widthBasis === "cabinet_inner"
      && ((cabinet.middleDividers || []).length > 0 || segmentIndex !== 1 || segmentCount !== 1)) {
      issues.push(`${openingId}跨越中立或錯用整桶內寬`);
      continue;
    }
    if (hasBaffle && widthBasis === "finished_segment"
      && (!(widthMm > 0) || widthMm > cabinet.widthMm)) {
      issues.push(`${openingId}缺可用的完成分段寬`);
      continue;
    }
    if (hasBaffle && !["cabinet_inner", "finished_segment"].includes(widthBasis)) {
      issues.push(`${openingId}缺擋板寬度基準`);
      continue;
    }
    preliminary.push({ raw, sourceType, sourceIndex, openingId, targetBoard, baffleMount, widthBasis, widthMm, segmentIndex, segmentCount });
  }

  const validEffects: ValidFaceEffect[] = [];
  const byOpening = new Map<string, ValidFaceEffect[]>();
  for (const effect of preliminary) {
    const key = `${effect.sourceType}:${effect.sourceIndex}:${effect.openingId}`;
    const current = byOpening.get(key);
    if (current) current.push(effect);
    else byOpening.set(key, [effect]);
  }
  for (const effects of byOpening.values()) {
    const first = effects[0];
    const indices = effects.map((effect) => effect.segmentIndex);
    const expected = Array.from({ length: first.segmentCount }, (_, index) => index + 1);
    const sameSeries = effects.every((effect) => effect.segmentCount === first.segmentCount
      && effect.targetBoard === first.targetBoard
      && effect.baffleMount === first.baffleMount
      && effect.widthBasis === first.widthBasis);
    const completeSeries = sameSeries && effects.length === first.segmentCount
      && [...indices].sort((a, b) => a - b).every((value, index) => value === expected[index]);
    if (!completeSeries || (first.segmentCount > 1 && (first.baffleMount === "none" || first.widthBasis !== "finished_segment"))) {
      issues.push(`${first.openingId}的擋板分段不是完整的1至${first.segmentCount}`);
      continue;
    }
    validEffects.push(...effects.sort((a, b) => a.segmentIndex - b.segmentIndex));
  }

  const covered = new Set(validEffects.map((effect) => `${effect.sourceType}:${effect.sourceIndex}`));
  for (const sourceKey of confirmedSlantedSources) {
    if (!covered.has(sourceKey)) issues.push(`${sourceKey}已確認斜把但缺退縮／擋板位置`);
  }

  return {
    issues: [...new Set(issues)],
    validEffects,
    drawerHandles,
    allowedCropNames,
  };
}

// The first calculation is a plain carcass/internal baseline. Face-dependent
// retreat, baffles and handle flags are deliberately cleared until the actual
// doors and drawer fronts have each been checked. Fixed-shelf counts and their
// normal dimensions remain untouched; this iteration does not infer a
// face-dependent fixed-shelf retreat.
export function prepareCarcassStage<T extends AnalysisForSop>(analysis: T): T {
  return { ...analysis, cabinets: analysis.cabinets.map((cabinet) => ({
    ...cabinet,
    topBoardRetreatMm: 0,
    bottomBoardRetreatMm: 0,
    slantedFixedShelfCount: 0,
    baffles: [],
    drawerGroups: (cabinet.drawerGroups || []).map((group) => ({ ...group, slantedHandle: false })),
  })) };
}

export function faceMachiningReadIssues(read: RecordValue, cabinet: CabinetRead, crops: CabinetCropInput[]) {
  return validateFaceRead(read, cabinet, crops).issues;
}

export function faceMachiningReadIsComplete(read: RecordValue, cabinet: CabinetRead, crops: CabinetCropInput[]) {
  return faceMachiningReadIssues(read, cabinet, crops).length === 0;
}

// Score only breaks ties between candidates with the same locked door facts.
export function faceMachiningReadScore(read: RecordValue, cabinet: CabinetRead, crops: CabinetCropInput[]) {
  const validation = validateFaceRead(read, cabinet, crops);
  if (!validation.issues.length) return 99;
  const resolvedDrawers = cabinet.drawerGroups.filter((group) => validation.drawerHandles.some((item) =>
    String(item.drawerGroupId || "") === group.id && hasSource(item, validation.allowedCropNames)
    && ["plain", "slanted"].includes(String(item.status || "")))).length;
  return Math.min(98, resolvedDrawers * 10 + validation.validEffects.length * 5);
}

export function applyFaceMachining<T extends AnalysisForSop & { warnings?: unknown }>(
  analysis: T,
  reads: RecordValue[],
  crops: CabinetCropInput[],
): T {
  const warnings = Array.isArray(analysis.warnings) ? [...analysis.warnings] : [];
  const cabinets = analysis.cabinets.map((source) => {
    const cabinet: CabinetRead = {
      ...source,
      topBoardRetreatMm: 0,
      bottomBoardRetreatMm: 0,
      slantedFixedShelfCount: 0,
      baffles: [],
      drawerGroups: (source.drawerGroups || []).map((group) => ({ ...group, slantedHandle: false })),
    };
    const matches = reads.filter((read) => read.cabinetId === cabinet.id);
    if (matches.length !== 1) {
      warnings.push(`${cabinet.id}缺少唯一的門／屜頭加工核對，退縮與擋板尚未完成。`);
      return cabinet;
    }

    const read = matches[0];
    const validation = validateFaceRead(read, cabinet, crops);
    for (const issue of validation.issues) warnings.push(`${cabinet.id}：${issue}。`);

    cabinet.drawerGroups.forEach((group) => {
      const observations = validation.drawerHandles.filter((item) => String(item.drawerGroupId || "") === group.id);
      const item = observations.length === 1 ? observations[0] : undefined;
      if (!item || !hasSource(item, validation.allowedCropNames) || !["slanted", "plain"].includes(String(item.status || ""))) return;
      const style = String(item.style || "");
      if (item.status === "plain" && style === "none") {
        group.slantedHandle = false;
        return;
      }
      if (item.status !== "slanted" || !["top", "bottom", "long"].includes(style)) return;
      group.slantedHandle = true;
      group.evidence = `${style === "top" ? "上斜把" : style === "bottom" ? "下斜把" : "長斜把"}；${String(item.evidence)}`;
    });

    for (const effect of validation.validEffects) {
      if (effect.targetBoard === "top") cabinet.topBoardRetreatMm = 19;
      if (effect.targetBoard === "bottom") cabinet.bottomBoardRetreatMm = 19;
      if (effect.baffleMount === "none") continue;
      const whole = effect.widthBasis === "cabinet_inner";
      const height = effect.baffleMount === "top_board" && effect.sourceType === "door" ? 50 : 60;
      cabinet.baffles.push({
        id: `${cabinet.id}-FACE-${effect.openingId}-${effect.segmentIndex}`,
        heightMm: height,
        widthMm: whole ? 0 : effect.widthMm,
        kind: height === 50 ? "door_50" : "drawer_60",
        mountBasis: effect.baffleMount as BaffleRead["mountBasis"],
        widthBasis: whole ? "cabinet_inner" : "finished_segment",
        splitAtMiddleDivider: effect.segmentCount > 1,
        segmentGroupId: effect.openingId,
        segmentIndex: effect.segmentIndex,
        segmentCount: effect.segmentCount,
        evidence: `${String(effect.raw.cropName)}：${String(effect.raw.evidence)}`,
      });
    }
    return cabinet;
  });
  return { ...analysis, cabinets, warnings: [...new Set(warnings)] };
}
