import type { CarcassResult } from "./carcass.ts";
import type { SegmentationPlan } from "./segmentation.ts";

export type CarcassLock = CarcassResult["cabinets"][number];

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function usableLock(lock: CarcassLock | undefined, expectedWidthMm: number) {
  return Boolean(lock
    && positiveInteger(lock.widthMm) === positiveInteger(expectedWidthMm)
    && positiveInteger(lock.heightMm) > 0
    && positiveInteger(lock.depthMm) > 0);
}

/**
 * The dedicated carcass reader numbers a single elevation C01/C02/... while
 * segmentation uses globally unique E01-C01/... IDs.  Exact IDs remain the
 * first choice.  A local-ID/order remap is allowed only when segmentation has
 * one elevation and the independently read width agrees, so two elevations can
 * never exchange otherwise similar W/H/D evidence.
 */
export function validatedCarcassLocks(value: unknown, segmentation: SegmentationPlan) {
  if (!value || typeof value !== "object") return new Map<string, CarcassLock>();
  const result = value as Partial<CarcassResult>;
  if (result.mode !== "carcass_only" || !Array.isArray(result.cabinets)) return new Map<string, CarcassLock>();

  const exactById = new Map(result.cabinets.map((item) => [String(item?.cabinetId || "").trim(), item]));
  const singleElevation = new Set(segmentation.cabinets.map((item) => item.elevationId)).size === 1;
  const byOrder = singleElevation
    ? new Map(result.cabinets.map((item) => [positiveInteger(item?.widthOrder), item]))
    : new Map<number, CarcassLock>();
  const locks = new Map<string, CarcassLock>();

  for (const segment of segmentation.cabinets) {
    const exact = exactById.get(segment.cabinetId);
    const candidate = usableLock(exact, segment.bottomSegmentMm)
      ? exact
      : byOrder.get(positiveInteger(segment.widthOrder));
    if (!usableLock(candidate, segment.bottomSegmentMm)) continue;
    locks.set(segment.cabinetId, { ...candidate!, cabinetId: segment.cabinetId, widthOrder: segment.widthOrder });
  }
  return locks;
}
