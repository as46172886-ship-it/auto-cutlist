const DEFINITIONS = {
  export_roundtrip: {
    label: "Excel匯出往返測試",
    countsAsRecognitionScore: false,
    countsAsFormalSiteTest: false,
    purpose: "只驗證正確列經匯出、重新開啟及解析後仍完全一致，不代表AI看圖正確率。",
  },
  deterministic_fixture: {
    label: "結構化fixture公式回歸",
    countsAsRecognitionScore: false,
    countsAsFormalSiteTest: false,
    purpose: "驗證已結構化資料經SOP公式與Excel輸出後的結果，不代表AI從原圖辨識的正確率。",
  },
  formal_site_scan: {
    label: "正式網站完整掃圖驗收",
    countsAsRecognitionScore: true,
    countsAsFormalSiteTest: true,
    purpose: "由正式網站重新上傳完整原圖、執行AI、下載Excel並逐列exact match；這才可作正式F1。",
  },
};

export function evaluationReport(kind, result) {
  const definition = DEFINITIONS[kind];
  if (!definition) throw new Error(`unknown evaluation kind: ${kind}`);
  return { evaluationKind: kind, ...definition, ...result };
}
