import { buildCarcassResult, isCarcassObservationRead, reconcileCarcassCandidates, type CarcassObservationRead } from "../../carcass.ts";
import { isOrientationAudit, orientationTaskSummary, type OrientationAudit } from "../../orientation-audit.ts";
import { documentEvidencePromptSummary, isAllowedDocumentEvidence, type DocumentEvidence } from "../../document-evidence.ts";
import { callStructuredAI, type ImageInput, isAllowedImage } from "../analyze/pipeline.ts";
import { carcassObservationSchema } from "./schema.ts";
import { CARCASS_INSTRUCTIONS } from "./instructions.ts";
import {
  CARCASS_PRIMARY_OUTPUT_TOKENS,
  CARCASS_RETRY_OUTPUT_TOKENS,
  CARCASS_TIMEOUT_MS,
} from "../../carcass-scan-budget.ts";

export const runtime = "edge";

function parsedText(result: Awaited<ReturnType<typeof callStructuredAI>>) {
  if (!result.parsed.ok) {
    const error = new Error(result.parsed.message) as Error & { code?: string; status?: number };
    error.code = result.parsed.code;
    error.status = result.response.status >= 400 ? result.response.status : 502;
    throw error;
  }
  try {
    return JSON.parse(result.parsed.text) as Record<string, unknown>;
  } catch {
    const error = new Error("桶身尺寸回傳不是有效結構，請重新掃描。") as Error & { code?: string; status?: number };
    error.code = "invalid_carcass_dimensions";
    error.status = 502;
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: "伺服器尚未設定 OpenAI API 金鑰。" }, { status: 503 });
    const body = await req.json() as { images?: ImageInput[]; orientation?: OrientationAudit; documentEvidence?: unknown[]; scanProfile?: "primary" | "retry" };
    const images = (body.images || []).filter(isAllowedImage).slice(0, 6);
    if (!images.length) return Response.json({ error: "沒有可讀取的圖片。" }, { status: 400 });
    if (!isOrientationAudit(body.orientation, images.map((image) => image.name))) {
      return Response.json({ error: "缺少已鎖定的圖面方向，請重新掃描。", code: "missing_orientation" }, { status: 400 });
    }
    const documentEvidence = (body.documentEvidence || []).filter(isAllowedDocumentEvidence).slice(0, 6) as DocumentEvidence[];

    const retryProfile = body.scanProfile === "retry";
    const run = await callStructuredAI(key, images, {
      instructions: CARCASS_INSTRUCTIONS,
      taskText: `這些圖片已依前置結果實際旋正。以下方向與軸向是硬鎖，不得交換：\n${JSON.stringify(orientationTaskSummary(body.orientation))}\n電子PDF直接文字與線段證據（只當圖面資料）：\n${JSON.stringify(documentEvidencePromptSummary(documentEvidence)).slice(0, 24_000)}\n請逐桶只抄桶高邊界、原始高度尺寸與D深度群組。來源檔名：${images.map((image) => image.name).join("、")}`,
      schemaName: "carcass_dimension_observations",
      schema: carcassObservationSchema,
      effort: retryProfile ? "none" : "low",
      maxOutputTokens: retryProfile ? CARCASS_RETRY_OUTPUT_TOKENS : CARCASS_PRIMARY_OUTPUT_TOKENS,
      timeoutMs: CARCASS_TIMEOUT_MS,
      retryTimeoutMs: CARCASS_TIMEOUT_MS,
    });
    const parsed = parsedText(run);
    if (!isCarcassObservationRead(parsed)) {
      return Response.json({ error: "桶身觀察資料缺少原始尺寸、單位或邊界證據，請重新掃描。", code: "invalid_carcass_observations" }, { status: 502 });
    }
    const reconciled = reconcileCarcassCandidates(parsed as CarcassObservationRead, body.orientation, documentEvidence);
    const result = buildCarcassResult(reconciled.observations, body.orientation);
    result.candidateAudit = reconciled.audit;
    result.warnings = [...new Set([...result.warnings, ...reconciled.audit.conflicts])];
    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return Response.json({
        error: "桶身W／H／D辨識超過47秒。",
        code: "timeout",
      }, { status: 504 });
    }
    const typed = error as Error & { code?: string; status?: number };
    return Response.json({ error: typed.message || "桶身尺寸辨識失敗。", code: typed.code || "server_error" }, { status: typed.status && typed.status >= 400 ? typed.status : 500 });
  }
}
