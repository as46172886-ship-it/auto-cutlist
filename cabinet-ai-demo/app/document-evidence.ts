export type PdfTextRunEvidence = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
};

export type PdfLineEvidence = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  axis: "horizontal" | "vertical";
  length: number;
};

export type DocumentEvidence = {
  imageName: string;
  sourceKind: "vector_pdf" | "raster_pdf";
  extractor: "pdfjs_text_and_paths";
  pageWidth: number;
  pageHeight: number;
  extractedText: string;
  textRuns: PdfTextRunEvidence[];
  axisLines: PdfLineEvidence[];
  vectorPathCount: number;
};

type Matrix = [number, number, number, number, number, number];
type PdfOps = { save: number; restore: number; transform: number; constructPath: number };
type OperatorListLike = { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> };

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function point(matrix: Matrix, x: number, y: number) {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}

function numericArray(value: unknown): number[] {
  if (!value || typeof value !== "object" || !(Symbol.iterator in value)) return [];
  return Array.from(value as Iterable<unknown>, (item) => finite(item));
}

function normalizedPoint(x: number, y: number, pageBox: [number, number, number, number]) {
  const [left, bottom, right, top] = pageBox;
  const width = Math.max(1, right - left);
  const height = Math.max(1, top - bottom);
  return {
    x: clamp(Math.round((x - left) / width * 1000), 0, 1000),
    y: clamp(Math.round((top - y) / height * 1000), 0, 1000),
  };
}

/**
 * PDF.js exposes already-decoded vector drawing operations.  This parser keeps
 * only long, nearly horizontal/vertical straight segments: the useful subset
 * for cabinet boundaries, dimension lines and shelf lines.  Curves and fills
 * are intentionally ignored instead of being guessed into cabinet geometry.
 */
export function extractAxisAlignedPdfLines(
  operatorList: OperatorListLike,
  ops: PdfOps,
  pageBox: [number, number, number, number],
  limit = 900,
) {
  const found: PdfLineEvidence[] = [];
  const stack: Matrix[] = [];
  let matrix: Matrix = [...IDENTITY];
  let vectorPathCount = 0;

  const append = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const rawLength = Math.hypot(dx, dy);
    if (rawLength < 4) return;
    const tolerance = Math.max(0.9, rawLength * 0.012);
    const axis = Math.abs(dy) <= tolerance ? "horizontal" : Math.abs(dx) <= tolerance ? "vertical" : null;
    if (!axis) return;
    const a = normalizedPoint(from.x, from.y, pageBox);
    const b = normalizedPoint(to.x, to.y, pageBox);
    const length = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
    if (length < 3) return;
    found.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, axis, length });
  };

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = Number(operatorList.fnArray[index]);
    const rawArgs = operatorList.argsArray[index];
    if (fn === ops.save) {
      stack.push([...matrix]);
      continue;
    }
    if (fn === ops.restore) {
      matrix = stack.pop() || [...IDENTITY];
      continue;
    }
    if (fn === ops.transform) {
      const values = numericArray(rawArgs);
      if (values.length >= 6) matrix = multiply(matrix, values.slice(0, 6) as Matrix);
      continue;
    }
    if (fn !== ops.constructPath || !Array.isArray(rawArgs)) continue;
    vectorPathCount += 1;
    const pathContainer = rawArgs[1];
    const path = Array.isArray(pathContainer) ? numericArray(pathContainer[0]) : [];
    if (!path.length) continue;
    let cursor: { x: number; y: number } | null = null;
    let start: { x: number; y: number } | null = null;
    for (let offset = 0; offset < path.length;) {
      const drawOp = path[offset++];
      if (drawOp === 0 && offset + 1 < path.length) {
        cursor = point(matrix, path[offset++], path[offset++]);
        start = cursor;
      } else if (drawOp === 1 && offset + 1 < path.length) {
        const next = point(matrix, path[offset++], path[offset++]);
        if (cursor) append(cursor, next);
        cursor = next;
      } else if (drawOp === 2 && offset + 5 < path.length) {
        offset += 4;
        cursor = point(matrix, path[offset++], path[offset++]);
      } else if (drawOp === 3) {
        if (cursor && start) append(cursor, start);
        cursor = start;
      } else {
        break;
      }
    }
  }

  const deduplicated = new Map<string, PdfLineEvidence>();
  for (const line of found.sort((a, b) => b.length - a.length)) {
    const key = [line.axis, Math.round(line.x1 / 2), Math.round(line.y1 / 2), Math.round(line.x2 / 2), Math.round(line.y2 / 2)].join(":");
    if (!deduplicated.has(key)) deduplicated.set(key, line);
    if (deduplicated.size >= limit) break;
  }
  return { axisLines: [...deduplicated.values()], vectorPathCount };
}

export function isAllowedDocumentEvidence(value: unknown): value is DocumentEvidence {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DocumentEvidence>;
  return typeof item.imageName === "string" && item.imageName.length <= 240
    && (item.sourceKind === "vector_pdf" || item.sourceKind === "raster_pdf")
    && item.extractor === "pdfjs_text_and_paths"
    && Number(item.pageWidth) > 0 && Number(item.pageHeight) > 0
    && typeof item.extractedText === "string" && item.extractedText.length <= 16_000
    && Array.isArray(item.textRuns) && item.textRuns.length <= 1_200
    && Array.isArray(item.axisLines) && item.axisLines.length <= 1_200;
}

const importantText = /(?:\d|D\s*\d|DEPTH|深|F\s*\d|鏡|踢腳|檯面|封板|填縫|抽|中立|固格|活格|缺口|衣桿|衣架)/i;

export function documentEvidencePromptSummary(values: DocumentEvidence[]) {
  return values.slice(0, 6).map((value) => ({
    imageName: value.imageName,
    sourceKind: value.sourceKind,
    extractor: value.extractor,
    extractedText: value.extractedText.slice(0, 8_000),
    textRuns: value.textRuns.filter((run) => importantText.test(run.text)).slice(0, 260),
    axisLines: value.axisLines.slice().sort((a, b) => b.length - a.length).slice(0, 180),
    vectorPathCount: value.vectorPathCount,
  }));
}
