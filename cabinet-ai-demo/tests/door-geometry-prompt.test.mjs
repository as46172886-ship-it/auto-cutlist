import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const initialPipeline = readFileSync(new URL("../app/api/analyze/pipeline.ts", import.meta.url), "utf8");
const doorRoute = readFileSync(new URL("../app/api/doors/route.ts", import.meta.url), "utf8");

for (const [name, source] of [["initial pipeline", initialPipeline], ["door route", doorRoute]]) {
  test(`${name} treats full dashed chevrons as direction evidence`, () => {
    assert.match(source, /大型虛線／點線人字幾何/);
    assert.match(source, /共同尖端在左/);
    assert.match(source, /共同尖端在右/);
  });

  test(`${name} never treats colored machining markers as door direction`, () => {
    assert.match(source, /彩色小三角/);
    assert.match(source, /不可當成左／右開向|不是門片開向符號/);
  });

  test(`${name} requires enhanced door evidence to close against a raw crop`, () => {
    assert.match(source, /只能協助定位/);
    assert.match(source, /不得引用p2／p3輔助圖/);
  });
}
