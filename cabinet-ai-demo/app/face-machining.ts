import { doorIsReadyForHardware } from "./door-recognition.ts";
import type { AnalysisForSop, BaffleRead } from "./sop.ts";
import type { CabinetCropInput } from "./segmentation.ts";

type RecordValue = Record<string, unknown>;
const records = (value: unknown): RecordValue[] => Array.isArray(value)
  ? value.filter((item): item is RecordValue => !!item && typeof item === "object" && !Array.isArray(item)) : [];

// The first stage is a cabinet baseline. Front machining is resolved only
// once the corresponding doors and drawer fronts have been examined.
// Fixed shelves (including their existing deductions) are deliberately frozen.
export function prepareCarcassStage<T extends AnalysisForSop>(analysis: T): T {
  return { ...analysis, cabinets: analysis.cabinets.map((cabinet) => ({
    ...cabinet, topBoardRetreatMm: 0, bottomBoardRetreatMm: 0, baffles: [],
    drawerGroups: (cabinet.drawerGroups || []).map((group) => ({ ...group, slantedHandle: false })),
  })) };
}

export function applyFaceMachining<T extends AnalysisForSop & { warnings?: unknown }>(
  analysis: T, reads: RecordValue[], crops: CabinetCropInput[],
): T {
  const warnings = Array.isArray(analysis.warnings) ? [...analysis.warnings] : [];
  const cabinets = analysis.cabinets.map((source) => {
    const cabinet = { ...source, topBoardRetreatMm: 0, bottomBoardRetreatMm: 0, baffles: [] as BaffleRead[],
      drawerGroups: (source.drawerGroups || []).map((group) => ({ ...group, slantedHandle: false })),
    };
    const matches = reads.filter((read) => read.cabinetId === cabinet.id);
    if (matches.length !== 1) {
      warnings.push(`${cabinet.id}缺少唯一的門／屜頭加工核對，退縮與擋板尚未完成。`);
      return cabinet;
    }
    const read = matches[0];
    const rawCrops = new Set(crops.filter((crop) => crop.cabinetId === cabinet.id
      && (crop.scanPass || 1) === 1 && ["internal", "front", "door"].includes(crop.role)).map((crop) => crop.name));
    const hasSource = (item: RecordValue) => rawCrops.has(String(item.cropName)) && !!String(item.evidence || "").trim();
    const drawerHandles = records(read.drawerHandles);
    const confirmedDrawers = new Set<number>();
    cabinet.drawerGroups.forEach((group, index) => {
      const observations = drawerHandles.filter((item) => item.drawerGroupId === group.id);
      const item = observations.length === 1 ? observations[0] : undefined;
      if (!item || !hasSource(item) || !["slanted", "plain"].includes(String(item.status))) {
        warnings.push(`${cabinet.id}屜頭${group.id}加工尚未看清，保留抽屜尺寸，斜把及相關退縮／擋板待核。`);
        return;
      }
      group.slantedHandle = item.status === "slanted";
      if (group.slantedHandle && !["top", "bottom", "long"].includes(String(item.style))) {
        group.slantedHandle = false;
        warnings.push(`${cabinet.id}屜頭${group.id}斜把樣式未明，相關加工待核。`);
        return;
      }
      if (group.slantedHandle) {
        confirmedDrawers.add(index);
        // Keep the machining label separate from older interpretation text.
        group.evidence = `${item.style === "top" ? "上斜把" : item.style === "bottom" ? "下斜把" : "長斜把"}；${String(item.evidence)}`;
      }
    });
    const effects = records(read.machining);
    const keys = effects.map((item) => String(item.openingId || ""));
    const covered = new Set<string>();
    for (const effect of effects) {
      const index = Number(effect.sourceIndex);
      const door = cabinet.doors?.[index];
      const validSource = Number.isInteger(index) && index >= 0 && (effect.sourceType === "drawer"
        ? confirmedDrawers.has(index)
        : effect.sourceType === "door" && door?.slantedHandle && doorIsReadyForHardware(door));
      const key = String(effect.openingId || "");
      if (!validSource || !hasSource(effect) || !key || keys.filter((value) => value === key).length !== 1
        || !["top", "bottom", "none"].includes(String(effect.targetBoard))
        || !["none", "top_board", "fixed_shelf", "raised_bottom"].includes(String(effect.baffleMount))) {
        warnings.push(`${cabinet.id}有加工項目缺少唯一開口或對應斜把原圖，該項退縮／擋板未套用。`);
        continue;
      }
      const hasBaffle = effect.baffleMount !== "none";
      const whole = effect.widthBasis === "cabinet_inner";
      const width = Number(effect.widthMm);
      if (hasBaffle && ((!whole && (effect.widthBasis !== "finished_segment" || !Number.isInteger(width) || width <= 0))
        || width > cabinet.widthMm || (whole && (cabinet.middleDividers || []).length > 0))) {
        warnings.push(`${cabinet.id}擋板開口${key}需依中立分段或補齊完成寬，該項加工未套用。`);
        continue;
      }
      if (effect.targetBoard === "top") cabinet.topBoardRetreatMm = 19;
      if (effect.targetBoard === "bottom") cabinet.bottomBoardRetreatMm = 19;
      if (hasBaffle) {
        const height = effect.baffleMount === "top_board" && effect.sourceType === "door" ? 50 : 60;
        cabinet.baffles.push({ id: `${cabinet.id}-FACE-${key}`, heightMm: height,
          widthMm: whole ? 0 : width, kind: height === 50 ? "door_50" : "drawer_60",
          mountBasis: effect.baffleMount as BaffleRead["mountBasis"],
          widthBasis: whole ? "cabinet_inner" : "finished_segment", splitAtMiddleDivider: !whole,
          segmentGroupId: key, segmentIndex: 1, segmentCount: 1,
          evidence: `${String(effect.cropName)}：${String(effect.evidence)}`,
        });
      }
      covered.add(`${effect.sourceType}:${index}`);
    }
    for (const index of confirmedDrawers) {
      if (!covered.has(`drawer:${index}`)) warnings.push(`${cabinet.id}屜頭${cabinet.drawerGroups[index].id}斜把已確認，相關退縮／擋板仍缺加工位置核對。`);
    }
    (cabinet.doors || []).forEach((door, index) => {
      if (door.slantedHandle && doorIsReadyForHardware(door) && !covered.has(`door:${index}`)) {
        warnings.push(`${cabinet.id}第${index + 1}組門斜把已確認，相關退縮／擋板仍缺加工位置核對。`);
      }
    });
    return cabinet;
  });
  return { ...analysis, cabinets, warnings: [...new Set(warnings)] };
}
