import type { DrawingUnit, MeasurementObservation, MeasurementUnit } from "./model.ts";

function finitePositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function numberFromRaw(rawText: unknown) {
  const normalized = String(rawText || "").replaceAll(",", ".");
  const match = normalized.match(/\d+(?:\.\d+)?/);
  return match ? finitePositive(match[0]) : 0;
}

export function normalizeDrawingUnit(value: unknown): DrawingUnit {
  return ["cm", "mm", "mixed", "unknown"].includes(String(value)) ? value as DrawingUnit : "unknown";
}

export function normalizeMeasurementUnit(value: unknown): MeasurementUnit {
  return ["cm", "mm", "drawing", "unknown"].includes(String(value)) ? value as MeasurementUnit : "unknown";
}

export function measurementToMm(measurement: Partial<MeasurementObservation> | undefined, drawingUnit: DrawingUnit) {
  if (!measurement) return 0;
  const rawText = String(measurement.rawText || "");
  const rawValue = finitePositive(measurement.value) || numberFromRaw(rawText);
  if (!rawValue) return 0;

  let unit = normalizeMeasurementUnit(measurement.unit);
  if (/mm|毫米/i.test(rawText)) unit = "mm";
  else if (/cm|公分/i.test(rawText)) unit = "cm";
  else if (/^\s*(?:D|深)/i.test(rawText) && rawValue < 100) unit = "cm";
  if (unit === "drawing") unit = drawingUnit === "cm" || drawingUnit === "mm" ? drawingUnit : "unknown";
  if (unit === "unknown") return 0;
  return Math.round(rawValue * (unit === "cm" ? 10 : 1));
}

export function dimensionTextToMm(rawText: string, drawingUnit: DrawingUnit) {
  const normalized = String(rawText || "");
  const inferredUnit: MeasurementUnit = /mm|毫米/i.test(normalized)
    ? "mm"
    : /cm|公分/i.test(normalized) || (/^\s*(?:D|深)/i.test(normalized) && numberFromRaw(normalized) < 100)
      ? "cm"
      : "drawing";
  return measurementToMm({ rawText: normalized, value: numberFromRaw(normalized), unit: inferredUnit, evidence: "" }, drawingUnit);
}

export function formatMillimeterFormula(values: number[], result: number) {
  return values.length > 1 ? `${values.join("＋")}＝${result} mm` : values.length === 1 ? `${values[0]} mm` : "";
}
