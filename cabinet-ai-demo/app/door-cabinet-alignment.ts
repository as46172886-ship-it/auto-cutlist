type JsonRecord = Record<string, unknown>;

export function indexDoorCabinetsById(
  cabinets: JsonRecord[],
  expectedCabinetIds: string[],
): Map<string, JsonRecord> | undefined {
  const expected = expectedCabinetIds.map((id) => String(id || "").trim());
  if (!expected.length || new Set(expected).size !== expected.length || expected.some((id) => !id)) return undefined;
  if (cabinets.length !== expected.length) return undefined;

  const indexed = new Map<string, JsonRecord>();
  for (const cabinet of cabinets) {
    const id = String(cabinet.id || "").trim();
    if (!id || indexed.has(id) || !expected.includes(id)) return undefined;
    indexed.set(id, cabinet);
  }
  return expected.every((id) => indexed.has(id)) ? indexed : undefined;
}
