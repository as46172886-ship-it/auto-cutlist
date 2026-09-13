export type CarcassRule = {
  id: string;
  group: "symbol" | "boundary" | "dimension" | "material" | "scope" | "validation";
  title: string;
  rule: string;
  deterministic: boolean;
};

export const SYMBOLS = [
  { symbol: "W", meaning: "Width／單一獨立桶身外寬", not: "總立面寬、門寬或水平留空" },
  { symbol: "H", meaning: "Height／桶底線到桶頂線的桶身外高", not: "含腳總高、上方留空或單一門高" },
  { symbol: "D", meaning: "Depth／桶身深度", not: "Door、門號、板厚或料號" },
  { symbol: "T", meaning: "Thickness／板厚", not: "桶身深度" },
  { symbol: "F", meaning: "固定層板中心線相對桶底的高度", not: "桶身外高或深度" },
] as const;

export const CARCASS_RULES: CarcassRule[] = [
  { id: "C01", group: "symbol", title: "寬度 W", deterministic: false, rule: "旋正後最下方的水平分段尺寸鏈，一段固定對應一個由左到右的獨立桶身。" },
  { id: "C02", group: "symbol", title: "深度 D", deterministic: false, rule: "D42.6固定表示深度42.6cm＝426mm；D426mm固定表示426mm。" },
  { id: "C03", group: "boundary", title: "桶高 H", deterministic: false, rule: "H只取同一對連續側板的桶底線到桶頂線；沒有外總高時才將首尾相接的垂直分段完整相加。" },
  { id: "C04", group: "boundary", title: "間隙仍屬桶高", deterministic: false, rule: "2.4cm門縫或斜把縫位於桶底與桶頂之間時，是高度鏈的一段，必須計入H，但不是24mm板厚。" },
  { id: "C05", group: "boundary", title: "不可誤拆上下桶", deterministic: false, rule: "左右側板由底到頂連續時，門面上下分段、水平門縫或內部橫線都不能把同一桶拆成上下兩桶。" },
  { id: "C06", group: "boundary", title: "排除腳與留空", deterministic: false, rule: "桶身下方腳高、現場區，以及桶身上方留空、天花間隙不計入H。" },
  { id: "C07", group: "dimension", title: "單位換算", deterministic: true, rule: "圖面cm固定乘10轉mm；已標mm固定乘1；單位不明不得自行猜測。" },
  { id: "C08", group: "dimension", title: "共用深度", deterministic: false, rule: "一筆D標註若明確跨同一排，可建立深度群組套用多桶；必須列出適用桶序與圖面證據。" },
  { id: "C09", group: "material", title: "獨立桶身", deterministic: true, rule: "每個獨立桶身固定2片側板、2片頂底板及1片背板；相鄰桶不共用側板。" },
  { id: "C10", group: "material", title: "側板", deterministic: true, rule: "側板完成尺寸＝D×H，18mm厚，每桶2片。" },
  { id: "C11", group: "material", title: "頂底板", deterministic: true, rule: "頂板與底板完成尺寸＝D×(W−36)，18mm厚，每桶共2片。" },
  { id: "C12", group: "material", title: "背板", deterministic: true, rule: "背板完成尺寸＝(W−26)×(H−26)，8mm厚，每桶1片。" },
  { id: "C13", group: "scope", title: "只做桶身", deterministic: true, rule: "本模式排除門片、抽屜、層板、中立、擋板、填縫板、踢腳板、檯面與全部五金。" },
  { id: "C14", group: "validation", title: "證據先於結果", deterministic: true, rule: "AI只抄原始文字、數值、單位、尺寸鏈與邊界證據；mm結果、加總與板件全部由程式計算。" },
  { id: "C15", group: "validation", title: "不完整不下料", deterministic: true, rule: "任何一桶W、H或D未閉合時，該桶不得產生板件；其他已閉合桶可保留。" },
];

export const EXCLUDED_COMPONENTS = ["門片", "抽屜", "層板", "中立", "擋板", "填縫板", "踢腳板", "檯面", "五金"] as const;

export const BOARD_PROFILE = {
  bodyThicknessMm: 18,
  backThicknessMm: 8,
  topBottomWidthDeductionMm: 36,
  backWidthDeductionMm: 26,
  backHeightDeductionMm: 26,
} as const;

export const CARCASS_ONLY_RULES = CARCASS_RULES.map((item) => `${item.id}｜${item.title}：${item.rule}`);

export function promptKnowledge() {
  const dictionary = SYMBOLS.map((item) => `- ${item.symbol}＝${item.meaning}；不是${item.not}。`).join("\n");
  const rules = CARCASS_RULES.filter((item) => !item.deterministic || ["C07", "C14", "C15"].includes(item.id))
    .map((item) => `- ${item.id} ${item.title}：${item.rule}`)
    .join("\n");
  return `${dictionary}\n\n判讀規則：\n${rules}`;
}
