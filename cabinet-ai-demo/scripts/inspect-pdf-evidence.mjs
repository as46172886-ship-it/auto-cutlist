import { readFile } from "node:fs/promises";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractAxisAlignedPdfLines } from "../app/document-evidence.ts";

const pdfPath = process.argv[2];
if (!pdfPath) throw new Error("usage: node scripts/inspect-pdf-evidence.mjs <file.pdf>");
const bytes = new Uint8Array(await readFile(pdfPath));
const document = await getDocument({ data: bytes, disableWorker: true }).promise;
const pages = [];
for (let pageNo = 1; pageNo <= document.numPages; pageNo += 1) {
  const page = await document.getPage(pageNo);
  const pageBox = page.view.slice(0, 4).map(Number);
  const [text, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  const strings = text.items.flatMap((item) => item && typeof item === "object" && "str" in item ? [String(item.str).trim()] : []).filter(Boolean);
  const vectors = extractAxisAlignedPdfLines(operators, OPS, pageBox);
  pages.push({
    pageNo,
    textRunCount: strings.length,
    extractedText: strings.join(" ").replace(/\s+/g, " ").slice(0, 2_000),
    vectorPathCount: vectors.vectorPathCount,
    horizontalLineCount: vectors.axisLines.filter((line) => line.axis === "horizontal").length,
    verticalLineCount: vectors.axisLines.filter((line) => line.axis === "vertical").length,
    longestLines: vectors.axisLines.slice(0, 12),
  });
}
console.log(JSON.stringify({ pages }, null, 2));
