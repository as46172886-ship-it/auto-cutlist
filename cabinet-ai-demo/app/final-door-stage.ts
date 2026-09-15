import { doorIsReadyForHardware, lockableDoorRead, normalizeDoorGap24Fields } from "./door-recognition.ts";
import { DOOR_SCAN_ATTEMPTS, doorCropsForAttempt, doorSourceEvidenceCropNames, isDoorNoResponseError } from "./door-scan.ts";
import { doorReadUsesOnlyKnownSymbolCrops } from "./door-recognition.ts";
import { faceMachiningReadIssues, faceMachiningReadScore } from "./face-machining.ts";
import type { CabinetCropInput } from "./segmentation.ts";
import type { CabinetRead } from "./sop.ts";

type RecordValue = Record<string, unknown>;
const records = (value: unknown): RecordValue[] => Array.isArray(value)
  ? value.filter((item): item is RecordValue => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;

/** All door facts must be complete in ONE read, not assembled from unrelated passes. */
export function finalDoorReadIssues(read: RecordValue): string[] {
  const issues: string[] = [];
  const resolution = lockableDoorRead(read);
  const unresolved = Array.isArray(read.unresolvedDoorRegions) ? read.unresolvedDoorRegions.map(String).filter(Boolean) : [];
  if (read.status !== "confirmed_4e" && read.status !== "confirmed_no_4e") issues.push("整桶門面尚未確認完整");
  if (unresolved.length) issues.push(`尚有未確認門面：${unresolved.join("、")}`);
  if (records(read.doors).some((door) => door.type !== "4E")) issues.push("加工門清單混入鋁框門或無門項目；請改列排除註記，避免加工位置錯對門片");
  if (resolution.status === "omitted") issues.push("門片有無、片數或原圖開向尚未確認");
  if (resolution.status === "confirmed_no_4e") return issues;
  const doors = records(read.doors).filter((door) => door.type === "4E");
  if (doors.length !== resolution.doors.length) issues.push("部分門片缺可回查的開向符號，不能略去後輸出");
  if (read.status === "confirmed_no_4e" && doors.length) issues.push("無門結論與已辨識門片互相矛盾");
  doors.forEach((raw, index) => {
    const door = normalizeDoorGap24Fields(raw);
    const label = `第${index + 1}組門`;
    if (door.dimensionBasis === "opening") {
      if (!positive(door.openingWidthMm)) issues.push(`${label}缺開口寬`);
      if (!positive(door.openingHeightMm)) issues.push(`${label}缺開口高`);
      if (positive(door.openingWidthMm) && Number(door.openingWidthMm) / Number(door.count) <= 3) issues.push(`${label}開口寬不足以扣門縫`);
      if (positive(door.openingHeightMm) && Number(door.openingHeightMm) <= (door.includesBottom30 ? 34 : 4)) issues.push(`${label}開口高不足以扣門縫`);
    } else if (door.dimensionBasis === "finished") {
      if (!positive(door.finishedWidthMm)) issues.push(`${label}缺完成寬`);
      if (!positive(door.finishedHeightMm)) issues.push(`${label}缺完成高`);
    } else issues.push(`${label}尚未確認寬高是開口尺寸或完成尺寸`);
    const count = Number(door.count), j = Number(door.jHandleCount), s = Number(door.slantedHandleCount);
    if (![j, s].every((value) => Number.isInteger(value) && value >= 0) || j + s > count) issues.push(`${label}手把數量與門片數不一致`);
    if (Boolean(door.slantedHandle) !== (s > 0)) issues.push(`${label}斜把有無與數量不一致`);
    if (s > 0 && !["top", "bottom", "long"].includes(String(door.slantedHandleStyle))) issues.push(`${label}已知有斜把，但上／下／長斜把位置未確認`);
    if (s === 0 && door.slantedHandleStyle !== "none") issues.push(`${label}尚未確認是否有斜把空隙`);
  });
  return [...new Set(issues)];
}

export function finalDoorStageIssues(read: RecordValue, cabinet: CabinetRead, crops: CabinetCropInput[]) {
  return [...new Set([...finalDoorReadIssues(read), ...faceMachiningReadIssues(read, cabinet, crops)])];
}

type ReadAttempt = (attempt: 1 | 2 | 3, crops: CabinetCropInput[], previous: RecordValue | null) => Promise<RecordValue | null>;

/** Retry the entire final face stage. A complete snapshot wins immediately and is never rescanned. */
export async function scanFinalDoorStage(cabinet: CabinetRead, crops: CabinetCropInput[], readAttempt: ReadAttempt) {
  const cabinetCrops = crops.filter((crop) => crop.cabinetId === cabinet.id);
  let best: RecordValue | null = null;
  let bestScore = -Infinity;
  let noDoorConfirmations = 0;
  let seenDoorPixels = false;
  let attemptsUsed = 0;
  let lastFailure = "";
  for (const attempt of DOOR_SCAN_ATTEMPTS) {
    const selected = doorCropsForAttempt(cabinetCrops, attempt);
    if (!selected.length) continue;
    attemptsUsed = attempt;
    try {
      const raw = await readAttempt(attempt, selected, best);
      if (!raw || String(raw.cabinetId) !== cabinet.id) { noDoorConfirmations = 0; lastFailure = "門面回傳缺少對應桶號"; continue; }
      const candidate = { ...raw, doors: records(raw.doors).map(normalizeDoorGap24Fields), attemptsUsed: attempt };
      if (!doorReadUsesOnlyKnownSymbolCrops(candidate, doorSourceEvidenceCropNames(selected))) {
        noDoorConfirmations = 0; lastFailure = "門向引用了本輪不存在的原始裁切"; continue;
      }
      const resolution = lockableDoorRead(candidate);
      seenDoorPixels ||= resolution.status === "confirmed_4e";
      const doorIssues = finalDoorReadIssues(candidate);
      noDoorConfirmations = resolution.status === "confirmed_no_4e" && !doorIssues.length ? noDoorConfirmations + 1 : 0;
      const noDoorReady = noDoorConfirmations >= 2 && !seenDoorPixels && cabinetCrops.some((crop) => crop.role === "door" || crop.role === "front");
      const faceIssues = faceMachiningReadIssues(candidate, cabinet, selected);
      if (!doorIssues.length && !faceIssues.length && (resolution.status === "confirmed_4e" || noDoorReady)) {
        return { ...candidate, doors: resolution.doors.map((door) => normalizeDoorGap24Fields(door)), finalDoorStageConfirmed: true, attemptsUsed: attempt };
      }
      // Ranking is for the failure report only. Never replace a complete later read with an earlier draft.
      const score = resolution.doors.filter(doorIsReadyForHardware).length * 100 - doorIssues.length * 10 + faceMachiningReadScore(candidate, cabinet, selected);
      if (!best || score >= bestScore) { best = candidate; bestScore = score; }
    } catch (error) {
      noDoorConfirmations = 0;
      lastFailure = isDoorNoResponseError(error) ? "門面掃描逾時，完整資料尚未確認" : "門面回傳無法讀取，完整資料尚未確認";
      if (isDoorNoResponseError(error)) break;
    }
  }
  const fallback = best || { cabinetId: cabinet.id, status: "unknown", doors: [], drawerHandles: [], machining: [], unresolvedDoorRegions: [] };
  const extra = lockableDoorRead(fallback).status === "confirmed_no_4e"
    ? [seenDoorPixels ? "先前已看到門向，不能以無門結論刪除" : "缺兩次一致的完整門面無門證據"] : [];
  return { ...fallback, finalDoorStageConfirmed: false, attemptsUsed, unresolvedDoorRegions: [...new Set([
    ...(Array.isArray(fallback.unresolvedDoorRegions) ? fallback.unresolvedDoorRegions.map(String) : []), ...extra, ...(lastFailure ? [lastFailure] : []),
  ])] };
}

/** Installation is authoritative: no earlier cabinet/door draft may overwrite a confirmed final snapshot. */
export function installFinalDoorReads<T extends { cabinets: CabinetRead[] }>(analysis: T, reads: RecordValue[]): T {
  return { ...analysis, cabinets: analysis.cabinets.map((cabinet) => {
    const matches = reads.filter((read) => read.cabinetId === cabinet.id);
    const read = matches[0];
    if (matches.length !== 1 || read.finalDoorStageConfirmed !== true || finalDoorReadIssues(read).length) throw new Error(`${cabinet.id}門板尚未完整確認`);
    const resolved = lockableDoorRead(read);
    return { ...cabinet, doors: structuredClone(resolved.doors) as CabinetRead["doors"], doorLock: {
      locked: true, status: resolved.status, attemptsUsed: Number(read.attemptsUsed) || 1, evidence: "最後階段整組門板、寬高及加工已確認",
    } };
  }) };
}
