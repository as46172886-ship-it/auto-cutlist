import assert from "node:assert/strict";
import test from "node:test";

import {
  isSlantedHandleMarkerPixel,
  colorMarkerComponents,
  collectSlantedHandleMarkerEvidence,
  mergeNearbyMarkerFragments,
  normalizeSlantedHandleMarkerEvidence,
  reliableSlantedHandleMarkerCount,
  slantedHandleConsistencyNote,
} from "../app/slanted-handle-audit.ts";

test("color marker selector rejects neutral ink and red dimension rules", () => {
  assert.equal(isSlantedHandleMarkerPixel(50, 95, 160), true);
  assert.equal(isSlantedHandleMarkerPixel(190, 170, 70), true);
  assert.equal(isSlantedHandleMarkerPixel(30, 30, 30), false);
  assert.equal(isSlantedHandleMarkerPixel(160, 120, 125), false);
  assert.equal(isSlantedHandleMarkerPixel(179, 178, 160), false);
});

test("connected-component extraction finds separate blue and yellow marks", () => {
  const width = 8;
  const height = 4;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const paint = (x, y, [r, g, b]) => {
    const offset = (y * width + x) * 4;
    rgba.set([r, g, b, 255], offset);
  };
  paint(1, 1, [50, 95, 160]); paint(2, 1, [50, 95, 160]);
  paint(6, 2, [190, 170, 70]); paint(6, 3, [190, 170, 70]);
  const components = colorMarkerComponents(rgba, width, height);
  assert.equal(components.length, 2);
  assert.equal(components.reduce((sum, item) => sum + item.bluePixels, 0), 2);
  assert.equal(components.reduce((sum, item) => sum + item.yellowPixels, 0), 2);
});

test("nearby anti-aliased fragments merge into one machining marker", () => {
  const result = mergeNearbyMarkerFragments([
    { x: 10, y: 10, width: 2, height: 2, pixels: 3 },
    { x: 18, y: 12, width: 5, height: 5, pixels: 20 },
    { x: 80, y: 10, width: 8, height: 8, pixels: 30 },
  ], 6);
  assert.equal(result.length, 2);
});

test("regular compact marks are reliable but paper-shadow blobs fail closed", () => {
  const regular = Array.from({ length: 12 }, (_, index) => ({ x: index * 30, y: index % 2 ? 40 : 10, width: 9, height: 8, pixels: 31 }));
  assert.deepEqual(reliableSlantedHandleMarkerCount(regular), { count: 12, reliable: true });
  assert.deepEqual(reliableSlantedHandleMarkerCount([{ x: 0, y: 0, width: 400, height: 300, pixels: 42000 }]), { count: 0, reliable: false });
});

test("marker count is only a warning and never rewrites material or hardware quantities", () => {
  const passed = slantedHandleConsistencyNote({ count: 12, reliable: true }, 12, 12);
  assert.match(passed, /核對通過/);
  const mismatch = slantedHandleConsistencyNote({ count: 12, reliable: true }, 11, 12);
  assert.match(mismatch, /只提示人工確認，不自動改數量/);
  assert.equal(slantedHandleConsistencyNote({ count: 99, reliable: false }, 12, 12), "");
});

test("crop evidence keeps one best read per cabinet and rejects untrusted payloads", () => {
  const combined = collectSlantedHandleMarkerEvidence([
    { cabinetId: "C01", count: 2, reliable: false, sourceImageName: "門面A" },
    { cabinetId: "C01", count: 2, reliable: false, sourceImageName: "門面A" },
    { cabinetId: "C02", count: 3, reliable: false, sourceImageName: "門面A" },
    { cabinetId: "C03", count: 99, reliable: false, sourceImageName: "陰影" },
  ]);
  assert.equal(combined?.count, 5);
  assert.equal(normalizeSlantedHandleMarkerEvidence(combined)?.count, 5);
  assert.equal(normalizeSlantedHandleMarkerEvidence({ count: 9999, reliable: true }), undefined);
  assert.equal(normalizeSlantedHandleMarkerEvidence({ count: 5, reliable: false }), undefined);
  assert.equal(collectSlantedHandleMarkerEvidence([{ cabinetId: "C01", count: 1, reliable: false }]), undefined);
  assert.equal(collectSlantedHandleMarkerEvidence([
    { cabinetId: "C01", count: 3, reliable: true, bluePixels: 20, yellowPixels: 0 },
    { cabinetId: "C02", count: 2, reliable: true, bluePixels: 12, yellowPixels: 0 },
  ]), undefined);
  const twoColor = collectSlantedHandleMarkerEvidence([
    { cabinetId: "C01", count: 3, reliable: true, bluePixels: 20, yellowPixels: 0 },
    { cabinetId: "C02", count: 2, reliable: true, bluePixels: 0, yellowPixels: 18 },
  ]);
  assert.equal(twoColor?.count, 5);
  assert.equal(twoColor?.bluePixels, 20);
  assert.equal(twoColor?.yellowPixels, 18);
  assert.equal(normalizeSlantedHandleMarkerEvidence(twoColor, true)?.count, 5);
  assert.equal(normalizeSlantedHandleMarkerEvidence({ count: 5, reliable: true, bluePixels: 30, yellowPixels: 0 }, true), undefined);
  assert.equal(normalizeSlantedHandleMarkerEvidence({ count: 5, reliable: true }, true), undefined);
});
