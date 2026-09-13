import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renders the finished site metadata without a starter preview marker", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>系統櫃 AI 拆料｜含門完整料單<\/title>/i);
  assert.doesNotMatch(html, /name=["']codex-preview["']/i);
});

test("layout uses local system fallbacks without hosted font asset requests", async () => {
  const source = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /next\/font|Geist/);
});

test("mobile confirmation bar stays in document flow and cannot cover quantity rows", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.confirm-bar[\s\S]*?position:\s*static\s*!important/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.confirm-bar\s*\{[^}]*position:\s*static[^}]*bottom:\s*auto/);
});

test("result tables keep cross-elevation duplicate rows uniquely keyed", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /materials\.map\(\(row, index\).*?key=\{`material-\$\{index\}-\$\{row\.item\}-\$\{row\.spec\}`\}/s);
  assert.match(source, /hardware\.map\(\(row, index\).*?key=\{`hardware-\$\{index\}-\$\{row\.item\}-\$\{row\.unit\}`\}/s);
});
