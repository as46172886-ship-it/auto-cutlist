import type { CabinetCropInput } from "./segmentation.ts";

type NamedImage = { name?: string; dataUrl: string };

// The main cabinet reads are required production evidence. The focused line
// review is supplemental and must never invalidate otherwise complete reads.
export const NON_DOOR_PRIMARY_TIMEOUT_MS = 85_000;
export const NON_DOOR_VERIFY_TIMEOUT_MS = 32_000;
export const NON_DOOR_SCAN_CONCURRENCY = 3;
export const NON_DOOR_CLIENT_BUFFER_MS = 15_000;

export function nonDoorClientTimeoutMs(cabinetCount: number) {
  const count = Math.max(1, Math.ceil(Number(cabinetCount) || 0));
  const batches = Math.ceil(count / NON_DOOR_SCAN_CONCURRENCY);
  return batches * NON_DOOR_PRIMARY_TIMEOUT_MS + NON_DOOR_CLIENT_BUFFER_MS;
}

/**
 * The upload UI accepts six originals. Global independent components can live
 * only on the fifth or sixth sheet, so the global scan must retain all six.
 */
export function selectGlobalNonDoorImages<T extends NamedImage>(originals: T[], overviews: T[]) {
  return [...originals.slice(0, 6), ...overviews.slice(0, 3)];
}

function roundRobinByCabinet(crops: CabinetCropInput[]) {
  const cabinetOrder: string[] = [];
  const byCabinet = new Map<string, CabinetCropInput[]>();
  for (const crop of crops) {
    if (!byCabinet.has(crop.cabinetId)) {
      cabinetOrder.push(crop.cabinetId);
      byCabinet.set(crop.cabinetId, []);
    }
    byCabinet.get(crop.cabinetId)!.push(crop);
  }
  const ordered: CabinetCropInput[] = [];
  for (let index = 0; cabinetOrder.some((id) => index < (byCabinet.get(id)?.length || 0)); index += 1) {
    for (const id of cabinetOrder) {
      const crop = byCabinet.get(id)?.[index];
      if (crop) ordered.push(crop);
    }
  }
  return ordered;
}

/**
 * Keep large drawings bounded while giving every cabinet its internal view
 * before front, dimension and detail references. This prevents later
 * cabinets from disappearing merely because earlier cabinets had more crops.
 */
export function selectStructuralCropsForRequest(all: CabinetCropInput[], limit = 18) {
  const eligible = all
    .filter((crop) => (crop.scanPass || 1) === 1 && crop.role !== "door")
    .filter((crop, index, items) => items.findIndex((candidate) => candidate.name === crop.name) === index);
  const mandatoryCabinetCount = new Set(eligible
    .filter((crop) => crop.role === "internal")
    .map((crop) => crop.cabinetId)).size;
  // The configured limit bounds supplemental views, never the one original
  // internal crop required for each segmented cabinet. Otherwise a drawing
  // with 19+ cabinets can falsely report that its final cabinets have no
  // source image even though the crops were created successfully.
  const safeLimit = Math.max(mandatoryCabinetCount, Math.max(0, Math.floor(limit)));
  const roleTiers: CabinetCropInput["role"][] = ["internal", "front", "dimension", "detail"];
  return roleTiers
    .flatMap((role) => roundRobinByCabinet(eligible.filter((crop) => crop.role === role)))
    .slice(0, safeLimit);
}

/**
 * Every segmented cabinet needs a first-pass internal image after the request
 * budget is applied. Checking the unbounded crop list is insufficient: a
 * large drawing can pass preflight and still lose the final cabinet at slice.
 */
export function missingStructuralSourceCabinetIds(crops: CabinetCropInput[], expectedCabinetIds: string[]) {
  const covered = new Set(crops
    .filter((crop) => (crop.scanPass || 1) === 1 && crop.role === "internal")
    .map((crop) => crop.cabinetId));
  return expectedCabinetIds.filter((cabinetId) => !covered.has(cabinetId));
}
