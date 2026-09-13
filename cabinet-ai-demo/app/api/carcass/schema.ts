const confidence = { type: "string", enum: ["high", "medium", "low"] } as const;

const measurement = {
  type: "object",
  additionalProperties: false,
  required: ["rawText", "value", "unit", "evidence"],
  properties: {
    rawText: { type: "string" },
    value: { type: "number" },
    unit: { type: "string", enum: ["cm", "mm", "drawing", "unknown"] },
    evidence: { type: "string" },
  },
} as const;

export const carcassObservationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["projectName", "drawingUnit", "cabinets", "depthGroups", "unresolved"],
  properties: {
    projectName: { type: "string" },
    drawingUnit: { type: "string", enum: ["cm", "mm", "mixed", "unknown"] },
    cabinets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "widthOrder", "heightMode", "heightTotal", "heightSegments", "heightSharedWithOrder",
          "sidePanelsContinuous", "bottomBoundaryEvidence", "topBoundaryEvidence", "heightEvidence",
          "depthGroupId", "confidence",
        ],
        properties: {
          widthOrder: { type: "integer", minimum: 1 },
          heightMode: { type: "string", enum: ["explicit_total", "segment_chain", "shared_height", "unknown"] },
          heightTotal: measurement,
          heightSegments: { type: "array", items: measurement },
          heightSharedWithOrder: { type: "integer", minimum: 0 },
          sidePanelsContinuous: { type: "boolean" },
          bottomBoundaryEvidence: { type: "string" },
          topBoundaryEvidence: { type: "string" },
          heightEvidence: { type: "string" },
          depthGroupId: { type: "string" },
          confidence,
        },
      },
    },
    depthGroups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["groupId", "measurement", "appliesToOrders", "evidence", "confidence"],
        properties: {
          groupId: { type: "string" },
          measurement,
          appliesToOrders: { type: "array", items: { type: "integer", minimum: 1 } },
          evidence: { type: "string" },
          confidence,
        },
      },
    },
    unresolved: { type: "array", items: { type: "string" } },
  },
} as const;
