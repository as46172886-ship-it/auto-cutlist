import type { CabinetRead } from "./sop.ts";
import { resolveBackStripQuantity } from "./sop.ts";
import { doorCountEvidenceIsClosed } from "./door-recognition.ts";

const n = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));

export function cabinetQuantitySummary(cabinet: CabinetRead) {
  const items = ["側板 2片", "頂板 1片", "底板 1片", "背板 1片"];
  const strip = resolveBackStripQuantity(cabinet);
  if (strip.count === null) items.push("背條 待確認");
  else if (strip.count > 0) items.push(`背條 ${strip.count}支`);

  if (n(cabinet.fixedShelves) > 0) items.push(`固格 ${n(cabinet.fixedShelves)}片`);
  if (n(cabinet.adjustableShelves) > 0) items.push(`活格 ${n(cabinet.adjustableShelves)}片`);
  if (n(cabinet.drawerCount) > 0 || (cabinet.drawerGroups || []).length > 0) {
    const drawers = Math.max(n(cabinet.drawerCount), (cabinet.drawerGroups || []).reduce((sum, group) => sum + n(group.count), 0));
    items.push(drawers > 0 ? `抽屜 ${drawers}抽` : "抽屜 待確認");
  }
  if ((cabinet.middleDividers || []).length > 0) items.push(`中立 ${cabinet.middleDividers.length}片`);

  const doors = (cabinet.doors || []).filter((door) => door.type === "4E");
  const doorCount = doors.reduce((sum, door) => sum + n(door.count), 0);
  const doorCountClosed = doors.length > 0 && doors.every(doorCountEvidenceIsClosed);
  if (doors.length > 0) items.push(doorCountClosed ? `4E門 ${doorCount}片` : "4E門 待確認");
  if ((cabinet.baffles || []).length > 0) items.push(`擋板 ${cabinet.baffles.length}支`);

  return items;
}
