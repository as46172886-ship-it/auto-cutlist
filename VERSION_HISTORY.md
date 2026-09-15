# 正式網站版本紀錄

最後核對：2026-09-14（Asia/Taipei）

本檔是自動拆料網站的正式、只追加版本帳本。版本號與部署狀態來自原 Sites 專案 `appgprj_6a700075d288819187b803b1296c67e9`；歷史修改註記取自各版本對應的 Git 提交標題。歷史標題只供追溯，不得取代當時完整程式、測試與規則內容。

目前清冊共 82 個 Sites 版本：76 個已部署，6 個僅儲存未部署。最新正式網站版本為 v82。

## 每次更新都必須遵守

1. 建立或部署新 Sites 版本前，先讀本檔，並新增該版本的「修改註記」；不得覆寫、刪除或重排舊版本紀錄。舊紀錄若有錯，只能追加更正說明。
2. 新版本至少記錄：使用者確認的規則、實際修改、不得退步項目、驗證結果、尚未解決事項、來源提交、Sites 版本與部署狀態。
3. 發布後同步更新 `CURRENT_VERSION.txt`、`START_HERE.md`、`HANDOFF.md`、`project-docs/STATUS.md` 與私人 GitHub 保存庫。
4. 掃描失敗或被阻擋時，記錄發生時間、網站版本、上傳檔名、完整錯誤文字與缺少的精確欄位；不能只靠聊天截圖，也不能用籠統「未閉合」取代欄位級原因。
5. 離線測試、結構化 fixture 與正式 AI 原圖驗收分開記錄。沒有正式原圖、下載 Excel 與 exact-match 收據，不得宣稱正式 AI 辨識已達 90%。
6. 任何新規則必須附防退步測試；若新規則與歷史 SOP 衝突，以使用者最新明確確認為準，並把被取代的舊規則寫進修改註記。

## 現行不得退步規則

- 2.4cm／24mm有標示時，只代表可放心判定該面有斜把；它不是尺寸關係，不扣門高，也不是完整料單阻擋條件。
- 沒有2.4／24mm標示時，不代表沒有斜把；仍須看門板或屜頭是否有斜把空隙。
- 門與屜頭分開判斷斜把，彼此不得傳播。
- 固格本輪不由門面辨識改動，維持既有公式。
- 有抽屜就必須有對應屜頭；門是否存在則依圖面證據。
- 同一條標高線的不同分段不自動相加；只有圖面另有平行內部尺寸線，才視為桶內尺寸證據。
- 正式 AI 90%尚未驗收，不能用離線 256/256 或結構化 61/61 代替。

## v82 詳細修改註記

- 狀態：已部署至原正式網站，owner-only 權限未變；部署識別為 `appgdep_6aa7f3063bfc8191ad743d0396fb3754`。
- 來源提交：`070be29e1dc2bc7564076a6727f212aa4dcbc133`。
- 使用者確認：不要解讀2.4的尺寸關係；有2.4就直接確認有斜把，沒有2.4則改看是否畫出斜把空隙，沒有標示本身不能作否定證據。
- 實際修改：移除24mm關係分類、門高減24mm與「24mm關係未確認」阻擋；門與屜頭的斜把證據維持獨立。
- 防退步驗證：完整 Node 測試 256/256、Vinext production build、Worker entrypoint與hosting manifest檢查均通過；佛斯特結構化 fixture 61/61。這些不是正式 AI 原圖辨識率。
- 2026-09-14 21:37 使用者回報：正式站上傳 `FF4D9D04-EB79-438F-9236-8B9BC4A5725C.png` 後顯示：
  「門板仍未閉合：E01-C01：門片尺寸或斜把加工樣式尚未閉合；E01-C02：門片尺寸或斜把加工樣式尚未閉合；E01-C03：門片尺寸或斜把加工樣式尚未閉合。本次不產生可能漏門板或門五金的完整料單。」
- 判讀：舊的「2.4／24mm關係尚未閉合」文字已消失，表示 v82 的2.4規則已生效；目前剩下的是 C01～C03 的「門片尺寸或斜把加工樣式」籠統阻擋，畫面無法分辨實際缺哪個欄位。
- 尚未解決：正式站未保存最近一次掃描結果，Sites worker 日誌亦無可還原的該次內容。下一次修正應把阻擋原因拆成欄位級訊息，並保存可追溯的最近掃描收據／紀錄；在完成前不可猜測漏的是尺寸或斜把。

## 全部 Sites 版本索引

| 版本 | 狀態 | 來源提交 | 日期 | 修改註記 |
| --- | --- | --- | --- | --- |
| v82 | 已部署 | `070be29` | 2026-09-14 | 2.4／24mm只作斜把肯定提示；不再判尺寸關係、不扣門高、不作完整料單阻擋 |
| v81 | 已部署 | `11c1f3a` | 2026-09-14 | fix: recover internal crops from combined elevations |
| v80 | 已部署 | `28b2105` | 2026-09-14 | fix: close face machining after carcass analysis |
| v79 | 已部署 | `3069552` | 2026-09-12 | Clarify dimension segments and resolve calculated drawer questions |
| v78 | 已部署 | `e3138e1` | 2026-09-12 | Preserve one structural crop per cabinet |
| v77 | 已部署 | `e85513b` | 2026-09-12 | Fix cutlist scan and board thickness handling |
| v76 | 已部署 | `0ab9127` | 2026-09-02 | 新增紅色尺寸線分離輔助圖 |
| v75 | 已部署 | `c9c9f83` | 2026-09-02 | 修正料單列印縮放相容性 |
| v74 | 已部署 | `fd3568e` | 2026-08-29 | 驗證逐桶任務實際並行上限 |
| v73 | 僅儲存，未部署 | `69fd0e4` | 2026-08-29 | 限制非門掃描並行並對齊批次等待 |
| v72 | 僅儲存，未部署 | `5c58e80` | 2026-08-29 | 對齊門板完整三輪等待時間 |
| v71 | 僅儲存，未部署 | `7fc31e7` | 2026-08-29 | 對齊非門前後端等待時間 |
| v70 | 僅儲存，未部署 | `5360b1f` | 2026-08-29 | 鎖定門板桶身ID配對 |
| v69 | 僅儲存，未部署 | `9c7278d` | 2026-08-29 | 防止結構複核跨桶套用 |
| v68 | 僅儲存，未部署 | `df375e6` | 2026-08-29 | 修正非門補充複核逾時 |
| v67 | 已部署 | `d80b12e` | 2026-08-29 | 修正正式WHD輸出上限 |
| v66 | 已部署 | `475dccc` | 2026-08-29 | 門板五金與正式驗收候選版 |
| v65 | 已部署 | `5d40971` | 2026-08-28 | 完整門板與嚴格佛斯特驗收 |
| v64 | 已部署 | `47cda85` | 2026-08-28 | Use strict multiset BOM scoring and remove answer overrides |
| v63 | 已部署 | `08e22a2` | 2026-08-27 | Correct carcass height span association |
| v62 | 已部署 | `9aa282e` | 2026-08-28 | 加入尺寸候選閉合求解與向量證據 |
| v61 | 已部署 | `4951221` | 2026-08-26 | 修正四維路桶高與正解套用 |
| v60 | 已部署 | `e5dd5e5` | 2026-08-26 | 修正Excel料單相容性 |
| v59 | 已部署 | `26d3e0c` | 2026-08-25 | 清除已由正確料單解決的舊問題 |
| v58 | 已部署 | `23412da` | 2026-08-25 | 排除公式五金重複計數 |
| v57 | 已部署 | `2b53874` | 2026-08-25 | 修正YCX尺寸並改為Excel完整料單 |
| v56 | 已部署 | `5c21d3c` | 2026-08-25 | 固定填縫板尺寸方向 |
| v55 | 已部署 | `c2b1d64` | 2026-08-25 | WHD逾時自動縮圖重試 |
| v54 | 已部署 | `ec1673a` | 2026-08-24 | 加入抽屜框複核與24毫米斜把閉合 |
| v53 | 已部署 | `a6e913e` | 2026-08-24 | 加入中立與層板專用線條複核 |
| v52 | 已部署 | `12f8459` | 2026-08-24 | 穩定獨立板件正規化與雙證據評測 |
| v51 | 已部署 | `d75b73c` | 2026-08-24 | 強化全高中立與共用腳高辨識 |
| v50 | 已部署 | `e5e9d4b` | 2026-08-24 | 加入WHD專用關卡與全圖局部雙證據 |
| v49 | 已部署 | `58d9f92` | 2026-08-24 | 加入工程圖 PDF 向量證據、掃描增強與非門分工辨識 |
| v48 | 已部署 | `7d83f79` | 2026-08-24 | Suppress unconfirmed independent panels |
| v47 | 已部署 | `41a192d` | 2026-08-24 | Infer side-by-side drawer centerline |
| v46 | 已部署 | `870bf54` | 2026-08-24 | Derive drawer opening widths from locked modules |
| v45 | 已部署 | `5e42986` | 2026-08-24 | Complete shared non-door structural patterns |
| v44 | 已部署 | `117c480` | 2026-08-24 | Slim non-door vision response contract |
| v43 | 已部署 | `62b666b` | 2026-08-24 | Extend bounded non-door scan window |
| v42 | 已部署 | `7872b2c` | 2026-08-24 | Broaden structural recognition correction |
| v41 | 已部署 | `f4d1c6d` | 2026-08-24 | Improve non-door recognition completion |
| v40 | 已部署 | `585bbd0` | 2026-08-24 | 重構門以外完整拆料與正確率驗證 |
| v39 | 已部署 | `0522523` | 2026-08-24 | 重構桶身證據與確定性計算 |
| v38 | 已部署 | `0c24fde` | 2026-08-22 | Reset workflow to carcass-only W H D detection |
| v37 | 已部署 | `8f506f1` | 2026-08-22 | Lock original pixel orientation with four candidate guide |
| v36 | 已部署 | `49cc234` | 2026-08-22 | Split orientation and segmentation to avoid hosted timeout |
| v35 | 已部署 | `d0239fb` | 2026-08-19 | 記錄本次門板與料單SOP修正 |
| v34 | 已部署 | `de50684` | 2026-08-17 | 將無法偵測門片改為非阻擋提醒 |
| v33 | 已部署 | `678d87e` | 2026-08-17 | 完成 SOP 層板覆蓋防漏與門鎖過期問題清理 |
| v32 | 已部署 | `771ad0b` | 2026-08-17 | 補齊 SOP 踢腳板來源檢核並完成料單對照 |
| v31 | 已部署 | `09b470e` | 2026-08-17 | 鎖定正確裁切與門向並補齊SOP缺料檢核 |
| v30 | 已部署 | `be7475a` | 2026-08-17 | 鎖定圖面方向並補齊完整 SOP 拆料規則 |
| v29 | 已部署 | `0aa7267` | 2026-08-17 | Retry incomplete orientation analysis once |
| v28 | 已部署 | `e5872db` | 2026-08-17 | Cross-check number and width directions |
| v27 | 已部署 | `cc40c59` | 2026-08-17 | Lock drawing orientation before cabinet segmentation |
| v26 | 已部署 | `895d893` | 2026-08-17 | Lock resolved 24mm door gap decisions |
| v25 | 已部署 | `354ab07` | 2026-08-15 | Make door gaps advisory only |
| v24 | 已部署 | `d369d02` | 2026-08-15 | Let door scan fail without blocking analysis |
| v23 | 已部署 | `fb2b0f4` | 2026-08-15 | Prevent long analysis stalls |
| v22 | 已部署 | `a5def99` | 2026-08-15 | Allow internal crops to reach door scan |
| v21 | 已部署 | `11ca554` | 2026-08-14 | Add preflight evidence gate |
| v20 | 已部署 | `641fc97` | 2026-08-12 | Decouple door symbols from dimensions |
| v19 | 已部署 | `c044179` | 2026-08-11 | Fix drawer tiers and door scan diagnostics |
| v18 | 已部署 | `bdc2886` | 2026-08-11 | 逐桶真裁切與門板優先鎖定 |
| v17 | 已部署 | `0d4dcd4` | 2026-08-10 | Add independent door recognition |
| v16 | 已部署 | `aec35fa` | 2026-08-10 | Hide absent cabinet items |
| v15 | 已部署 | `8cb6765` | 2026-08-10 | Fix mobile blockers and quantity reconciliation |
| v14 | 已部署 | `770a682` | 2026-08-06 | Add explicit V2 quantity reconciliation for every cabinet and hardware item |
| v13 | 已部署 | `60bdcd7` | 2026-08-05 | Complete SOP quantity and interior validation |
| v12 | 已部署 | `d681b0b` | 2026-08-05 | Centralize all SOP quantities and merge blockers |
| v11 | 已部署 | `704d9eb` | 2026-08-04 | Trace every SOP formula and cabinet annotation |
| v10 | 已部署 | `4287513` | 2026-08-04 | Preserve and validate cabinet interiors |
| v9 | 已部署 | `cf1dd8d` | 2026-08-04 | Fix evidence binding and false scan blocks |
| v8 | 已部署 | `6cfc1a0` | 2026-08-04 | Enforce continuous cabinet side interpretation |
| v7 | 已部署 | `3687def` | 2026-08-04 | Retry slow OpenAI vision passes |
| v6 | 已部署 | `09b2233` | 2026-08-04 | Enforce rotated drawing axis evidence |
| v5 | 已部署 | `7573830` | 2026-08-03 | 完整SOP與三階段尺寸判讀 |
| v4 | 已部署 | `b01e02d` | 2026-08-03 | 加入雙重讀圖覆核、對話修正與 SOP 阻擋驗證 |
| v3 | 已部署 | `8a3196b` | 2026-08-03 | 修正 OpenAI 結構輸出解析、逾時與自動重試 |
| v2 | 已部署 | `d346dd7` | 2026-08-03 | 加入 OpenAI 真實讀圖與 SOP 確認拆料流程 |
| v1 | 已部署 | `cf7d482` | 2026-08-03 | Build interactive cabinet AI prototype |

## 新版本追加範本

### vNEXT — YYYY-MM-DD

- 狀態：已保存／已部署。
- 使用者確認：
- 實際修改：
- 不得退步：
- 驗證結果：
- 已知未解決：
- 來源提交：
- Sites 版本／部署識別：
- 正式原圖驗收收據：

## 2026-09-15 新版本修改註記（發布前）

- 使用者要求：門片有無、片數、寬高及加工在同一階段完整判斷；確定後不再更動。採用最後一關完整確認門面，沿用前段桶身與內裝資料。
- 實際修改：最後門面關卡不再使用第一輪符號鎖覆蓋後輪整份門資料；每輪完整重讀，同輪的門、屜頭與加工一起驗證。完整候選直接採用並停止掃該桶，不再受舊候選分數影響。
- 防退步：拒絕partial、未確認區域、被過濾的門組、缺寬高與斜把樣式；門片確認後不以舊桶身门草稿覆寫。保留2.4只作斜把提示、固格及抽屜公式。
- 已知限制：正式AI原圖90%仍未驗收；同日實站測試須遵守每日兩次上限。本次先以不呼叫AI的多輪回歸確認資料流。
- 診斷更正：後續查到2026-09-14 21:37門關卡422，以及之前桶身/分桶/非門200的請求紀錄，但沒有逐門AI回傳內容。舊紀錄「沒有可還原內容」仍成立，不能解讀為沒有任何請求紀錄。
- 驗證、來源提交與正式版本：完成後另行追加。
- 發布前複查補正：最後加工門清單只允許4E，鋁框只列排除註記，防止过滤後加工索引錯位。最終266/266離線測試通過，正式建置成功；保留6個既存TypeScript技術債，未做付費AI原圖驗收。

## v83 — 2026-09-15 最後門面完整確認（已部署）

- 使用者確認與修改：承接上節，門片寬高與全部門面資料同輪確認後凍結，不再拆成先鎖符號、後補尺寸；未確認草稿不覆蓋完整結果。
- 防退步：10項新測試覆蓋補齊寬高、partial、缺門組、分組重排、加工索引、舊門尺寸覆寫、確認即停止、無門衝突、2.4只提示，以及鋁框排除索引。固格、抽屜99／90／81及24mm不扣門高不變。
- 驗證：全部266/266離線測試通過、Vinext production build成功、Worker default.fetch及封裝manifest檢查成功；6個既存TypeScript型別錯誤未修。
- 來源提交：`a5139a99c577cbe0f68c365a775560dc58ff82c6`，已推送原Sites來源main。
- Sites版本：`appgprj_6a700075d288819187b803b1296c67e9~appgver_516607f4a96081918e38152e6d0f272f`（v83）。
- 部署：`appgdep_6aa845b470008191848bb6c44b8c77ba`，succeeded；UTC 2026-09-14T19:06:42.458058+00:00（臺北2026-09-15）。
- 網址：https://cabinet-ai-demo.as46172886.chatgpt.site/ 。owner-only存取不變，D1／R2未啟用，既有雲端秘密保留。
- 正式原圖驗收收據：本輪未執行付費AI掃描或下載驗收，沒有新增正式F1；90%與複驗仍未完成。
- 已知未解決：填縫未確認、假門板完整支援、非等寬活格及抽牆高文字衝突沿用既有待辦。診斷只記錯誤欄位，不宣稱已有完整案件資料庫。
