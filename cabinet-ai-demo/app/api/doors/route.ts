export const runtime = "edge";

import { calculateCompleteSop, type AnalysisForSop } from "../../sop.ts";
import { finalDoorStageIssues, installFinalDoorReads, scanFinalDoorStage } from "../../final-door-stage.ts";
import { batchForConcurrency, missingDoorSourceCabinetIds, selectDoorCropsForRequest } from "../../door-scan.ts";
import { indexDoorCabinetsById } from "../../door-cabinet-alignment.ts";
import { DOOR_ATTEMPT_TIMEOUT_MS, DOOR_SCAN_CONCURRENCY } from "../../door-scan-budget.ts";
import { isSegmentationPlan, type CabinetCropInput, type SegmentationPlan } from "../../segmentation.ts";
import { callStructuredAI, isAllowedCabinetCrop } from "../analyze/pipeline.ts";
import { normalizeSlantedHandleMarkerEvidence } from "../../slanted-handle-audit.ts";
import { applyFaceMachining, prepareCarcassStage } from "../../face-machining.ts";

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
                type: { type: "string", enum: ["4E"] },
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

const DOOR_INSTRUCTIONS = `你是系統櫃最後一關的完整門面讀圖員。門片有無、片數、開向、開口或完成寬高、斜把加工必須在本輪一起確認，不得只找符號就宣告confirmed_4e。尚有任何門面、尺寸或加工未讀齊時填partial及逐項unresolvedDoorRegions；同桶所有門及屜頭都確認後才填confirmed_4e，後端之後直接凍結整份結果、不再交給其他AI重判。你要一起辨識功能4E門板、屜頭、各自的斜把，以及斜把成立後才需要的退縮與擋板；鋁框門只分類排除，不拆料。

硬規則：
1. 一個門面內清楚的「<」代表一片左開門，「>」代表一片右開門。符號可能是跨越大部分門面的兩段大型虛線／點線人字幾何，不一定是印刷文字：兩條斜線的共同尖端在左才是「<」，共同尖端在右才是「>」。高對比圖與斜向遮罩只能協助定位；必須回到同輪提供的第一輪原始門面／桶內裁切再次看見，symbolRegions.cropName固定引用原始裁切，不得引用p2／p3輔助圖。必須逐個定位實際cropName、座標與區域；不得用門框數、常見配置、單一斜線或裁切邊界猜片數。
2. doors只放需要加工的4E門；鋁框門只在excludedSurfaces描述，無4E門時doors=[]，不要建立aluminum或none項目，以免加工索引錯位。doorSymbols依左到右、上到下排列，count必須等於doorSymbols長度，countBasis必須是symbols。若尺寸相同且加工相同可合成一組；尺寸或加工不同必須分組。
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

async function scanCabinetDoors(key: string, segment: SegmentationPlan["cabinets"][number], allCrops: CabinetCropInput[], cabinet: JsonRecord) {
  return scanFinalDoorStage(cabinet as unknown as AnalysisForSop["cabinets"][number], allCrops, async (attemptNo, selected, previous) => {
    const run = await callStructuredAI(key, selected.map(({ name, dataUrl }) => ({ name, dataUrl })), {
      instructions: DOOR_INSTRUCTIONS,
      taskText: `只輸出cabinetId=${segment.cabinetId}。最後門面階段第${attemptNo}輪：一次完整盤點所有門片，並逐組填寬高、開向及加工；不得把片數與尺寸拆成不同任務。鎖定桶寬=${segment.bottomSegmentMm}mm；桶身尺寸只供開口關聯，不能直接當門高：${JSON.stringify({ id: cabinet.id, widthMm: cabinet.widthMm, heightMm: cabinet.heightMm, depthMm: cabinet.depthMm, drawerGroups: cabinet.drawerGroups, middleDividers: cabinet.middleDividers, drawingNotes: cabinet.drawingNotes })}。圖面有抽屜等分區時，要依每組門實際覆蓋的開口讀寬高。每組drawerGroups都有屜頭，drawerHandles不得漏組；門與屜頭斜把分開判。2.4／24mm出現就確認對應面有斜把，沒有則看斜把空隙；不參與門高扣除。只有確認沒有空隙時，普通门用slantedHandle=false、slantedHandleCount=0、slantedHandleStyle=none。退縮與擋板依同輪doors/sourceIndex填寫；固格尺寸不動。有中立時擋板逐實體開口分段。本輪裁切：${JSON.stringify(selected.map(({ name, role, region, focus, scanPass }) => ({ name, role, region, focus: focus || "全桶", scanPass: scanPass || 1 })))}。${previous ? `前輪尚未確認的草稿（不是鎖定答案）：${JSON.stringify(previous)}。請回原圖整體複核並輸出本輪完整結果，保留可見的全部門片，補齊缺少的寬高／加工；不可沿用0或unknown當完成。` : ""}`,
      schemaName: `complete_door_${attemptNo}`,
      schema: DOOR_SCHEMA,
      effort: "low",
      maxOutputTokens: 6_000,
      timeoutMs: DOOR_ATTEMPT_TIMEOUT_MS,
      retryTimeoutMs: DOOR_ATTEMPT_TIMEOUT_MS,
      imageDetail: attemptNo === 1 ? "high" : "original",
    });
    if (!run.parsed.ok) return null;
    const parsed = JSON.parse(run.parsed.text) as JsonRecord;
    const read = (Array.isArray(parsed.cabinetDoors) ? parsed.cabinetDoors : []).find((item) => isJsonRecord(item) && String(item.cabinetId) === segment.cabinetId);
    return isJsonRecord(read) ? read : null;
  });
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
      const cabinet = cabinetsById.get(String(read.cabinetId))!;
      const issues = finalDoorStageIssues(read, cabinet as unknown as AnalysisForSop["cabinets"][number], crops);
      if (read.finalDoorStageConfirmed !== true && !issues.length) issues.push("最後門面階段尚未完整確認");
      return issues.map((issue) => `${String(read.cabinetId)}：${issue}`);
    });
    if (doorIssues.length) {
      // Keep diagnostic fields, never raw images or credentials, in the scan response and Worker log.
      const diagnostics = reads.map((read) => ({
        cabinetId: read.cabinetId, attemptsUsed: read.attemptsUsed, status: read.status,
        issues: doorIssues.filter((issue) => issue.startsWith(`${String(read.cabinetId)}：`)),
      }));
      console.warn("final_door_stage_incomplete", JSON.stringify(diagnostics));
      return Response.json({
        error: `門板尚未完整確認：${[...new Set(doorIssues)].join("；")}。本次先停止完整料單，請依缺項補充圖面。`,
        code: "door_incomplete", diagnostics,
      }, { status: 422 });
    }
    const doorAnalysis = installFinalDoorReads(baseline, reads) as AnalysisForSop & JsonRecord;
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
