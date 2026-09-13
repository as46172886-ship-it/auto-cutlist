import assert from "node:assert/strict";
import test from "node:test";
import { displayProjectName, humanizeDisplayText, splitBlockingIssue } from "../app/display-text.ts";

test("does not expose a UUID as the project title", () => {
  assert.equal(displayProjectName("FF4D9004-EB79-438F-9236-8B9BC4A5725C"), "本次圖面");
  assert.equal(displayProjectName("客廳電視櫃"), "客廳電視櫃");
});

test("translates internal AI field names into workshop Chinese", () => {
  const raw = "C1 DG_C1_1 的 drawerWallHeightMm 未標；countBasis、doorSymbols、direction 仍是 unknown。";
  const shown = humanizeDisplayText(raw);
  assert.equal(shown.includes("drawerWallHeightMm"), false);
  assert.equal(shown.includes("countBasis"), false);
  assert.equal(shown.includes("DG_C1_1"), false);
  assert.match(shown, /抽牆高度.*門片數量依據.*門片開向符號.*開向.*待確認/);
});

test("turns a tagged backend blocker into a clear card title and detail", () => {
  assert.deepEqual(splitBlockingIssue("[背條數量對照] C1目前1支，SOP應有2支，缺1支。", 0), {
    title: "背條數量對照",
    detail: "C1目前1支，SOP應有2支，缺1支。",
  });
});
