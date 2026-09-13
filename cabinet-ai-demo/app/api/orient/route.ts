import { callStructuredAI, ImageInput, isAllowedImage } from "../analyze/pipeline";
import { orientationAuditSchema } from "../analyze/schemas";
import { enforceOrientationConfidence, isOrientationAudit, type OrientationAudit } from "../../orientation-audit";
import { ORIENTATION_AUDIT_INSTRUCTIONS } from "../segment/instructions";

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
    error.code = "invalid_orientation";
    error.status = 502;
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: "伺服器尚未設定 OpenAI API 金鑰。" }, { status: 503 });
    const body = await req.json() as { images?: ImageInput[]; orientationImages?: ImageInput[] };
    const images = (body.images || []).filter(isAllowedImage).slice(0, 6);
    if (!images.length) return Response.json({ error: "沒有可讀取的圖片。" }, { status: 400 });
    const orientationImages = (body.orientationImages || []).filter(isAllowedImage).slice(0, 6);
    const guideNames = new Set(orientationImages.map((image) => image.name));
    if (orientationImages.length !== images.length || images.some((image) => !guideNames.has(image.name))) {
      return Response.json({ error: "四方向候選圖不完整，請重新掃描。", code: "missing_orientation_guides" }, { status: 400 });
    }

    const orientationRun = await callStructuredAI(key, orientationImages, {
      instructions: ORIENTATION_AUDIT_INSTRUCTIONS,
      taskText: `請逐張比較候選表的四個標示角度，選出圖面真正正立的格子，再鎖定底部水平寬度鏈與側邊垂直高度鏈。rotationToUprightDeg必須抄被選格子的標籤角度。來源檔名必須原樣回填：${images.map((image) => image.name).join("、")}`,
      schemaName: "drawing_orientation_audit",
      schema: orientationAuditSchema,
      effort: "low",
      maxOutputTokens: 4_000,
      timeoutMs: 55_000,
      retryTimeoutMs: 55_000,
    });
    const orientation = parsedText(orientationRun, "圖面方向檢查不是有效結構，請重新掃描。");
    if (!isOrientationAudit(orientation, images.map((image) => image.name))) {
      return Response.json({ error: "圖面方向或軸向尚未鎖定，請重新掃描。", code: "invalid_orientation" }, { status: 502 });
    }
    return Response.json(enforceOrientationConfidence(orientation as OrientationAudit));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return Response.json({ error: "方向辨識超過55秒，已停止本階段；請直接再按一次。", code: "timeout" }, { status: 504 });
    const typed = error as Error & { code?: string; status?: number };
    return Response.json({ error: typed.message || "圖面方向辨識失敗。", code: typed.code || "server_error" }, { status: typed.status && typed.status >= 400 ? typed.status : 500 });
  }
}
