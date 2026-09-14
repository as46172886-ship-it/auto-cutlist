import { hingesPerDoorForFinishedHeight } from "./hinge-rules.ts";

type DoorLike = {
  type?: string;
  count?: number;
  countBasis?: string;
  doorSymbols?: unknown[];
  openingWidthMm?: number;
  openingHeightMm?: number;
  finishedWidthMm?: number;
  finishedHeightMm?: number;
  dimensionBasis?: string;
  slantedHandle?: boolean;
  slantedHandleCount?: number;
  slantedHandleStyle?: string;
  jHandleCount?: number;
  evidence?: string;
  symbolRegions?: unknown[];
};

type JsonRecord = Record<string, unknown>;

export type DoorGap24Context = "none" | "door_chain_included" | "already_separate" | "stacked_lift" | "unknown";

export type DoorGap24Lock = {
  cabinetId: string;
  doorIndex: number;
  context: Exclude<DoorGap24Context, "none" | "unknown">;
};

const RESOLVED_GAP24_CONTEXTS = new Set<DoorGap24Context>([
  "none",
  "door_chain_included",
  "already_separate",
  "stacked_lift",
]);

const POSITIVE_GAP24_CONTEXTS = new Set<DoorGap24Lock["context"]>([
  "door_chain_included",
  "already_separate",
  "stacked_lift",
]);

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const positiveInteger = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));

export function normalizeDoorGap24Fields(originalDoor: JsonRecord): JsonRecord {
  const door = { ...originalDoor };
  let context = String(door.slantedGap24Context || "unknown") as DoorGap24Context;
  if (!RESOLVED_GAP24_CONTEXTS.has(context)) context = "unknown";

  // The latest workshop rule treats a visible 24 mm / 2.4 cm mark only as a
  // positive slanted-handle hint.  It is not a door-height deduction and its
  // relationship to a height chain never has to be closed.  Keep the legacy
  // fields as evidence tags for old saved reads, but promote their positive
  // signal into the actual per-door handle fields.
  const hasSlantedHandleHint = door.includesSlantedGap24 === true
    || POSITIVE_GAP24_CONTEXTS.has(context as DoorGap24Lock["context"]);
  const count = positiveInteger(door.count);
  if (hasSlantedHandleHint && door.type === "4E" && count > 0) {
    door.slantedHandle = true;
    if (positiveInteger(door.slantedHandleCount) === 0) door.slantedHandleCount = count;
    if (!["top", "bottom", "long"].includes(String(door.slantedHandleStyle || "unknown"))) {
      door.slantedHandleStyle = "unknown";
    }
  }

  // A positive includes flag already means the reader judged that the opening
  // height contains the 24 mm gap. Close that decision instead of asking the
  // same question again in later passes.
  if (context === "unknown" && door.includesSlantedGap24 === true) context = "door_chain_included";

  // When the read contains no slanted-handle evidence at all, 24 mm is not an
  // applicable prerequisite for an ordinary 4E door.
  if (context === "unknown"
    && !door.slantedHandle
    && positiveInteger(door.slantedHandleCount) === 0
    && door.includesSlantedGap24 !== true) {
    context = "none";
  }

  door.slantedGap24Context = context;
  door.includesSlantedGap24 = context === "door_chain_included";
  return door;
}

function gap24LockKey(cabinetId: string, doorIndex: number) {
  return `${cabinetId}::${doorIndex}`;
}

export function collectResolvedDoorGap24Locks(structured: JsonRecord, existing: DoorGap24Lock[] = []) {
  const locks = new Map(existing.map((lock) => [gap24LockKey(lock.cabinetId, lock.doorIndex), lock] as const));
  const cabinets = (Array.isArray(structured.cabinets) ? structured.cabinets : []).filter(isJsonRecord);

  cabinets.forEach((cabinet, cabinetIndex) => {
    const cabinetId = String(cabinet.id || cabinet.name || `cabinet-${cabinetIndex}`);
    const doors = (Array.isArray(cabinet.doors) ? cabinet.doors : []).filter(isJsonRecord);
    doors.forEach((door, doorIndex) => {
      const context = String(normalizeDoorGap24Fields(door).slantedGap24Context) as DoorGap24Context;
      if (!POSITIVE_GAP24_CONTEXTS.has(context as DoorGap24Lock["context"])) return;
      const key = gap24LockKey(cabinetId, doorIndex);
      if (!locks.has(key)) locks.set(key, { cabinetId, doorIndex, context: context as DoorGap24Lock["context"] });
    });
  });

  return [...locks.values()];
}

export function restoreResolvedDoorGap24Locks(structured: JsonRecord, locks: DoorGap24Lock[]) {
  const byKey = new Map(locks.map((lock) => [gap24LockKey(lock.cabinetId, lock.doorIndex), lock] as const));
  const cabinets = (Array.isArray(structured.cabinets) ? structured.cabinets : []).filter(isJsonRecord).map((cabinet, cabinetIndex) => {
    const cabinetId = String(cabinet.id || cabinet.name || `cabinet-${cabinetIndex}`);
    const doors = (Array.isArray(cabinet.doors) ? cabinet.doors : []).filter(isJsonRecord).map((door, doorIndex) => {
      const normalized = normalizeDoorGap24Fields(door);
      const lock = byKey.get(gap24LockKey(cabinetId, doorIndex));
      if (!lock) return normalized;
      return {
        ...normalized,
        slantedGap24Context: lock.context,
        includesSlantedGap24: lock.context === "door_chain_included",
      };
    });
    return { ...cabinet, doors };
  });
  return { ...structured, cabinets };
}

export function normalizedDoorSymbols(door: DoorLike) {
  return (Array.isArray(door.doorSymbols) ? door.doorSymbols : [])
    .map(String)
    .filter((symbol): symbol is "<" | ">" => symbol === "<" || symbol === ">");
}

function normalizedSymbolRegions(door: DoorLike) {
  return (Array.isArray(door.symbolRegions) ? door.symbolRegions : []).filter(isJsonRecord);
}

function symbolRegionsAreDistinct(regions: JsonRecord[]) {
  return regions.every((region, index) => {
    const cropName = String(region.cropName || "").trim();
    const x = Number(region.xPermille);
    const y = Number(region.yPermille);
    return !regions.slice(0, index).some((previous) => {
      if (String(previous.cropName || "").trim() !== cropName) return false;
      const previousX = Number(previous.xPermille);
      const previousY = Number(previous.yPermille);
      return Number.isFinite(previousX) && Number.isFinite(previousY)
        && Math.hypot(previousX - x, previousY - y) <= 24;
    });
  });
}

export function doorSymbolCropNames(read: JsonRecord) {
  const names = (Array.isArray(read.doors) ? read.doors : [])
    .filter(isJsonRecord)
    .flatMap((door) => normalizedSymbolRegions(door).map((region) => String(region.cropName || "").trim()))
    .filter(Boolean);
  return [...new Set(names)];
}

export function doorReadUsesOnlyKnownSymbolCrops(read: JsonRecord, allowedCropNames: Iterable<string>) {
  const allowed = new Set([...allowedCropNames].map(String));
  return doorSymbolCropNames(read).every((name) => allowed.has(name));
}

export function doorCountEvidenceIsClosed(door: DoorLike) {
  if (door.type !== "4E") return false;
  const count = positiveInteger(door.count);
  if (!count) return false;

  const basis = String(door.countBasis || "unknown");
  const evidence = String(door.evidence || "").trim();
  const symbols = normalizedDoorSymbols(door);
  if (basis === "symbols") return symbols.length === count;
  if (basis === "user_confirmed") return /(?:使用者|人工).{0,12}(?:確認|指定)|已確認/.test(evidence);
  if (basis === "explicit_note") return /(?:圖註|標註|文字|門板|4E).{0,16}(?:\d+|一|二|三|四|五|六).{0,4}片/.test(evidence);
  // AI-only geometry is deliberately not a closing basis. The first scan must
  // show the actual < / > pixels; otherwise the door is omitted and warned.
  return false;
}

export function doorCountPixelsAreClosed(door: DoorLike) {
  const count = positiveInteger(door.count);
  return door.type === "4E" && count > 0 && door.countBasis === "symbols" && normalizedDoorSymbols(door).length === count;
}

export function doorSymbolPixelsAreLocated(door: DoorLike) {
  const count = positiveInteger(door.count);
  const symbols = normalizedDoorSymbols(door);
  const regions = normalizedSymbolRegions(door);
  if (!count || regions.length !== count || symbols.length !== count || !symbolRegionsAreDistinct(regions)) return false;
  return regions.every((region, index) => {
    const x = Number(region.xPermille);
    const y = Number(region.yPermille);
    return region.symbol === symbols[index]
      && String(region.cropName || "").trim().length > 0
      && String(region.region || "").trim().length > 0
      && Number.isInteger(x) && x >= 0 && x <= 1000
      && Number.isInteger(y) && y >= 0 && y <= 1000
      && String(region.evidence || "").trim().length > 0;
  });
}

export function doorDimensionEvidenceIsClosed(door: DoorLike) {
  if (door.dimensionBasis === "opening") return Number(door.openingWidthMm) > 0 && Number(door.openingHeightMm) > 0;
  if (door.dimensionBasis === "finished") return Number(door.finishedWidthMm) > 0 && Number(door.finishedHeightMm) > 0;
  return false;
}

export function doorIsReadyForHardware(door: DoorLike) {
  const normalized = normalizeDoorGap24Fields(door as JsonRecord) as DoorLike;
  const count = positiveInteger(normalized.count);
  const jHandleCount = positiveInteger(normalized.jHandleCount);
  const slantedHandleCount = positiveInteger(normalized.slantedHandleCount);
  const slantedStyle = String(normalized.slantedHandleStyle || "unknown");
  const handlesClosed = jHandleCount <= count
    && slantedHandleCount <= count
    && jHandleCount + slantedHandleCount <= count
    && Boolean(normalized.slantedHandle) === (slantedHandleCount > 0)
    && (slantedHandleCount === 0 || ["top", "bottom", "long"].includes(slantedStyle));
  return doorCountEvidenceIsClosed(normalized) && doorDimensionEvidenceIsClosed(normalized) && handlesClosed;
}

function finishedDoorHeight(door: JsonRecord) {
  if (door.dimensionBasis === "finished") return positiveInteger(door.finishedHeightMm);
  if (door.dimensionBasis !== "opening") return 0;
  return positiveInteger(Number(door.openingHeightMm) - (door.includesBottom30 ? 30 : 0) - 4);
}

function applyHingeSchedule(door: JsonRecord) {
  return { ...door, hingeCountPerDoor: hingesPerDoorForFinishedHeight(finishedDoorHeight(door)) };
}

function confirmedReadDoors(read: JsonRecord) {
  const sourceDoors = (Array.isArray(read.doors) ? read.doors : []).filter(isJsonRecord);
  // Door count/direction are a symbol-only lock. Dimensions, the 24 mm gap,
  // handles and hardware are intentionally resolved later and must never erase
  // a clear < or > that has already been located in a door-leaf crop.
  const doors = sourceDoors
    .filter((door) => door.type === "4E" && doorCountPixelsAreClosed(door) && doorSymbolPixelsAreLocated(door))
    .map((door) => {
      const symbols = normalizedDoorSymbols(door);
      const direction = symbols.every((symbol) => symbol === "<") ? "left"
        : symbols.every((symbol) => symbol === ">") ? "right"
          : "mixed";
      return applyHingeSchedule({ ...door, direction });
    });
  const allRegions = doors.flatMap((door) => normalizedSymbolRegions(door));
  return symbolRegionsAreDistinct(allRegions) ? doors : [];
}

function readIsConfirmedNoDoor(read: JsonRecord) {
  const unresolved = (Array.isArray(read.unresolvedDoorRegions) ? read.unresolvedDoorRegions : []).map(String).filter(Boolean);
  return read.status === "confirmed_no_4e" && unresolved.length === 0 && (!Array.isArray(read.doors) || read.doors.length === 0);
}

export function lockableDoorRead(read: JsonRecord) {
  const doors = confirmedReadDoors(read);
  if (doors.length) return { locked: true as const, status: "confirmed_4e" as const, doors };
  if (readIsConfirmedNoDoor(read)) return { locked: true as const, status: "confirmed_no_4e" as const, doors: [] as JsonRecord[] };
  return { locked: false as const, status: "omitted" as const, doors: [] as JsonRecord[] };
}

function mergeDoorDetails(symbolDoor: JsonRecord, currentDoor: JsonRecord | undefined) {
  if (!currentDoor || currentDoor.type !== "4E") return applyHingeSchedule(normalizeDoorGap24Fields(symbolDoor));
  const merged = { ...symbolDoor };
  const basis = String(currentDoor.dimensionBasis || "unknown");
  if (basis === "opening" && Number(currentDoor.openingWidthMm) > 0 && Number(currentDoor.openingHeightMm) > 0) {
    merged.dimensionBasis = "opening";
    merged.openingWidthMm = currentDoor.openingWidthMm;
    merged.openingHeightMm = currentDoor.openingHeightMm;
    merged.finishedWidthMm = 0;
    merged.finishedHeightMm = 0;
  } else if (basis === "finished" && Number(currentDoor.finishedWidthMm) > 0 && Number(currentDoor.finishedHeightMm) > 0) {
    merged.dimensionBasis = "finished";
    merged.finishedWidthMm = currentDoor.finishedWidthMm;
    merged.finishedHeightMm = currentDoor.finishedHeightMm;
    merged.openingWidthMm = 0;
    merged.openingHeightMm = 0;
  }
  for (const key of ["jHandleCount", "slantedHandleCount"] as const) {
    if (Number.isFinite(Number(currentDoor[key])) && Number(currentDoor[key]) >= 0) merged[key] = currentDoor[key];
  }
  for (const key of ["slantedHandle", "includesBottom30", "includesSlantedGap24"] as const) {
    if (typeof currentDoor[key] === "boolean") merged[key] = currentDoor[key];
  }
  if (["top", "bottom", "long", "none", "unknown"].includes(String(currentDoor.slantedHandleStyle))) {
    merged.slantedHandleStyle = currentDoor.slantedHandleStyle;
  }
  if (["none", "door_chain_included", "already_separate", "stacked_lift"].includes(String(currentDoor.slantedGap24Context))) {
    merged.slantedGap24Context = currentDoor.slantedGap24Context;
  }
  const detailsEvidence = String(currentDoor.evidence || "").trim();
  if (detailsEvidence && !String(merged.evidence || "").includes(detailsEvidence)) {
    merged.evidence = `${String(merged.evidence || "").trim()}；尺寸／加工：${detailsEvidence}`.replace(/^；/, "");
  }
  return applyHingeSchedule(normalizeDoorGap24Fields(merged));
}

export function applyDoorRecognition(structured: JsonRecord, audit: JsonRecord): JsonRecord {
  const reads = new Map(
    (Array.isArray(audit.cabinetDoors) ? audit.cabinetDoors : [])
      .filter(isJsonRecord)
      .map((read) => [String(read.cabinetId || ""), read] as const)
      .filter(([id]) => id),
  );

  const cabinets = (Array.isArray(structured.cabinets) ? structured.cabinets : []).filter(isJsonRecord).map((cabinet) => {
    const id = String(cabinet.id || cabinet.name || "");
    const read = reads.get(id);
    if (!read) return cabinet;

    const resolution = lockableDoorRead(read);
    const currentDoors = (Array.isArray(cabinet.doors) ? cabinet.doors : []).filter(isJsonRecord).filter((door) => door.type === "4E");
    const doors = resolution.status === "confirmed_4e"
      ? resolution.doors.map((door, index) => mergeDoorDetails(door, currentDoors[index]))
      : resolution.doors;
    return { ...cabinet, doors, doorLock: { locked: resolution.locked, status: resolution.status, attemptsUsed: positiveInteger(read.attemptsUsed), evidence: String(read.evidence || "") } };
  });

  const doorWarnings = (Array.isArray(audit.cabinetDoors) ? audit.cabinetDoors : []).filter(isJsonRecord).flatMap((read) => {
    const id = String(read.cabinetId || "未命名桶身");
    const attempts = positiveInteger(read.attemptsUsed) || 3;
    const regions = (Array.isArray(read.unresolvedDoorRegions) ? read.unresolvedDoorRegions : []).map(String).filter(Boolean);
    const resolution = lockableDoorRead(read);
    if (resolution.status === "confirmed_no_4e") return [];
    if (resolution.status === "confirmed_4e") {
      if (!regions.length) return [];
      const count = resolution.doors.reduce((sum, door) => sum + positiveInteger((door as JsonRecord).count), 0);
      return [`${id} 已鎖定${count}片清楚的<／>門片；仍看不清的門樣區域不列入（${regions.join("、")}），且不會清除已鎖定門片。`];
    }
    if (regions.some((region) => /(?:沒有回應|無法偵測|已提早結束)/.test(region))) {
      return [`${id} 無法偵測門板，門板掃描已提早結束；其他尺寸與桶內結構照常顯示，本次不列該桶門片及門用五金。`];
    }
    return [`${id} 的<／>符號經逐桶裁切放大複核${attempts}次仍未看清；本次不列該桶門片及門用五金${regions.length ? `（未確認區：${regions.join("、")}）` : ""}。`];
  });
  const warnings = [...(Array.isArray(structured.warnings) ? structured.warnings : []), ...doorWarnings];
  return { ...structured, cabinets, warnings: [...new Set(warnings)], doorRecognition: audit };
}

export function restoreLockedDoors(structured: JsonRecord, audit: JsonRecord): JsonRecord {
  return applyDoorRecognition(structured, audit);
}
