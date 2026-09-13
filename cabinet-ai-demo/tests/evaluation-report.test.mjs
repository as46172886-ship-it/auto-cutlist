import assert from "node:assert/strict";
import test from "node:test";
import { evaluationReport } from "../scripts/lib/evaluation-report.mjs";

test("export roundtrip cannot be reported as AI recognition or a formal site test", () => {
  const report = evaluationReport("export_roundtrip", { f1: 100 });
  assert.equal(report.f1, 100);
  assert.equal(report.countsAsRecognitionScore, false);
  assert.equal(report.countsAsFormalSiteTest, false);
  assert.match(report.purpose, /不代表AI看圖正確率/);
});

test("only a full formal-site scan is eligible for the formal recognition score", () => {
  const report = evaluationReport("formal_site_scan", { f1: 91.8 });
  assert.equal(report.countsAsRecognitionScore, true);
  assert.equal(report.countsAsFormalSiteTest, true);
  assert.match(report.purpose, /正式F1/);
});

test("unknown evaluation kinds fail instead of silently inheriting a stronger label", () => {
  assert.throws(() => evaluationReport("offline_guess", { f1: 100 }), /unknown evaluation kind/);
});
