import { callStructuredAI, ImageInput, isAllowedImage } from "../analyze/pipeline";
import { cabinetSegmentationSchema, internalCropRepairSchema } from "../analyze/schemas";
import { isSegmentationPlan, type SegmentationPlan } from "../../segmentation";
import { applyOrientationLocks, enforceOrientationConfidence, isOrientationAudit, orientationTaskSummary, type OrientationAudit } from "../../orientation-audit";
import { buildPreflightReport } from "../../preflight";
import {
  closeInternalCropsFromInternalViews,
  isInternalCropRepairResult,
  mergeInternalCropRepairs,
  missingInternalCropCabinetIds,
  segmentationSourceReferenceErrors,
  type InternalCropRepairResult,
} from "../../segmentation-internal";
import { INTERNAL_CROP_REPAIR_INSTRUCTIONS, SEGMENTATION_INSTRUCTIONS } from "./instructions";

export const runtime = "edge";

function parsedText(result: Awaited<ReturnType<typeof callStructuredAI>>, invalidMessage: string) {
  if (!result.parsed.ok) {
    const error = new Error(result.parsed.message) as Error & { code?: string; status?: number };
    error.code = result.parsed.code;
    error.status = result.response.status >= 400 ? result.response.status : 502;
    throw error;
  }
  try {
    return JSON.parse(result.parsed.text) as Record<string, unknown>;
  } catch {
    const error = new Error(invalidMessage) as Error & { code?: string; status?: number };
    error.code = "invalid_segmentation";
    error.status = 502;
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: "伺服器尚未設定 OpenAI API 金鑰。" }, { status: 503 });
    const body = await req.json() as { images?: ImageInput[]; orientation?: OrientationAudit };
    const images = (body.images || []).filter(isAllowedImage).slice(0, 6);
    if (!images.length) return Response.json({ error: "沒有可讀取的圖片。" }, { status: 400 });
    if (!isOrientationAudit(body.orientation, images.map((image) => image.name))) {
      return Response.json({ error: "缺少已鎖定的圖面方向，請重新掃描。", code: "missing_orientation" }, { status: 400 });
    }
    const lockedOrientation = enforceOrientationConfidence(body.orientation);

    const segmentationRun = await callStructuredAI(key, images, {
      instructions: SEGMENTATION_INSTRUCTIONS,
      taskText: `方向與軸向已由前一關鎖定，必須逐項照用，不得改角度或交換寬高：\n${JSON.stringify(orientationTaskSummary(lockedOrientation))}\n請依底部水平尺寸鏈規劃逐桶裁切。來源檔名：${images.map((image) => image.name).join("、")}`,
      schemaName: "cabinet_crop_segmentation",
      schema: cabinetSegmentationSchema,
      effort: "low",
      maxOutputTokens: 8_000,
      timeoutMs: 55_000,
      retryTimeoutMs: 55_000,
    });
    const parsedPlan = parsedText(segmentationRun, "逐桶裁切規劃不是有效結構，請重新掃描。");
    if (!isSegmentationPlan(parsedPlan)) return Response.json({ error: "逐桶裁切規劃缺少有效桶身或裁切框，請重新掃描。", code: "invalid_segmentation" }, { status: 502 });

    let plan: SegmentationPlan = closeInternalCropsFromInternalViews(applyOrientationLocks(parsedPlan, lockedOrientation));
    let missingInternalCabinetIds = missingInternalCropCabinetIds(plan);
    if (missingInternalCabinetIds.length) {
      const repairRun = await callStructuredAI(key, images, {
        instructions: INTERNAL_CROP_REPAIR_INSTRUCTIONS,
        taskText: `方向鎖：${JSON.stringify(orientationTaskSummary(lockedOrientation))}\n\n只複核缺少桶內裁切的桶：${JSON.stringify(missingInternalCabinetIds)}\n\n既有分桶與裁切（不可改寫）：${JSON.stringify(plan.cabinets.map((cabinet) => ({
          cabinetId: cabinet.cabinetId,
          elevationId: cabinet.elevationId,
          widthOrder: cabinet.widthOrder,
          bottomSegmentMm: cabinet.bottomSegmentMm,
          sourceCrops: cabinet.sourceCrops.map((crop) => ({ sourceImageName: crop.sourceImageName, role: crop.role, box: crop.box, region: crop.region, evidence: crop.evidence })),
        })))}\n\n來源檔名：${images.map((image) => image.name).join("、")}`,
        schemaName: "cabinet_internal_crop_repair",
        schema: internalCropRepairSchema,
        effort: "low",
        maxOutputTokens: 3_000,
        timeoutMs: 40_000,
        retryTimeoutMs: 40_000,
      });
      const parsedRepair = parsedText(repairRun, "桶內裁切複核不是有效結構，請重新掃描。");
      if (!isInternalCropRepairResult(parsedRepair)) return Response.json({ error: "桶內裁切複核缺少有效來源或座標，請重新掃描。", code: "invalid_internal_crop_repair" }, { status: 502 });
      plan = applyOrientationLocks(
        mergeInternalCropRepairs(plan, parsedRepair as InternalCropRepairResult, images.map((image) => image.name)),
        lockedOrientation,
      );
      missingInternalCabinetIds = missingInternalCropCabinetIds(plan);
    }

    const sourceReferenceErrors = segmentationSourceReferenceErrors(plan, images.map((image) => image.name));
    if (sourceReferenceErrors.length) return Response.json({
      error: `逐桶裁切引用了不存在的原圖來源：${sourceReferenceErrors.join("、")}；請重新掃描。`,
      code: "invalid_crop_source",
      sourceReferenceErrors,
    }, { status: 502 });
    if (missingInternalCabinetIds.length) return Response.json({
      error: `${missingInternalCabinetIds.join("、")}在原圖中仍找不到可讀的桶內結構；本次不會把純門面誤當桶內圖，也不產生可能漏料的料單。請補上內部立面或較清楚的完整圖後再掃描。`,
      code: "missing_internal_crops",
      missingCabinetIds: missingInternalCabinetIds,
    }, { status: 422 });

    const preflight = buildPreflightReport(plan);
    if (!preflight.ready) {
      const blocked = preflight.checks.filter((check) => check.status === "blocked").map((check) => `${check.scope}：${check.detail}`);
      return Response.json({ error: `前置分桶資料尚未閉合：${blocked.join("；")}`, code: "segmentation_preflight_blocked", preflight }, { status: 422 });
    }
    return Response.json(plan);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return Response.json({ error: "分桶或桶內裁切複核逾時，已安全停止本階段；請直接再按一次。", code: "timeout" }, { status: 504 });
    const typed = error as Error & { code?: string; status?: number };
    return Response.json({ error: typed.message || "逐桶裁切規劃失敗。", code: typed.code || "server_error" }, { status: typed.status && typed.status >= 400 ? typed.status : 500 });
  }
}
