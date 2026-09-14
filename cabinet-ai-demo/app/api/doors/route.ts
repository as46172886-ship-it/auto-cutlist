export const runtime = "edge";

import { calculateCompleteSop, type AnalysisForSop } from "../../sop.ts";
import { applyDoorRecognition, doorIsReadyForHardware, doorReadUsesOnlyKnownSymbolCrops, doorSymbolCropNames, lockableDoorRead } from "../../door-recognition.ts";
import { batchForConcurrency, DOOR_SCAN_ATTEMPTS, doorCropsForAttempt, doorSourceEvidenceCropNames, isDoorNoResponseError, missingDoorSourceCabinetIds, preserveFirstDoorSymbolLock, selectDoorCropsForRequest } from "../../door-scan.ts";
import { indexDoorCabinetsById } from "../../door-cabinet-alignment.ts";
import { DOOR_ATTEMPT_TIMEOUT_MS, DOOR_SCAN_CONCURRENCY } from "../../door-scan-budget.ts";
import { isSegmentationPlan, type CabinetCropInput, type SegmentationPlan } from "../../segmentation.ts";
import { callStructuredAI, isAllowedCabinetCrop } from "../analyze/pipeline.ts";
import { normalizeSlantedHandleMarkerEvidence } from "../../slanted-handle-audit.ts";
import { applyFaceMachining, faceMachiningReadIsComplete, faceMachiningReadIssues, faceMachiningReadScore, prepareCarcassStage } from "../../face-machining.ts";

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
        required: ["cabinetId", "status", "sourceImageName", "region", "doors", "drawerHandles", "machining", "excludedSurfaces", "unresolvedDoorRegions", "confidence", "evidence"],
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
          drawerHandles: {
            type: "array", maxItems: 20,
            items: {
              type: "object", additionalProperties: false,
              required: ["drawerGroupId", "status", "style", "cropName", "evidence"],
              properties: {
                drawerGroupId: { type: "string" },
                status: { type: "string", enum: ["slanted", "plain", "unknown"] },
                style: { type: "string", enum: ["top", "bottom", "long", "none", "unknown"] },
                cropName: { type: "string" }, evidence: { type: "string" },
              },
            },
          },
          machining: {
            type: "array", maxItems: 40,
            items: {
              type: "object", additionalProperties: false,
              required: ["openingId", "sourceType", "sourceIndex", "targetBoard", "baffleMount", "widthBasis", "widthMm", "segmentIndex", "segmentCount", "cropName", "evidence"],
              properties: {
                openingId: { type: "string" },
                sourceType: { type: "string", enum: ["drawer", "door"] },
                sourceIndex: { type: "integer", minimum: 0, maximum: 19 },
                targetBoard: { type: "string", enum: ["top", "bottom", "none"] },
                baffleMount: { type: "string", enum: ["none", "top_board", "fixed_shelf", "raised_bottom"] },
                widthBasis: { type: "string", enum: ["cabinet_inner", "finished_segment", "unknown"] },
                widthMm: { type: "integer", minimum: 0 },
                segmentIndex: { type: "integer", minimum: 1, maximum: 20 },
                segmentCount: { type: "integer", minimum: 1, maximum: 20 },
                cropName: { type: "string" }, evidence: { type: "string" },
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

const DOOR_INSTRUCTIONS = `你是系統櫃最後門面讀圖員。你要一起辨識功能4E門板、屜頭、各自的斜把，以及斜把成立後才需要的退縮與擋板；鋁框門只分類排除，不拆料。

硬規則：
1. 一個門面內清楚的「<」代表一片左開門，「>」代表一片右開門。符號可能是跨越大部分門面的兩段大型虛線／點線人字幾何，不一定是印刷文字：兩條斜線的共同尖端在左才是「<」，共同尖端在右才是「>」。高對比圖與斜向遮罩只能協助定位；必須回到同輪提供的第一輪原始門面／桶內裁切再次看見，symbolRegions.cropName固定引用原始裁切，不得引用p2／p3輔助圖。必須逐個定位實際cropName、座標與區域；不得用門框數、常見配置、單一斜線或裁切邊界猜片數。
2. doorSymbols依左到右、上到下排列，count必須等於doorSymbols長度，countBasis必須是symbols。若尺寸相同且加工相同可合成一組；尺寸或加工不同必須分組。
3. dimensionBasis=finished只限圖面直接標單片完成門面；dimensionBasis=opening時openingWidthMm/openingHeightMm填整組開口，後端只扣單門縫與門高4mm（以及圖上另有的底部30mm）。看不清就unknown且尺寸填0，不得猜；2.4／24mm不參與門高扣除。
4. 24mm／2.4cm只是一個「此處有斜把」的肯定提示，不必判它包含在哪一段、是否已另列或是否為疊櫃抬高。只要在對應門板或屜頭附近看見2.4，就把該面判為斜把，再依空隙位置判top／bottom／long；沒看見2.4也不代表普通面，仍要看是否有一條斜把空隙或加工圖形。只有確定沒有斜把空隙／加工才填plain或none。相容欄位固定填includesSlantedGap24=false、slantedGap24Context=none，禁止提出24mm關係問題。
5. slantedHandleStyle精確分top（上斜把）、bottom（下斜把）、long（長斜把）、none或unknown；slantedHandleCount只算實際加工門片。門邊孤立的彩色小三角只能作斜把加工證據，絕不可當成左／右開向。J把只依小方形把手記號計數。
6. hingeCountPerDoor固定填0，由後端依完成門高算；普通門油壓器由後端每片1個。
7. 桶身資料中的退縮、擋板與drawerGroups.slantedHandle已刻意清零；不可把清零誤判為沒有門面加工。每個drawerGroups項目代表一組一定存在的屜頭，drawerHandles必須逐組恰好輸出一筆；普通屜頭填plain＋none，斜把屜頭填slanted及top／bottom／long。門與屜頭必須分開看圖，任何一方的斜把都不可套到另一方。
8. drawerHandles與machining的cropName都只能引用本輪同時提供、scanPass=1且role為door／front／internal的原始裁切；增強圖只能定位，不能作最後證據。evidence要寫出實際可見的門或屜頭及位置。
9. 只有已確認斜把的門或屜頭才可建立machining；普通面不得建立。sourceType=drawer時sourceIndex是drawerGroups的零起算索引，sourceType=door時是本輸出doors的零起算索引。每個已確認斜把來源至少要有一筆實際加工位置，不能只填斜把而省略退縮／擋板。
10. targetBoard只可明確指定實際頂板、底板或none；沒有「橫板」這個籠統品項。本次固格板尺寸不由影像改寫，因此固格斜把位置只可用targetBoard=none，必要擋板仍可填baffleMount=fixed_shelf。沒有實際板件不得假造退縮。
11. 需要擋板時先看實際鎖附位置。無中立且跨完整內寬用widthBasis=cabinet_inner、widthMm=0、segmentIndex=segmentCount=1；有中立或不同開口時，逐支填finished_segment及圖上完成寬。相同openingId的N支實體擋板必須完整輸出segmentIndex=1…N、segmentCount=N；不得用一支跨中立。
12. 每筆machining至少要有實際退縮或擋板，targetBoard=none且baffleMount=none的空項目禁止輸出。所有文字使用繁體中文，只描述圖上證據。`;

function doorScore(read: JsonRecord) {
  const resolution = lockableDoorRead(read);
  if (resolution.status !== "confirmed_4e") return read.status === "confirmed_no_4e" ? 1 : 0;
  const count = resolution.doors.reduce((sum, door) => sum + Math.max(0, Math.round(Number((door as JsonRecord).count) || 0)), 0);
  const ready = resolution.doors.filter((door) => doorIsReadyForHardware(door as JsonRecord)
    && (!(door as JsonRecord).slantedHandle || !["unknown", "none", ""].includes(String((door as JsonRecord).slantedHandleStyle || "unknown")))).length;
  return count * 100 + ready * 20;
}

function candidateScore(read: JsonRecord, cabinet: JsonRecord, crops: CabinetCropInput[]) {
  return doorScore(read) * 100 + faceMachiningReadScore(read, cabinet as unknown as AnalysisForSop["cabinets"][number], crops);
}

async function scanCabinetDoors(key: string, segment: SegmentationPlan["cabinets"][number], allCrops: CabinetCropInput[], cabinet: JsonRecord) {
  const cabinetCrops = allCrops.filter((crop) => crop.cabinetId === segment.cabinetId);
  let finalRead: JsonRecord | null = null;
  let firstSymbolLock: JsonRecord | null = null;
  let noDoorConfirmations = 0;
  let attemptsUsed = 0;
  let finalScore = -1;
  for (const attemptNo of DOOR_SCAN_ATTEMPTS) {
    const selected = doorCropsForAttempt(cabinetCrops, attemptNo);
    if (!selected.length) continue;
    attemptsUsed = attemptNo;
    try {
      const run = await callStructuredAI(key, selected.map(({ name, dataUrl }) => ({ name, dataUrl })), {
        instructions: DOOR_INSTRUCTIONS,
        taskText: `只輸出cabinetId=${segment.cabinetId}。鎖定桶寬=${segment.bottomSegmentMm}mm；桶身資料只供門面開口關聯，不是答案：${JSON.stringify({ id: cabinet.id, widthMm: cabinet.widthMm, heightMm: cabinet.heightMm, depthMm: cabinet.depthMm, drawerGroups: cabinet.drawerGroups, middleDividers: cabinet.middleDividers, drawingNotes: cabinet.drawingNotes })}。其中退縮、擋板及屜頭斜把為0／空是前階段刻意建立的未加工基準，必須在本輪依原圖重新判讀。每組drawerGroups都有屜頭，drawerHandles不得漏組；門與屜頭斜把分開判。2.4／24mm出現就確認對應面有斜把，沒有則繼續看斜把空隙；它不參與門高扣除也不需要關係判定。若有中立，擋板逐實體開口分段輸出。本輪裁切：${JSON.stringify(selected.map(({ name, role, region, focus, scanPass }) => ({ name, role, region, focus: focus || "全桶", scanPass: scanPass || 1 })))}。${firstSymbolLock ? `前輪不可覆蓋的符號鎖：${JSON.stringify(lockableDoorRead(firstSymbolLock).doors)}；本輪只能保留並補齊尺寸／加工或新增其他清楚符號。` : ""}`,
        schemaName: `complete_door_${attemptNo}`,
        schema: DOOR_SCHEMA,
        effort: "low",
        maxOutputTokens: 6_000,
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
      const score = candidateScore(candidate, cabinet, selected);
      if (!finalRead || score >= finalScore) {
        finalRead = candidate;
        finalScore = score;
      }
      const ready = resolution.status === "confirmed_4e" && resolution.doors.every((door) => doorIsReadyForHardware(door as JsonRecord));
      if (ready && faceMachiningReadIsComplete(candidate, cabinet as unknown as AnalysisForSop["cabinets"][number], selected)) break;
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
    cabinetId: segment.cabinetId, status: "unknown", sourceImageName: "", region: segment.label, doors: [], drawerHandles: [], machining: [], excludedSurfaces: [],
    unresolvedDoorRegions: ["三次門板裁切仍未定位清楚的<／>或完成尺寸"], confidence: "low", evidence: "門面未閉合，本次不產生完整料單", attemptsUsed,
  };
}

export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: "伺服器尚未設定 OpenAI API 金鑰。" }, { status: 503 });
    const body = await req.json() as { analysis?: unknown; segmentation?: SegmentationPlan; cabinetCrops?: CabinetCropInput[]; slantedHandleMarkerEvidence?: unknown };
    if (!isSegmentationPlan(body.segmentation)) return Response.json({ error: "尚未完成方向與底寬分桶。" }, { status: 400 });
    if (!isJsonRecord(body.analysis) || !Array.isArray(body.analysis.cabinets)) return Response.json({ error: "尚未完成桶身與非門構件掃描。" }, { status: 400 });
    const baseline = prepareCarcassStage(body.analysis as AnalysisForSop & JsonRecord);
    const cabinets = baseline.cabinets.filter(isJsonRecord);
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
    const doorIssues = reads.flatMap((read) => {
      const resolved = lockableDoorRead(read);
      if (resolved.status === "omitted") return [`${String(read.cabinetId || "未知桶身")}：門片有無或開向尚未閉合`];
      if (resolved.status === "confirmed_4e" && resolved.doors.some((door) => !doorIsReadyForHardware(door as JsonRecord))) {
        return [`${String(read.cabinetId || "未知桶身")}：門片尺寸或斜把加工樣式尚未閉合`];
      }
      return [];
    });
    if (doorIssues.length) {
      return Response.json({ error: `門板仍未閉合：${[...new Set(doorIssues)].join("；")}。本次不產生可能漏門板或門五金的完整料單。`, code: "door_incomplete" }, { status: 422 });
    }
    const doorAnalysis = applyDoorRecognition(baseline, audit) as AnalysisForSop & JsonRecord;
    const faceIssues = reads.flatMap((read) => {
      const cabinet = doorAnalysis.cabinets.find((item) => item.id === String(read.cabinetId || ""));
      return cabinet ? faceMachiningReadIssues(read, cabinet, crops).map((issue) => `${cabinet.id}：${issue}`) : [`${String(read.cabinetId || "未知桶身")}：找不到桶身資料`];
    });
    if (faceIssues.length) {
      return Response.json({ error: `門板／屜頭加工仍未閉合：${[...new Set(faceIssues)].join("；")}。本次不產生可能漏退縮或擋板的完整料單。`, code: "face_machining_incomplete" }, { status: 422 });
    }
    const analysis = applyFaceMachining(doorAnalysis, reads, crops);
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
