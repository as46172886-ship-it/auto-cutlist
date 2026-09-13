import type { CabinetCropInput } from "./segmentation.ts";
import { lockableDoorRead } from "./door-recognition.ts";

type JsonRecord = Record<string, unknown>;

export const DOOR_SCAN_ATTEMPTS = [1, 2, 3] as const;

function lockedSymbols(read: JsonRecord) {
  const resolution = lockableDoorRead(read);
  if (resolution.status !== "confirmed_4e") return [] as string[];
  return resolution.doors.flatMap((door) => Array.isArray((door as JsonRecord).doorSymbols)
    ? ((door as JsonRecord).doorSymbols as unknown[]).map(String).filter((symbol) => symbol === "<" || symbol === ">")
    : []);
}

function lockedPixelFacts(read: JsonRecord) {
  const resolution = lockableDoorRead(read);
  if (resolution.status !== "confirmed_4e") return [] as string[];
  return resolution.doors.flatMap((door) => (Array.isArray((door as JsonRecord).symbolRegions)
    ? ((door as JsonRecord).symbolRegions as unknown[]).filter((region): region is JsonRecord => Boolean(region) && typeof region === "object" && !Array.isArray(region))
    : []).map((region) => [
      String(region.symbol || ""),
      String(region.cropName || "").trim(),
      Number(region.xPermille),
      Number(region.yPermille),
    ].join("::")));
}

function containsSymbolMultiset(candidate: string[], locked: string[]) {
  const remaining = [...candidate];
  for (const symbol of locked) {
    const index = remaining.indexOf(symbol);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}

/**
 * The first located door symbol is an immutable pixel fact. A later enhanced
 * crop may add more symbols, but it may never flip or delete an already
 * located < or >. This mirrors the rotation and cabinet-width hard locks.
 */
export function preserveFirstDoorSymbolLock(firstLockedRead: JsonRecord, candidateRead: JsonRecord) {
  const firstResolution = lockableDoorRead(firstLockedRead);
  if (firstResolution.status !== "confirmed_4e") return candidateRead;
  const candidateResolution = lockableDoorRead(candidateRead);
  const firstSymbols = lockedSymbols(firstLockedRead);
  const candidateSymbols = lockedSymbols(candidateRead);
  const firstPixels = lockedPixelFacts(firstLockedRead);
  const candidatePixels = new Set(lockedPixelFacts(candidateRead));
  const candidateAddsSymbols = candidateResolution.status === "confirmed_4e"
    && candidateSymbols.length > firstSymbols.length
    && containsSymbolMultiset(candidateSymbols, firstSymbols)
    && firstPixels.every((pixel) => candidatePixels.has(pixel));
  if (candidateAddsSymbols) {
    return {
      ...candidateRead,
      evidence: `${String(candidateRead.evidence || "")}；沿用前輪已鎖定${firstSymbols.join("、")}，本輪只新增清楚符號`.replace(/^；/, ""),
      firstSymbolLockPreserved: true,
    };
  }

  const unresolved = [
    ...(Array.isArray(candidateRead.unresolvedDoorRegions) ? candidateRead.unresolvedDoorRegions.map(String) : []),
    ...(Array.isArray(firstLockedRead.unresolvedDoorRegions) ? firstLockedRead.unresolvedDoorRegions.map(String) : []),
  ].filter((item, index, all) => item && all.indexOf(item) === index);
  const conflict = candidateResolution.status === "confirmed_4e"
    && !containsSymbolMultiset(candidateSymbols, firstSymbols);
  return {
    ...candidateRead,
    status: candidateRead.status === "confirmed_4e" ? "confirmed_4e" : firstLockedRead.status,
    doors: firstResolution.doors,
    unresolvedDoorRegions: candidateRead.status === "confirmed_4e" ? (Array.isArray(candidateRead.unresolvedDoorRegions) ? candidateRead.unresolvedDoorRegions : []) : unresolved,
    evidence: `${String(candidateRead.evidence || "")}；第一輪清楚符號${firstSymbols.join("、")}已鎖定，後輪${conflict ? "相反判讀已拒絕" : "不得清除或改向"}`.replace(/^；/, ""),
    firstSymbolLockPreserved: true,
    symbolConflictRejected: conflict,
  };
}

const doorRolePriority: Record<string, number> = { door: 0, front: 1, internal: 2, dimension: 3, detail: 4 };
const doorRequestRoles = new Set(["door", "front", "internal", "dimension"]);
const sourceDoorRoles = new Set(["door", "front", "internal"]);

export function cabinetCropPass(crop: CabinetCropInput) {
  return crop.scanPass === 2 || crop.scanPass === 3 ? crop.scanPass : 1;
}

export function doorCropsForAttempt(all: CabinetCropInput[], attemptNo: 1 | 2 | 3) {
  const requested = all.filter((crop) => cabinetCropPass(crop) === attemptNo);
  const persistentReferences = attemptNo === 1 ? [] : all.filter((crop) => cabinetCropPass(crop) === 1);
  const selected = requested.length ? [...requested, ...persistentReferences] : all.filter((crop) => cabinetCropPass(crop) === 1);
  return selected
    .filter((crop, index, items) => items.findIndex((candidate) => candidate.name === crop.name) === index)
    .sort((a, b) => (doorRolePriority[a.role] ?? 9) - (doorRolePriority[b.role] ?? 9) || a.name.localeCompare(b.name));
}

/**
 * Enhanced crops may locate a faint chevron, but only first-pass cabinet
 * views that can actually contain a door leaf may prove it. Dimension-only
 * and generic detail crops are deliberately excluded because their arrows
 * and leaders can resemble a < / > fragment.
 */
export function doorSourceEvidenceCropNames(crops: CabinetCropInput[]) {
  return new Set(crops
    .filter((crop) => cabinetCropPass(crop) === 1 && sourceDoorRoles.has(crop.role))
    .map((crop) => crop.name));
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
 * Keep the request bounded without starving the last cabinets in a large
 * drawing. Every cabinet's raw door-capable views are scheduled before
 * dimension references and enhanced passes; each tier is round-robin.
 */
export function selectDoorCropsForRequest(all: CabinetCropInput[], limit = 100) {
  const safeLimit = Math.max(0, Math.floor(limit));
  const eligible = all
    .filter((crop) => doorRequestRoles.has(crop.role))
    .filter((crop, index, items) => items.findIndex((candidate) => candidate.name === crop.name) === index);
  const tiers = [
    eligible.filter((crop) => cabinetCropPass(crop) === 1 && sourceDoorRoles.has(crop.role)),
    eligible.filter((crop) => cabinetCropPass(crop) === 1 && !sourceDoorRoles.has(crop.role)),
    eligible.filter((crop) => cabinetCropPass(crop) === 2),
    eligible.filter((crop) => cabinetCropPass(crop) === 3),
  ];
  return tiers.flatMap(roundRobinByCabinet).slice(0, safeLimit);
}

/** Door direction and symbols must always be traceable to a first-pass view. */
export function missingDoorSourceCabinetIds(crops: CabinetCropInput[], expectedCabinetIds: string[]) {
  const covered = new Set(crops
    .filter((crop) => cabinetCropPass(crop) === 1 && sourceDoorRoles.has(crop.role))
    .map((crop) => crop.cabinetId));
  return expectedCabinetIds.filter((cabinetId) => !covered.has(cabinetId));
}

export function batchForConcurrency<T>(items: T[], concurrency: number) {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += safeConcurrency) {
    batches.push(items.slice(index, index + safeConcurrency));
  }
  return batches;
}

export function shouldStopDoorAttempts(read: Record<string, unknown>) {
  const resolution = lockableDoorRead(read);
  return read.status === "confirmed_4e"
    && resolution.locked
    && resolution.status === "confirmed_4e"
    && (!Array.isArray(read.unresolvedDoorRegions) || read.unresolvedDoorRegions.length === 0);
}

export function isDoorNoResponseError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /(?:timeout|timed out|逾時|沒有回應)/i.test(error.message);
}
