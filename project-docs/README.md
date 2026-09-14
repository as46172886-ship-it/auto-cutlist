# 自動拆料專案總索引

整理日期：2026-09-14。這份建檔涵蓋目前工作區可取得的資料，不是全部歷史對話逐字稿。

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

- 現行 Sites 原始碼提交：`11c1f3aa0e05b3f1db8795675d7d1e899970ce45`，已部署為 v81；歷史移轉基準仍保留在 `SOURCE_VERSION.txt`。
- `app/face-machining.ts` 已接入 `/api/non-door` 與 `/api/doors`，並由現行測試覆蓋；未完成項目改以 [STATUS.md](STATUS.md) 為準。
- GitHub 私人庫 `as46172886-ship-it/auto-cutlist` 保存程式、測試、規則文件與可取得附件；本次 v81 快照同步完成後以倉庫最新 HEAD 為準。
- GitHub 是移轉與稽核用封存；Sites 仍是網站原始碼與部署來源。同步 GitHub 不取代 Sites，也不變更 owner-only 存取權。
- 本輪已完成離線測試與正式站部署，但未執行付費原圖正式掃描；正式 AI 90% 仍待依 [VALIDATION.md](VALIDATION.md) 驗收及複驗。

## GitHub 保存方式

建議使用私人儲存庫 `auto-cutlist`，以整個 `codex-migration` 內容為根目錄；不要只存三份摘要而漏掉程式、測試、原圖與歷史依據。保留既有目錄，避免程式診斷的相對路徑失效。

上傳前依 FILES.json 逐檔檢查並掃描秘密；不得直接遞迴上傳整個工作區。排除 `.git/`、`node_modules/`、`dist/`、`.env*`、`.dev.vars*`、`.wrangler/`、`.sites-runtime/`、cookies、授權快取、帶憑證的日誌與臨時建置包。原圖、正解與客戶資料只能進入確認適合的私人儲存庫。清冊是候選保存範圍，不是已通過機密審核的證明。

往後每次規則調整需同時更新 RULES、FORMULAS、測試與 STATUS；歷史資料不覆蓋、不刪除。每次上線另記提交 SHA、Sites 版本與驗收依據。
