# 接手狀態與下一步

## 2026-09-12目前狀態

- 2026-09-11接手修正版已部署為Sites v77，原owner-only網址與權限維持不變。
- 2026-09-12實站回報19桶以上案件被18張結構裁切上限誤判缺圖；已改為每桶必要internal原圖不可被補充視角上限截掉。235/235測試與Vinext建置通過，已部署為Sites v78。
- 上述是程式與離線回歸，不是佛斯特正式AI辨識；90%目標仍未驗收。

## 基準（歷史已回報，移轉時未重新跑AI）

- 移轉來源HEAD：見 SOURCE_VERSION.txt，為 c82259de56af62a72e55ff2b920abfe456dba648。2026-09-11接手後工作副本另有未部署修正，不能再把該SHA當成目前工作副本內容。
- 2026-09-11 Windows接手環境以鎖檔安裝後完成等價Vinext建置與Node測試：235/235通過。原Linux包裝腳本因本機沒有bash未直接執行。
- 結構化雙立面＋公式＋Excel離線回歸：61/61，precision/recall/F1均100%。門板5/5列，門五金6/6列（列數不是片數）。
- 完整AI看圖正式F1：尚未取得；90%目標與複驗未完成。
- 新修正已保存，尚未部署到正式站，不能把本包版本說成已上線。
- 舊的全域跨立面合併曾使模擬上限F1為76.1%；現已修正。這不是歷史AI實測基準。
- LibreOffice往返重存61/61；雙立面輸出橫式A4共7頁，舊紀錄6頁屬較早輸出。

## 正式站與阻擋

正式網址：https://cabinet-ai-demo.as46172886.chatgpt.site/
Sites project_id：appgprj_6a700075d288819187b803b1296c67e9，保存在原始碼 .openai/hosting.json。

2026-09-08/09曾遇雲端Google登入502 Connection refused；使用者複製授權URL後見400 Missing required parameter: redirect_uri。尚未證實兩者同一根因，不能歸咎帳密。
最新該次查詢：專案active、未disabled、使用者owner；首頁於2026-09-08T17:15:38Z回200，之後11個字型檔404，路徑包含 /workspace/sites/cabinet-ai-demo/.vinext/fonts/。部分請求帶平台登入識別，並非所有瀏覽器都未登入。字型404通常影響字型載入，不能當成Google登入502原因。
多次雲端接手請求成功但使用者看不到按鈕。使用者本機登入不代表雲端瀏覽器同步登入。
2026-09-11重新查得：同一project仍active、未disabled、目前使用者為owner、access仍為owner-only custom，latest version為76；雲端秘密清單仍有OPENAI_API_KEY項目且值受平台遮蔽。近期正式日誌仍可重現11個Geist字型404，請求同時帶平台登入識別，因此字型404不是登入失敗證據。接手工作副本已移除next/font依賴，改用本機中文字型fallback；新建置不再引用錯誤字型路徑，但尚未部署。

## 接手先做

1. 讀取原始 README、package.json、scripts/build-verified.sh；需要Node>=22.13。沿用鎖檔與現有安裝流程。平台專屬環境不可假設新Codex具備。
2. 先跑 npm test（包含build及全部tests）；需要依賴時依README安裝。不要直接跑 scripts/*live*，那可能呼叫收費AI。
3. 離線完整診斷：在 cabinet-ai-demo 執行 node scripts/diagnose-foster-combined.mjs '../佛斯特_修正拆料表(1).xlsx'。
4. 查字型資產路徑/打包問題與登入狀態；依平台正規方式恢復實站驗收，不改公開權限或自行重建OAuth。
5. 找到當日正式測試帳本；若找不到，標記不明，不假設為0。按 scripts/lib/formal-site-run.mjs 和 example receipt 收集正式證據。
6. 真實missing/extra才決定下一項準確率修正。未取得正式F1前不得宣布達標。

## 已保存修正索引

詳見 docs/research-log.md、CHANGELOG.txt、tests/：門向原圖證據鏈與遮罩；裁切逐桶公平分配與缺原圖阻擋；雙立面分組輸出、唯一ID與來源匹配；腳高共識；填縫板與衣桿隔離；抽屜上下/並排、每組寬度、N−1中立板、擋板分段保留及數量閉合；J把/斜把互斥；開向備註優先於舊文字；畫面重複列唯一鍵；完整61列Excel回歸。

## 2026-09-11已重現並修正、尚未部署

- `scanGlobalNonDoor`原本只送出前4張原圖，已改為保留前端允許的6張，新增第5/6張回歸測試。
- 非標準板厚原本在非門正規化時被強制改回標準profile，Excel又只按品項推定厚度。現在只有`standard_sop`會標準化；`user_confirmed`與`unknown`沿資料流保留，板料合併鍵包含厚度，Excel優先使用逐列`thicknessMm`。
- 移除`next/font`的Geist載入；新建置不再產生對`/workspace/sites/.../.vinext/fonts/`的引用。
- 上述都是離線程式修正，不是正式佛斯特missing/extra結論，也不代表已上線。

## 仍待完成

- 正式站登入需由實際可操作的登入瀏覽器重驗；目前平台資料與日誌只證明專案、owner-only存取和部分已識別請求正常，不能宣稱先前Google 502已消失。
- 找不到2026-09-11正式測試run ledger，因此今日使用次數仍標記「不明」，不可假設0次。
- 新修正版尚未保存為Sites版本或部署；正式AI完整原圖F1及90%複驗仍未完成。

## 原則與歷史規則

圖面常為cm，料單mm，標準板18/背板8；基本頂底D×(W−36)、背板(W−26)×(H−26)、固格深D−29；實際有中立、中心線、檯面、斜把、特殊板厚時依已確認結構與現行SOP，不無條件套基本式。滑軌以組（兩支）計，最大500mm。24mm是間隙/抬高/尺寸鏈哪一種必須先辨識，不能重扣。背條在多版SOP與記憶有不同門檻，接手不可用摘要覆蓋程式；需逐案追正解來源。

本包的研究材料保留官方文件/原始專案來源連結於原文，不代表每個推薦方案採用。不得用歷史助理「完成」敘述取代可重現證據。
