import assert from "node:assert/strict";
import test from "node:test";
import { mapInBatches } from "../app/bounded-concurrency.ts";

test("bounded cabinet work never exceeds the configured concurrency and preserves order", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapInBatches([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value % 3));
    active -= 1;
    return value * 10;
  });

  assert.equal(peak, 3);
  assert.deepEqual(result, [10, 20, 30, 40, 50, 60, 70, 80, 90]);
});
