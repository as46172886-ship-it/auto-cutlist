import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const [fixturePath, imagePath, ...cropPaths] = process.argv.slice(2);
if (!fixturePath || !imagePath) {
  throw new Error("usage: node scripts/eval-non-door-fixture-live.mjs <fixture.json> <upright-image> <cabinet-crop...>");
}

const fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));
if (!Array.isArray(fixture.widthsMm) || !fixture.widthsMm.length) throw new Error("fixture.widthsMm is required");
if (cropPaths.length && ![fixture.widthsMm.length, fixture.widthsMm.length * 2].includes(cropPaths.length)) {
  throw new Error(`expected ${fixture.widthsMm.length} raw crops, optionally followed by ${fixture.widthsMm.length} line crops; received ${cropPaths.length}`);
}

async function imageSource(path) {
  const bytes = await readFile(resolve(path));
  const mime = /png/i.test(extname(path)) ? "image/png" : "image/jpeg";
  return { name: basename(path), dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
}

const source = await imageSource(imagePath);
const cropSources = await Promise.all(cropPaths.map(imageSource));
const widths = fixture.widthsMm.map((value) => Math.round(Number(value)));
const cabinets = widths.map((width, index) => {
  const cabinetId = `C${String(index + 1).padStart(2, "0")}`;
  return {
    cabinetId,
    elevationId: "E01",
    label: `第${index + 1}桶`,
    widthOrder: index + 1,
    bottomSegmentMm: width,
    bottomDimensionText: String(fixture.bottomDimensionTexts?.[index] ?? width),
    sourceCrops: [{
      cropId: `${cabinetId}-full`, sourceImageName: source.name, role: "internal", rotationToUprightDeg: 0,
      box: { x: 0, y: 0, width: 1000, height: 1000 }, region: "完整旋正圖，依鎖定底寬判讀本桶",
      evidence: "評測輸入保留完整尺寸鏈",
    }],
    confidence: "high",
    evidence: "獨立評測夾具鎖定的底部寬度鏈",
  };
});
const segmentation = {
  projectName: "獨立評測案件",
  drawingUnit: fixture.drawingUnit,
  views: [{ imageName: source.name, viewKind: "internal", elevationId: "E01", rotationToUprightDeg: 0, evidence: "已旋正" }],
  cabinets,
  unresolved: [],
};
const rawCabinetCrops = cabinets.map((cabinet, index) => ({
  name: cropSources[index]?.name || `${cabinet.cabinetId}-${source.name}`,
  dataUrl: cropSources[index]?.dataUrl || source.dataUrl,
  cabinetId: cabinet.cabinetId,
  cropId: `${cabinet.cabinetId}-full`,
  role: "internal",
  sourceImageName: source.name,
  region: cabinet.sourceCrops[0].region,
  scanPass: 1,
}));
const enhancedCabinetCrops = cropSources.slice(cabinets.length).map((enhanced, index) => ({
  ...rawCabinetCrops[index],
  name: `${enhanced.name}#線稿增強`,
  dataUrl: enhanced.dataUrl,
  focus: `${rawCabinetCrops[index].region}；自適應二值化線稿，需與原始裁切交叉核對`,
}));
const cabinetCrops = [...rawCabinetCrops, ...enhancedCabinetCrops];

const baseUrl = process.env.EVAL_BASE_URL || "http://127.0.0.1:5173";
const headers = { "content-type": "application/json" };
if (process.env.OAI_SITES_TOKEN) headers["OAI-Sites-Authorization"] = `Bearer ${process.env.OAI_SITES_TOKEN}`;
const orientation = { images: [{
  imageName: source.name,
  rotationToUprightDeg: 0,
  uprightTextEvidence: "評測檔已依原圖方向關卡實際旋正",
  numberDirectionEvidence: "文字及數字正立",
  widthDirectionEvidence: `底部水平鏈${fixture.bottomDimensionTexts.join("／")}`,
  bottomHorizontalDimensionTexts: fixture.bottomDimensionTexts,
  sideVerticalDimensionTexts: fixture.sideVerticalDimensionTexts || [],
  orientationBasis: "numbers_and_width_agree",
  confidence: "high",
}] };

async function postJson(path, payload, timeoutMs = 75_000) {
  const maxAttempts = Math.max(1, Number(process.env.EVAL_HTTP_ATTEMPTS || 2));
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => ({}));
    last = { response, body, attempt };
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) return last;
  }
  return last;
}

const carcassRun = await postJson("/api/carcass", { images: [source], orientation });
if (!carcassRun.response.ok) {
  console.log(JSON.stringify({ stage: "carcass", status: carcassRun.response.status, attempt: carcassRun.attempt, error: carcassRun.body.error, code: carcassRun.body.code }, null, 2));
  process.exit(2);
}

const nonDoorRun = await postJson("/api/non-door", {
  images: [source], carcass: carcassRun.body, segmentation, cabinetCrops,
});
if (!nonDoorRun.response.ok) {
  console.log(JSON.stringify({ stage: "non-door", status: nonDoorRun.response.status, attempt: nonDoorRun.attempt, error: nonDoorRun.body.error, code: nonDoorRun.body.code }, null, 2));
  process.exit(2);
}

const body = nonDoorRun.body;
const actualMaterials = body.result.materials.map((row) => `${row.item}|${row.spec}|${row.qty}`);
const actualHardware = body.result.hardware.map((row) => `${row.item}|${row.qty}`);
const expected = new Set([...(fixture.expectedMaterials || []), ...(fixture.expectedHardware || [])]);
const actual = new Set([...actualMaterials, ...actualHardware]);
const matched = [...actual].filter((row) => expected.has(row));
const precision = actual.size ? matched.length / actual.size : 0;
const recall = expected.size ? matched.length / expected.size : 0;
const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;

console.log(JSON.stringify({
  fixture: fixture.id,
  status: nonDoorRun.response.status,
  attempts: { carcass: carcassRun.attempt, nonDoor: nonDoorRun.attempt },
  matched: matched.length,
  expected: expected.size,
  actual: actual.size,
  precision: Number((precision * 100).toFixed(1)),
  recall: Number((recall * 100).toFixed(1)),
  f1: Number((f1 * 100).toFixed(1)),
  missing: [...expected].filter((row) => !actual.has(row)),
  extra: [...actual].filter((row) => !expected.has(row)),
  cabinets: body.analysis.cabinets.map((cabinet) => ({
    id: cabinet.id, W: cabinet.widthMm, H: cabinet.heightMm, D: cabinet.depthMm,
    fixed: cabinet.fixedShelves, adjustable: cabinet.adjustableShelves, drawers: cabinet.drawerCount,
    dividers: cabinet.middleDividers?.length || 0, foot: `${cabinet.footState}:${cabinet.footHeightMm}`,
  })),
  questions: body.analysis.questions,
  warnings: body.analysis.warnings,
}, null, 2));
