/**
 * Authoritative formula from 自動拆料系統0705_修正版V2_公式防錯確認版.xlsx,
 * sheet 自動拆料V2_單櫃, cell H16:
 * <=0 => 0, <960 => 2, <1600 => 3, <2240 => 4, otherwise 5.
 */
export function hingesPerDoorForFinishedHeight(heightMm: unknown) {
  const height = Math.round(Number(heightMm) || 0);
  if (height <= 0) return 0;
  if (height < 960) return 2;
  if (height < 1600) return 3;
  if (height < 2240) return 4;
  return 5;
}

export const HINGE_HEIGHT_SCHEDULE = [
  { range: "1–959mm", hingesPerDoor: 2 },
  { range: "960–1599mm", hingesPerDoor: 3 },
  { range: "1600–2239mm", hingesPerDoor: 4 },
  { range: "2240mm以上", hingesPerDoor: 5 },
] as const;
