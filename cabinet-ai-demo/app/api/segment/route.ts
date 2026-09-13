import { callStructuredAI, ImageInput, isAllowedImage } from "../analyze/pipeline";
import { cabinetSegmentationSchema } from "../analyze/schemas";
import { isSegmentationPlan } from "../../segmentation";
import { applyOrientationLocks, enforceOrientationConfidence, isOrientationAudit, orientationTaskSummary, type OrientationAudit } from "../../orientation-audit";
import { SEGMENTATION_INSTRUCTIONS } from "./instructions";

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
    const plan = parsedText(segmentationRun, "逐桶裁切規劃不是有效結構，請重新掃描。");
    if (!isSegmentationPlan(plan)) return Response.json({ error: "逐桶裁切規劃缺少有效桶身或裁切框，請重新掃描。", code: "invalid_segmentation" }, { status: 502 });
    return Response.json(applyOrientationLocks(plan, lockedOrientation));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return Response.json({ error: "逐桶裁切規劃超過55秒，已停止本階段；請直接再按一次。", code: "timeout" }, { status: 504 });
    const typed = error as Error & { code?: string; status?: number };
    return Response.json({ error: typed.message || "逐桶裁切規劃失敗。", code: typed.code || "server_error" }, { status: typed.status && typed.status >= 400 ? typed.status : 500 });
  }
}
