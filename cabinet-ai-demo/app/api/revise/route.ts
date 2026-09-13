import { ImageInput, isAllowedImage, isAllowedCabinetCrop, runRevisionPipeline } from "../analyze/pipeline";
import { validateCabinetStructure } from "../analyze/structure-validation";
import { isSegmentationPlan, type CabinetCropInput, type SegmentationPlan } from "../../segmentation";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: "伺服器尚未設定 OpenAI API 金鑰。" }, { status: 503 });

    const body = await req.json() as {
      images?: ImageInput[];
      analysis?: Record<string, unknown>;
      reply?: string;
      history?: Array<{ role?: string; text?: string }>;
      segmentation?: SegmentationPlan;
      cabinetCrops?: CabinetCropInput[];
    };
    const images = (body.images || []).filter(isAllowedImage).slice(0, 6);
    const reply = String(body.reply || "").trim();
    if (!images.length || !reply) return Response.json({ error: "缺少圖面或修正內容。" }, { status: 400 });
    if (!isSegmentationPlan(body.segmentation)) return Response.json({ error: "缺少既有分桶資料，請重新掃描。" }, { status: 400 });
    const cabinetCrops = (body.cabinetCrops || []).filter(isAllowedCabinetCrop).slice(0, 120);
    if (!cabinetCrops.length) return Response.json({ error: "缺少既有逐桶裁切圖，請重新掃描。" }, { status: 400 });

    const recentHistory = (body.history || [])
      .slice(-8)
      .map((message) => `${message.role === "user" ? "使用者" : "AI"}：${String(message.text || "").slice(0, 1600)}`)
      .join("\n");
    const structured = await runRevisionPipeline(key, images, body.segmentation, cabinetCrops, body.analysis || {}, reply, recentHistory);
    return Response.json(validateCabinetStructure(structured));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return Response.json({ error: "修正判讀仍然逾時；系統已自動重試一次，請稍後再試。", code: "timeout" }, { status: 504 });
    }
    const typed = error as Error & { code?: string; status?: number };
    return Response.json(
      { error: typed.message || "修正圖面失敗。", code: typed.code || "server_error" },
      { status: typed.status && typed.status >= 400 ? typed.status : 500 },
    );
  }
}
