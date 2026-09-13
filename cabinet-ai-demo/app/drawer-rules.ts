/**
 * Formal drawer-wall height tiers confirmed by the revised workbook examples:
 * 145 / 160 / 175 / 200 mm finished drawer fronts use a 100 mm wall;
 * 201–239 mm fronts use a 120 mm wall; 240 mm and above use 180 mm.
 */
export const DRAWER_WALL_HEIGHT_TIERS = [
  { maxFinishedFrontHeightMm: 200, drawerWallHeightMm: 100 },
  { maxFinishedFrontHeightMm: 239, drawerWallHeightMm: 120 },
  { maxFinishedFrontHeightMm: Number.POSITIVE_INFINITY, drawerWallHeightMm: 180 },
] as const;

export function drawerWallHeightForFrontHeight(finishedFrontHeightMm: unknown) {
  const height = Math.round(Number(finishedFrontHeightMm) || 0);
  if (height <= 0) return 0;
  return DRAWER_WALL_HEIGHT_TIERS.find((tier) => height <= tier.maxFinishedFrontHeightMm)?.drawerWallHeightMm || 0;
}

export function drawerWallHeightFormulaText(finishedFrontHeightMm: unknown) {
  const front = Math.round(Number(finishedFrontHeightMm) || 0);
  const wall = drawerWallHeightForFrontHeight(front);
  return wall ? `完成屜頭高${front}mm → 抽牆高${wall}mm（≤200用100；201–239用120；≥240用180）` : "缺完成屜頭高度，無法套抽牆級距";
}
