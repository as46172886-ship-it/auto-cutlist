import { SOP_PROMPT, SOP_RULE_COUNT } from "../../sop-rules";
import { QUANTITY_PROMPT, QUANTITY_RULE_COUNT } from "../../quantity-rules";
import { OpenAIResponse, parseOpenAIResponse, safeResponseDiagnostics } from "./openai-response";
import { structuredImageContent, type ImageDetail } from "./image-content";
import { cabinetReadSchema, dimensionLedgerSchema, doorRecognitionSchema } from "./schemas";
import { findSemanticEvidenceErrors, hasAxisAwareLedger, normalizeSemanticEvidence, selectBetterSemanticResult } from "./semantic-validation";
import { findInteriorCompletenessErrors } from "./structure-validation";
import {
  collectResolvedDoorGap24Locks,
  doorReadUsesOnlyKnownSymbolCrops,
  doorSymbolCropNames,
  lockableDoorRead,
  restoreLockedDoors,
  restoreResolvedDoorGap24Locks,
  type DoorGap24Lock,
} from "../../door-recognition.ts";
import { cabinetCropSummary, type CabinetCropInput, type SegmentationPlan } from "../../segmentation";
import { batchForConcurrency, cabinetCropPass, doorCropsForAttempt, doorSourceEvidenceCropNames, isDoorNoResponseError, preserveFirstDoorSymbolLock, shouldStopDoorAttempts } from "../../door-scan.ts";
import {
  applySegmentationLocks,
  findSegmentationLockErrors,
  mergeCabinetStructureReads,
  normalizeLedgerToSegmentationLocks,
  segmentationLockSummary,
} from "./segmentation-locks.ts";

export type ImageInput = { name?: string; dataUrl?: string };
export type ValidImageInput = Required<ImageInput>;
export type Effort = "none" | "low" | "medium" | "high";

export function isAllowedImage(image: ImageInput): image is ValidImageInput {
  return typeof image.name === "string" && typeof image.dataUrl === "string" && /^data:image\/(png|jpe?g|webp);base64,/i.test(image.dataUrl);
}

export function isAllowedCabinetCrop(value: unknown): value is CabinetCropInput {
  if (!value || typeof value !== "object") return false;
  const crop = value as Partial<CabinetCropInput>;
  if (!isAllowedImage(crop)) return false;
  const metadata = value as Partial<CabinetCropInput>;
  const scanPass = metadata.scanPass === undefined ? 1 : Number(metadata.scanPass);
  return Boolean(String(metadata.cabinetId || "").trim() && String(metadata.cropId || "").trim()
    && String(metadata.sourceImageName || "").trim() && ["door", "internal", "front", "dimension", "detail"].includes(String(metadata.role || ""))
    && [1, 2, 3].includes(scanPass));
}

type StructuredCallOptions = {
  instructions: string;
  taskText: string;
  schemaName: string;
  schema: Record<string, unknown>;
  effort: Effort;
  maxOutputTokens: number;
  timeoutMs: number;
  retryTimeoutMs: number;
  imageDetail?: ImageDetail;
};

export async function callStructuredAI(key: string, images: ValidImageInput[], options: StructuredCallOptions) {
  const content: Record<string, unknown>[] = [
    { type: "input_text", text: options.taskText },
    ...structuredImageContent(images, options.imageDetail),
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        store: false,
        reasoning: { effort: options.effort },
        instructions: options.instructions,
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: options.schemaName, strict: true, schema: options.schema } },
        max_output_tokens: options.maxOutputTokens,
      }),
    });
    const raw = await response.json() as OpenAIResponse;
    if (!response.ok) {
      return {
        response,
        raw,
        parsed: {
          ok: false as const,
          code: raw.error?.code || "openai_error",
          message: raw.error?.message || "OpenAI API 呼叫失敗。",
          retryable: response.status >= 500,
        },
      };
    }
    return { response, raw, parsed: parseOpenAIResponse(raw) };
  } finally {
    clearTimeout(timer);
  }
}

export const DIMENSION_INSTRUCTIONS = `你是第一階段「尺寸證據抄錄員」。本階段只抄錄及分類圖面尺寸，不判桶身、不拆料。

必做程序：
1. 每張圖先找可讀文字方向，把照片在腦中旋轉至正立；用 rotationToUprightDeg記錄順時針需旋轉0／90／180／270度。後續horizontal／vertical一律以「旋正後的圖面」為準，不以原始照片像素方向為準。若任務文字附有「前置方向與分桶硬鎖」，那是較早以數字方向＋底寬位置雙重核對完成的像素證據，必須逐字沿用，不得在本階段重新旋轉或交換寬高。
2. 分別判斷是內部圖、門板圖、正立面、側視圖、細節圖或尺寸圖，建立 imageViews。
3. 每一筆尺寸建立唯一ID（M001、M002…）。沿尺寸線追起點與終點，抄下看得見的所有主要數字；rawText保留原字，sourceValue只填原圖數字，sourceUnit明確填cm／mm／unknown，再依sourceUnit換算valueMm。cm固定×10，mm固定×1，禁止只留下換算結果而遺失原值與單位。
4. 水平尺寸線只能標orientation=horizontal，垂直尺寸線只能標orientation=vertical；文字註記用note，深度箭頭用depth_arrow。禁止因照片橫放而交換寬高。
5. 深度必須單獨搜尋：查看D、深、DEPTH、側視圖水平尺寸、立面上方／下方的共用註記，以及另一張對應內部圖。深度標註不一定貼在每個桶身旁邊。
6. 一個深度若明確套用同一排、同一立面或一群櫃體，建立一個depthGroup，列出適用區域；後續櫃體要共用，不可逐桶填0再逐桶提問。
7. 617、2272之類的數字不可只看數值猜深度；必須依尺寸線方向、側視位置或文字註記判斷。617若是垂直線就是高度，不是深度。
8. 2.4cm出現在門面高度鏈或兩門面之間時，優先分類slanted_handle_gap=24mm，並只把它當成「此處有斜把」的肯定提示；不必判斷它包含在哪段門高，也不參與門板尺寸扣除。沒看到2.4不代表沒有斜把，後續仍須看門面或屜頭是否有一條斜把空隙。標準18mm桶身板不能因看到2.4就改成24mm板；只有明確T24、板厚24或厚度線才可分類board_thickness。
9. 複合文字如「鏡子35*130」要拆成350mm寬與1300mm高兩筆note尺寸，保留同一文字證據。
10. 不清楚的數字可標unknown，但必須說明它在圖上的位置；禁止杜撰未出現的數字。
11. 圖面若以cm標示，例39.4必須輸出394mm；若原圖已是mm則不乘10。
12. 同時追蹤側板線是否從桶底連續到桶頂。連續側板內的水平門縫、斜把縫或內部水平板線不是獨立桶身邊界；把這項觀察寫入imageViews.notes與相關尺寸evidence。
13. 純數字「門N」（例如門509）是普通4E門的名義門寬標記：本階段保留在note，不放進dimensions；後端會固定算完成門寬=N-2。含英文字母的「門A12」才是門型／門號，不得當mm。只有真正有起終點的尺寸線才進dimensions。

軸向防錯範例：旋正後，圖底部水平鏈40／80／60只能是400／800／600寬；圖側垂直鏈55.2／2.4／16只能是552／24／160高或間隙。若三段同方向、首尾相接且跨滿左側矮櫃，必須相加得到桶高736mm；絕不可把736mm當寬度。右側外總高227.2且兩側板線上下連續時，163.1／2.4／61.7是同一個2272mm高桶身的內部分段，不得拆成上下兩桶。

輸出只包含尺寸證據表與深度群組，不建立任何 cabinet。`;

export const STRUCTURE_INSTRUCTIONS = `你是第二階段「系統櫃結構判讀員」。你會收到第一階段尺寸證據表，並重新查看原圖。先把每個尺寸綁定到正確物件，再依完整SOP建立結構；此階段仍不可拆料或算五金。

你收到的每一張輸入都是依底部水平尺寸段真裁切、放大的單一桶身。任務文字中的「前置方向與分桶硬鎖」是不可覆蓋的輸入事實：rotation、cabinetId、elevationId、左右順序、底部水平桶寬與桶數全部不得重判、換軸、合桶、拆桶或改名。必須一桶一桶查，禁止用整張立面概括。每桶先建立componentRegions：逐區分類側板、頂底板、背板、背條、固格、活格、中立、擋板、抽屜、抽面、4E門、鋁框門、固定板或未知，再把該分類對應的Rxx填入sopRuleIds，最後才更新結構欄位。門片數與<／>開向已由更早的像素複核鎖定；本階段不得新增、刪除或改寫type、count、countBasis、doorSymbols、direction，但必須另外核對並補齊已鎖定門片的開口／完成尺寸與把手資料。2.4／24mm只提示有斜把，不是待閉合的尺寸關係。

固定判讀順序：
1. 對照檔名／視圖，配對同一案的內部圖、門板圖、正立面與側視圖。
2. 先建立立面與水平／垂直尺寸鏈，再依側板線的連續或中斷判斷獨立桶身。
   - 每條dimensionChain必須填dimensionIds，直接引用第一階段尺寸ID。
   - width鏈只能引用orientation=horizontal；height鏈只能引用orientation=vertical。
   - 每個cabinet.widthDimensionIds只能引用水平尺寸ID；heightDimensionIds只能引用垂直尺寸ID。
   - 左右側板線若由桶底連續到桶頂，必須只建立一個cabinet；只有獨立頂底板、側板中斷、深度分離或明寫疊櫃才可拆成上下兩個cabinet。單一水平分隔線、門縫或斜把縫絕對不足。
3. 封板、鏡面、踢腳板等放到各自陣列，絕不能為了填資料把它們建立成 cabinet。
4. 把尺寸證據表的 depthGroup 綁到櫃體。相同群組只要有一個明確共用深度，就套給整群並在 depthEvidence 說明來源；不得因每桶旁邊沒重複標深度而填0。
5. 逐桶判門片、層板、抽屜、中立、實際頂板／底板／固格、擋板與腳；所有會影響加工的原圖文字（F高度、上18下18、缺口、下起開、4P、J把、斜把等）逐字抄入drawingNotes。先判斷元件是否存在：原圖明確沒有或該結構不適用時，對應陣列留空、計數填0、狀態填absent／not_applicable，不得提出問題或提醒；只有已有圖面證據證明元件存在、但數量或尺寸讀不清時，才保留待確認並提出一個合併後的阻擋問題。
6. 最後驗算每條尺寸鏈。總寬是總寬，不能建立成一個1800或2272寬的桶身。重疊的上櫃／下櫃必須放不同 widthChainId，不能相加。
7. questions只放「不回答就不能安全拆料」的問題，合併同類問題但不可因題數上限省略任何未確認項；warnings只放不阻擋的提醒。
   - projectName必須用圖面上的案件名稱；沒有名稱就填「本次圖面」，禁止把檔名UUID、隨機碼或圖片編號當案件名稱。
   - summary、questions、warnings必須寫成現場人員可直接閱讀的繁體中文；禁止出現countBasis、doorSymbols、direction、drawerWallHeightMm、mountBasis、segmentGroupId等程式欄位名稱，也不得要求使用者理解尺寸ID或抽屜組內部代碼。
   - 已確認不存在、數量為0且結構不適用的門片、抽屜、中立、固格、活格、擋板、背條、腳、鏡子、踢腳板、獨立板件與特殊五金，不得出現在summary、questions或warnings；不要輸出「目前0片／0支／0項」占版面。
   - 尺寸ID、證據ID、軸向綁定是系統內部工作，絕不可要求使用者回答。
   - 2.5#、材質、板種、色號或顏色註記不影響本階段桶身拆料時，只能放warnings，不能放questions。
   - M008=1000若標在「缺口」或門面加工區，未證明端點前不得當成桶身開口高度；M013=159若只是右側連續高櫃的局部垂直分段，不得另造獨立板件。兩者可記錄為非阻擋提醒，不因而阻擋已閉合的桶身外尺寸。

重要欄位定義：
- door.openingWidthMm／openingHeightMm 是整個開口尺寸；dimensionBasis=opening時後端才依SOP計算。finishedWidthMm／finishedHeightMm 必須是「單片」已完成門面尺寸，dimensionBasis=finished時後端不再扣3、4或30；24mm不參與門高扣除。
   - 門片數與開向只能沿用第一優先像素複核的鎖定結果。只有位於門面葉片區的清楚<／>可成立symbols；禁止用leaf_geometry、寬度、對稱或AI經驗補門片。未鎖定門板保持空陣列並提醒，不得在結構階段補猜。門尺寸、J把與斜把是另一條資料線：可依尺寸及加工證據補入，但任何不確定都不得清除已鎖定的<／>。
- 2.4cm／24mm只是一個斜把提示：看見時，對應門板或屜頭直接判為有斜把，再從空隙位置判上斜把、下斜把或長斜把；沒看見時仍檢查是否存在斜把空隙，不能用「沒有2.4」直接判成普通面。不得詢問24mm屬於含縫總高、獨立分段或疊櫃抬高，也不得用它扣門高。相容欄位固定填includesSlantedGap24=false、slantedGap24Context=none。
- 本階段只建立桶身與內裝基準：topBoardRetreatMm=0、bottomBoardRetreatMm=0、slantedFixedShelfCount=0、baffles=[]。門與屜頭完成最後獨立掃描後，才可按各自斜把證據回算實際頂板／底板退縮與擋板；本次不改固格尺寸。
- fixedShelves逐片計數；所有看得清楚的F中心線高度以mm填入fixedShelfPositionsMm。F是含頂底量到固格中心線，不得扣成板邊。
- drawerGroup.centerlineBoundaryCount填0／1／2，表示抽屜格有幾側尺寸到中立中心線；usesCenterlineWidth必須與其是否大於0一致。後端會依此固定套-99／-90／-81，內抽再-50。regionPosition填top／middle／bottom／unknown；圖面明確是上方並排抽時必須填top，讓後端可用H與F中心線補出只在上方抽屜區的中立。
- middleDividers不能因看見並排抽就延伸到下方門區。一般深度填depthBasis=standard_d_minus_29；若圖上直接給完成深度才填finished。高度若由上下接點與跨度計算，填heightBasis=connection_span及referenceSpanMm，後端依完整板18／固格中心線9計算；只有圖面直接給完成高才填finished。資料不足填unknown並提問，禁止直接套H-36。
- boardProfile必須逐桶建立。標準SOP固定為body18、back8、drawerBottom8、頂底寬扣36、背板寬高各扣26、固格D扣29/W扣36、活格D扣40/W扣37，deductionBasis=standard_sop。D-44已停用。只要原圖明示非標板厚，deductionBasis不得仍填standard_sop；需有使用者確認的完整扣數組才填user_confirmed，否則全部保留unknown並阻擋。
- footState必須區分present／absent／unknown。落地櫃不得因看不到腳就當0；確認present還必須讀腳高，後端固定每桶基本4個，另對每片從頂板直達底板的全高中立加1個底部支撐腳，並依≤120 A10、>120 A12。吊櫃固定absent。
- 電視櫃、鏡櫃、特殊櫃的specialBackStripState必須是confirmed後才可使用specialBackStripCount（確認0也成立）；一般櫃填not_applicable並由後端套正式級距，未知不得當0。
- baffles每一支實體擋板建立一筆獨立id，並先填mountBasis=top_board／fixed_shelf／raised_bottom／other／unknown。鎖固格或上升底板由後端固定60mm；只有已確認純門斜把且鎖頂板的門櫃擋板才50mm。整桶內寬用widthBasis=cabinet_inner，widthMm可填0讓後端固定算W-36；若被中立分段則每段各一筆finished_segment，使用同一segmentGroupId並填1..N的segmentIndex、segmentCount=N，不能只設splitAtMiddleDivider=true卻只有一筆。
- drawingNotes只抄圖上看得見且會影響結構／加工的註記；顏色、材質、色號可保留在warnings，但不能阻擋拆料。
- independentPanels、kickboards、mirrors、specialHardware 每筆都必須填所屬 elevationId；不同立面的相同品項不得先加總。independentPanels 放獨立封板、填縫板與其他非桶身板件。圖面辨識到櫃身外側與全高牆／收口線分離時，填縫板標準寬固定100mm、高度取相鄰桶身外高、不含腳高與上方留空，左右每一個不同邊界各1片；圖面明標其他完成寬時才覆蓋100mm。其他板件count未知仍填0並阻擋；封板有直紋且需高×寬時 dimensionOrder=height_width。
- 純數字「門N」不是門號：普通全高4E門固定算完成門寬=N-2，完成門高=桶身外高-底部30（若同鏈包含）-4；2.4／24mm只提示斜把，不扣門高。例：門509、H1472且無底部30分段，完成門507×1468。含英文字母的門A12才保留為門型／門號。普通4E門每片自動帶1個油壓器；斜把只寫「長斜把×N」加工價格備註，不列specialHardware或五金料單。
- specialHardware只要辨識到品項就必須保留；qty或unit不明時填0／空字串並提出阻擋問題，禁止從陣列刪除。
- specialBackStripCount 只在圖面或已確認答案明確給特殊櫃背條數時填正數；一般櫃填0，由後端依正式高度規則計算。
- 「鏡子35*130」若文字及指引線清楚，直接記錄widthMm=350、heightMm=1300，不得再詢問是否為鏡子尺寸。
- 若水平底鏈為40／80／60，候選桶寬只能從400／800／600及圖上真正的水平次級鏈推得。55.2／2.4／16若在線條旋正後為垂直鏈，只能用於高度／間隙，禁止生成552、24、160寬桶或488剩餘寬。
- 精確回歸例：水平40／80／60 + 三處D42.6 + 左側垂直55.2／2.4／16 + 右側外總高227.2、內分段163.1／2.4／61.7且側板連續時，建立三個桶身：W400×H736×D426、W800×H736×D426、W600×H2272×D426。右側600不可另拆上櫃；9.5是離地95mm；鏡子35×130列mirrors，不列cabinet。W400上方是一個抽屜，W800上方是兩個並排抽屜且該drawerGroup.regionPosition=top、fixedShelfPositionMm=552；因此應有1片中立，只做到上方抽屜區，referenceSpan=736-552=184，上接頂板18、下接固格中心線9，完成高157，深D-29=397。下方門區不得延伸中立。右側高櫃的擋板若圖面顯示鎖在固格，mountBasis=fixed_shelf且高度固定60，不得保留成door_50。
- 2.4cm位在門面附近時只當斜把肯定提示，不是24mm厚水平板，也不參與門高扣除；標準桶身板厚仍為18mm。沒有2.4時仍須看是否有一條斜把空隙。

以下 ${SOP_RULE_COUNT} 條是完整且逐條強制的正式SOP，不得用一般木工常識覆蓋：
${SOP_PROMPT}

以下 ${QUANTITY_RULE_COUNT} 條是由正式SOP整理出的數量硬規則。automatic項目不得向使用者提問，後端會固定計算；drawing項目只讀圖逐數：
${QUANTITY_PROMPT}`;

export const AUDIT_INSTRUCTIONS = `你是第三階段「反向驗算員」。你會收到尺寸證據表及第二階段完整結構，並重新查看原圖。不要延續第二階段的假設；逐項找反例後輸出修正完成的整份結構。

必查清單：
A. 深度：先查所有圖的共用D／深度／側視尺寸，再查 depthGroup。只要共用依據成立，就替整群填入深度與來源；禁止產生「C1缺深度、C2缺深度、C3缺深度」這種重複問題。不同深度也不可硬併。
B. 寬度：每條 width dimensionChain 的 cabinetIds 寬度總和、segmentsMm總和與totalMm需吻合；1800通常應是兩個900等模組，2272通常是整體或另一基準，不能當單桶寬。
C0. 軸向證據：逐一核對dimensionIds、widthDimensionIds、heightDimensionIds。水平40／80／60只能形成400／800／600寬；垂直55.2／2.4／16只能形成552／24／160高或間隙。若第二階段用垂直尺寸創造736寬、160寬櫃或488剩餘寬，必須刪除並按水平尺寸鏈重建。
C. 高度：外側總高優先；門面分段高、617等局部垂直尺寸不可冒充整桶高或深度。
D. 桶身：側板連續時不得因水平門縫拆成疊櫃；只有獨立頂底、側板中斷、深度分離或明確標註才成立疊櫃。精確例：227.2外總高與163.1／2.4／61.7連續垂直鏈同時存在，且600寬柱的兩側板連續，結論只能是一個W600×H2272桶身，不是上下兩桶。
E. 獨立件：封板、鏡子、門板、踢腳板與局部板件不得留在 cabinets。
F. 斜把：只把真正形成斜把空間的頂板、底板或固格標 retreat19；擋板50／60及中立分段必須有圖面依據。
F2. 板厚與斜把提示：24mm若在門面垂直鏈中且第一階段分類slanted_handle_gap，只能作「有斜把」提示，絕不可稱為24mm厚板；除非原圖明寫T24或板厚24。不得要求判定24mm屬於哪一段，也不得用它扣門高。
G. 門與抽屜：完成門面高不可再扣4；2.4／24mm只提示斜把；抽屜中心線邊界0／1／2必須分別套-99／-90／-81；中立只做到實際分隔區，深度一般D-29，高度依完整板18／固格中心線9逐端扣除；鋁框門不列但桶身保留。
G2. 固格與註記：本次自動流程的固格一律核對D-29×W-36，不由門面影像改成D-48；F中心線高度、上18下18、缺口、下起開、4P、J把與斜把註記不得在驗算時消失。
H. 問題：已能從證據表、尺寸鏈或同群櫃體推得的資料不得再問；合併重複問題，但所有真正阻擋問題都必須保留，不能因題數上限省略。

完整正式SOP如下：
${SOP_PROMPT}`;

const INTERIOR_INSTRUCTIONS = `你是第三階段「桶身內部逐件複核員」。外部桶身數量、ID、W／H／D、尺寸鏈與深度群組已由前兩階段建立；除非原圖有明確反證，禁止更改或刪除它們。你的唯一重點是逐桶從上到下盤點內部板件、抽屜與五金所需資料，然後輸出整份完整結構。

每個桶身都必須逐項檢查：
1. 圖上的每個「抽」或抽屜符號都要計入drawerCount，並建立對應drawerGroups；group.count總和必須等於drawerCount，isInner群組數量總和必須等於innerDrawerCount。辨識到群組卻未知數量時不可填0當作沒有，必須阻擋。
2. drawerGroup.openingWidthMm是該抽屜格的實際格寬，不是整個立面總寬；openingHeightMm固定記錄「完成屜頭／抽面高度」。drawerWallHeightMm固定填0，後端依正式級距自動改寫：完成屜頭高≤200mm用100mm抽牆，>200mm用180mm抽牆。讀不到完成屜頭高時只問屜頭高，禁止另問抽牆高，也禁止把屜頭高直接當抽牆高。centerlineBoundaryCount必須逐組填0／1／2，對應後端-99／-90／-81；內抽後端再-50。
3. 同一桶內若抽屜區與門區之間有實際固格板，必須計入fixedShelves；本次自動流程slantedFixedShelfCount固定為0，固格仍使用D-29。不可因不知道固格位置就把整個fixedShelves歸零。可讀到的每個F中心線高度都填入fixedShelfPositionsMm。
4. 逐片數清fixedShelves、adjustableShelves；F中心線、固格或固定層板的肯定標記才是固格。立面已看見實體水平層板而沒有上述固定證據時，依R24直接判活動層板，不再保留固格／活格問題。固格固定D-29×W-36、現行活格固定D-40×W-37；D-44已停用。所有看得見的板線都必須判斷是門縫還是桶內板。<／>斜向門片標記可以畫在桶內板線上方，但它只是覆蓋標記：不得因此把同區已畫出的水平層板改成unknown、門區或刪除。若中立板把同一桶分成左右兩格，須逐格數每一道水平板；同高板線若在中立兩側都存在，固定算左右各1片。活格必須依每個實際開口分格計尺寸與片數，不能仍列一片跨過中立的全寬活格。
5. 並排抽屜必須有middleDividers，且並排N列固定需要N-1片完整中立，只做到實際抽屜分隔區。一般中立深度填depthBasis=standard_d_minus_29；高度以referenceSpanMm及上下接點交由後端扣完整板18／中心線9。只有原圖直接給完成尺寸才用finished；資料不全用unknown並提問，禁止套H-36。下方大門區不得延伸中立。
   - 每個drawerGroup另填regionPosition；明確在上方且下接F固格中心線時填top與fixedShelfPositionMm。若H與F已確認，後端會用上方跨度H−F自動建立缺少的N−1片中立，禁止再問使用者已可由圖面算出的中立數量或高度。
6. 逐片盤點斜把相關baffles，先填mountBasis判斷鎖附在頂板、固格或上升底板，再決定50／60與是否依中立分段；鎖固格／上升底板固定60，只有已確認純門斜把且鎖頂板才50；有N個分段就建立N筆實體擋板及完整segmentGroupId／segmentIndex／segmentCount。
7. 4E門的片數與<／>完全沿用前一階段逐桶像素鎖定值，不得覆蓋。未鎖定的門板保持空陣列；已鎖定的type、count、countBasis、doorSymbols、direction不得更動。門寬、門高、J把與斜把必須另看尺寸鏈與加工註記補齊；2.4／24mm出現時直接作為有斜把的肯定提示，沒有時再看是否有斜把空隙。不得要求24mm關係、不得用它扣門高，也不得因此刪除已鎖定門片。鉸鍊依完成門高由後端正式公式自動算，不提問顆數。
8. 每桶都要核對boardProfile、footState及特殊櫃specialBackStripState；所有獨立板件必須有count；辨識到的特殊五金即使數量未知也不可刪除。
9. 不得把前一階段已存在且有證據的drawerGroups、固格、活格、中立、擋板、fixedShelfPositionsMm、drawingNotes、independentPanels或specialHardware整批清空。若原圖明確證明某項不存在才可刪除；已確認不存在的項目不必在warnings列「0項」，只有刪除與前階段證據矛盾、可能造成漏料時才提醒。
10. 最終projectName、summary、questions、warnings只用現場可讀的繁體中文。沒有案件名就用「本次圖面」；禁止輸出UUID、尺寸ID、抽屜組內部代碼或任何程式欄位名稱。可由本輪圖面證據成立的門片數、中立與擋板必須直接補入結構，不得保留舊問題重複詢問；已確認不存在或不適用的項目不得留問題、提醒或0數量占位文字。

以下是全部 ${SOP_RULE_COUNT} 條正式SOP，逐條強制：
${SOP_PROMPT}

以下 ${QUANTITY_RULE_COUNT} 條數量硬規則也全部強制。固定數量由後端算，不得列成缺資料；所有數量問題必須寫成「目前辨識數／SOP應有數或公式／差異／需補的唯一值」，禁止只寫「請確認數量」。抽牆高度依完成屜頭高套固定級距，缺值時只問完成屜頭高；鉸鍊由後端正式公式自動算：
${QUANTITY_PROMPT}`;

const DOOR_RECOGNITION_INSTRUCTIONS = `你是第一優先的「<／>符號掃描員」。這一階段只有一個任務：在指定單一桶身的門面葉片內找清楚的「<」與「>」。不要判門寬、門高、24mm、把手、鉸鍊或其他拆料資料；那些全部由後續階段處理，絕不能影響符號結果。

唯一適用的SOP：
1. 位在門面葉片內的「<」代表1片左開4E門；「>」代表1片右開4E門。一個符號固定一片。符號可能是跨越大部分門面的兩段大型虛線／點線人字幾何，不一定是印刷文字。幾何方向必須逐字遵守：兩條斜向虛線的共同尖端在左、向右張開才是「<」；共同尖端在右、向左張開才是「>」。先沿用前置rotation把數字轉正，禁止再用原始照片方向重判。
2. 尺寸線箭頭、註記引線箭頭、層板線、抽屜框線、小方塊、24mm縫，以及門邊孤立的彩色小三角都不是門片開向符號；彩色小三角只能供後續斜把加工核對。大型虛線若被層板線或裁切邊界截斷，必須在重疊裁切中找到兩條斜線及共同尖端才可判向，不得用單一斜線猜測。
3. 只收錄本次裁切中肉眼能直接指出位置的符號。高對比圖與斜向遮罩只能協助定位；每個符號必須回到同輪提供的第一輪原始門面／桶內裁切再次看見，symbolRegions.cropName固定引用該原始裁切，不得引用p2／p3輔助圖。每個符號都填symbolRegions：symbol、實際原始cropName、所在門面區域、該裁切內0–1000的x／y及簡短證據。
4. doorSymbols長度=count，countBasis固定symbols；依圖面由左到右、由上到下排列。若無法判斷兩符號是否同一門組，寧可每個符號各建一筆count=1，也不能丟掉清楚符號。
5. 這一階段所有尺寸固定填0、dimensionBasis=unknown；J把與斜把數量填0、includesSlantedGap24=false、slantedGap24Context=none、hingeCountPerDoor=0。禁止因這些欄位未知而把已看見的符號改成unknown或刪除。
6. 找到至少一個清楚符號就把它放入doors。若所有可能門面都已掃清，status=confirmed_4e；若仍有其他模糊門樣區，status=partial，但清楚符號仍必須保留並會由後端立即鎖定。後一輪即使信心較高，也只能新增另一個清楚符號，不能把前一輪的<翻成>、把>翻成<或清掉。
7. 找不到符號時，evidence及unresolvedDoorRegions必須明寫原因：沒有門面裁切、符號太小、被裁切邊界切斷、對比不足、與尺寸箭頭重疊，或該區確實無符號；並指出需要哪個區域的放大圖。不可只寫「不確定」。
8. confirmed_no_4e僅限確有door/front裁切，且所有表面都能明確分類為抽面、鋁框門、固定板或非門；後端仍要求三次一致。只有internal裁切不得宣告無門。

所有evidence使用現場可讀繁體中文，只描述符號像素與裁切位置。不要引用其他SOP，不要驗證尺寸，也不要讓尺寸缺失取消<／>。`;

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cabinetCropEvidenceHints(crops: CabinetCropInput[]) {
  return crops.filter((crop) => cabinetCropPass(crop) === 1).map(({ cabinetId, name, role, sourceImageName, region, focus }) => ({
    cabinetId, name, role, sourceImageName, region, focus: focus || "全桶",
  }));
}

function restoreDoorLocks(candidate: JsonRecord, audit: JsonRecord, existingGapLocks: DoorGap24Lock[]) {
  const symbolLocked = restoreLockedDoors(candidate, audit);
  const gapLocked = restoreResolvedDoorGap24Locks(symbolLocked, existingGapLocks);
  return {
    structured: gapLocked,
    gapLocks: collectResolvedDoorGap24Locks(gapLocked, existingGapLocks),
  };
}

function doorReadScore(read: JsonRecord) {
  const statusScore = read.status === "confirmed_4e" ? 30 : read.status === "partial" ? 20 : read.status === "confirmed_no_4e" ? 10 : 0;
  const resolution = lockableDoorRead(read);
  const doorCount = resolution.status === "confirmed_4e" ? resolution.doors.reduce((sum, door) => sum + Math.max(0, Math.round(Number((door as JsonRecord).count) || 0)), 0) : 0;
  const unresolved = Array.isArray(read.unresolvedDoorRegions) ? read.unresolvedDoorRegions.length : 0;
  return doorCount * 100 + statusScore - unresolved;
}

async function runDoorRecognitionByCabinet(
  key: string,
  segmentation: SegmentationPlan,
  cabinetCrops: CabinetCropInput[],
) {
  const calls: Array<Awaited<ReturnType<typeof callStructuredAI>>> = [];
  const cabinetDoors: JsonRecord[] = [];
  const unresolved: string[] = [];
  for (const batch of batchForConcurrency(segmentation.cabinets, 3)) {
    const results = await Promise.all(batch.map(async (segment) => {
      const segmentCalls: Array<Awaited<ReturnType<typeof callStructuredAI>>> = [];
      const segmentUnresolved: string[] = [];
      const all = cabinetCrops.filter((crop) => crop.cabinetId === segment.cabinetId);
      let finalRead: JsonRecord | null = null;
      let firstSymbolLock: JsonRecord | null = null;
      const parsedReads: JsonRecord[] = [];
      const scanAttempts: JsonRecord[] = [];
      let stoppedForNoResponse = false;
      if (!all.length) {
        return {
          read: { cabinetId: segment.cabinetId, status: "unknown", sourceImageName: "", region: segment.label, doors: [], excludedSurfaces: [], unresolvedDoorRegions: ["沒有成功產生此桶裁切圖"], confidence: "low", evidence: "無可供逐桶像素複核的裁切圖", attemptsUsed: 0, scanAttempts: [] } as JsonRecord,
          calls: segmentCalls,
          unresolved: [`${segment.cabinetId}缺逐桶裁切圖，門板及門用五金已排除`],
        };
      }
      for (const attemptNo of [1, 2, 3] as const) {
        const selectedCrops = doorCropsForAttempt(all, attemptNo);
        const crops = selectedCrops.map(({ name, dataUrl }) => ({ name, dataUrl }));
        const cropMetadata = selectedCrops.map(({ name, role, sourceImageName, region, scanPass, focus }) => ({ name, role, sourceImageName, region, scanPass: scanPass || 1, focus: focus || "全桶" }));
        let attempt: Awaited<ReturnType<typeof callStructuredAI>>;
        try {
          attempt = await callStructuredAI(key, crops, {
            instructions: DOOR_RECOGNITION_INSTRUCTIONS,
            taskText: `第${attemptNo}/3次逐桶符號掃描。只輸出cabinetId=${segment.cabinetId}的一筆結果。底部水平尺寸段=${segment.bottomDimensionText || segment.bottomSegmentMm}（${segment.bottomSegmentMm}mm）定義這一桶。本次是${attemptNo === 1 ? "全桶基準裁切" : attemptNo === 2 ? "上下重疊高對比裁切" : "四象限重疊高對比裁切"}，實際輸入：${JSON.stringify(cropMetadata)}。唯一任務是重新找門面葉片內的<／>；完全不要驗證任何尺寸。找到一個就保留一片，填實際cropName與0–1000座標；找不到必須說明需要怎樣的裁切才能看清。${firstSymbolLock ? `\n\n前輪不可覆蓋的門向像素鎖：${JSON.stringify(lockableDoorRead(firstSymbolLock).doors)}。後輪只能保留並新增其他清楚符號，不得刪除、反轉或以較高信心改寫。` : ""}`,
            schemaName: `door_${attemptNo}_audit`, schema: doorRecognitionSchema, effort: "low",
            maxOutputTokens: 3_500, timeoutMs: 45_000, retryTimeoutMs: 45_000,
          });
        } catch (error) {
          scanAttempts.push({ attemptNo, cropNames: selectedCrops.map((crop) => crop.name), focuses: selectedCrops.map((crop) => crop.focus || "全桶"), status: "error", symbols: [], locked: false, note: error instanceof Error ? error.message : "API呼叫失敗" });
          if (isDoorNoResponseError(error)) {
            stoppedForNoResponse = true;
            break;
          }
          continue;
        }
        segmentCalls.push(attempt);
        console.log(`door ${segment.cabinetId} attempt ${attemptNo}`, safeResponseDiagnostics(attempt.raw));
        if (!attempt.parsed.ok) {
          scanAttempts.push({ attemptNo, cropNames: selectedCrops.map((crop) => crop.name), focuses: selectedCrops.map((crop) => crop.focus || "全桶"), status: "error", symbols: [], locked: false, note: attempt.parsed.message });
          continue;
        }
        try {
          const parsed = JSON.parse(attempt.parsed.text) as JsonRecord;
          const read = (Array.isArray(parsed.cabinetDoors) ? parsed.cabinetDoors : []).find((item) => isJsonRecord(item) && String(item.cabinetId) === segment.cabinetId);
          if (!isJsonRecord(read)) throw new Error("本次沒有指定桶身結果");
          let candidate: JsonRecord = { ...read, attemptsUsed: attemptNo };
          const allowedSymbolCrops = doorSourceEvidenceCropNames(selectedCrops);
          if (firstSymbolLock) doorSymbolCropNames(firstSymbolLock).forEach((name) => allowedSymbolCrops.add(name));
          if (!doorReadUsesOnlyKnownSymbolCrops(candidate, allowedSymbolCrops)) {
            candidate = {
              ...candidate,
              status: "partial",
              doors: [],
              unresolvedDoorRegions: [...(Array.isArray(candidate.unresolvedDoorRegions) ? candidate.unresolvedDoorRegions.map(String) : []), "符號引用了本輪不存在的裁切圖"],
              evidence: `${String(candidate.evidence || "")}；未知裁切圖證據已拒絕`.replace(/^；/, ""),
            };
          }
          if (firstSymbolLock) candidate = preserveFirstDoorSymbolLock(firstSymbolLock, candidate);
          parsedReads.push(candidate);
          const symbols = (Array.isArray(candidate.doors) ? candidate.doors : []).filter(isJsonRecord).flatMap((door) => Array.isArray(door.doorSymbols) ? door.doorSymbols.map(String) : []);
          const resolution = lockableDoorRead(candidate);
          const canLockNow = resolution.locked && resolution.status === "confirmed_4e";
          if (canLockNow && !firstSymbolLock) firstSymbolLock = candidate;
          scanAttempts.push({ attemptNo, cropNames: selectedCrops.map((crop) => crop.name), focuses: selectedCrops.map((crop) => crop.focus || "全桶"), status: String(candidate.status || "unknown"), symbols, locked: canLockNow, note: String(candidate.evidence || "") });
          if (!finalRead || doorReadScore(candidate) >= doorReadScore(finalRead)) finalRead = candidate;
          if (shouldStopDoorAttempts(candidate)) break;
        } catch (error) {
          scanAttempts.push({ attemptNo, cropNames: selectedCrops.map((crop) => crop.name), focuses: selectedCrops.map((crop) => crop.focus || "全桶"), status: "error", symbols: [], locked: false, note: error instanceof Error ? error.message : "結果格式無法讀取" });
        }
      }
      if (firstSymbolLock && finalRead) finalRead = preserveFirstDoorSymbolLock(firstSymbolLock, finalRead);
      const hasFrontEvidence = all.some((crop) => cabinetCropPass(crop) === 1 && (crop.role === "door" || crop.role === "front"));
      const noDoorReads = parsedReads.filter((read) => read.status === "confirmed_no_4e"
        && (!Array.isArray(read.unresolvedDoorRegions) || read.unresolvedDoorRegions.length === 0)
        && Array.isArray(read.excludedSurfaces) && read.excludedSurfaces.length > 0);
      const noDoorConsensus = parsedReads.length === 3 && noDoorReads.length === 3 && hasFrontEvidence;
      if (noDoorConsensus) finalRead = { ...noDoorReads[2], attemptsUsed: 3 };
      else if (finalRead?.status === "confirmed_no_4e") finalRead = {
        ...finalRead,
        status: "unknown",
        doors: [],
        unresolvedDoorRegions: [hasFrontEvidence ? "三次不同裁切未一致證明沒有4E門" : "缺門板／正立面裁切，只有桶內圖不能證明沒有門板"],
        evidence: `${String(finalRead.evidence || "")}；未通過三次無門一致性硬檢查`,
      };
      if (!finalRead) finalRead = {
        cabinetId: segment.cabinetId,
        status: "unknown",
        sourceImageName: "",
        region: segment.label,
        doors: [],
        excludedSurfaces: [],
        unresolvedDoorRegions: [stoppedForNoResponse ? "門板辨識沒有回應，已提早結束" : "多次裁切仍沒有定位到門面葉片內的<／>"],
        confidence: "low",
        evidence: stoppedForNoResponse ? "無法偵測門板；其他尺寸與桶內結構仍照常輸出" : "請提供更近、更正、更高對比且包含完整門面符號的照片",
        attemptsUsed: scanAttempts.length,
      };
      const symbolResolution = lockableDoorRead(finalRead);
      const lockedSymbolCount = symbolResolution.status === "confirmed_4e" ? symbolResolution.doors.reduce((sum, door) => sum + Math.max(0, Math.round(Number((door as JsonRecord).count) || 0)), 0) : 0;
      finalRead = { ...finalRead, attemptsUsed: scanAttempts.length, scanAttempts, symbolsLocked: symbolResolution.status === "confirmed_4e", lockedSymbolCount };
      if (symbolResolution.status === "omitted") segmentUnresolved.push(stoppedForNoResponse
        ? `${segment.cabinetId}無法偵測門板，已提早結束門板掃描；門板及門用五金未列`
        : `${segment.cabinetId}多次裁切後仍未定位<／>，門板及門用五金未列`);
      else if (symbolResolution.status === "confirmed_4e" && Array.isArray(finalRead.unresolvedDoorRegions) && finalRead.unresolvedDoorRegions.length) segmentUnresolved.push(`${segment.cabinetId}已鎖定${lockedSymbolCount}片清楚門片，其餘模糊門樣區不列`);
      return { read: finalRead, calls: segmentCalls, unresolved: segmentUnresolved };
    }));
    for (const result of results) {
      cabinetDoors.push(result.read);
      calls.push(...result.calls);
      unresolved.push(...result.unresolved);
    }
  }
  return { audit: { cabinetDoors, unresolved } as JsonRecord, calls };
}

function unavailableDoorRun(segmentation: SegmentationPlan) {
  const reason = "門板辨識沒有回應，已提早結束";
  return {
    audit: {
      cabinetDoors: segmentation.cabinets.map((segment) => ({
        cabinetId: segment.cabinetId,
        status: "unknown",
        sourceImageName: "",
        region: segment.label,
        doors: [],
        excludedSurfaces: [],
        unresolvedDoorRegions: [reason],
        confidence: "low",
        evidence: "無法偵測門板；其他尺寸與桶內結構仍照常輸出",
        attemptsUsed: 0,
        scanAttempts: [],
        symbolsLocked: false,
        lockedSymbolCount: 0,
      })),
      unresolved: segmentation.cabinets.map((segment) => `${segment.cabinetId}無法偵測門板；門板及門用五金未列`),
    } as JsonRecord,
    calls: [] as Array<Awaited<ReturnType<typeof callStructuredAI>>>,
  };
}

const SEMANTIC_REPAIR_INSTRUCTIONS = `${STRUCTURE_INSTRUCTIONS}

你現在是「尺寸軸向修復員」。後端已找出不可接受的軸向或證據錯誤。必須重新查看原圖及尺寸證據，修正整份結構後輸出；不得只把錯誤句子換個說法，也不得刪掉尺寸ID來規避檢查。`;

function parseJsonResult(attempt: Awaited<ReturnType<typeof callStructuredAI>>, label: string) {
  if (!attempt.parsed.ok) {
    const error = new Error(attempt.parsed.message) as Error & { code?: string; status?: number; retryable?: boolean };
    error.code = attempt.parsed.code;
    error.status = attempt.response.status >= 400 ? attempt.response.status : 502;
    error.retryable = attempt.parsed.retryable;
    throw error;
  }
  try {
    return JSON.parse(attempt.parsed.text) as Record<string, unknown>;
  } catch {
    const error = new Error(`${label}回傳內容不是有效結構，請重新掃描。`) as Error & { code?: string; status?: number };
    error.code = "invalid_json";
    error.status = 502;
    throw error;
  }
}

function addUsage(calls: Array<Awaited<ReturnType<typeof callStructuredAI>>>) {
  return {
    inputTokens: calls.reduce((sum, call) => sum + (call.raw.usage?.input_tokens || 0), 0),
    outputTokens: calls.reduce((sum, call) => sum + (call.raw.usage?.output_tokens || 0), 0),
    passes: calls.length,
  };
}

export async function callWithRetry(key: string, images: ValidImageInput[], options: StructuredCallOptions, logName: string) {
  const calls: Array<Awaited<ReturnType<typeof callStructuredAI>>> = [];
  const retryOptions = { ...options, effort: "none" as const, timeoutMs: options.retryTimeoutMs };
  let attempt: Awaited<ReturnType<typeof callStructuredAI>>;
  try {
    attempt = await callStructuredAI(key, images, options);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AbortError") throw error;
    console.warn(`${logName} timed out; retrying once`, { timeoutMs: options.timeoutMs, retryTimeoutMs: options.retryTimeoutMs });
    attempt = await callStructuredAI(key, images, retryOptions);
    calls.push(attempt);
    console.log(`${logName} timeout retry`, safeResponseDiagnostics(attempt.raw));
    return { attempt, calls };
  }
  calls.push(attempt);
  console.log(logName, safeResponseDiagnostics(attempt.raw));
  if (!attempt.parsed.ok && attempt.parsed.retryable) {
    attempt = await callStructuredAI(key, images, retryOptions);
    calls.push(attempt);
    console.log(`${logName} retry`, safeResponseDiagnostics(attempt.raw));
  }
  return { attempt, calls };
}

async function runStructureByCabinet(
  key: string,
  segmentation: SegmentationPlan,
  cabinetCrops: CabinetCropInput[],
  dimensionLedger: JsonRecord,
) {
  const calls: Array<Awaited<ReturnType<typeof callStructuredAI>>> = [];
  const reads: JsonRecord[] = [];
  for (const batch of batchForConcurrency(segmentation.cabinets, 3)) {
    const results = await Promise.all(batch.map(async (segment) => {
      const segmentCropInputs = cabinetCrops.filter((crop) => crop.cabinetId === segment.cabinetId && cabinetCropPass(crop) === 1);
      const segmentImages = segmentCropInputs.map(({ name, dataUrl }) => ({ name, dataUrl }));
      if (!segmentImages.length) throw new Error(`${segment.cabinetId}缺第一輪完整裁切圖，無法判讀桶內結構。`);
      const oneCabinetPlan: SegmentationPlan = { ...segmentation, cabinets: [segment] };
      const run = await callWithRetry(key, segmentImages, {
        instructions: STRUCTURE_INSTRUCTIONS,
        taskText: `這次只判讀一個已裁切桶身，輸出cabinets必須恰好一筆。不得建立相鄰桶、不得把整排合成一桶，也不得用側邊垂直高度鏈改寫桶寬。\n\n前置方向與分桶硬鎖：${JSON.stringify(segmentationLockSummary(oneCabinetPlan))}\n\n本桶裁切規劃：${JSON.stringify(cabinetCropSummary(oneCabinetPlan))}\n\n本桶實際像素裁切與邊界提示：${JSON.stringify(cabinetCropEvidenceHints(segmentCropInputs))}\n\n已鎖正方向的尺寸證據表：${JSON.stringify(dimensionLedger)}\n\n先完整盤點componentRegions，再逐片數活動層板；看得見實體水平層板而沒有F中心線、固格或固定層板的肯定標記時，依R24直接列活格，不再詢問固格／活格。<／>斜向門片標記只是覆蓋標記，不得遮掉或取消其後仍清楚可見的水平層板。若有全高中立，逐格數每一道水平板；同高板線在中立兩側都存在時固定算左右各1片，不能只計一側，也不能跨過中立。門片符號與片數由最後的獨立掃描鎖回，本階段只能補門尺寸與把手；2.4／24mm只提示有斜把，不判尺寸關係也不扣門高。純數字「門N」是普通4E門名義門寬，完成門寬固定N-2，含字母「門A12」才是門型／門號。`,
        schemaName: `cabinet_structure_${segment.cabinetId.toLowerCase()}`,
        schema: cabinetReadSchema,
        effort: "low",
        maxOutputTokens: 9_000,
        timeoutMs: 90_000,
        retryTimeoutMs: 120_000,
      }, `cabinet structure ${segment.cabinetId}`);
      const parsed = parseJsonResult(run.attempt, `${segment.cabinetId}結構判讀階段`);
      const normalized = normalizeSemanticEvidence(parsed, dimensionLedger);
      return {
        structured: applySegmentationLocks(normalized, oneCabinetPlan, dimensionLedger),
        calls: run.calls,
      };
    }));
    for (const result of results) {
      reads.push(result.structured);
      calls.push(...result.calls);
    }
  }
  const merged = mergeCabinetStructureReads(reads, segmentation, dimensionLedger);
  return { structured: applySegmentationLocks(merged, segmentation, dimensionLedger), calls };
}

async function repairSemanticEvidence(
  key: string,
  images: ValidImageInput[],
  dimensionLedger: Record<string, unknown>,
  structured: Record<string, unknown>,
  segmentation?: SegmentationPlan,
) {
  const normalized = applySegmentationLocks(normalizeSemanticEvidence(structured, dimensionLedger), segmentation, dimensionLedger, structured);
  const errors = findSemanticEvidenceErrors(normalized, dimensionLedger);
  if (!errors.length) return { structured: normalized, calls: [] as Array<Awaited<ReturnType<typeof callStructuredAI>>>, errors };

  const repairRun = await callWithRetry(key, images, {
    instructions: SEMANTIC_REPAIR_INSTRUCTIONS,
    taskText: `後端尺寸軸向硬檢查發現以下錯誤：\n- ${errors.join("\n- ")}\n\n前置方向與分桶硬鎖：${segmentation ? JSON.stringify(segmentationLockSummary(segmentation)) : "無"}\n\n尺寸證據表：${JSON.stringify(dimensionLedger)}\n\n需修正的結構：${JSON.stringify(normalized)}\n\n請重新查看原圖，輸出修正後完整結構；不得改變硬鎖的方向、桶數、桶號、順序或寬度。`,
    schemaName: "cabinet_structure_axis_repaired",
    schema: cabinetReadSchema,
    effort: "low",
    maxOutputTokens: 14_000,
    timeoutMs: 90_000,
    retryTimeoutMs: 120_000,
  }, "cabinet semantic repair pass");

  if (!repairRun.attempt.parsed.ok) return { structured: normalized, calls: repairRun.calls, errors };
  try {
    const candidate = applySegmentationLocks(normalizeSemanticEvidence(JSON.parse(repairRun.attempt.parsed.text) as Record<string, unknown>, dimensionLedger), segmentation, dimensionLedger, normalized);
    return { structured: selectBetterSemanticResult(normalized, candidate, dimensionLedger), calls: repairRun.calls, errors };
  } catch {
    return { structured: normalized, calls: repairRun.calls, errors };
  }
}

function selectBetterCompleteResult(baseline: Record<string, unknown>, candidate: Record<string, unknown>, dimensionLedger: Record<string, unknown>) {
  const baselineSemantic = findSemanticEvidenceErrors(baseline, dimensionLedger).length;
  const candidateSemantic = findSemanticEvidenceErrors(candidate, dimensionLedger).length;
  if (candidateSemantic < baselineSemantic) return candidate;
  if (candidateSemantic > baselineSemantic) return baseline;
  const baselineInterior = findInteriorCompletenessErrors(baseline).length;
  const candidateInterior = findInteriorCompletenessErrors(candidate).length;
  if (candidateInterior < baselineInterior) return candidate;
  if (candidateInterior > baselineInterior) return baseline;
  return selectBetterSemanticResult(baseline, candidate, dimensionLedger);
}

async function repairInteriorCompleteness(
  key: string,
  images: ValidImageInput[],
  dimensionLedger: Record<string, unknown>,
  structured: Record<string, unknown>,
  segmentation?: SegmentationPlan,
) {
  const gaps = findInteriorCompletenessErrors(structured);
  if (!gaps.length) return { structured, calls: [] as Array<Awaited<ReturnType<typeof callStructuredAI>>> };

  const interiorRun = await callWithRetry(key, images, {
    instructions: INTERIOR_INSTRUCTIONS,
    taskText: `後端逐件檢查發現桶內資料不完整：\n- ${gaps.join("\n- ")}\n\n前置方向與分桶硬鎖：${segmentation ? JSON.stringify(segmentationLockSummary(segmentation)) : "無"}\n\n尺寸證據表：${JSON.stringify(dimensionLedger)}\n\n目前結構：${JSON.stringify(structured)}\n\n請重新查看全部原圖，逐桶補回能由圖面證明的固格、活格、抽屜群組、中立、擋板、門片與五金必要欄位；特別重查所有仍為unknown但證據提到水平板線／水平分段線的開口。<／>門向虛線只是畫在板線上方的覆蓋標記，不得把後方可見層板取消；同高板線若在中立兩側都存在，必須左右各計1片。不能證明的資料保留0並提出一個使用者看得懂的合併問題。不得改變硬鎖的方向、桶數、桶號、順序或寬度。`,
    schemaName: "cabinet_interior_completed",
    schema: cabinetReadSchema,
    effort: "low",
    maxOutputTokens: 14_000,
    timeoutMs: 90_000,
    retryTimeoutMs: 120_000,
  }, "cabinet interior completeness pass");

  if (!interiorRun.attempt.parsed.ok) return { structured, calls: interiorRun.calls };
  try {
    const candidate = applySegmentationLocks(normalizeSemanticEvidence(JSON.parse(interiorRun.attempt.parsed.text) as Record<string, unknown>, dimensionLedger), segmentation, dimensionLedger, structured);
    return { structured: selectBetterCompleteResult(structured, candidate, dimensionLedger), calls: interiorRun.calls };
  } catch {
    return { structured, calls: interiorRun.calls };
  }
}

export async function runInitialPipeline(key: string, images: ValidImageInput[], segmentation: SegmentationPlan, cabinetCrops: CabinetCropInput[]) {
  const allCalls: Array<Awaited<ReturnType<typeof callStructuredAI>>> = [];
  const filenames = images.map((image) => image.name || "未命名").join("、");
  const cropImages = cabinetCrops.filter((crop) => cabinetCropPass(crop) === 1).map(({ name, dataUrl }) => ({ name, dataUrl }));

  // Door scanning starts in the background, but must never prevent the main
  // dimension and cabinet-structure read from progressing.
  const doorPromise = runDoorRecognitionByCabinet(key, segmentation, cabinetCrops)
    .catch(() => unavailableDoorRun(segmentation));
  const dimensionRun = await callWithRetry(key, images, {
    instructions: DIMENSION_INSTRUCTIONS,
    taskText: `請逐張建立尺寸證據表。圖片共${images.length}張：${filenames}。尤其要遍歷所有可能的共用深度標註。\n\n前置方向與分桶硬鎖：${JSON.stringify(segmentationLockSummary(segmentation))}\n\n這份硬鎖已用「數字正向」及「寬度鏈位於櫃底」雙重核對；直接抄入imageViews與尺寸軸向，不得自行翻成相反90度。`,
    schemaName: "cabinet_dimension_ledger",
    schema: dimensionLedgerSchema,
    effort: "none",
    maxOutputTokens: 8_000,
    timeoutMs: 45_000,
    retryTimeoutMs: 75_000,
  }, "cabinet dimension pass");
  allCalls.push(...dimensionRun.calls);
  const dimensionLedger = normalizeLedgerToSegmentationLocks(parseJsonResult(dimensionRun.attempt, "尺寸證據階段"), segmentation);

  // Read one cabinet per request.  A full-elevation model answer is useful for
  // global context but is not allowed to merge four independently cropped bays.
  const structureRun = await runStructureByCabinet(key, segmentation, cabinetCrops, dimensionLedger);
  allCalls.push(...structureRun.calls);
  let structured = applySegmentationLocks(structureRun.structured, segmentation, dimensionLedger);

  // The main structure is already available at this point. Door results are
  // applied afterward; a silent door request becomes a visible warning only.
  const doorRun = await doorPromise;
  const doorAudit = doorRun.audit;
  allCalls.push(...doorRun.calls);
  let doorGap24Locks: DoorGap24Lock[] = [];
  let restoredDoorState = restoreDoorLocks(structured, doorAudit, doorGap24Locks);
  structured = restoredDoorState.structured;
  doorGap24Locks = restoredDoorState.gapLocks;

  const repaired = await repairSemanticEvidence(key, cropImages, dimensionLedger, structured, segmentation);
  restoredDoorState = restoreDoorLocks(repaired.structured, doorAudit, doorGap24Locks);
  structured = applySegmentationLocks(restoredDoorState.structured, segmentation, dimensionLedger, structured);
  doorGap24Locks = restoredDoorState.gapLocks;
  allCalls.push(...repaired.calls);
  const interior = await repairInteriorCompleteness(key, cropImages, dimensionLedger, structured, segmentation);
  restoredDoorState = restoreDoorLocks(interior.structured, doorAudit, doorGap24Locks);
  structured = applySegmentationLocks(restoredDoorState.structured, segmentation, dimensionLedger, structured);
  doorGap24Locks = restoredDoorState.gapLocks;
  allCalls.push(...interior.calls);
  const preAuditSemanticErrors = findSemanticEvidenceErrors(structured, dimensionLedger);

  const auditRun = await callWithRetry(key, cropImages, {
    instructions: AUDIT_INSTRUCTIONS,
    taskText: `請反向驗算並輸出修正後的完整結構。\n\n前置方向與分桶硬鎖：${JSON.stringify(segmentationLockSummary(segmentation))}\n\n尺寸軸向硬檢查仍需注意：${preAuditSemanticErrors.length ? preAuditSemanticErrors.join("；") : "已通過，請維持所有尺寸ID與軸向"}\n\n尺寸證據表：${JSON.stringify(dimensionLedger)}\n\n第二階段結果：${JSON.stringify(structured)}\n\n反向驗算只能修正桶內內容；不得改方向、合桶、漏桶、換序或改寫硬鎖寬度。`,
    schemaName: "cabinet_structure_audited",
    schema: cabinetReadSchema,
    effort: "none",
    maxOutputTokens: 14_000,
    timeoutMs: 75_000,
    retryTimeoutMs: 105_000,
  }, "cabinet audit pass");
  allCalls.push(...auditRun.calls);
  const audit = auditRun.attempt;
  if (audit.parsed.ok) {
    try {
      const candidate = applySegmentationLocks(normalizeSemanticEvidence(JSON.parse(audit.parsed.text) as Record<string, unknown>, dimensionLedger), segmentation, dimensionLedger, structured);
      restoredDoorState = restoreDoorLocks(selectBetterCompleteResult(structured, candidate, dimensionLedger), doorAudit, doorGap24Locks);
      structured = restoredDoorState.structured;
      doorGap24Locks = restoredDoorState.gapLocks;
    }
    catch { structured.warnings = [...(Array.isArray(structured.warnings) ? structured.warnings : []), "第三階段驗算格式異常，已保留第二階段結果。"] }
  } else {
    structured.warnings = [...(Array.isArray(structured.warnings) ? structured.warnings : []), "第三階段反向驗算未完成，已保留第二階段結果。"];
  }

  restoredDoorState = restoreDoorLocks(normalizeSemanticEvidence(structured, dimensionLedger), doorAudit, doorGap24Locks);
  structured = applySegmentationLocks(restoredDoorState.structured, segmentation, dimensionLedger, structured);
  structured.dimensionLedger = dimensionLedger;
  structured.segmentationPlan = segmentation;
  structured.cabinetCropSummary = cabinetCropSummary(segmentation);
  structured.cropEvidenceHints = cabinetCropEvidenceHints(cabinetCrops);
  structured.sopRuleCount = SOP_RULE_COUNT;
  const axisErrors = [...findSegmentationLockErrors(structured, segmentation, dimensionLedger), ...findSemanticEvidenceErrors(structured, dimensionLedger)];
  structured.axisValidation = { passed: axisErrors.length === 0, errors: axisErrors };
  structured.scanStages = ["底部尺寸鏈分桶", "逐桶真裁切放大", "尺寸證據", "逐桶元件分類", "門板最後逐桶確認並鎖定", "桶內逐件複核", "軸向硬檢查", "反向驗算"];
  structured.usage = addUsage(allCalls);
  return structured;
}

export async function runRevisionPipeline(
  key: string,
  images: ValidImageInput[],
  segmentation: SegmentationPlan,
  cabinetCrops: CabinetCropInput[],
  current: Record<string, unknown>,
  reply: string,
  historyText: string,
) {
  const calls: Array<Awaited<ReturnType<typeof callStructuredAI>>> = [];
  const cropImages = cabinetCrops.filter((crop) => cabinetCropPass(crop) === 1).map(({ name, dataUrl }) => ({ name, dataUrl }));
  const doorAudit = isJsonRecord(current.doorRecognition) ? current.doorRecognition : { cabinetDoors: [], unresolved: [] };
  const userExplicitlyCorrectsGap24 = /(?:24\s*mm|2\.4\s*(?:cm|公分)?|斜把|斜手把|門縫|疊櫃抬高)/i.test(reply);
  let doorGap24Locks: DoorGap24Lock[] = userExplicitlyCorrectsGap24 ? [] : collectResolvedDoorGap24Locks(current);
  let dimensionLedger = current.dimensionLedger as Record<string, unknown> | undefined;
  if (!hasAxisAwareLedger(dimensionLedger)) {
    const dimensionRun = await callWithRetry(key, images, {
      instructions: DIMENSION_INSTRUCTIONS,
      taskText: `請先為這批原圖重建完整尺寸證據表，尤其是共用深度。\n\n前置方向與分桶硬鎖：${JSON.stringify(segmentationLockSummary(segmentation))}\n\n硬鎖已由數字方向與櫃底寬度鏈雙重核對，不得重判方向。`,
      schemaName: "cabinet_dimension_ledger_revision",
      schema: dimensionLedgerSchema,
      effort: "none",
      maxOutputTokens: 8_000,
      timeoutMs: 45_000,
      retryTimeoutMs: 75_000,
    }, "cabinet revision dimension pass");
    calls.push(...dimensionRun.calls);
    dimensionLedger = parseJsonResult(dimensionRun.attempt, "修正尺寸證據階段");
  }
  dimensionLedger = normalizeLedgerToSegmentationLocks(dimensionLedger as Record<string, unknown>, segmentation);

  const correctionTask = `使用者正在修正系統櫃讀圖。只使用逐桶裁切圖，一桶一桶重查componentRegions與內部項目。使用者最新回答優先於AI推論；已確認不存在者完全不列。固定SOP數量、抽牆高度級距及鉸鍊正式級距由後端計算，不得詢問。第一階段門片type、count、countBasis、doorSymbols、direction不可新增、刪除或覆蓋；門寬、門高及把手則是另一條資料線，必須依圖或使用者回答補正，且不得因此清除<／>。2.4／24mm只作有斜把的肯定提示，不必確認它的尺寸關係，也不從門高扣除；若沒有2.4，再看門面或屜頭是否有斜把空隙。若要更改門片數或開向，必須重新上傳掃描取得新的像素複核。每個抽屜組補完成屜頭高度、實際格寬與位置；抽牆高由後端依屜頭高≤200用100、>200用180；中立只做到實際分隔區；擋板先判鎖附位置。前置方向、桶數、桶號、左右順序與底部水平桶寬是硬鎖，任何修正都不得覆蓋。\n\n前置方向與分桶硬鎖：${JSON.stringify(segmentationLockSummary(segmentation))}\n\n逐桶分段：${JSON.stringify(cabinetCropSummary(segmentation))}\n\n尺寸證據表：${JSON.stringify(dimensionLedger)}\n\n門板符號鎖：${JSON.stringify(doorAudit)}\n\n目前結構：${JSON.stringify(current)}\n\n近期對話：${historyText}\n\n使用者最新回答：${reply}`;
  const revisionRun = await callWithRetry(key, cropImages, {
    instructions: STRUCTURE_INSTRUCTIONS,
    taskText: correctionTask,
    schemaName: "cabinet_structure_revision",
    schema: cabinetReadSchema,
    effort: "low",
    maxOutputTokens: 14_000,
    timeoutMs: 90_000,
    retryTimeoutMs: 120_000,
  }, "cabinet revision pass");
  calls.push(...revisionRun.calls);
  let restoredDoorState = restoreDoorLocks(
    applySegmentationLocks(normalizeSemanticEvidence(parseJsonResult(revisionRun.attempt, "圖面修正階段"), dimensionLedger), segmentation, dimensionLedger, current),
    doorAudit,
    doorGap24Locks,
  );
  let structured: JsonRecord = restoredDoorState.structured;
  doorGap24Locks = restoredDoorState.gapLocks;

  const repaired = await repairSemanticEvidence(key, cropImages, dimensionLedger, structured, segmentation);
  restoredDoorState = restoreDoorLocks(repaired.structured, doorAudit, doorGap24Locks);
  structured = applySegmentationLocks(restoredDoorState.structured, segmentation, dimensionLedger, structured);
  doorGap24Locks = restoredDoorState.gapLocks;
  calls.push(...repaired.calls);
  const interior = await repairInteriorCompleteness(key, cropImages, dimensionLedger, structured, segmentation);
  restoredDoorState = restoreDoorLocks(interior.structured, doorAudit, doorGap24Locks);
  structured = applySegmentationLocks(restoredDoorState.structured, segmentation, dimensionLedger, structured);
  doorGap24Locks = restoredDoorState.gapLocks;
  calls.push(...interior.calls);
  const preAuditSemanticErrors = findSemanticEvidenceErrors(structured, dimensionLedger);

  const auditRun = await callWithRetry(key, cropImages, {
    instructions: AUDIT_INSTRUCTIONS,
    taskText: `使用者最新回答必須保留為最高優先的已確認事實：${reply}\n\n前置方向與分桶硬鎖：${JSON.stringify(segmentationLockSummary(segmentation))}\n\n尺寸軸向硬檢查仍需注意：${preAuditSemanticErrors.length ? preAuditSemanticErrors.join("；") : "已通過，請維持所有尺寸ID與軸向"}\n\n尺寸證據表：${JSON.stringify(dimensionLedger)}\n\n修正後結構：${JSON.stringify(structured)}\n\n請做最後反向驗算並輸出完整結構；不得改變硬鎖的方向、桶數、桶號、順序或寬度。`,
    schemaName: "cabinet_structure_revision_audited",
    schema: cabinetReadSchema,
    effort: "none",
    maxOutputTokens: 14_000,
    timeoutMs: 75_000,
    retryTimeoutMs: 105_000,
  }, "cabinet revision audit");
  calls.push(...auditRun.calls);
  const audit = auditRun.attempt;
  if (audit.parsed.ok) {
    try {
      const candidate = applySegmentationLocks(normalizeSemanticEvidence(JSON.parse(audit.parsed.text) as Record<string, unknown>, dimensionLedger), segmentation, dimensionLedger, structured);
      restoredDoorState = restoreDoorLocks(selectBetterCompleteResult(structured, candidate, dimensionLedger), doorAudit, doorGap24Locks);
      structured = restoredDoorState.structured;
      doorGap24Locks = restoredDoorState.gapLocks;
    }
    catch { structured.warnings = [...(Array.isArray(structured.warnings) ? structured.warnings : []), "修正後驗算格式異常，已保留前一階段結果。"] }
  } else {
    structured.warnings = [...(Array.isArray(structured.warnings) ? structured.warnings : []), "修正後反向驗算未完成，已保留前一階段結果。"];
  }

  restoredDoorState = restoreDoorLocks(normalizeSemanticEvidence(structured, dimensionLedger), doorAudit, doorGap24Locks);
  structured = applySegmentationLocks(restoredDoorState.structured, segmentation, dimensionLedger, structured);
  structured.dimensionLedger = dimensionLedger;
  structured.segmentationPlan = segmentation;
  structured.cabinetCropSummary = cabinetCropSummary(segmentation);
  structured.cropEvidenceHints = cabinetCropEvidenceHints(cabinetCrops);
  structured.sopRuleCount = SOP_RULE_COUNT;
  const axisErrors = [...findSegmentationLockErrors(structured, segmentation, dimensionLedger), ...findSemanticEvidenceErrors(structured, dimensionLedger)];
  structured.axisValidation = { passed: axisErrors.length === 0, errors: axisErrors };
  structured.scanStages = ["沿用底部尺寸鏈分桶", "沿用逐桶裁切", "沿用不可覆蓋門板鎖", "套用使用者確認", "逐桶元件重查", "桶內逐件複核", "軸向硬檢查", "反向驗算"];
  structured.usage = addUsage(calls);
  return structured;
}
