export type OpenAIResponse = {
  id?: string;
  status?: string;
  error?: { message?: string; code?: string; type?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
  };
};

export type ParsedOpenAIResponse =
  | { ok: true; text: string }
  | { ok: false; code: string; message: string; retryable: boolean };

export function parseOpenAIResponse(raw: OpenAIResponse): ParsedOpenAIResponse {
  if (raw.error) {
    return {
      ok: false,
      code: raw.error.code || raw.error.type || "openai_error",
      message: raw.error.message || "OpenAI API 回傳錯誤。",
      retryable: false,
    };
  }

  if (raw.status === "incomplete") {
    const reason = raw.incomplete_details?.reason || "unknown";
    if (reason === "max_output_tokens") {
      return { ok: false, code: "output_limit", message: "AI 輸出額度不足，系統將以較低推理強度重試。", retryable: true };
    }
    if (reason === "content_filter") {
      return { ok: false, code: "content_filter", message: "圖片內容觸發安全篩選，無法完成讀圖。", retryable: false };
    }
    return { ok: false, code: `incomplete_${reason}`, message: "AI 回應未完整結束，請稍後再試。", retryable: true };
  }

  const content = (raw.output || []).flatMap((item) => item.type === "message" ? item.content || [] : []);
  const refusal = content.find((item) => item.type === "refusal")?.refusal;
  if (refusal) return { ok: false, code: "refusal", message: "AI 拒絕處理這張圖片。請確認圖片內容後再試。", retryable: false };

  const text = content.filter((item) => item.type === "output_text" && typeof item.text === "string").map((item) => item.text).join("");
  if (!text.trim()) {
    return { ok: false, code: "empty_output", message: "AI 已完成處理，但沒有產生結構資料。系統將自動重試。", retryable: true };
  }
  return { ok: true, text };
}

export function safeResponseDiagnostics(raw: OpenAIResponse) {
  return {
    responseId: raw.id || null,
    status: raw.status || null,
    incompleteReason: raw.incomplete_details?.reason || null,
    outputTypes: (raw.output || []).map((item) => item.type || "unknown"),
    contentTypes: (raw.output || []).flatMap((item) => (item.content || []).map((content) => content.type || "unknown")),
    inputTokens: raw.usage?.input_tokens || 0,
    outputTokens: raw.usage?.output_tokens || 0,
    reasoningTokens: raw.usage?.output_tokens_details?.reasoning_tokens || 0,
  };
}
