import type { DocumentEvidence, PdfLineEvidence, PdfTextRunEvidence } from "../../document-evidence.ts";
import type { OrientationAudit } from "../../orientation-audit.ts";
import { dimensionTextToMm, measurementToMm, normalizeDrawingUnit } from "./dimensions.ts";
import type { CarcassObservationRead, DrawingUnit, MeasurementObservation } from "./model.ts";

export type DimensionCandidate = {
  source: "pdf_vector" | "orientation_ai";
  imageName: string;
  rawText: string;
  valueMm: number;
  role: "depth" | "fixed_shelf" | "thickness" | "dimension";
  axis: "horizontal" | "vertical" | "unknown";
  x: number;
  y: number;
  lineDistance: number;
  lineKey: string | null;
  lineIndex: number | null;
  spanStart: number | null;
  spanEnd: number | null;
};

export type DimensionCandidateAudit = {
  candidatesConsidered: number;
  vectorCandidates: number;
  closuresAccepted: number;
  repairs: string[];
  conflicts: string[];
  recognitionPasses: string;
};

export type CandidateReconciliation = {
  observations: CarcassObservationRead;
  audit: DimensionCandidateAudit;
};

type HeightChain = {
  source: DimensionCandidate["source"];
  imageName: string;
  valuesMm: number[];
  rawTexts: string[];
  scoreBias: number;
};

const EMPTY_MEASUREMENT: MeasurementObservation = { rawText: "", value: 0, unit: "unknown", evidence: "" };

function numericText(value: string) {
  return String(value || "").replaceAll(",", ".").match(/\d+(?:\.\d+)?/)?.[0] || "";
}

function candidateRole(text: string): DimensionCandidate["role"] {
  const normalized = String(text || "").trim();
  if (/^(?:D\s*|深(?:度)?\s*)\d/i.test(normalized)) return "depth";
  if (/^F\s*\d/i.test(normalized)) return "fixed_shelf";
  if (/^T\s*\d/i.test(normalized)) return "thickness";
  return "dimension";
}

function pointSegmentDistance(x: number, y: number, line: PdfLineEvidence) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(x - line.x1, y - line.y1);
  const t = Math.max(0, Math.min(1, ((x - line.x1) * dx + (y - line.y1) * dy) / lengthSquared));
  return Math.hypot(x - (line.x1 + t * dx), y - (line.y1 + t * dy));
}

function nearestLineRelation(run: PdfTextRunEvidence, lines: PdfLineEvidence[]) {
  const x = run.x + run.width / 2;
  const y = run.y + run.height / 2;
  const rotation = ((Math.round(run.rotationDeg) % 180) + 180) % 180;
  const textAxis = rotation >= 45 && rotation <= 135 ? "vertical" : "horizontal";
  const nearest = lines
    .map((line, lineIndex) => {
      const spanStart = line.axis === "vertical" ? Math.min(line.y1, line.y2) : Math.min(line.x1, line.x2);
      const spanEnd = line.axis === "vertical" ? Math.max(line.y1, line.y2) : Math.max(line.x1, line.x2);
      const projection = line.axis === "vertical" ? y : x;
      return {
        line,
        lineIndex,
        spanStart,
        spanEnd,
        containsProjection: projection >= spanStart && projection <= spanEnd,
        distance: pointSegmentDistance(x, y, line),
      };
    })
    .filter((item) => item.line.axis === textAxis)
    .sort((a, b) => a.distance - b.distance
      || Number(b.containsProjection) - Number(a.containsProjection)
      || (a.spanEnd - a.spanStart) - (b.spanEnd - b.spanStart))[0];
  if (!nearest || nearest.distance > 95) return {
    axis: textAxis as "horizontal" | "vertical",
    distance: 999,
    lineKey: null,
    lineIndex: null,
    spanStart: null,
    spanEnd: null,
  };
  const crossAxisCoordinate = nearest.line.axis === "vertical"
    ? Math.round((nearest.line.x1 + nearest.line.x2) / 2)
    : Math.round((nearest.line.y1 + nearest.line.y2) / 2);
  return {
    axis: nearest.line.axis,
    distance: Math.round(nearest.distance),
    lineKey: `${nearest.line.axis}:${crossAxisCoordinate}`,
    lineIndex: nearest.lineIndex,
    spanStart: nearest.spanStart,
    spanEnd: nearest.spanEnd,
  };
}

function textRunToCandidate(run: PdfTextRunEvidence, evidence: DocumentEvidence, drawingUnit: DrawingUnit): DimensionCandidate | null {
  const number = numericText(run.text);
  if (!number) return null;
  const role = candidateRole(run.text);
  const valueMm = dimensionTextToMm(run.text, drawingUnit);
  if (!valueMm || valueMm > 10_000) return null;
  const relation = nearestLineRelation(run, evidence.axisLines);
  return {
    source: "pdf_vector",
    imageName: evidence.imageName,
    rawText: run.text.trim(),
    valueMm,
    role,
    axis: relation.axis,
    x: Math.round(run.x + run.width / 2),
    y: Math.round(run.y + run.height / 2),
    lineDistance: relation.distance,
    lineKey: relation.lineKey,
    lineIndex: relation.lineIndex,
    spanStart: relation.spanStart,
    spanEnd: relation.spanEnd,
  };
}

export function extractDocumentDimensionCandidates(values: DocumentEvidence[], drawingUnit: DrawingUnit) {
  return values
    .filter((value) => value.sourceKind === "vector_pdf")
    .flatMap((value) => value.textRuns.map((run) => textRunToCandidate(run, value, drawingUnit)))
    .filter((item): item is DimensionCandidate => Boolean(item))
    .slice(0, 800);
}

function orientationCandidates(audit: OrientationAudit, drawingUnit: DrawingUnit) {
  return audit.images.flatMap((image) => image.sideVerticalDimensionTexts.map((rawText, index) => ({
    source: "orientation_ai" as const,
    imageName: image.imageName,
    rawText,
    valueMm: dimensionTextToMm(rawText, drawingUnit),
    role: candidateRole(rawText),
    axis: "vertical" as const,
    x: 0,
    y: index,
    lineDistance: 999,
    lineKey: null,
    lineIndex: null,
    spanStart: null,
    spanEnd: null,
  }))).filter((item) => item.valueMm > 0);
}

function groupBy<T, K>(values: T[], keyFor: (value: T) => K) {
  const grouped = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const existing = grouped.get(key);
    if (existing) existing.push(value);
    else grouped.set(key, [value]);
  }
  return grouped;
}

function hasCompatibleSpans(selected: DimensionCandidate[]) {
  if (selected[0]?.source !== "pdf_vector") return true;
  if (selected.some((item) => !item.lineKey || item.spanStart === null || item.spanEnd === null)) return false;
  if (new Set(selected.map((item) => item.lineKey)).size !== 1) return false;
  if (new Set(selected.map((item) => item.lineIndex)).size === 1) return true;
  const spans = selected.map((item) => ({ start: item.spanStart!, end: item.spanEnd! })).sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1];
    const current = spans[index];
    if (current.start < previous.end - 2 || Math.abs(current.start - previous.end) > 2) return false;
  }
  return true;
}

function contiguousChains(candidates: DimensionCandidate[], source: DimensionCandidate["source"], imageName: string, scoreBias: number) {
  const chains: HeightChain[] = [];
  for (let start = 0; start < candidates.length; start += 1) {
    for (let length = 2; length <= 4 && start + length <= candidates.length; length += 1) {
      const selected = candidates.slice(start, start + length);
      if (selected.some((item) => item.role !== "dimension" || item.valueMm <= 0)) continue;
      if (!hasCompatibleSpans(selected)) continue;
      const total = selected.reduce((sum, item) => sum + item.valueMm, 0);
      if (total < 100 || total > 3_500) continue;
      chains.push({ source, imageName, valuesMm: selected.map((item) => item.valueMm), rawTexts: selected.map((item) => item.rawText), scoreBias });
    }
  }
  return chains;
}

function pdfHeightChains(candidates: DimensionCandidate[]) {
  const chains: HeightChain[] = [];
  const byImage = groupBy(candidates.filter((item) => item.role === "dimension" && item.axis === "vertical" && item.lineKey), (item) => item.imageName);
  for (const [imageName, imageCandidates] of byImage) {
    const byLine = groupBy(imageCandidates, (item) => item.lineKey!);
    for (const lineCandidates of byLine.values()) {
      lineCandidates.sort((a, b) => a.y - b.y);
      chains.push(...contiguousChains(lineCandidates, "pdf_vector", imageName, -0.025));
    }
  }
  return chains;
}

function orientationHeightChains(candidates: DimensionCandidate[]) {
  const chains: HeightChain[] = [];
  const byImage = groupBy(candidates, (item) => item.imageName);
  for (const [imageName, imageCandidates] of byImage) chains.push(...contiguousChains(imageCandidates, "orientation_ai", imageName, 0));
  return chains;
}

function normalizedDistance(left: number[], right: number[]) {
  if (left.length !== right.length || !left.length) return Number.POSITIVE_INFINITY;
  return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]) / Math.max(50, value, right[index]), 0) / left.length;
}

function relativeDifference(left: number, right: number) {
  return Math.abs(left - right) / Math.max(left, right);
}

function chainKey(chain: HeightChain) {
  return chain.valuesMm.join("+");
}

function uniqueBest<T extends { score: number; key: string }>(ranked: T[], maximumScore: number, margin: number) {
  const sorted = ranked.filter((item) => item.score <= maximumScore).sort((a, b) => a.score - b.score);
  if (!sorted.length) return { best: null as T | null, ambiguous: false };
  const best = sorted[0];
  const alternative = sorted.find((item) => item.key !== best.key);
  return { best: !alternative || alternative.score - best.score >= margin ? best : null, ambiguous: Boolean(alternative && alternative.score - best.score < margin) };
}

function measurement(rawText: string, valueMm: number, drawingUnit: DrawingUnit, evidence: string): MeasurementObservation {
  const unit = drawingUnit === "cm" ? "cm" : "mm";
  return { rawText, value: unit === "cm" ? valueMm / 10 : valueMm, unit, evidence };
}

function reconcileHeightChains(
  observations: CarcassObservationRead,
  chains: HeightChain[],
  audit: DimensionCandidateAudit,
) {
  for (const cabinet of observations.cabinets) {
    if (!cabinet.sidePanelsContinuous || cabinet.heightMode === "shared_height" || cabinet.heightMode === "unknown") continue;
    const cabinetId = `C${String(cabinet.widthOrder).padStart(2, "0")}`;
    if (cabinet.heightMode === "segment_chain") {
      const observed = cabinet.heightSegments.map((item) => measurementToMm(item, observations.drawingUnit));
      if (!observed.length || observed.some((value) => !value)) continue;
      const ranked = chains.filter((chain) => chain.valuesMm.length === observed.length).map((chain) => ({
        chain,
        key: chainKey(chain),
        score: normalizedDistance(observed, chain.valuesMm) + chain.scoreBias,
      }));
      const resolved = uniqueBest(ranked, 0.105, 0.025);
      if (resolved.best && resolved.best.score > 0.004) {
        const chain = resolved.best.chain;
        cabinet.heightSegments = chain.valuesMm.map((valueMm, index) => measurement(chain.rawTexts[index], valueMm, observations.drawingUnit, `${chain.source}候選與完整高度鏈閉合`));
        cabinet.heightEvidence = `${cabinet.heightEvidence}；候選求解以${chain.rawTexts.join("＋")}閉合`.replace(/^；/, "");
        audit.closuresAccepted += 1;
        audit.repairs.push(`${cabinetId}高度鏈 ${observed.join("＋")} → ${chain.valuesMm.join("＋")} mm`);
      } else if (resolved.ambiguous) audit.conflicts.push(`${cabinetId}高度鏈有多組近似候選，未自動改值。`);
      continue;
    }

    const observedTotal = measurementToMm(cabinet.heightTotal, observations.drawingUnit);
    if (!observedTotal) continue;
    const ranked = chains.filter((chain) => !chain.valuesMm.some((value) => relativeDifference(value, observedTotal) <= 0.055)).map((chain) => {
      const total = chain.valuesMm.reduce((sum, value) => sum + value, 0);
      const containsGap24 = chain.valuesMm.includes(24);
      const relative = relativeDifference(total, observedTotal);
      const sourceBonus = chain.source === "pdf_vector" ? -0.02 : containsGap24 ? -0.012 : 0;
      return { chain, key: chainKey(chain), total, score: relative + chain.scoreBias + sourceBonus };
    });
    const resolved = uniqueBest(ranked, 0.055, 0.018);
    if (resolved.best && Math.abs(resolved.best.total - observedTotal) >= 6) {
      const chain = resolved.best.chain;
      cabinet.heightMode = "segment_chain";
      cabinet.heightTotal = { ...EMPTY_MEASUREMENT };
      cabinet.heightSegments = chain.valuesMm.map((valueMm, index) => measurement(chain.rawTexts[index], valueMm, observations.drawingUnit, `${chain.source}候選與連續側板閉合`));
      cabinet.heightEvidence = `${cabinet.heightEvidence}；原總高${observedTotal}mm與候選鏈衝突，改由${chain.rawTexts.join("＋")}閉合`.replace(/^；/, "");
      audit.closuresAccepted += 1;
      audit.repairs.push(`${cabinetId}總高 ${observedTotal} → ${resolved.best.total} mm（${chain.valuesMm.join("＋")}）`);
    } else if (resolved.ambiguous) audit.conflicts.push(`${cabinetId}總高存在多組可行閉合鏈，保留原讀值。`);
  }
}

function reconcileRepeatedDepth(observations: CarcassObservationRead, candidates: DimensionCandidate[], audit: DimensionCandidateAudit) {
  const depthCandidates = candidates.filter((item) => item.role === "depth" && item.valueMm >= 200 && item.valueMm <= 800);
  const grouped = groupBy(depthCandidates, (item) => item.valueMm);
  if (grouped.size !== 1) {
    if (grouped.size > 1) audit.conflicts.push("電子PDF出現多個不同深度值，保留原本適用範圍，不自動合併。");
    return;
  }
  const [depthMm, matches] = [...grouped.entries()][0];
  const orders = observations.cabinets.map((item) => item.widthOrder).filter((item) => item > 0);
  if (matches.length < orders.length || !orders.length) return;
  const existingValues = new Set(observations.depthGroups.map((group) => measurementToMm(group.measurement, observations.drawingUnit)).filter(Boolean));
  if (existingValues.size > 1 || (existingValues.size === 1 && !existingValues.has(depthMm))) {
    audit.conflicts.push(`深度候選${depthMm}mm與模型深度群組衝突，未自動覆蓋。`);
    return;
  }
  const covered = new Set(observations.depthGroups.flatMap((group) => group.appliesToOrders));
  const missing = orders.filter((order) => !covered.has(order));
  if (!missing.length) return;
  const rawText = matches[0].rawText;
  observations.depthGroups.push({
    groupId: "PDF-REPEATED-DEPTH",
    measurement: measurement(rawText, depthMm, observations.drawingUnit, `電子PDF重複${matches.length}處深度文字`),
    appliesToOrders: missing,
    evidence: `電子PDF同值深度${rawText}重複${matches.length}處，補足尚未覆蓋的桶序。`,
    confidence: "high",
  });
  audit.repairs.push(`深度${depthMm}mm補足桶序 ${missing.join("、")}`);
}

export function reconcileCarcassCandidates(
  input: CarcassObservationRead,
  orientation: OrientationAudit,
  documents: DocumentEvidence[] = [],
): CandidateReconciliation {
  const observations = structuredClone(input);
  observations.drawingUnit = normalizeDrawingUnit(observations.drawingUnit);
  const vector = extractDocumentDimensionCandidates(documents, observations.drawingUnit);
  const orientationList = orientationCandidates(orientation, observations.drawingUnit);
  const chains = [...pdfHeightChains(vector), ...orientationHeightChains(orientationList)];
  const audit: DimensionCandidateAudit = {
    candidatesConsidered: vector.length + orientationList.length,
    vectorCandidates: vector.length,
    closuresAccepted: 0,
    repairs: [],
    conflicts: [],
    recognitionPasses: "方向尺寸候選＋桶身尺寸觀察＋向量PDF證據＋確定性閉合求解",
  };
  if (observations.drawingUnit !== "unknown") {
    reconcileHeightChains(observations, chains, audit);
    reconcileRepeatedDepth(observations, vector, audit);
  }
  return { observations, audit };
}
