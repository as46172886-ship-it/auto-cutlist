const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function displayProjectName(value: unknown) {
  const name = String(value || "").trim();
  if (!name || UUID_PATTERN.test(name) || /^IMG[_-][A-Z0-9_-]{16,}$/i.test(name)) return "本次圖面";
  return name;
}

const FIELD_LABELS: Array<[RegExp, string]> = [
  [/\bdrawerWallHeightMm\b/gi, "抽牆高度"],
  [/\bopeningWidthMm\b/gi, "抽屜格寬"],
  [/\bfixedShelfPositionMm\b/gi, "固格中心線高度"],
  [/\bcenterlineBoundaryCount\b/gi, "中立中心線邊界數"],
  [/\bcountBasis\b/gi, "門片數量依據"],
  [/\bdoorSymbols\b/gi, "門片開向符號"],
  [/\bdirection\b/gi, "開向"],
  [/\bmountBasis\b/gi, "擋板鎖附位置"],
  [/\bwidthBasis\b/gi, "擋板寬度依據"],
  [/\bsegmentGroupId\b/gi, "擋板分組"],
  [/\bsegmentCount\b/gi, "擋板支數"],
  [/\bregionPosition\b/gi, "抽屜所在區域"],
  [/\bdoor_50\b/gi, "門櫃擋板 50mm"],
  [/\bdrawer_60\b/gi, "抽屜擋板 60mm"],
  [/\bunknown\b/gi, "待確認"],
];

export function humanizeDisplayText(value: unknown) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text
    .replace(/\bM\d{2,}\s*=\s*(\d+(?:\.\d+)?\s*mm)\b/gi, "圖面上的 $1 尺寸")
    .replace(/\bDG[-_A-Z0-9]+\b/gi, "抽屜組")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "本次圖面")
    .replace(/\bM\d{2,}\b/gi, "圖面尺寸");
  for (const [pattern, label] of FIELD_LABELS) text = text.replace(pattern, label);
  return text.replace(/\s{2,}/g, " ").trim();
}

export function splitBlockingIssue(value: unknown, index: number) {
  const text = humanizeDisplayText(value);
  const tagged = text.match(/^\[([^\]]+)\]\s*(.*)$/);
  return tagged
    ? { title: tagged[1], detail: tagged[2] }
    : { title: `第 ${index + 1} 項`, detail: text };
}
