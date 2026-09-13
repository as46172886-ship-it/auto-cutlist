# 自動拆料專案總索引

整理日期：2026-09-13。這份建檔涵蓋目前工作區可取得的資料，不是全部歷史對話逐字稿。

## 建議分類

| 文件／目錄 | 用途 |
| --- | --- |
| [RULES.md](RULES.md) | 使用者最新規則、判圖流程、優先順序 |
| [FORMULAS.md](FORMULAS.md) | 目前計算公式、單位、適用條件 |
| [TOOLS.md](TOOLS.md) | 實際使用的程式工具、版本與用途 |
| [STATUS.md](STATUS.md) | 未完成事項、規則衝突、驗收狀態 |
| [VALIDATION.md](VALIDATION.md) | 離線測試與正式 AI 驗收分開管理 |
| [AUDIT-2026-09-13.md](AUDIT-2026-09-13.md) | 本次完整檔案、程式、測試與附件盤點 |
| [SOURCE-RULES.md](SOURCE-RULES.md) | 程式內 67 條 SOP、30 條數量規則、15 條基礎桶身規則的完整快照 |
| [FILES.json](FILES.json) | 建檔時來源檔案的大小與 SHA-256 清冊 |
| ../cabinet-ai-demo/ | 現行程式、測試、fixtures、設定；維持原路徑 |
| ../references/ | 歷版 SOP、研究藍圖；原件保留，不冒充最新規則 |
| ../offline-evidence/ | 原圖副本、裁切、歷史離線結果；存在不代表正式驗收 |

正解：`../佛斯特_修正拆料表(1).xlsx`。版型：`../估價原稿含料單(1).xls`。
交接入口：[START_HERE](../START_HERE.md)、[AGENTS](../AGENTS.md)、[HANDOFF](../HANDOFF.md)。

## 保存狀態

- 本機程式基準提交：`3069552d161ddca1e050cc7abe1689d1eaaa1480`。
- 另有未提交草稿 `app/face-machining.ts`，尚未接入 API、測試或部署，須一起保存為「未完成」，不能當正式功能。
- 本次僅整理文件與清冊，不修改計算程式，不進行正式掃圖或部署。
- GitHub 目標庫為私人 `as46172886-ship-it/auto-cutlist`；2026-09-13 GitHub 官方授權端點事故期間仍無法完成連接，本次文件建立不代表已上傳 GitHub。
- 現有程式遠端是 Sites 原始碼倉庫，不是 GitHub。GitHub 建檔不取代原 Sites、不變更網站存取權。

## GitHub 保存方式

建議使用私人儲存庫 `auto-cutlist`，以整個 `codex-migration` 內容為根目錄；不要只存三份摘要而漏掉程式、測試、原圖與歷史依據。保留既有目錄，避免程式診斷的相對路徑失效。

上傳前依 FILES.json 逐檔檢查並掃描秘密；不得直接遞迴上傳整個工作區。排除 `.git/`、`node_modules/`、`dist/`、`.env*`、`.dev.vars*`、`.wrangler/`、`.sites-runtime/`、cookies、授權快取、帶憑證的日誌與臨時建置包。原圖、正解與客戶資料只能進入確認適合的私人儲存庫。清冊是候選保存範圍，不是已通過機密審核的證明。

往後每次規則調整需同時更新 RULES、FORMULAS、測試與 STATUS；歷史資料不覆蓋、不刪除。每次上線另記提交 SHA、Sites 版本與驗收依據。
