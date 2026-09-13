export const runtime = "edge";

import { runInitialPipeline, isAllowedImage, isAllowedCabinetCrop, ImageInput } from "./pipeline";
import { validateCabinetStructure } from "./structure-validation";
import { isSegmentationPlan, type CabinetCropInput, type SegmentationPlan } from "../../segmentation";
import { buildPreflightReport } from "../../preflight";

export { validateCabinetStructure } from "./structure-validation";
export { cabinetReadSchema, dimensionLedgerSchema } from "./schemas";
export type { ImageInput } from "./pipeline";

export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: "伺服器尚未設定 OpenAI API 金鑰。" }, { status: 503 });

    const body = await req.json() as { images?: ImageInput[]; segmentation?: SegmentationPlan; cabinetCrops?: CabinetCropInput[] };
    const images = (body.images || []).filter(isAllowedImage).slice(0, 6);
    if (!images.length) return Response.json({ error: "沒有可讀取的圖片。" }, { status: 400 });
    if (!isSegmentationPlan(body.segmentation)) return Response.json({ error: "尚未完成底部尺寸鏈分桶，請重新掃描。" }, { status: 400 });
    const plannedPreflight = buildPreflightReport(body.segmentation);
    if (!plannedPreflight.ready) return Response.json({ error: "前置資料尚未閉合，未進入拆料分析。", preflight: plannedPreflight }, { status: 422 });
    const cabinetCrops = (body.cabinetCrops || []).filter(isAllowedCabinetCrop).slice(0, 120);
    if (!cabinetCrops.length) return Response.json({ error: "未產生逐桶裁切圖，請重新掃描。" }, { status: 400 });
    const croppedPreflight = buildPreflightReport(body.segmentation, cabinetCrops);
    if (!croppedPreflight.ready) return Response.json({ error: "前置裁切證據不完整，未進入拆料分析。", preflight: croppedPreflight }, { status: 422 });

    const structured = await runInitialPipeline(key, images, body.segmentation, cabinetCrops);
    return Response.json(validateCabinetStructure(structured));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return Response.json({ error: "這張圖的 AI 辨識仍然逾時；系統已自動重試一次，請稍後再試。", code: "timeout" }, { status: 504 });
    }
    const typed = error as Error & { code?: string; status?: number };
    return Response.json(
      { error: typed.message || "伺服器處理失敗。", code: typed.code || "server_error" },
      { status: typed.status && typed.status >= 400 ? typed.status : 500 },
    );
  }
}
