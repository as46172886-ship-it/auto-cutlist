# 系統櫃自動拆料：深度研究、程式架構與修正機制藍圖

日期：2026-08-24  
定位：可直接用來規劃下一版系統的技術基線  
優先範圍：程式正確性、圖面理解、規則治理、修正閉環；先做櫃體，再擴充門片、斜把、封板、五金與裁切最佳化

---

## 1. 最重要的研究結論

自動拆料不應被設計成「把一張圖交給 AI，讓它直接吐 Excel」。可靠方案必須拆成四種責任：

1. **證據擷取**：從 DXF、向量 PDF、掃描圖取得文字、尺寸線、箭頭、板件線、符號及座標。
2. **結構判讀**：把證據組成櫃體、模組、開口、門片與尺寸鏈的候選解釋。
3. **人工確認**：只針對會大幅影響結果或互相衝突的欄位提問，確認後建立不可變版本。
4. **確定性計算**：用版本化規則、約束與測試產生正式拆料表；AI 不負責最後尺寸與數量計算。

真正的核心不是 OCR 準確率，而是：**在展開板件以前，能否先把尺寸角色、櫃體邊界、獨立側板、中立板、上下櫃關係與門片型式固定下來。** 上游結構錯了，後面的公式即使每一條都算對，仍會得到錯誤拆料表。

### 建議的責任邊界

| 元件 | 可以做什麼 | 不可以做什麼 |
|---|---|---|
| OCR／向量解析 | 找文字、線段、箭頭、位置與置信度 | 自行決定哪個數字是總寬或門寬 |
| 視覺 AI | 提出結構候選、解釋、待確認問題 | 直接成為正式 BOM 數值來源 |
| 使用者確認層 | 鎖定高影響欄位、接受或修正候選 | 讓修正被後續 AI 靜默覆蓋 |
| 規則引擎 | 套用公式、板厚、縫隙、數量與版本 | 猜測缺失尺寸或默選衝突規則 |
| 驗證器 | 檢查尺寸鏈、不變量、數量與來源 | 只檢查檔案能否開啟 |
| Excel／排版輸出 | 寫入已驗證結果、保留追溯資訊 | 覆寫原始圖面或原始範本 |

---

## 2. 從現有 SOP 與修正案例得到的直接發現

現有資料已經揭露幾個比「再換一個 AI 模型」更重要的問題：

- 圖面總尺寸與正面分段尺寸容易被混用。
- 門片淨尺寸已扣過縫隙時，不能再次扣除。
- 斜把門不能一律推導成 50 mm 封板；必須先辨識門型、把手位置與相鄰結構。
- 遇到中立板時，封板、門片或開口可能必須分段，不能跨越模組邊界。
- 每一個獨立櫃體都需要自己的側板；不能因正面線條連續就漏掉獨立側板。
- 尺寸值相同不代表角色相同；背板的第一尺寸、側板的高度、層板的寬度必須有語意欄位，不能只存兩個無名數字。
- 五金合計偶然相同不代表計算正確；要能由門片／抽屜／模組逐項反推。

### 已發現的規則衝突

目前 SOP v5 記載活動層板為：

`(D - 44) × (W - 37)`

佛斯特修正案例則採用：

`(D - 40) × (W - 37)`

這兩者不能靠程式「挑一個看起來合理的」。正確做法是：

1. 兩條規則都有規則 ID、版本、適用條件、來源與生效日。
2. 每張工單固定一個 `RuleProfile`。
3. 同一規則族有多個有效版本而工單未指定時，立即中止。
4. 個案修正預設只屬於個案，不自動升格為全域 SOP。
5. 要升格時，必須經審核、建立新版本並重跑黃金案例。

隨附程式刻意保留兩個版本，未釘選就拋出 `RuleConflict`，以證明衝突不會被靜默掩蓋。

---

## 3. 建議的整體架構

| 階段 | 輸入 | 核心工作 | 輸出／閘門 |
|---|---|---|---|
| A. 檔案分流 | DXF、PDF、PNG/JPG、Excel | 判斷向量或點陣、頁面、比例、雜湊 | 不改寫原始檔 |
| B. 證據層 | 原始頁面 | 文字、線、箭頭、符號、座標、偵測器版本 | Evidence Store |
| C. 關聯層 | Evidence | 尺寸文字連到尺寸線；尺寸線連到櫃／開口 | 候選關聯圖 |
| D. 結構層 | 候選關聯圖 | 櫃體／模組／開口／門片／中立板圖模型 | 一個或多個候選方案 |
| E. 約束層 | 候選方案 | 尺寸鏈、正值、板厚、總和、相容性檢查 | 可解、矛盾或資訊不足 |
| F. 確認層 | 候選與矛盾 | 只問高影響且可回答的問題 | immutable confirmed revision |
| G. 規則層 | confirmed revision + RuleProfile | 純函式展開板件／五金 | 未彙總明細 Part |
| H. 驗證層 | Part | 單櫃不變量、來源、數量、反推檢查 | 可發布或阻擋 |
| I. 輸出層 | 已驗證 Part | Excel 範本、彙總、標籤、裁切資料 | 可回讀、可追溯檔案 |
| J. 修正層 | 人工修正 | 分類根因、增加回歸案例、版本決策 | 下一版品質提升 |

建議先把 A、F、G、H、I 做穩，再提高自動視覺判讀比例。這樣即使早期仍需手動確認，計算核心也不會跟著 OCR 一起不穩定。

---

## 4. 圖面解析：向量優先，OCR 只處理必要區域

### 4.1 檔案路由

建議順序：

1. **DXF**：直接讀取 `DIMENSION`、`LINE`、`LWPOLYLINE`、`TEXT`、`MTEXT`、圖層與 block；保留實際座標與單位。
2. **向量 PDF**：先抽取文字與 drawing commands，再建立文字—線段空間關係。
3. **混合 PDF**：向量資訊先取；只有影像區域才 OCR。
4. **掃描圖／照片**：校正旋轉、透視與二值化後，採多裁切、多尺度 OCR。

[PyMuPDF 的 drawing extraction](https://pymupdf.readthedocs.io/en/latest/recipes-drawing-and-graphics.html) 可取得頁面向量繪圖，[ezdxf 的 DIMENSION 文件](https://ezdxf.readthedocs.io/en/stable/dxfentities/dimension.html) 可直接存取 CAD 尺寸實體；這比先把所有檔案轉成圖片再 OCR 更能保留幾何語意。

### 4.2 點陣圖前處理

每頁不要只做一次 OCR。建議保留以下衍生影像：

- 原圖：保留整體上下文。
- 旋轉校正圖：處理 90°、180°、270° 與小角度歪斜。
- 自適應二值化圖：改善背景不均。
- 細線增強圖：保留尺寸線與延伸線。
- 去線文字圖：讓 OCR 不被尺寸線穿字干擾。
- 每櫃裁切圖、尺寸鏈裁切圖、門片符號裁切圖。

[OpenCV 影像處理教程](https://docs.opencv.org/4.x/d7/da8/tutorial_table_of_content_imgproc.html) 涵蓋 threshold、morphology 與 Hough line 等必要工具；[PaddleOCR 的通用 OCR pipeline](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/pipeline_usage/OCR.html) 支援方向分類、文字偵測與辨識。所有裁切結果都必須保存「裁切座標 → 原圖座標」轉換，否則後面無法追溯。

### 4.3 線段與拓樸

單純 Hough line 容易把虛線、板材邊界、尺寸線混在一起。建議組合：

- 傳統方法：二值化、形態學、Hough、端點吸附、共線合併。
- 學習式線段偵測：如 [DeepLSD](https://github.com/cvg/DeepLSD)。
- 圖模型：交點、端點為 node；線段為 edge；文字與符號為附著物。
- 線段整理：共線合併、短缺口容忍、交點切割；[Shapely `line_merge`](https://shapely.readthedocs.io/en/2.1.2/reference/shapely.line_merge.html) 可用於線段合併，[NetworkX connected components](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.components.connected_components.html) 可協助找連通區。

### 4.4 尺寸文字關聯

不要用「離數字最近的櫃子」這種單一規則。尺寸候選的分數應包含：

- 文字中心到尺寸線的垂直距離。
- 文字方向與尺寸線方向是否一致。
- 文字是否位於兩個箭頭／延伸線之間。
- 尺寸線投影是否覆蓋目標櫃體或開口。
- 同一尺寸鏈的相鄰數字是否能加總成總尺寸。
- 候選連接後是否造成結構約束矛盾。
- 向量文字與 OCR 文字是否一致。

最終應產生多個候選關聯及分數，交給約束層消歧，而不是太早丟掉第二名。

---

## 5. AI 的正確用法：輸出結構候選，不輸出正式拆料

視覺模型適合做：

- 判斷圖面區塊類型。
- 將文字、線段與符號整理成候選結構。
- 比較兩個可能解釋，描述造成差異的證據。
- 產生精準的確認問題。

視覺模型不適合單獨負責：

- 精確空間定位與細小、旋轉文字。
- 對虛線／點線等樣式做絕對可靠判讀。
- 大量計數與最終尺寸計算。

OpenAI 的[影像／視覺指南](https://developers.openai.com/api/docs/guides/images-vision)明確列出小字、旋轉文字、精準空間定位、計數與線條樣式等限制；需要讀小字與座標時可使用較高影像細節，但仍不能取代幾何與驗證層。

### 5.1 強型別輸出

AI 回傳必須符合 JSON Schema，例如：

```json
{
  "cabinet_candidates": [
    {
      "cabinet_id": "A01",
      "width_mm": {"value": 800, "evidence_ids": ["e17"], "confidence": 0.94},
      "depth_mm": {"value": 394, "evidence_ids": ["e22"], "confidence": 0.81},
      "structure": "independent_floor_cabinet",
      "alternatives": [],
      "unresolved": ["adjustable_shelf_rule_profile"]
    }
  ]
}
```

[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) 可限制輸出結構符合 schema，但 schema 正確不代表內容正確。因此仍要把大任務拆小、提供已標註例子，並由幾何、約束和人工確認檢查內容。程式端建議用 [Pydantic strict mode](https://docs.pydantic.dev/latest/concepts/strict_mode/)、[discriminated unions](https://docs.pydantic.dev/latest/concepts/unions/) 與其 [JSON Schema](https://docs.pydantic.dev/latest/concepts/json_schema/) 功能，讓 API schema 與程式模型來自同一份定義。

### 5.2 置信度不是模型自評

正式置信度應由可觀測信號組成，例如：

`confidence = OCR品質 + 幾何連結 + 多路解析一致性 + 約束一致性 + 使用者確認`

其中任何結構關鍵欄位，只要證據互相衝突，就算模型自評 0.99 也不能自動通過。建議將置信度分為：

- `confirmed`：使用者已鎖定。
- `high`：多來源一致且約束成立，可預填但仍可檢視。
- `review`：可列出 2–3 個候選，必須詢問。
- `blocked`：無足夠證據或矛盾，禁止拆料。

---

## 6. 結構與約束：先建立櫃體圖，再展開板件

### 6.1 建議資料模型

每個案件至少需要：

- `Document`：原始檔雜湊、頁面、單位與比例。
- `Evidence`：來源、頁碼、bbox、原文字、偵測器、版本、分數。
- `DimensionCandidate`：數值、方向、尺寸線、目標候選。
- `CabinetCandidate`：外尺寸、模組邊界、獨立性、證據。
- `Opening`：隸屬櫃體、上下左右邊界、門／抽屜型式。
- `ConfirmedRevision`：使用者鎖定後的不可變快照。
- `RuleProfile`：每一規則族所用版本。
- `Part`：尺寸、數量、材料、紋路、封邊、來源與公式。
- `CorrectionEvent`：修正前後、根因、確認人、回歸案例。

已確認資料不得 update-in-place。修正時要建立 `revision r4`，保留 `r3`，正式工單再指向新版本。這讓任何 Excel 都能回答：「它是由哪一版確認資料及哪一版規則算出來的？」

### 6.2 約束求解

可先用一般 Python 驗證，複雜後再引入求解器：

- 尺寸鏈：分段總和 ± 板厚／縫隙 = 總尺寸。
- 物理限制：所有板件尺寸為正；層板寬不能大於櫃內淨寬。
- 結構限制：獨立櫃體每個數量單位應有兩片側板。
- 開口限制：門片／抽屜屬於一個明確開口，不跨過中立板。
- 規則限制：同一規則族只有一個被釘選版本。

[Z3](https://microsoft.github.io/z3guide/docs/logic/intro/) 適合表達算術與邏輯條件並判斷 SAT／UNSAT；UNSAT 時可把衝突條件轉成可理解的問題。[OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver) 適合整數約束、選擇與最佳化。第一版不用為了「高級」而全量導入求解器；先把規則與錯誤類型寫清楚，再把多候選消歧交給求解器。

---

## 7. 規則引擎的程式寫法

### 7.1 禁止用字串 `eval`

不要把 `"D-44"` 存入資料庫後直接 `eval`。應把規則存為：

```text
family = adjustable_shelf
version = sop_v5_d44
depth_offset_mm = 44
width_offset_mm = 37
handler = adjustable_shelf_rect
```

程式只允許呼叫已註冊的 handler。好處是可型別檢查、可測試、可限制輸入，也不會執行任意程式碼。

### 7.2 純函式與分層

推薦：

```text
ConfirmedRevision + RuleProfile
    -> expand_one_cabinet()
    -> validate_one_cabinet()
    -> raw Parts
    -> aggregate_parts()
    -> validate_job()
    -> Excel / nesting input
```

`expand_one_cabinet()` 不讀 Excel、不呼叫 AI、不查全域狀態；輸入相同就必須輸出相同。這能讓單元測試真正可靠。

### 7.3 每筆板件的來源

每筆未彙總 Part 至少保留：

- cabinet ID／revision ID
- evidence IDs
- W、D、H 與板件數量輸入快照
- rule ID／rule version
- 可讀公式
- 材料、厚度、尺寸角色、紋路、封邊

彙總後不能把來源丟掉；至少保存所有 source part IDs 和 source cabinet IDs。若使用者看到總數異常，可以下鑽到每個櫃體，而不是重新猜整張圖。

### 7.4 單位與尺寸角色

- 系統內統一使用整數毫米。
- 單位轉換只在輸入邊界做一次。
- `width_mm`、`height_mm`、`depth_mm` 不可用同一個無名欄位代替。
- 板件尺寸要另外表示 `cut_length`、`cut_width`、`grain_axis`；不能靠「較大者就是長」推斷。
- 小數或非整毫米規則要明確定義 rounding policy，並寫測試。

---

## 8. 修正機制：讓每一次錯誤真正變成系統能力

人工修正先分類根因：

| 根因 | 例子 | 應修改的位置 |
|---|---|---|
| OCR | 394 讀成 334 | 辨識資料／前處理／字典 |
| 尺寸關聯 | 800 被連到門片而非櫃寬 | 幾何打分與尺寸鏈 |
| 結構 | 上下櫃誤合併、漏中立板 | 櫃體圖與確認問題 |
| 公式 | 活動層板扣量錯誤 | 規則版本，不是 prompt |
| 彙總 | 相同名稱但不同厚度被合併 | 彙總 key |
| 五金 | 合頁來源門數錯 | 逐門反推與不變量 |
| Excel mapping | 值寫錯工作表／欄 | 範本契約與 round-trip test |
| 規則衝突 | D−40 與 D−44 並存 | RuleProfile 與發版流程 |

每次「已確認修正」的安全流程：

1. 保存原輸入、原輸出、修正後真值與根因。
2. 建立最小可重現案例；敏感資料去識別化。
3. 先新增會失敗的回歸測試。
4. 修正正確層，不用 prompt 掩蓋程式錯誤。
5. 跑全套黃金案例與性質測試。
6. 若要改全域規則，建立新版本並記錄適用條件。
7. 新版發布後仍保留舊案件的原規則版本，不能偷偷重算歷史單。

資料版本可先用 Git + 內容雜湊；資料量變大後可用 [DVC](https://dvc.org/doc/start) 管理資料與 pipeline，或用 [MLflow tracing](https://mlflow.org/docs/latest/genai/tracing/) 保存每次模型／工具呼叫及評估。不要直接把 AI 自己的錯誤輸出當成訓練答案；只有人工確認真值可進黃金集。

---

## 9. 測試策略：不要只測「範例能跑」

### 9.1 測試層級

1. **單元測試**：每條公式、每個 rounding、每種板件數量。
2. **黃金案例**：真實已確認案件，逐列比較規格、數量、來源。
3. **性質／變形測試**：例如 W 增加 100，側板不變，頂底板與層板寬增加 100，背板寬增加 100。
4. **衝突測試**：未指定 D−40／D−44 時必須失敗。
5. **快照／核准測試**：Excel sheet、欄位、標題、排序與關鍵儲存格。
6. **突變測試**：故意把 `-44` 改成 `-40` 或把 `2片側板` 改成 `1片`，測試必須會紅。
7. **端到端測試**：圖面 → 確認 → 拆料 → Excel → 回讀驗證。

[Hypothesis](https://hypothesis.readthedocs.io/) 可自動產生大量尺寸組合找邊界錯誤；[pytest parametrization](https://docs.pytest.org/en/stable/how-to/parametrize.html) 適合把 SOP 規則表轉成資料驅動測試；[mutmut](https://github.com/boxed/mutmut) 可檢查測試是否真的能抓到公式被改壞。

### 9.2 必須追蹤的指標

| 指標 | 用途 | 建議發版閘門 |
|---|---|---|
| OCR 字元／整字正確率 | 判斷辨識層 | 分圖面來源統計，不用單一平均掩蓋 |
| 尺寸—目標關聯 F1 | 比 OCR 更接近真正風險 | 關鍵尺寸不得無證據自動接受 |
| 櫃體／模組 exact match | 衡量結構判讀 | 結構未確認時禁止正式拆料 |
| 關鍵欄位自動接受 precision | 控制靜默錯誤 | precision 優先於 recall |
| BOM 列、規格、數量 exact match | 正式品質 | 黃金案例的重大錯誤為 0 |
| 規則衝突靜默通過數 | 治理品質 | 必須為 0 |
| 來源完整率 | 可追溯性 | 每筆正式 Part 為 100% |
| 人工修正回歸覆蓋率 | 持續改善 | 每筆 confirmed correction 都有 case |

[OpenAI 的 eval best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices) 建議以具體任務、代表性資料與持續評估來迭代，而不是只看少數展示案例。

---

## 10. Excel 輸出：範本也是一份 API 契約

### 10.1 安全做法

- 永遠保留原始工作簿，只輸出新檔或範本副本。
- 明確指定優先工作表、欄名、資料型別、排序與空白規則。
- 寫入後重新開啟，逐格驗證關鍵欄位。
- 若含公式，另用 LibreOffice／Excel 計算與儲存，再讀取 cached result。
- 比較工作表名稱、合併儲存格、列高欄寬、資料列數與公式數量。
- 重要輸出另保留機器可讀 JSON，避免 Excel 成為唯一真相。

[openpyxl 的公式文件](https://openpyxl.readthedocs.io/en/3.1/simple_formulae.html)說明它不會計算公式；[openpyxl 教程](https://openpyxl.readthedocs.io/en/stable/tutorial.html)也提醒部分圖形在開啟再儲存時可能遺失。因此不能用「openpyxl 成功 save」當成完整驗收。[LibreOffice 命令列參數](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html) 可用於 headless 轉檔／重算，但仍需回讀和視覺抽查。

### 10.2 舊格式與多引擎

- `.xlsx/.xlsm`：openpyxl；巨集檔要測試 `keep_vba` 與實際開啟結果。
- `.xls`：不要假裝 openpyxl 支援；使用專用引擎或先以 LibreOffice 正規化。
- `.xlsb`：用明確支援的引擎。

[pandas `read_excel`](https://pandas.pydata.org/docs/reference/api/pandas.read_excel.html) 支援多種 engine；[xlrd](https://xlrd.readthedocs.io/) 的現行定位主要是歷史 `.xls` 讀取。程式應按副檔名與實際 magic bytes 分流，而不是盲目嘗試同一套 reader。

---

## 11. 裁切最佳化與製造資料

拆料正確之後，才進入排版。矩形系統板需要的限制不只是面積：

- 標準板尺寸與可用邊界。
- 鋸路 `kerf`、修邊量、最小可用餘料。
- 紋路方向及允許旋轉角度。
- 材料、花色、厚度、批次不能混板。
- 封邊方向與標籤方向。
- 可重用餘料的尺寸、材料與庫存 ID。
- 目標函數：先最少板數，再降低切割複雜度／換料／碎料。

矩形板件可先用 [rectpack](https://github.com/secnot/rectpack) 或自建 guillotine-aware heuristic；一般 [OR-Tools bin packing](https://developers.google.com/optimization/pack/bin_packing) 是一維／抽象裝箱的基礎，實際 2D 必須加入長寬、旋轉與幾何限制。不規則形狀才考慮 [Deepnest 的 no-fit polygon 思路](https://github.com/Jack000/Deepnest)。[OpenCutList](https://github.com/lairdubois/lairdubois-opencutlist-sketchup-extension) 可作為功能參考，包含零件表、板材裁切圖、標籤、紋路、封邊與餘料概念。

不要讓排版器「修正」拆料尺寸。它只能選位置與方向；若因旋轉違反紋路，必須判定不可行，而不是偷偷交換長寬。

---

## 12. 技術選型建議

| 層 | 建議 | 理由 |
|---|---|---|
| 核心後端 | Python 3.12 + Pydantic | CV、文件、最佳化生態完整；強型別 schema 可共用 |
| API | FastAPI（實作時） | 與 Pydantic 整合、易產生 OpenAPI |
| 前端 | TypeScript + React | 適合圖面覆蓋框、候選切換、確認與差異檢視 |
| 幾何 | PyMuPDF、ezdxf、OpenCV、Shapely、NetworkX | 覆蓋向量、點陣與圖模型 |
| OCR | PaddleOCR；必要時自訓小字／工程字型模型 | 可拆分方向、偵測、辨識並微調 |
| 約束 | 先純 Python；之後 Z3／CP-SAT | 逐步增加複雜度，保持可解釋 |
| 資料庫 | SQLite 起步，協作後 PostgreSQL | revision、provenance、correction 結構清楚 |
| 背景工作 | 任務佇列 + 可重試 job | OCR、PDF、排版不應阻塞 UI |
| 測試 | unittest/pytest + Hypothesis + mutation | 公式、案例與不變量並用 |
| 資料版本 | Git/content hash 起步；DVC/MLflow 後續 | 讓圖面、標註、模型、規則、輸出對得起來 |

Rust/C++ 可以在效能量測證明線段處理或排版成為瓶頸後再加入。第一版同時使用太多語言，會讓規則修正、部署與追錯更難。

---

## 13. 實作路線圖

### Phase 0：把 SOP 變成可執行規格

- 為每條規則加 ID、版本、來源、適用條件、生效日。
- 釐清 D−40／D−44 的適用範圍，未釐清前維持衝突阻擋。
- 把既有修正案件轉成黃金案例。
- 定義尺寸角色、材料、紋路、封邊與數量 schema。

**完成條件**：純手動輸入確認資料，也能穩定產生正確、可追溯的櫃體明細。

### Phase 1：規則核心與確認 UI

- 導入 immutable revision、RuleProfile、Part provenance。
- 先做側板、頂底板、背板、固定／活動層板。
- 每個錯誤必須指出規則／輸入／證據，不只顯示「處理失敗」。

**完成條件**：所有現有櫃體黃金案例 exact match，靜默規則衝突為 0。

### Phase 2：向量 PDF／DXF

- 取得文字、尺寸線、圖層與座標。
- 建立尺寸文字關聯與櫃體圖。
- 顯示 evidence overlay，使用者可點擊證據。

**完成條件**：向量來源的關鍵欄位自動接受 precision 達到內部門檻；其餘主動詢問。

### Phase 3：掃描圖 OCR 與多裁切

- 建立固定 benchmark，不以單張展示判斷。
- 針對工程字型、旋轉小字與尺寸符號標註／微調。
- 將 OCR score、幾何、約束與多模型一致性分開記錄。

**完成條件**：低置信度不會進正式拆料；錯誤都能回到原圖位置。

### Phase 4：門片、斜把、封板與五金

- 用 discriminated union 表示門型，避免所有門共用一組欄位。
- 先確定開口與模組邊界，再算門片。
- 五金以每扇門／每個抽屜明細計算，再彙總反推。

**完成條件**：不再雙扣門縫、不跨中立板、每項五金可下鑽來源。

### Phase 5：Excel 契約與 2D 排版

- 建立工作表／儲存格契約、round-trip test、視覺抽查。
- 增加 kerf、紋路、旋轉、封邊、餘料與標籤。
- 把排版結果與原 Part ID 綁定。

**完成條件**：輸出檔可回讀、可重算、可追溯；排版不會改動拆料規格。

### Phase 6：持續學習與發版治理

- 每次修正自動生成待辦回歸案例。
- 儀表板依圖面來源、櫃型、規則版本分群統計。
- 新模型／新規則在 shadow mode 與現行版比較，再決定升級。

**完成條件**：新版本沒有通過完整黃金集與重大錯誤閘門就無法發布。

---

## 14. 本次附帶的可執行參考核心

`auto_cutlist_reference` 已實作：

- Pydantic 嚴格／凍結資料模型。
- candidate 未確認輸入阻擋。
- SOP v5 D−44 與佛斯特 D−40 的版本衝突偵測。
- 櫃體五類板件確定性展開。
- 每筆板件的輸入快照、證據、公式、規則版本。
- 彙總後保留來源櫃號與 Part ID。
- 個案修正預設不升格為全域規則。
- 9 個回歸／不變量測試；全部通過。

測試過程曾刻意抓到「背板寬度位於 dimension 1、其他橫板寬度位於 dimension 2」的欄位角色差異。修正方式不是交換數字，而是讓測試依板件族檢查語意。這就是正式系統應採用的錯誤修正方式。

---

## 15. 研究來源索引

### 圖面、OCR、幾何

- [PaddleOCR 官方文件](https://paddlepaddle.github.io/PaddleOCR/main/en/index.html)
- [PaddleOCR 文字偵測](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/module_usage/text_detection.html)
- [PaddleOCR 辨識模型微調](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version2.x/ppocr/model_train/recognition.en.md)
- [PyMuPDF drawing extraction](https://pymupdf.readthedocs.io/en/latest/recipes-drawing-and-graphics.html)
- [pdfplumber](https://github.com/jsvine/pdfplumber)
- [ezdxf entity content](https://ezdxf.readthedocs.io/en/stable/tasks/get_entity_content.html)
- [OpenCV image processing](https://docs.opencv.org/4.x/d7/da8/tutorial_table_of_content_imgproc.html)
- [DeepLSD](https://github.com/cvg/DeepLSD)
- [GLSP: graph-based line segment parsing](https://arxiv.org/abs/2303.03851)
- [Topology-driven vectorization of line drawings](https://la.disneyresearch.com/publication/topology-driven-vectorization-of-line-drawings/)
- [eDOCr2 工程圖 OCR 研究](https://www.mdpi.com/2075-1702/13/3/254)
- [CVAT 標註工具](https://docs.cvat.ai/docs/getting_started/overview/)

### Schema、規則、約束、測試

- [JSON Schema overview](https://json-schema.org/overview/what-is-jsonschema)
- [Pydantic strict mode](https://docs.pydantic.dev/latest/concepts/strict_mode/)
- [Z3 Guide](https://microsoft.github.io/z3guide/docs/logic/intro/)
- [OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver)
- [Hypothesis](https://hypothesis.readthedocs.io/)
- [pytest parametrization](https://docs.pytest.org/en/stable/how-to/parametrize.html)
- [ApprovalTests Python](https://github.com/approvals/approvaltests.python)
- [DVC](https://dvc.org/doc/start)
- [MLflow Evaluation](https://mlflow.org/docs/latest/ml/evaluation/)

### Excel 與排版

- [openpyxl formulas](https://openpyxl.readthedocs.io/en/3.1/simple_formulae.html)
- [openpyxl tutorial](https://openpyxl.readthedocs.io/en/stable/tutorial.html)
- [LibreOffice command-line parameters](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html)
- [pandas read_excel](https://pandas.pydata.org/docs/reference/api/pandas.read_excel.html)
- [rectpack](https://github.com/secnot/rectpack)
- [Deepnest](https://github.com/Jack000/Deepnest)
- [OpenCutList](https://github.com/lairdubois/lairdubois-opencutlist-sketchup-extension)

---

## 最終判斷

下一版最值得投資的不是讓 AI「更敢猜」，而是讓系統具備以下五種能力：

1. 每個判讀都能回到圖面證據。
2. 高影響欄位未確認就不能計算。
3. 每個正式結果都能指出公式與規則版本。
4. 規則衝突、結構矛盾與低置信度都會明確阻擋，不靜默帶入 Excel。
5. 每次人工修正都變成分類清楚的回歸案例，而不是只修當下那一張表。

做到這五點，再持續改善 OCR、視覺模型與排版器，系統才會隨案件增加而變得可靠，而不是隨 prompt 變長而變得更難維護。

