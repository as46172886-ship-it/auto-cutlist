import assert from "node:assert/strict";
import test from "node:test";
import { taipeiCalendarDate, validateFormalSiteReceipt } from "../scripts/lib/formal-site-run.mjs";

const manifest = { files: [{ sha256: "source-a" }, { sha256: "source-b" }] };
const receipt = {
  evaluationKind: "formal_site_scan",
  liveUrl: "https://cabinet-ai-demo.as46172886.chatgpt.site",
  deploymentVersion: 81,
  startedAt: "2026-09-03T00:10:00+08:00",
  downloadedAt: "2026-09-03T00:30:00+08:00",
  sourceSha256s: ["source-b", "source-a"],
  outputSha256: "output-x",
};
const options = { expectedLiveUrl: receipt.liveUrl, outputSha256: "output-x" };

test("formal receipt accepts the complete production flow and assigns the daily run number", () => {
  const result = validateFormalSiteReceipt(receipt, manifest, [{ startedAt: "2026-09-02T15:00:00+08:00" }], options);
  assert.deepEqual(result, { ok: true, date: "2026-09-03", runNumber: 1, errors: [] });
});

test("Taipei calendar date does not follow UTC midnight", () => {
  assert.equal(taipeiCalendarDate("2026-09-02T16:10:00Z"), "2026-09-03");
});

test("offline or altered inputs cannot be promoted to a formal score", () => {
  const result = validateFormalSiteReceipt({ ...receipt, evaluationKind: "export_roundtrip", sourceSha256s: ["source-a"] }, manifest, [], options);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /formal_site_scan/);
  assert.match(result.errors.join("\n"), /完整且相同/);
});

test("a third formal test on one Taipei day is rejected", () => {
  const priorRuns = [
    { startedAt: "2026-09-03T00:40:00+08:00" },
    { startedAt: "2026-09-03T12:40:00+08:00" },
  ];
  const result = validateFormalSiteReceipt(receipt, manifest, priorRuns, options);
  assert.equal(result.ok, false);
  assert.equal(result.runNumber, 3);
  assert.match(result.errors.join("\n"), /禁止超過每日2次/);
});
