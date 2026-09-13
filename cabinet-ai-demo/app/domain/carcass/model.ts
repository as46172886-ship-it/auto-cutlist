import type { OrientationAudit } from "../../orientation-audit.ts";

export type Confidence = "high" | "medium" | "low";
export type DrawingUnit = "cm" | "mm" | "mixed" | "unknown";
export type MeasurementUnit = "cm" | "mm" | "drawing" | "unknown";
export type HeightMode = "explicit_total" | "segment_chain" | "shared_height" | "unknown";

export type MeasurementObservation = {
  rawText: string;
  value: number;
  unit: MeasurementUnit;
  evidence: string;
};

export type CabinetObservation = {
  widthOrder: number;
  heightMode: HeightMode;
  heightTotal: MeasurementObservation;
  heightSegments: MeasurementObservation[];
  heightSharedWithOrder: number;
  sidePanelsContinuous: boolean;
  bottomBoundaryEvidence: string;
  topBoundaryEvidence: string;
  heightEvidence: string;
  depthGroupId: string;
  confidence: Confidence;
};

export type DepthGroupObservation = {
  groupId: string;
  measurement: MeasurementObservation;
  appliesToOrders: number[];
  evidence: string;
  confidence: Confidence;
};

export type CarcassObservationRead = {
  projectName: string;
  drawingUnit: DrawingUnit;
  cabinets: CabinetObservation[];
  depthGroups: DepthGroupObservation[];
  unresolved: string[];
};

export type DimensionSource = "orientation_lock" | "explicit_total" | "segment_chain" | "shared_height" | "depth_group" | "missing";

export type CarcassCabinet = {
  widthOrder: number;
  cabinetId: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  widthRawText: string;
  heightRawTexts: string[];
  depthRawText: string;
  heightFormula: string;
  widthEvidence: string;
  heightEvidence: string;
  depthEvidence: string;
  confidence: Confidence;
  widthSource: DimensionSource;
  heightSource: DimensionSource;
  depthSource: DimensionSource;
  complete: boolean;
};

export type CarcassMaterialRow = {
  item: "側板" | "頂底板" | "背板";
  spec: string;
  thicknessMm: 18 | 8;
  qty: number;
  cabinetIds: string[];
  formula: string;
  ruleId: string;
  note: string;
};

export type CarcassResult = {
  mode: "carcass_only";
  projectName: string;
  drawingUnit: DrawingUnit;
  cabinets: CarcassCabinet[];
  materials: CarcassMaterialRow[];
  unresolved: string[];
  warnings: string[];
  excluded: string[];
  candidateAudit?: {
    candidatesConsidered: number;
    vectorCandidates: number;
    closuresAccepted: number;
    repairs: string[];
    conflicts: string[];
    recognitionPasses: string;
  };
  complete: boolean;
};

export type CarcassBuildInput = {
  observations: CarcassObservationRead;
  orientation: OrientationAudit;
};
