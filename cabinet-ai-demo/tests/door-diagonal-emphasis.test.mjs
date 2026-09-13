import assert from "node:assert/strict";
import test from "node:test";
import { doorScanTilesForPass, emphasizeDiagonalDoorGeometry } from "../app/image-crop.ts";

function image(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const set = (x, y, rgb = [20, 20, 20]) => {
    const offset = (y * width + x) * 4;
    data[offset] = rgb[0]; data[offset + 1] = rgb[1]; data[offset + 2] = rgb[2]; data[offset + 3] = 255;
  };
  return { data, set };
}

test("diagonal door emphasis keeps dashed chevrons and suppresses cabinet axes", () => {
  const width = 61;
  const height = 45;
  const { data, set } = image(width, height);
  for (let y = 5; y < 40; y += 1) set(5, y);
  for (let x = 5; x < 56; x += 1) set(x, 22);
  for (let step = 0; step < 22; step += 1) {
    if (step % 6 < 4) {
      set(12 + step, 22 - step);
      set(12 + step, 22 + step);
    }
  }
  emphasizeDiagonalDoorGeometry(data, width, height);
  const black = (x, y) => data[(y * width + x) * 4] === 0;
  let diagonal = 0;
  let vertical = 0;
  let horizontal = 0;
  for (let step = 0; step < 22; step += 1) {
    if (black(12 + step, 22 - step)) diagonal += 1;
    if (black(12 + step, 22 + step)) diagonal += 1;
  }
  for (let y = 5; y < 40; y += 1) if (black(5, y)) vertical += 1;
  for (let x = 5; x < 56; x += 1) if (black(x, 22)) horizontal += 1;
  assert.ok(diagonal >= 20, `expected dashed chevron support, got ${diagonal}`);
  assert.ok(vertical <= 4, `vertical cabinet frame leaked ${vertical} pixels`);
  assert.ok(horizontal <= 8, `horizontal shelf leaked ${horizontal} pixels`);
});

test("colored machining triangle is excluded from neutral door-direction mask", () => {
  const { data, set } = image(31, 31);
  for (let x = 8; x <= 22; x += 1) {
    const half = Math.floor((x - 8) / 2);
    for (let y = 15 - half; y <= 15 + half; y += 1) set(x, y, [30, 80, 190]);
  }
  emphasizeDiagonalDoorGeometry(data, 31, 31);
  assert.equal([...data].filter((value, index) => index % 4 === 0 && value === 0).length, 0);
});

test("a sparse non-chevron crop falls back instead of becoming a blank mask", () => {
  const { data, set } = image(41, 41);
  for (let step = 0; step < 4; step += 1) set(10 + step, 10 + step);
  const original = data.slice();
  emphasizeDiagonalDoorGeometry(data, 41, 41);
  assert.deepEqual(data, original);
});

test("a flooded diagonal texture falls back to the high-contrast source", () => {
  const { data, set } = image(51, 51);
  for (let y = 0; y < 51; y += 1) {
    for (let x = 0; x < 51; x += 1) if ((x + y) % 4 < 2) set(x, y);
  }
  const original = data.slice();
  emphasizeDiagonalDoorGeometry(data, 51, 51);
  assert.deepEqual(data, original);
});

test("the diagonal pass keeps the complete chevron in one full-cabinet tile", () => {
  assert.deepEqual(doorScanTilesForPass(2, true), [
    { focus: "全桶門向", x: 0, y: 0, width: 1, height: 1 },
  ]);
  assert.equal(doorScanTilesForPass(2).length, 2);
});
