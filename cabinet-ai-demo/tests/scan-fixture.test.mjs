import assert from "node:assert/strict";
import test from "node:test";
import { jpegDimensions } from "../scripts/lib/scan-fixture.mjs";

test("reads JPEG dimensions from the SOF marker without decoding image pixels", () => {
  const bytes = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x06, 0x00, 0x04, 0x80, 0x03, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  assert.deepEqual(jpegDimensions(bytes), { width: 1152, height: 1536 });
});
