import type { SegmentationPlan } from "./segmentation";

export type RotationToUprightDeg = 0 | 90 | 180 | 270;

export type OrientationAuditItem = {
  imageName: string;
  rotationToUprightDeg: RotationToUprightDeg;
  uprightTextEvidence: string;
  numberDirectionEvidence: string;
  widthDirectionEvidence: string;
  bottomHorizontalDimensionTexts: string[];
  sideVerticalDimensionTexts: string[];
  orientationBasis: "numbers_and_width_agree" | "numbers_only" | "width_only" | "conflict" | "insufficient";
  confidence: "high" | "medium" | "low";
};

export type OrientationAudit = {
  images: OrientationAuditItem[];
};

const VALID_ROTATIONS = new Set<RotationToUprightDeg>([0, 90, 180, 270]);

export function isOrientationAudit(value: unknown, expectedImageNames: string[] = []): value is OrientationAudit {
  if (!value || typeof value !== "object") return false;
  const images = (value as Partial<OrientationAudit>).images;
  if (!Array.isArray(images) || images.length === 0) return false;
  const valid = images.every((item) => Boolean(
    item
    && typeof item.imageName === "string"
    && item.imageName.trim()
    && VALID_ROTATIONS.has(item.rotationToUprightDeg)
    && typeof item.uprightTextEvidence === "string"
    && typeof item.numberDirectionEvidence === "string"
    && typeof item.widthDirectionEvidence === "string"
    && Array.isArray(item.bottomHorizontalDimensionTexts)
    && item.bottomHorizontalDimensionTexts.every((text) => typeof text === "string" && text.trim().length > 0)
    && Array.isArray(item.sideVerticalDimensionTexts)
    && item.sideVerticalDimensionTexts.every((text) => typeof text === "string" && text.trim().length > 0)
    && ["numbers_and_width_agree", "numbers_only", "width_only", "conflict", "insufficient"].includes(item.orientationBasis)
    && ["high", "medium", "low"].includes(item.confidence)
  ));
  if (!valid) return false;
  const returnedNames = images.map((item) => item.imageName);
  if (new Set(returnedNames).size !== returnedNames.length) return false;
  if (!expectedImageNames.length) return true;
  const returned = new Set(returnedNames);
  return images.length === expectedImageNames.length
    && new Set(expectedImageNames).size === expectedImageNames.length
    && expectedImageNames.every((name) => returned.has(name));
}

export function enforceOrientationConfidence(audit: OrientationAudit): OrientationAudit {
  return {
    images: audit.images.map((item) => {
      const hasNumberEvidence = Boolean(item.uprightTextEvidence.trim() && item.numberDirectionEvidence.trim());
      const hasWidthEvidence = Boolean(item.widthDirectionEvidence.trim() && item.bottomHorizontalDimensionTexts.length);
      const evidenceMatchesBasis = item.orientationBasis === "numbers_and_width_agree"
        ? hasNumberEvidence && hasWidthEvidence
        : item.orientationBasis === "numbers_only"
          ? hasNumberEvidence
          : item.orientationBasis === "width_only"
            ? hasWidthEvidence
            : false;
      return {
        ...item,
        confidence: !evidenceMatchesBasis || item.orientationBasis === "conflict" || item.orientationBasis === "insufficient"
          ? "low"
          : item.orientationBasis === "numbers_only" || item.orientationBasis === "width_only"
            ? item.confidence === "low" ? "low" : "medium"
            : item.confidence,
      };
    }),
  };
}

export function orientationTaskSummary(audit: OrientationAudit) {
  return audit.images.map((item) => ({
    imageName: item.imageName,
    lockedClockwiseRotationDeg: item.rotationToUprightDeg,
    uprightTextEvidence: item.uprightTextEvidence,
    numberDirectionEvidence: item.numberDirectionEvidence,
    widthDirectionEvidence: item.widthDirectionEvidence,
    bottomHorizontalWidthChain: item.bottomHorizontalDimensionTexts,
    sideVerticalHeightChain: item.sideVerticalDimensionTexts,
    orientationBasis: item.orientationBasis,
    confidence: item.confidence,
  }));
}

export function applyOrientationLocks(plan: SegmentationPlan, audit: OrientationAudit): SegmentationPlan {
  const rotationByImage = new Map(audit.images.map((item) => [item.imageName, item.rotationToUprightDeg] as const));
  return {
    ...plan,
    orientationAudit: audit,
    views: plan.views.map((view) => ({
      ...view,
      rotationToUprightDeg: rotationByImage.get(view.imageName) ?? view.rotationToUprightDeg,
    })),
    cabinets: plan.cabinets.map((cabinet) => ({
      ...cabinet,
      sourceCrops: cabinet.sourceCrops.map((crop) => ({
        ...crop,
        rotationToUprightDeg: rotationByImage.get(crop.sourceImageName) ?? crop.rotationToUprightDeg,
      })),
    })),
  };
}
