function normalizedText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedSpec(value) {
  return normalizedText(value).replace(/\s*[×xX]\s*/g, " × ");
}

export function canonicalRow(row) {
  return {
    item: normalizedText(row.item),
    spec: normalizedSpec(row.spec),
    thickness: normalizedText(row.thickness),
    qty: Number(row.qty) || 0,
    note: normalizedText(row.note),
  };
}

export function rowKey(row) {
  const value = canonicalRow(row);
  return JSON.stringify([value.item, value.spec, value.thickness, value.qty, value.note]);
}

function countRows(rows) {
  const counts = new Map();
  const samples = new Map();
  for (const row of rows.map(canonicalRow)) {
    const key = rowKey(row);
    counts.set(key, (counts.get(key) || 0) + 1);
    samples.set(key, row);
  }
  return { counts, samples };
}

function expandedDifference(left, right, samples) {
  const values = [];
  for (const [key, count] of left) {
    const difference = Math.max(0, count - (right.get(key) || 0));
    if (difference) values.push({ ...samples.get(key), count: difference });
  }
  return values;
}

export function scoreExactRows(expectedRows, actualRows) {
  const expected = countRows(expectedRows);
  const actual = countRows(actualRows);
  let matched = 0;
  for (const [key, count] of expected.counts) matched += Math.min(count, actual.counts.get(key) || 0);
  const expectedCount = expectedRows.length;
  const actualCount = actualRows.length;
  const precision = actualCount ? matched / actualCount : 0;
  const recall = expectedCount ? matched / expectedCount : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    matched,
    expected: expectedCount,
    actual: actualCount,
    precision: Number((precision * 100).toFixed(1)),
    recall: Number((recall * 100).toFixed(1)),
    f1: Number((f1 * 100).toFixed(1)),
    missing: expandedDifference(expected.counts, actual.counts, expected.samples),
    extra: expandedDifference(actual.counts, expected.counts, actual.samples),
  };
}

export function scoreExactRowSections(expectedRows, actualRows, classify) {
  const scoreSection = (section) => scoreExactRows(
    expectedRows.filter((row) => classify(row) === section),
    actualRows.filter((row) => classify(row) === section),
  );
  const doorPanels = scoreSection("door-panels");
  const doorHardware = scoreSection("door-hardware");
  return {
    doorPanels,
    doorHardware,
    doorRelated: scoreExactRows(
      expectedRows.filter((row) => classify(row) !== "other"),
      actualRows.filter((row) => classify(row) !== "other"),
    ),
  };
}
