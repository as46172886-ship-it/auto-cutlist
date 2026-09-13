import assert from "node:assert/strict";
import test from "node:test";

import { isChromaticRedDimensionPixel } from "../app/image-crop.ts";

test("suppresses chromatic red dimension rules without erasing neutral numerals", () => {
  assert.equal(isChromaticRedDimensionPixel(155, 120, 125), true);
  assert.equal(isChromaticRedDimensionPixel(225, 205, 208), true);
  assert.equal(isChromaticRedDimensionPixel(35, 35, 35), false);
  assert.equal(isChromaticRedDimensionPixel(160, 155, 150), false);
  assert.equal(isChromaticRedDimensionPixel(245, 245, 245), false);
});
