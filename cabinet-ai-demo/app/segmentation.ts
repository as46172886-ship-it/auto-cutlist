export type CropRole = "door" | "internal" | "front" | "dimension" | "detail";

export type NormalizedCropBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PlannedCrop = {
  cropId: string;
  sourceImageName: string;
  role: CropRole;
  rotationToUprightDeg: 0 | 90 | 180 | 270;
  box: NormalizedCropBox;
  region: string;
  evidence: string;
};

export type CabinetSegment = {
  cabinetId: string;
  elevationId: string;
  label: string;
  widthOrder: number;
  bottomSegmentMm: number;
  bottomDimensionText: string;
  sourceCrops: PlannedCrop[];
  confidence: "high" | "medium" | "low";
  evidence: string;
};

export type SegmentationPlan = {
  projectName: string;
  drawingUnit: "cm" | "mm" | "mixed" | "unknown";
  orientationAudit?: import("./orientation-audit").OrientationAudit;
  views: Array<{
    imageName: string;
    viewKind: "internal" | "door" | "front" | "side" | "detail" | "dimension" | "unknown";
    elevationId: string;
    rotationToUprightDeg: 0 | 90 | 180 | 270;
    evidence: string;
  }>;
  cabinets: CabinetSegment[];
  unresolved: string[];
};

export type CabinetCropInput = {
  name: string;
  dataUrl: string;
  cabinetId: string;
  cropId: string;
  role: CropRole;
  sourceImageName: string;
  region: string;
  scanPass?: 1 | 2 | 3;
  focus?: string;
  slantedHandleMarkerEvidence?: import("./slanted-handle-audit").CropMarkerEvidence;
};

const validRotation = (value: unknown): value is 0 | 90 | 180 | 270 => value === 0 || value === 90 || value === 180 || value === 270;

export function isSegmentationPlan(value: unknown): value is SegmentationPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<SegmentationPlan>;
  if (!Array.isArray(plan.cabinets) || !plan.cabinets.length || !Array.isArray(plan.views)) return false;
  const cabinetIds = plan.cabinets.map((cabinet) => String(cabinet?.cabinetId || "").trim());
  if (new Set(cabinetIds).size !== cabinetIds.length) return false;
  const orderKeys = plan.cabinets.map((cabinet) => `${String(cabinet?.elevationId || "").trim()}|${Number(cabinet?.widthOrder)}`);
  if (new Set(orderKeys).size !== orderKeys.length) return false;
  const cropIds: string[] = [];
  const valid = plan.cabinets.every((cabinet) => {
    if (!cabinet || typeof cabinet !== "object" || !String(cabinet.cabinetId || "").trim()
      || !String(cabinet.elevationId || "").trim() || !Number.isInteger(cabinet.widthOrder) || Number(cabinet.widthOrder) < 1
      || !Array.isArray(cabinet.sourceCrops) || !cabinet.sourceCrops.length) return false;
    return cabinet.sourceCrops.every((crop) => {
      const box = crop?.box;
      const cropId = String(crop?.cropId || "").trim();
      if (cropId) cropIds.push(cropId);
      return Boolean(crop && cropId && String(crop.sourceImageName || "").trim() && validRotation(crop.rotationToUprightDeg)
        && box && Number(box.width) > 0 && Number(box.height) > 0);
    });
  });
  return valid && new Set(cropIds).size === cropIds.length;
}

export function cabinetCropSummary(plan: SegmentationPlan) {
  return plan.cabinets.map((cabinet) => ({
    id: cabinet.cabinetId,
    elevationId: cabinet.elevationId,
    label: cabinet.label,
    widthOrder: cabinet.widthOrder,
    bottomSegmentMm: cabinet.bottomSegmentMm,
    bottomDimensionText: cabinet.bottomDimensionText,
    cropIds: cabinet.sourceCrops.map((crop) => crop.cropId),
    roles: cabinet.sourceCrops.map((crop) => crop.role),
    evidence: cabinet.evidence,
  }));
}
