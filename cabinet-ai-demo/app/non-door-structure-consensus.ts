type JsonRecord = Record<string, unknown>;

export type StructureVerification = {
  cabinetId: string;
  fullHeightMiddleDividerCount: number;
  adjustableShelfBoardCount: number;
  fixedShelfBoardCount: number;
  drawerFrontCount: number;
  drawerColumnCount: number;
  drawerRowCount: number;
  drawerCountReliable: boolean;
  reliable: boolean;
  confidence: "high" | "medium" | "low";
  dividerEvidence: string;
  shelfEvidence: string;
  drawerEvidence: string;
  exclusions: string[];
};

export type SettledStructureVerification = {
  verification?: StructureVerification;
  warning?: string;
};

export async function settleStructureVerification(
  cabinetId: string,
  run: Promise<StructureVerification>,
): Promise<SettledStructureVerification> {
  try {
    return { verification: await run };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      warning: timedOut
        ? `${cabinetId}結構線補充複核逾時，已沿用逐桶主掃描結果。`
        : `${cabinetId}結構線補充複核未完成，已沿用逐桶主掃描結果。`,
    };
  }
}

const count = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));
const records = (value: unknown) => (Array.isArray(value) ? value : []).filter((item): item is JsonRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)));

function isExistingFullHeightDivider(divider: JsonRecord) {
  const text = `${String(divider.region || "")} ${String(divider.evidence || "")}`;
  return (divider.topConnection === "top_board" && divider.bottomConnection === "bottom_board")
    || /全高|通高|由頂.{0,12}到底|上接頂板.{0,20}下接底板/.test(text);
}

export function applyStructureVerification(read: JsonRecord, verification: StructureVerification | undefined) {
  if (!verification?.reliable || verification.confidence === "low") return read;
  const source = read.cabinet;
  if (!source || typeof source !== "object" || Array.isArray(source)) return read;
  const sourceCabinetId = String((source as JsonRecord).id || "").trim();
  const verificationCabinetId = String(verification.cabinetId || "").trim();
  if (!sourceCabinetId || verificationCabinetId !== sourceCabinetId) return read;
  const cabinet = { ...(source as JsonRecord) };
  const heightMm = count(cabinet.heightMm);
  const dividers = records(cabinet.middleDividers);
  const existingFullCount = dividers.filter(isExistingFullHeightDivider).length;
  const verifiedFullCount = Math.min(4, count(verification.fullHeightMiddleDividerCount));
  for (let index = existingFullCount; index < verifiedFullCount; index += 1) {
    dividers.push({
      depthMm: 0,
      heightMm: 0,
      referenceSpanMm: heightMm,
      depthBasis: "standard_d_minus_29",
      heightBasis: "connection_span",
      region: `全高中立${index + 1}`,
      topConnection: "top_board",
      bottomConnection: "bottom_board",
      evidence: `專用線條複核：${verification.dividerEvidence}`,
    });
  }
  cabinet.middleDividers = dividers;
  cabinet.adjustableShelves = Math.max(count(cabinet.adjustableShelves), count(verification.adjustableShelfBoardCount));
  if (verification.drawerCountReliable) {
    const drawerCount = Math.min(20, count(verification.drawerFrontCount));
    const columns = Math.min(drawerCount, count(verification.drawerColumnCount));
    const rows = count(verification.drawerRowCount);
    cabinet.drawerCount = drawerCount;
    if (!drawerCount) cabinet.drawerGroups = [];
    else if (rows === 1) {
      const existingGroups = records(cabinet.drawerGroups);
      const group = existingGroups.sort((a, b) => count(b.count) - count(a.count))[0];
      if (group) cabinet.drawerGroups = [{
        ...group,
        count: drawerCount,
        openingWidthMm: 0,
        sideBySide: columns > 1,
        usesCenterlineWidth: columns > 1,
        centerlineBoundaryCount: columns > 1 ? 1 : 0,
        evidence: `${String(group.evidence || "")}；抽屜框專用複核：${verification.drawerEvidence}`,
      }];
    }
    cabinet.sideBySideDrawers = columns > 1 && rows === 1;
  }
  cabinet.evidence = `${String(cabinet.evidence || "")}；結構線專用複核：${verification.dividerEvidence}／${verification.shelfEvidence}／${verification.drawerEvidence}`;
  if (verification.confidence === "high") cabinet.confidence = "high";
  return {
    ...read,
    cabinet,
    warnings: [...new Set([
      ...(Array.isArray(read.warnings) ? read.warnings.map(String) : []),
      ...verification.exclusions.map((item) => `結構線複核已排除：${item}`),
    ])],
  };
}
