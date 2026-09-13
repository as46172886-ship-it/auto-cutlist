# 使用工具與程式地圖

2026-09-13 依本機 package.json 與原始碼記錄；以下是專案目前宣告，不是對外推薦或保證已升級到最新版。

| 工具 | 宣告版本／用途 |
| --- | --- |
| Node.js | 要求≥22.13；執行程式、離線測試與診斷 |
| TypeScript | 5.9.3；結構資料與計算器 |
| React／React DOM | 19.2.6；網站介面 |
| Next | 16.2.6；搭配Vinext的應用结构 |
| Vinext／Vite | 0.0.50／8.0.13；建置與執行 |
| Cloudflare Vite plugin／Wrangler | 1.37.1／4.92.0；Worker建置工具 |
| Tailwind CSS | 4.2.1；樣式 |
| pdfjs-dist | ^5.4.149（確切安裝依lock）；PDF轉圖 |
| fflate | 0.7.4；壓縮與Excel封裝相關 |
| Drizzle ORM／kit | 0.45.2／0.31.10；資料庫腳手架，不能因此宣稱正式資料庫已啟用 |
| OpenAI Responses API | `app/api/analyze/pipeline.ts` 目前指定gpt-5.4；負責圖面結構化提取，非最終尺寸裁決 |
| Sites | 現有私人網站部署與雲端秘密；GitHub歸檔不取代它 |
| Git／GitHub | 原始碼與版本保存；目標為私人 `as46172886-ship-it/auto-cutlist`，目前因官方事故尚未連接／上傳 |
| LibreOffice | 歷史Excel開啟／重存／PDF驗證，不是正式看圖AI |

## 程式入口

- `app/api/orient`：旋正證據；`segment`：分立面／桶身／裁切。
- `app/api/carcass` 與 `app/domain/carcass`：早期基礎桶身模式；只算側／頂底／背，不等於使用者最新「含內部件」的完整桶身定義。
- `app/api/non-door`、`app/non-door-normalize.ts`：內部結構與正規化。
- `app/api/doors`、`app/door-recognition.ts`、`app/door-scan.ts`：末段門板辨識與證據鎖定。
- `app/sop.ts`：基本／非門／完整三種計算入口；`drawer-rules.ts`、`hinge-rules.ts`、`quantity-rules.ts`：固定公式。
- `app/sop-rules.ts`：提示與展示規則；與公式helper可能有歷史差異，見STATUS。
- `app/xlsx-export.ts`：Excel輸出；`tests/`：離線回歸；`scripts/`：診斷與驗收。
- `app/face-machining.ts`：未接入草稿，非已啟用工具。

## 憑證與執行限制

API只由伺服器讀取`OPENAI_API_KEY`；本文件不保存值。GitHub不保存金鑰、cookies、登入session或授權快取。雲端既有秘密留在原Sites，不搬移明文。

原npm建置／安裝腳本以Linux與bash為主；Windows歷史以等價Vinext建置驗證。是否能在新機直接執行需先檢查，不把平台專用路徑當成可攜安裝方案。完整依賴與供應鏈版本以`package-lock.json`為準。
