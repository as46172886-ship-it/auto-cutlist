import type { CabinetObservation, CarcassObservationRead, DepthGroupObservation, MeasurementObservation } from "./model.ts";

function isMeasurement(value: unknown): value is MeasurementObservation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MeasurementObservation>;
  return typeof item.rawText === "string"
    && Number.isFinite(Number(item.value))
    && ["cm", "mm", "drawing", "unknown"].includes(String(item.unit))
    && typeof item.evidence === "string";
}

function isCabinet(value: unknown): value is CabinetObservation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CabinetObservation>;
  return Number.isFinite(Number(item.widthOrder))
    && ["explicit_total", "segment_chain", "shared_height", "unknown"].includes(String(item.heightMode))
    && isMeasurement(item.heightTotal)
    && Array.isArray(item.heightSegments)
    && item.heightSegments.every(isMeasurement)
    && Number.isFinite(Number(item.heightSharedWithOrder))
    && typeof item.sidePanelsContinuous === "boolean"
    && typeof item.bottomBoundaryEvidence === "string"
    && typeof item.topBoundaryEvidence === "string"
    && typeof item.heightEvidence === "string"
    && typeof item.depthGroupId === "string"
    && ["high", "medium", "low"].includes(String(item.confidence));
}

function isDepthGroup(value: unknown): value is DepthGroupObservation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DepthGroupObservation>;
  return typeof item.groupId === "string"
    && isMeasurement(item.measurement)
    && Array.isArray(item.appliesToOrders)
    && item.appliesToOrders.every((order) => Number.isFinite(Number(order)))
    && typeof item.evidence === "string"
    && ["high", "medium", "low"].includes(String(item.confidence));
}

export function isCarcassObservationRead(value: unknown): value is CarcassObservationRead {
  if (!value || typeof value !== "object") return false;
  const read = value as Partial<CarcassObservationRead>;
  return typeof read.projectName === "string"
    && ["cm", "mm", "mixed", "unknown"].includes(String(read.drawingUnit))
    && Array.isArray(read.cabinets)
    && read.cabinets.every(isCabinet)
    && Array.isArray(read.depthGroups)
    && read.depthGroups.every(isDepthGroup)
    && Array.isArray(read.unresolved)
    && read.unresolved.every((item) => typeof item === "string");
}
