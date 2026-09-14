# 自動拆料 → Codex 接手包

原始移轉整理日期為2026-09-11；本工作副本於2026-09-14更新到正式站 v80。這是目前可取得資料的移轉副本，不是全部歷史對話逐字匯出；原專案與原始檔保留。

## 如何接手

解壓縮後，讓 Codex 開啟整個 codex-migration 資料夾，讀本檔、AGENTS.md、HANDOFF.md，再進入 cabinet-ai-demo 工作。目前 `cabinet-ai-demo` 的提交 `28b2105425fc3ca7cd0d767d2362fa261cd55b55` 已部署為原網站 Sites v80；後續仍須以 `CURRENT_VERSION.txt` 與 Sites 狀態核對，不可只信舊摘要。

可交給 Codex 的第一句話：

「請先讀 START_HERE.md、AGENTS.md、HANDOFF.md 與 cabinet-ai-demo/docs/research-log.md，延續既有自動拆料專案。先核對 CURRENT_VERSION.txt、原 Sites project_id 與既有測試，再依每日最多兩次限制執行佛斯特完整原圖正式掃描，下載Excel做全列exact match；不要把離線100%當成AI辨識率，不要另建網站或改公開權限。」

## 內容

- cabinet-ai-demo/：目前正式網站的原始碼、測試、fixture、研究紀錄及設定檔；不含依賴安裝目錄、Git登入設定或雲端金鑰。
- 佛斯特_修正拆料表(1).xlsx：現行逐列正解。與 references 中同名舊版分開保留。
- 估價原稿含料單(1).xls：輸出版型參考。
- references/：此次找回的歷版 SOP、衣櫃試拆表與研究藍圖，屬歷史材料，不自動視為最新規則。
- offline-evidence/：先前離線圖像處理、原圖副本、診斷與Excel相容性材料。檔案存在不代表每個研究方案已採用或驗收。
- SOURCE_VERSION.txt、CURRENT_VERSION.txt、CHANGELOG.txt：原始移轉基準、目前正式版本與提交摘要。
- MANIFEST.json：原始2026-09-11移轉包的大小與SHA-256歷史清冊；目前GitHub快照清冊見project-docs/FILES.json。

本包不轉移瀏覽器登入狀態或雲端API秘密。已配置的雲端秘密仍留在原Sites專案；新Codex環境需有正常平台存取權，不能擷取明文金鑰當成移轉方式。

## 範圍限制

歷史對話沒有完整逐字匯出介面；本包以可取得檔案、版本紀錄與本對話決策整理。未取得的舊案附件（例如獨立YCX原始圖面、所有早期PDF與所有歷史試拆表）不能聲稱已全部移轉；YCX已有程式fixture。若後续取得更多附件，以新增來源與雜湊方式補入，不覆蓋現行正解。
