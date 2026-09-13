export type QuantityRule = {
  id: string;
  sop: string;
  item: string;
  formula: string;
  mode: "automatic" | "drawing" | "spec_table";
};

// One deterministic source for every fixed quantity in the authoritative SOP.
// The vision model only extracts structure; these values are calculated here.
export const QUANTITY = Object.freeze({
  SIDE_PANELS_PER_CABINET: 2,
  TOP_BOARDS_PER_CABINET: 1,
  BOTTOM_BOARDS_PER_CABINET: 1,
  BACK_PANELS_PER_CABINET: 1,
  CONNECTORS_PER_TOP_BOTTOM_BOARD_SHALLOW: 4,
  CONNECTORS_PER_TOP_BOTTOM_BOARD_DEEP: 6,
  FEET_PER_FLOOR_CABINET: 4,
  SUPPORT_FEET_PER_FULL_HEIGHT_MIDDLE_DIVIDER: 1,
  FIXED_SHELF_FITTINGS_PER_BOARD: 4,
  ADJUSTABLE_SHELF_PINS_PER_BOARD: 4,
  MIDDLE_DIVIDER_FITTINGS_PER_BOARD: 4,
  DAMPERS_PER_STANDARD_DOOR: 1,
  SLIDES_PER_DRAWER: 1,
  FRONT_BACK_WALLS_PER_DRAWER: 2,
  SIDE_WALLS_PER_DRAWER: 2,
  BOTTOMS_PER_DRAWER: 1,
  SUPPLEMENT_BOARDS_PER_INNER_DRAWER: 4,
  DOWELS_PER_DRAWER_SHALLOW: 12,
  DOWELS_PER_DRAWER_DEEP: 4,
  MIRROR_BEADS_PER_MIRROR: 4,
  BAFFLES_PER_REQUIRED_OPENING: 1,
});

export const QUANTITY_RULES: QuantityRule[] = [
  { id: "Q01", sop: "R08/R16", item: "側板", formula: "每個獨立桶身 2 片", mode: "automatic" },
  { id: "Q02", sop: "R17", item: "頂板／底板", formula: "每桶頂板 1 片、底板 1 片", mode: "automatic" },
  { id: "Q03", sop: "R18", item: "背板", formula: "每桶 1 片", mode: "automatic" },
  { id: "Q04", sop: "R19", item: "一般落地櫃背條", formula: "H≤1200：0；1200<H≤1800：1；H>1800：2", mode: "automatic" },
  { id: "Q05", sop: "R20", item: "吊櫃／特殊櫃背條", formula: "吊櫃每桶至少 1 支；特殊櫃依圖面確認實際數量，確認 0 也要留證據，未知不得當 0", mode: "drawing" },
  { id: "Q06", sop: "R21", item: "KD", formula: "D<500：每片頂／底板 4 個；D≥500：每片 6 個", mode: "automatic" },
  { id: "Q07", sop: "R21", item: "桶身木榫", formula: "數量等於 KD；不可和抽木榫混算", mode: "automatic" },
  { id: "Q08", sop: "R22", item: "調整腳", formula: "每個落地桶身基本 4 支；每片從頂板直達底板的全高中立板另加 1 支支撐腳；依腳高分 A10／A12", mode: "automatic" },
  { id: "Q09", sop: "R23/R60", item: "白固格器", formula: "每片固格板 4 個", mode: "automatic" },
  { id: "Q10", sop: "R24/R60", item: "活格利", formula: "每片活格板 4 個", mode: "automatic" },
  { id: "Q11", sop: "R58-R60", item: "中立板固格器", formula: "每片中立板 4 個；上18下18不免算", mode: "automatic" },
  { id: "Q12", sop: "R37/R38", item: "門片", formula: "門面葉片區內每一個 < 或 > 代表 1 片4E門；抽面、鋁框門、尺寸箭頭與J把記號不計，所有門樣區域閉合前不得先算五金", mode: "drawing" },
  { id: "Q13", sop: "R61", item: "GS鉸鍊", formula: "依完成門高固定：1–959=2、960–1599=3、1600–2239=4、2240以上=5個／片，再乘門片數", mode: "automatic" },
  { id: "Q14", sop: "R61", item: "油壓器", formula: "一般普通門每片 1 個", mode: "automatic" },
  { id: "Q15", sop: "R41/R42", item: "斜把加工備註", formula: "實際斜把加工門片＋屜頭逐片註記『長斜把×N』，只供加工與計價，不輸出五金列", mode: "drawing" },
  { id: "Q16", sop: "R43/R44", item: "J 型手把", formula: "實際 J 把加工門片數；不得超過門片數", mode: "drawing" },
  { id: "Q17", sop: "R46-R48", item: "三節滑軌", formula: "每抽 1 組；1 組為左右各 1 支", mode: "automatic" },
  { id: "Q18", sop: "R49-R51/R67", item: "前後抽牆", formula: "每抽 2 片；高度依完成屜頭級距：≤200用100、201–239用120、≥240用180", mode: "automatic" },
  { id: "Q19", sop: "R51/R67", item: "邊抽牆", formula: "每抽 2 片；高度與前後抽牆相同，依完成屜頭級距自動算", mode: "automatic" },
  { id: "Q20", sop: "R51", item: "抽底板", formula: "每抽 1 片", mode: "automatic" },
  { id: "Q21", sop: "R53", item: "內抽抽補板", formula: "每個內抽 4 片", mode: "automatic" },
  { id: "Q22", sop: "R52", item: "抽木榫", formula: "D<500：每抽12顆；D≥500：每抽4顆；與桶身木榫分算後合併", mode: "automatic" },
  { id: "Q23", sop: "R62", item: "鏡珠", formula: "每面明鏡 4 顆", mode: "automatic" },
  { id: "Q24", sop: "R30-R33", item: "斜把擋板", formula: "每個需要擋板的開口 1 支；有中立時按開口分段，每一實體分段各建立 1 筆", mode: "drawing" },
  { id: "Q25", sop: "R36", item: "踢腳板", formula: "現場總長換算 2800 標準料；最後餘長固定加 500，短料上限 2800", mode: "automatic" },
  { id: "Q26", sop: "R62/R63", item: "特殊五金", formula: "伸縮衣桿、拉盤等依圖面逐項逐數列入；已辨識但數量未知時必須阻擋，不得省略", mode: "drawing" },
  { id: "Q27", sop: "R34/R35/R65", item: "獨立封板／板件", formula: "每一實體板件依圖面確認片數；未知不得填 0 或從料單省略", mode: "drawing" },
  { id: "Q28", sop: "R46-R53", item: "抽屜總數閉合", formula: "drawerGroups 各組數量總和必須等於桶身 drawerCount", mode: "drawing" },
  { id: "Q29", sop: "R46-R53", item: "內抽數量閉合", formula: "isInner 各組數量總和必須等於 innerDrawerCount，且不得大於總抽數", mode: "drawing" },
  { id: "Q30", sop: "R54-R60", item: "並排抽中立板", formula: "並排 N 列固定需要 N−1 片完整中立；每片再自動計 4 個固格器", mode: "automatic" },
];

export const QUANTITY_RULE_COUNT = QUANTITY_RULES.length;

export function drawerDowelsPerDrawerForDepth(depthMm: number) {
  return Math.round(Number(depthMm) || 0) >= 500
    ? QUANTITY.DOWELS_PER_DRAWER_DEEP
    : QUANTITY.DOWELS_PER_DRAWER_SHALLOW;
}

export const QUANTITY_PROMPT = QUANTITY_RULES
  .map((rule) => `${rule.id}｜${rule.sop}｜${rule.item}：${rule.formula}｜${rule.mode}`)
  .join("\n");
