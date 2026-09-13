import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";

const imagePath = process.argv[2];
if (!imagePath) throw new Error("usage: node scripts/eval-non-door-live.mjs <upright-image>");
const bytes = await readFile(imagePath);
const mime = /png/i.test(extname(imagePath)) ? "image/png" : "image/jpeg";
const source = { name: basename(imagePath), dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
const cropPaths = process.argv.slice(3, 6);
const cropSources = await Promise.all(cropPaths.map(async (cropPath) => {
  const cropBytes = await readFile(cropPath);
  const cropMime = /png/i.test(extname(cropPath)) ? "image/png" : "image/jpeg";
  return { name: basename(cropPath), dataUrl: `data:${cropMime};base64,${cropBytes.toString("base64")}` };
}));
const widths = [400, 800, 600];
const cabinets = widths.map((width, index) => ({
  cabinetId: `C0${index + 1}`, elevationId: "E01", label: `第${index + 1}桶`, widthOrder: index + 1,
  bottomSegmentMm: width, bottomDimensionText: String(width / 10),
  sourceCrops: [{ cropId: `C0${index + 1}-full`, sourceImageName: source.name, role: "internal", rotationToUprightDeg: 0, box: { x: 0, y: 0, width: 1000, height: 1000 }, region: "完整旋正圖，依鎖定底寬判讀本桶", evidence: "評測輸入保留完整尺寸鏈" }],
  confidence: "high", evidence: "答案外洩隔離的底寬硬鎖",
}));
const segmentation = { projectName: "評測案件", drawingUnit: "cm", views: [{ imageName: source.name, viewKind: "internal", elevationId: "E01", rotationToUprightDeg: 0, evidence: "已旋正" }], cabinets, unresolved: [] };
const cabinetCrops = cabinets.map((cabinet, index) => ({ name: cropSources[index]?.name || `${cabinet.cabinetId}-${source.name}`, dataUrl: cropSources[index]?.dataUrl || source.dataUrl, cabinetId: cabinet.cabinetId, cropId: `${cabinet.cabinetId}-full`, role: "internal", sourceImageName: source.name, region: cabinet.sourceCrops[0].region, scanPass: 1 }));

const expectedMaterials = [
  "側板|426 × 2272|2", "側板|426 × 736|4", "頂底板|426 × 764|2", "頂底板|426 × 564|2", "頂底板|426 × 364|2",
  "中立板|397 × 133|1", "固格板|378 × 764|1", "固格板|378 × 564|1", "活格板|386 × 763|1", "活格板|386 × 563|2", "活格板|386 × 363|1",
  "前抽牆|100 × 310|4", "前抽牆|100 × 301|2", "邊抽牆|100 × 350|6", "抽底板|320 × 324|2", "抽底板|311 × 324|1", "屜頭|397 × 160|3",
  "封板|180 × 1100|1", "擋板|60 × 764|1", "擋板|60 × 564|1", "擋板|60 × 364|1", "背板|774 × 710|1", "背板|574 × 2246|1", "背板|374 × 710|1",
  "踢腳板|120 × 2800|1", "檯面|450 × 1200|1", "背條|110 × 564|2", "明鏡|350 × 1300|1",
];
const expectedHardware = ["A10|12", "KD|24", "抽木榫|60", "白固格器|12", "活格利|16", "35滑軌|3", "35伸縮衣桿|1", "鏡珠|4"];

const baseUrl = process.env.EVAL_BASE_URL || "http://127.0.0.1:5173";
const headers = { "content-type": "application/json" };
if (process.env.OAI_SITES_TOKEN) headers["OAI-Sites-Authorization"] = `Bearer ${process.env.OAI_SITES_TOKEN}`;
const orientation = { images: [{
  imageName: source.name, rotationToUprightDeg: 0,
  uprightTextEvidence: "評測檔已依原圖方向關卡實際旋正",
  numberDirectionEvidence: "文字及數字正立",
  widthDirectionEvidence: "底部水平鏈40／80／60",
  bottomHorizontalDimensionTexts: ["40", "80", "60"],
  sideVerticalDimensionTexts: ["55.2", "2.4", "16", "163.1", "2.4", "61.7", "227.2", "9.5", "15.9"],
  orientationBasis: "numbers_and_width_agree", confidence: "high",
}] };
const carcassResponse = await fetch(`${baseUrl}/api/carcass`, {
  method: "POST", headers, body: JSON.stringify({ images: [source], orientation }), signal: AbortSignal.timeout(75_000),
});
const carcass = await carcassResponse.json();
if (!carcassResponse.ok) {
  console.log(JSON.stringify({ stage: "carcass", status: carcassResponse.status, error: carcass.error, code: carcass.code }, null, 2));
  process.exit(2);
}
const response = await fetch(`${baseUrl}/api/non-door`, { method: "POST", headers, body: JSON.stringify({ images: [source], carcass, segmentation, cabinetCrops }), signal: AbortSignal.timeout(75_000) });
const body = await response.json();
if (!response.ok) { console.log(JSON.stringify({ status: response.status, error: body.error, code: body.code }, null, 2)); process.exit(2); }

const actualMaterials = body.result.materials.map((row) => `${row.item}|${row.spec}|${row.qty}`);
const actualHardware = body.result.hardware.map((row) => `${row.item}|${row.qty}`);
const expected = new Set([...expectedMaterials, ...expectedHardware]);
const actual = new Set([...actualMaterials, ...actualHardware]);
const matched = [...actual].filter((row) => expected.has(row));
const precision = actual.size ? matched.length / actual.size : 0;
const recall = expected.size ? matched.length / expected.size : 0;
const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
console.log(JSON.stringify({
  status: response.status, matched: matched.length, expected: expected.size, actual: actual.size,
  precision: Number((precision * 100).toFixed(1)), recall: Number((recall * 100).toFixed(1)), f1: Number((f1 * 100).toFixed(1)),
  missing: [...expected].filter((row) => !actual.has(row)), extra: [...actual].filter((row) => !expected.has(row)),
  cabinets: body.analysis.cabinets.map((cabinet) => ({ id: cabinet.id, W: cabinet.widthMm, H: cabinet.heightMm, D: cabinet.depthMm, fixed: cabinet.fixedShelves, adjustable: cabinet.adjustableShelves, drawers: cabinet.drawerCount })),
  questions: body.analysis.questions, warnings: body.analysis.warnings,
}, null, 2));
