import type { NormalizedCropBox, PlannedCrop, SegmentationPlan } from "./segmentation.ts";

export type InternalCropRepair = {
  cabinetId: string;
  sourceImageName: string;
  rotationToUprightDeg: 0 | 90 | 180 | 270;
  box: NormalizedCropBox;
  region: string;
  evidence: string;
};

export type InternalCropRepairResult = {
  repairs: InternalCropRepair[];
  unresolved: string[];
};

const FACE_ROLES = new Set<PlannedCrop["role"]>(["front", "door"]);
const VALID_ROTATIONS = new Set([0, 90, 180, 270]);

const clean = (value: unknown) => String(value || "").trim();

function validBox(value: unknown): value is NormalizedCropBox {
  if (!value || typeof value !== "object") return false;
  const box = value as Partial<NormalizedCropBox>;
  return [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && Number(box.x) >= 0 && Number(box.y) >= 0
    && Number(box.width) > 0 && Number(box.height) > 0
    && Number(box.x) + Number(box.width) <= 1000
    && Number(box.y) + Number(box.height) <= 1000;
}

function uniqueCropId(base: string, used: Set<string>) {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export function missingInternalCropCabinetIds(plan: SegmentationPlan) {
  return plan.cabinets
    .filter((cabinet) => !cabinet.sourceCrops.some((crop) => crop.role === "internal"))
    .map((cabinet) => cabinet.cabinetId);
}

/**
 * A single source sheet can be both an internal drawing and a face elevation.
 * When the model classified the source view itself as internal but emitted only
 * a face crop for a cabinet, preserve the face crop and add the missing logical
 * internal crop over the same pixels.  A source classified only as front/door
 * is deliberately not promoted here; that case needs a focused visual repair.
 */
export function closeInternalCropsFromInternalViews(plan: SegmentationPlan): SegmentationPlan {
  const internalSources = new Set(plan.views
    .filter((view) => view.viewKind === "internal")
    .map((view) => clean(view.imageName))
    .filter(Boolean));
  const usedCropIds = new Set(plan.cabinets.flatMap((cabinet) => cabinet.sourceCrops.map((crop) => crop.cropId)));

  return {
    ...plan,
    cabinets: plan.cabinets.map((cabinet) => {
      if (cabinet.sourceCrops.some((crop) => crop.role === "internal")) return cabinet;
      const source = cabinet.sourceCrops.find((crop) => internalSources.has(clean(crop.sourceImageName)) && FACE_ROLES.has(crop.role));
      if (!source) return cabinet;
      return {
        ...cabinet,
        sourceCrops: [...cabinet.sourceCrops, {
          ...source,
          cropId: uniqueCropId(`${cabinet.cabinetId}-internal-overlap`, usedCropIds),
          role: "internal",
          region: `${source.region}（同一張完整立面中的桶內結構區）`,
          evidence: `${source.evidence}；來源視圖已判定可見桶內結構，因此保留同框重疊的internal證據。`,
        }],
      };
    }),
  };
}

export function isInternalCropRepairResult(value: unknown): value is InternalCropRepairResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<InternalCropRepairResult>;
  if (!Array.isArray(result.repairs) || !Array.isArray(result.unresolved)
    || !result.unresolved.every((item) => typeof item === "string")) return false;
  return result.repairs.every((repair) => Boolean(
    repair && typeof repair === "object"
    && clean(repair.cabinetId)
    && clean(repair.sourceImageName)
    && VALID_ROTATIONS.has(repair.rotationToUprightDeg)
    && validBox(repair.box)
    && clean(repair.region)
    && clean(repair.evidence)
  ));
}

/** Merge only explicit visual repairs for cabinets that are still missing an internal crop. */
export function mergeInternalCropRepairs(
  plan: SegmentationPlan,
  result: InternalCropRepairResult,
  allowedSourceImageNames: string[],
): SegmentationPlan {
  const allowedSources = new Set(allowedSourceImageNames.map(clean).filter(Boolean));
  const planSources = new Set(plan.views.map((view) => clean(view.imageName)).filter(Boolean));
  const missing = new Set(missingInternalCropCabinetIds(plan));
  const usedCropIds = new Set(plan.cabinets.flatMap((cabinet) => cabinet.sourceCrops.map((crop) => crop.cropId)));
  const repairByCabinet = new Map<string, InternalCropRepair>();
  for (const repair of result.repairs) {
    const cabinetId = clean(repair.cabinetId);
    const sourceImageName = clean(repair.sourceImageName);
    if (!missing.has(cabinetId) || repairByCabinet.has(cabinetId)
      || !allowedSources.has(sourceImageName) || !planSources.has(sourceImageName)) continue;
    repairByCabinet.set(cabinetId, { ...repair, cabinetId, sourceImageName });
  }

  return {
    ...plan,
    unresolved: [...new Set([...(plan.unresolved || []), ...(result.unresolved || [])])],
    cabinets: plan.cabinets.map((cabinet) => {
      const repair = repairByCabinet.get(cabinet.cabinetId);
      if (!repair) return cabinet;
      return {
        ...cabinet,
        sourceCrops: [...cabinet.sourceCrops, {
          cropId: uniqueCropId(`${cabinet.cabinetId}-internal-repair`, usedCropIds),
          sourceImageName: repair.sourceImageName,
          role: "internal",
          rotationToUprightDeg: repair.rotationToUprightDeg,
          box: repair.box,
          region: repair.region,
          evidence: repair.evidence,
        }],
      };
    }),
  };
}

export function segmentationSourceReferenceErrors(plan: SegmentationPlan, allowedSourceImageNames: string[]) {
  const allowed = new Set(allowedSourceImageNames.map(clean).filter(Boolean));
  const errors: string[] = [];
  for (const view of plan.views) {
    if (!allowed.has(clean(view.imageName))) errors.push(`view:${view.imageName}`);
  }
  for (const cabinet of plan.cabinets) {
    for (const crop of cabinet.sourceCrops) {
      if (!allowed.has(clean(crop.sourceImageName))) errors.push(`${cabinet.cabinetId}/${crop.cropId}:${crop.sourceImageName}`);
    }
  }
  return [...new Set(errors)];
}
