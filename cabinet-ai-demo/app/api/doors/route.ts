export const runtime = "edge";

import { calculateCompleteSop, type AnalysisForSop } from "../../sop.ts";
import { applyDoorRecognition, doorIsReadyForHardware, doorReadUsesOnlyKnownSymbolCrops, doorSymbolCropNames, lockableDoorRead } from "../../door-recognition.ts";
import { batchForConcurrency, DOOR_SCAN_ATTEMPTS, doorCropsForAttempt, doorSourceEvidenceCropNames, isDoorNoResponseError, missingDoorSourceCabinetIds, preserveFirstDoorSymbolLock, selectDoorCropsForRequest } from "../../door-scan.ts";
import { indexDoorCabinetsById } from "../../door-cabinet-alignment.ts";
import { DOOR_ATTEMPT_TIMEOUT_MS, DOOR_SCAN_CONCURRENCY } from "../../door-scan-budget.ts";
import { isSegmentationPlan, type CabinetCropInput, type SegmentationPlan } from "../../segmentation.ts";
import { callStructuredAI, isAllowedCabinetCrop } from "../analyze/pipeline.ts";
import { normalizeSlantedHandleMarkerEvidence } from "../../slanted-handle-audit.ts";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const DOOR_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["cabinetDoors"],
  properties: {
    cabinetDoors: {
      type: "array", minItems: 1, maxItems: 1,
      items: {
        type: "object", additionalProperties: false,
        required: ["cabinetId", "status", "sourceImageName", "region", "doors", "excludedSurfaces", "unresolvedDoorRegions", "confidence", "evidence"],
        properties: {
          cabinetId: { type: "string" },
          status: { type: "string", enum: ["confirmed_4e", "partial", "confirmed_no_4e", "unknown"] },
          sourceImageName: { type: "string" },
          region: { type: "string" },
          doors: {
            type: "array", maxItems: 20,
            items: {
              type: "object", additionalProperties: false,
              required: ["type", "count", "countBasis", "doorSymbols", "symbolRegions", "openingWidthMm", "openingHeightMm", "finishedWidthMm", "finishedHeightMm", "dimensionBasis", "direction", "jHandleCount", "slantedHandle", "slantedHandleCount", "slantedHandleStyle", "includesBottom30", "includesSlantedGap24", "slantedGap24Context", "hingeCountPerDoor", "evidence"],
              properties: {
                type: { type: "string", enum: ["4E", "aluminum", "none"] },
                count: { type: "integer", minimum: 0, maximum: 20 },
                countBasis: { type: "string", enum: ["symbols", "explicit_note", "unknown"] },
                doorSymbols: { type: "array", items: { type: "string", enum: ["<", ">"] }, maxItems: 20 },
                symbolRegions: {
                  type: "array", maxItems: 20,
                  items: {
                    type: "object", additionalProperties: false,
                    required: ["symbol", "cropName", "region", "xPermille", "yPermille", "evidence"],
                    properties: {
                      symbol: { type: "string", enum: ["<", ">"] }, cropName: { type: "string" }, region: { type: "string" },
                      xPermille: { type: "integer", minimum: 0, maximum: 1000 }, yPermille: { type: "integer", minimum: 0, maximum: 1000 }, evidence: { type: "string" },
                    },
                  },
                },
                openingWidthMm: { type: "integer", minimum: 0 }, openingHeightMm: { type: "integer", minimum: 0 },
                finishedWidthMm: { type: "integer", minimum: 0 }, finishedHeightMm: { type: "integer", minimum: 0 },
                dimensionBasis: { type: "string", enum: ["opening", "finished", "unknown"] },
                direction: { type: "string", enum: ["left", "right", "mixed", "unknown"] },
                jHandleCount: { type: "integer", minimum: 0, maximum: 20 },
                slantedHandle: { type: "boolean" }, slantedHandleCount: { type: "integer", minimum: 0, maximum: 20 },
                slantedHandleStyle: { type: "string", enum: ["top", "bottom", "long", "none", "unknown"] },
                includesBottom30: { type: "boolean" }, includesSlantedGap24: { type: "boolean" },
                slantedGap24Context: { type: "string", enum: ["none", "door_chain_included", "already_separate", "stacked_lift", "unknown"] },
                hingeCountPerDoor: { type: "integer", minimum: 0 }, evidence: { type: "string" },
              },
            },
          },
          excludedSurfaces: { type: "array", items: { type: "string" } },
          unresolvedDoorRegions: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["high", "medium", "low"] }, evidence: { type: "string" },
        },
      },
    },
  },
};

const DOOR_INSTRUCTIONS = `你是系統櫃4E門板專用讀圖員。只辨識功能4E門板、開向、門尺寸與門把加工；鋁框門只分類排除，不拆料。

硬規則：
1. 一個門面內清楚的「<」代表一片左開門，「>」代表一片右開門。符號可能是跨越大部分門面的兩段大型虛線／點線人字幾何，不一定是印刷文字：兩條斜線的共同尖端在左才是「<」，共同尖端在右才是「>」。高對比圖與斜向遮罩只能協助定位；必須回到同輪提供的第一輪原始門面／桶內裁切再次看見，symbolRegions.cropName固定引用原始裁切，不得引用p2／p3輔助圖。必須逐個定位實際cropName、座標與區域；不得用門框數、常見配置、單一斜線或裁切邊界猜片數。
2. doorSymbols依左到右、上到下排列，count必須等於doorSymbols長度，countBasis必須是symbols。若尺寸相同且加工相同可合成一組；尺寸或加工不同必須分組。
3. dimensionBasis=finished只限圖面直接標單片完成門面；dimensionBasis=opening時openingWidthMm/openingHeightMm填整組開口，後端才會扣單門縫與門高4mm。看不清就unknown且尺寸填0，不得猜。
4. 24mm／2.4cm斜把縫只可依尺寸鏈判一次：開口高度仍包含它用door_chain_included；圖上已分開標或門高已扣用already_separate；疊櫃上抬用stacked_lift；沒有斜把用none。
5. slantedHandleStyle精確分top（上斜把）、bottom（下斜把）、long（長斜把）、none或unknown；slantedHandleCount只算實際加工門片。門邊孤立的彩色小三角只能作斜把加工證據，絕不可當成左／右開向。J把只依小方形把手記號計數。
6. hingeCountPerDoor固定填0，由後端依完成門高算；普通門油壓器由後端每片1個。所有文字使用繁體中文，只描述圖上證據。`;

function doorScore(read: JsonRecord) {
  const resolution = lockableDoorRead(read);
  if (resolution.status !== "confirmed_4e") return read.status === "confirmed_no_4e" ? 1 : 0;
  const count = resolution.doors.reduce((sum, door) => sum + Math.max(0, Math.round(Number((door as JsonRecord).count) || 0)), 0);
  const ready = resolution.doors.filter((door) => doorIsReadyForHardware(door as JsonRecord)
    && (!(door as JsonRecord).slantedHandle || !["unknown", "none", ""].includes(String((door as JsonRecord).slantedHandleStyle || "unknown")))).length;
  return count * 100 + ready * 20;
}

async function scanCabinetDoors(key: string, segment: SegmentationPlan["cabinets"][number], allCrops: CabinetCropInput[], cabinet: JsonRecord) {
  const cabinetCrops = allCrops.filter((crop) => crop.cabinetId === segment.cabinetId);
  let finalRead: JsonRecord | null = null;
  let firstSymbolLock: JsonRecord | null = null;
  let noDoorConfirmations = 0;
  let attemptsUsed = 0;
  for (const attemptNo of DOOR_SCAN_ATTEMPTS) {
    const selected = doorCropsForAttempt(cabinetCrops, attemptNo);
    if (!selected.length) continue;
    attemptsUsed = attemptNo;
    try {
      const run = await callStructuredAI(key, selected.map(({ name, dataUrl }) => ({ name, dataUrl })), {
        instructions: DOOR_INSTRUCTIONS,
        taskText: `只輸出cabinetId=${segment.cabinetId}。鎖定桶寬=${segment.bottomSegmentMm}mm；桶身資料只供開口關聯，不是答案：${JSON.stringify({ id: cabinet.id, widthMm: cabinet.widthMm, heightMm: cabinet.heightMm, depthMm: cabinet.depthMm, drawerGroups: cabinet.drawerGroups, baffles: cabinet.baffles, drawingNotes: cabinet.drawingNotes })}。本輪裁切：${JSON.stringify(selected.map(({ name, role, region, focus, scanPass }) => ({ name, role, region, focus: focus || "全桶", scanPass: scanPass || 1 })))}。${firstSymbolLock ? `前輪不可覆蓋的符號鎖：${JSON.stringify(lockableDoorRead(firstSymbolLock).doors)}；本輪只能保留並補齊尺寸／加工或新增其他清楚符號。` : ""}`,
        schemaName: `complete_door_${attemptNo}`,
        schema: DOOR_SCHEMA,
        effort: "low",
        maxOutputTokens: 4_000,
        timeoutMs: DOOR_ATTEMPT_TIMEOUT_MS,
        retryTimeoutMs: DOOR_ATTEMPT_TIMEOUT_MS,
        imageDetail: attemptNo === 1 ? "high" : "original",
      });
      if (!run.parsed.ok) continue;
      const parsed = JSON.parse(run.parsed.text) as JsonRecord;
      const read = (Array.isArray(parsed.cabinetDoors) ? parsed.cabinetDoors : []).find((item) => isJsonRecord(item) && String(item.cabinetId) === segment.cabinetId);
      if (!isJsonRecord(read)) continue;
      let candidate = { ...read, attemptsUsed: attemptNo } as JsonRecord;
      const allowedSymbolCrops = doorSourceEvidenceCropNames(selected);
      if (firstSymbolLock) doorSymbolCropNames(firstSymbolLock).forEach((name) => allowedSymbolCrops.add(name));
      if (!doorReadUsesOnlyKnownSymbolCrops(candidate, allowedSymbolCrops)) {
        candidate = {
          ...candidate,
          status: "partial",
          doors: [],
          unresolvedDoorRegions: [...(Array.isArray(candidate.unresolvedDoorRegions) ? candidate.unresolvedDoorRegions.map(String) : []), "符號引用了本輪不存在的裁切圖"],
          evidence: `${String(candidate.evidence || "")}；未知裁切圖證據已拒絕`.replace(/^；/, ""),
        };
      }
      if (firstSymbolLock) candidate = preserveFirstDoorSymbolLock(firstSymbolLock, candidate);
      const resolution = lockableDoorRead(candidate);
      if (resolution.status === "confirmed_4e" && !firstSymbolLock) firstSymbolLock = candidate;
      if (candidate.status === "confirmed_no_4e" && (!Array.isArray(candidate.unresolvedDoorRegions) || candidate.unresolvedDoorRegions.length === 0)) noDoorConfirmations += 1;
      if (!finalRead || doorScore(candidate) >= doorScore(finalRead)) finalRead = candidate;
      const ready = resolution.status === "confirmed_4e" && resolution.doors.every((door) => doorIsReadyForHardware(door as JsonRecord));
      if (ready) break;
    } catch (error) {
      if (isDoorNoResponseError(error)) break;
    }
  }
  if (firstSymbolLock && finalRead) finalRead = preserveFirstDoorSymbolLock(firstSymbolLock, finalRead);
  const hasFrontEvidence = cabinetCrops.some((crop) => crop.role === "door" || crop.role === "front");
  if (finalRead?.status === "confirmed_no_4e" && (!hasFrontEvidence || noDoorConfirmations < 2)) finalRead = {
    ...finalRead, status: "unknown", doors: [], unresolvedDoorRegions: ["缺少兩次一致的完整門面證據，不能宣告沒有4E門"], evidence: `${String(finalRead.evidence || "")}；無門結果未通過一致性檢查`,
  };
  return finalRead || {
    cabinetId: segment.cabinetId, status: "unknown", sourceImageName: "", region: segment.label, doors: [], excludedSurfaces: [],
    unresolvedDoorRegions: ["三次門板裁切仍未定位清楚的<／>或完成尺寸"], confidence: "low", evidence: "本次門板不列，桶身料單仍保留", attemptsUsed,
  };
}

export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: "伺服器尚未設定 OpenAI API 金鑰。" }, { status: 503 });
    const body = await req.json() as { analysis?: unknown; segmentation?: SegmentationPlan; cabinetCrops?: CabinetCropInput[]; slantedHandleMarkerEvidence?: unknown };
    if (!isSegmentationPlan(body.segmentation)) return Response.json({ error: "尚未完成方向與底寬分桶。" }, { status: 400 });
    if (!isJsonRecord(body.analysis) || !Array.isArray(body.analysis.cabinets)) return Response.json({ error: "尚未完成桶身與非門構件掃描。" }, { status: 400 });
    const cabinets = body.analysis.cabinets.filter(isJsonRecord);
    const cabinetsById = indexDoorCabinetsById(cabinets, body.segmentation.cabinets.map((segment) => segment.cabinetId));
    if (!cabinetsById) return Response.json({ error: "桶身ID與門板分桶不一致，本次不產生完整料單。" }, { status: 422 });
    const crops = selectDoorCropsForRequest((body.cabinetCrops || []).filter(isAllowedCabinetCrop), 100);
    if (!crops.length) return Response.json({ error: "沒有可用的門面裁切圖。" }, { status: 400 });
    const missingDoorCabinets = missingDoorSourceCabinetIds(crops, body.segmentation.cabinets.map((cabinet) => cabinet.cabinetId));
    if (missingDoorCabinets.length) return Response.json({ error: `請求裁切缺少${missingDoorCabinets.join("、")}可回查的門面／桶內原圖，本次不猜門板或開向。` }, { status: 422 });

    const reads: JsonRecord[] = [];
    for (const batch of batchForConcurrency(body.segmentation.cabinets, DOOR_SCAN_CONCURRENCY)) {
      const batchReads = await Promise.all(batch.map((segment) => {
        return scanCabinetDoors(key, segment, crops, cabinetsById.get(segment.cabinetId)!);
      }));
      reads.push(...batchReads);
    }
    const audit = { cabinetDoors: reads, unresolved: reads.flatMap((read) => Array.isArray(read.unresolvedDoorRegions) ? read.unresolvedDoorRegions.map((item) => `${String(read.cabinetId)}：${String(item)}`) : []) };
    const analysis = applyDoorRecognition(body.analysis, audit) as AnalysisForSop & JsonRecord;
    const markerEvidence = normalizeSlantedHandleMarkerEvidence(body.slantedHandleMarkerEvidence, true);
    if (markerEvidence) analysis.slantedHandleMarkerEvidence = markerEvidence;
    const result = calculateCompleteSop(analysis);
    return Response.json({ analysis, result, scope: "complete_including_doors", formulaMode: "deterministic", doorRecognition: audit });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return Response.json({ error: "門板辨識逾時；桶身資料已保留，請稍後再試。", code: "timeout" }, { status: 504 });
    const typed = error as Error & { status?: number; code?: string };
    return Response.json({ error: typed.message || "門板辨識失敗。", code: typed.code || "server_error" }, { status: typed.status && typed.status >= 400 ? typed.status : 500 });
  }
}
