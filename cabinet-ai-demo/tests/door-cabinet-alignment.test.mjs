import assert from "node:assert/strict";
import test from "node:test";
import { indexDoorCabinetsById } from "../app/door-cabinet-alignment.ts";

test("door scans align cabinets by exact ID even when analysis order differs", () => {
  const c01 = { id: "C01", widthMm: 400 };
  const c02 = { id: "C02", widthMm: 800 };
  const indexed = indexDoorCabinetsById([c02, c01], ["C01", "C02"]);
  assert.equal(indexed?.get("C01"), c01);
  assert.equal(indexed?.get("C02"), c02);
});

test("door scans reject a missing, duplicate, or neighboring cabinet ID instead of using array position", () => {
  assert.equal(indexDoorCabinetsById([{ id: "C01" }, { id: "C03" }], ["C01", "C02"]), undefined);
  assert.equal(indexDoorCabinetsById([{ id: "C01" }, { id: "C01" }], ["C01", "C02"]), undefined);
  assert.equal(indexDoorCabinetsById([{ id: "C01" }, {}], ["C01", "C02"]), undefined);
});
