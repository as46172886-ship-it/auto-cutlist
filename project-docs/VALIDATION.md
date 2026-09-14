# 測試與驗收

## 2026-09-14 已執行

- `node --test tests/*.test.mjs`：256/256 通過，包含桶身基準清除、門／屜頭獨立斜把、實體擋板分段、每抽一片屜頭、尺寸線幾何、同圖桶內角色閉合、桶身局部／全域 ID 對應，以及2.4／24mm只提示斜把且不扣門高／不阻擋的回歸。
- `npx vinext build`：成功；首頁與 7 個 API routes 完成 production build。
- 建置產物驗證：`dist/server/index.js` 有 Worker `default.fetch`；`dist/.openai/hosting.json` 可解析並與原 project_id 一致。
- 佛斯特結構化雙立面 fixture：61/61；門板與門五金仍由 exact-match 回歸涵蓋。
- 原始碼提交 `070be29e1dc2bc7564076a6727f212aa4dcbc133` 已推送、封裝、儲存為 Sites v82 並成功部署。
- `npx tsc --noEmit` 尚有 6 個既存型別錯誤；這不影響本次 Vinext production build，但不得把型別檢查描述為全綠。

## 離線與正式分開

- 256 項測試與佛斯特 61/61 代表給定結構資料後的規則、公式及 Excel 回歸，不代表 AI 看原圖達 90%。
- 名稱含 `live` 的腳本可能呼叫付費 AI，不屬一般離線測試。
- Windows 沒有 bash，故 `npm test` 的 Linux wrapper 不直接執行；本輪已分別完成其核心 Node 測試、Vinext build 與產物驗證。

## 正式驗收必要證據

1. 先確認 Asia/Taipei 當日帳本，每天完整正式掃描與下載最多 2 次，未知不能當 0。
2. 原網站上傳兩張完整佛斯特原圖，經 AI 掃描後下載 Excel，不以預填 fixture 取代。
3. 保存原圖 SHA-256、網址、部署版本、開始／結束時間、Excel SHA-256 與收據。
4. 比對品項、規格、厚度、數量、備註及重複列數量；4E 門、假門板、屜頭、開向、加工與門五金均不可排除分母。
5. precision＝正確匹配列／輸出列；recall＝正確匹配列／正解列；F1＝2PR／(P+R)。
6. F1≥90% 且再複驗維持才算目標完成。速度、介面或離線 fixture 不能代替準確率。

Excel 另需驗證可正常開啟、無修復訊息、有效列印範圍與可讀性。歷史 LibreOffice 重存 61 列相符、橫式 A4 七頁；不是本輪重新執行的正式 AI 驗收。
