import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenAIResponse, safeResponseDiagnostics } from "../app/api/analyze/openai-response.ts";
import { structuredImageContent } from "../app/api/analyze/image-content.ts";

test("extracts structured text from a completed response", () => {
  const raw = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{\"cabinets\":[]}" }] }] };
  assert.deepEqual(parseOpenAIResponse(raw), { ok: true, text: "{\"cabinets\":[]}" });
});

test("marks output-token exhaustion as retryable", () => {
  const result = parseOpenAIResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "output_limit");
  assert.equal(result.retryable, true);
});

test("handles refusal without retrying", () => {
  const result = parseOpenAIResponse({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "refusal");
  assert.equal(result.retryable, false);
});

test("does not leak text through diagnostics", () => {
  const diagnostics = safeResponseDiagnostics({ id: "resp_1", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "secret drawing" }] }], usage: { input_tokens: 10, output_tokens: 5, output_tokens_details: { reasoning_tokens: 2 } } });
  assert.equal(JSON.stringify(diagnostics).includes("secret drawing"), false);
  assert.deepEqual(diagnostics.contentTypes, ["output_text"]);
});

test("uses original detail only when a focused scan explicitly requests it", () => {
  const images = [{ dataUrl: "data:image/png;base64,AA==" }];
  assert.equal(structuredImageContent(images)[0].detail, "high");
  assert.equal(structuredImageContent(images, "original")[0].detail, "original");
});
