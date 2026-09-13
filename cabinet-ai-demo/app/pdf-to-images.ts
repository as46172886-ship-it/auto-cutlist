import { extractAxisAlignedPdfLines, type DocumentEvidence, type PdfTextRunEvidence } from "./document-evidence";

export type PdfPageImage = { name: string; dataUrl: string; documentEvidence: DocumentEvidence };

function textRunEvidence(item: unknown, pageBox: [number, number, number, number]): PdfTextRunEvidence | null {
  if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) return null;
  const typed = item as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
  const text = String(typed.str || "").trim();
  const transform = Array.isArray(typed.transform) || ArrayBuffer.isView(typed.transform)
    ? Array.from(typed.transform as ArrayLike<number>, Number)
    : [];
  if (!text || transform.length < 6) return null;
  const [left, bottom, right, top] = pageBox;
  const pageWidth = Math.max(1, right - left);
  const pageHeight = Math.max(1, top - bottom);
  const rotationDeg = Math.round(Math.atan2(transform[1], transform[0]) * 180 / Math.PI);
  return {
    text: text.slice(0, 160),
    x: Math.max(0, Math.min(1000, Math.round((transform[4] - left) / pageWidth * 1000))),
    y: Math.max(0, Math.min(1000, Math.round((top - transform[5]) / pageHeight * 1000))),
    width: Math.max(0, Math.min(1000, Math.round(Number(typed.width || 0) / pageWidth * 1000))),
    height: Math.max(0, Math.min(1000, Math.round(Number(typed.height || Math.hypot(transform[2], transform[3])) / pageHeight * 1000))),
    rotationDeg,
  };
}

export async function pdfFileToImages(file: File, maxPages = 6): Promise<PdfPageImage[]> {
  const { GlobalWorkerOptions, getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await getDocument({ data: bytes }).promise;
  const images: PdfPageImage[] = [];
  const pageCount = Math.min(maxPages, document.numPages);
  for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
    const page = await document.getPage(pageNo);
    const pageBox = page.view.slice(0, 4).map(Number) as [number, number, number, number];
    const [textContent, operatorList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    const textRuns = textContent.items.map((item) => textRunEvidence(item, pageBox)).filter((item): item is PdfTextRunEvidence => Boolean(item)).slice(0, 1_200);
    const extractedText = textRuns.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim().slice(0, 16_000);
    const vectors = extractAxisAlignedPdfLines(operatorList, OPS, pageBox);
    const initial = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 2600 / Math.max(initial.width, initial.height));
    const viewport = page.getViewport({ scale: Math.max(1.5, scale) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("瀏覽器無法建立PDF頁面畫布。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const name = `${file.name}#第${pageNo}頁`;
    images.push({
      name,
      dataUrl: canvas.toDataURL("image/jpeg", 0.96),
      documentEvidence: {
        imageName: name,
        sourceKind: textRuns.length >= 3 || vectors.vectorPathCount >= 12 ? "vector_pdf" : "raster_pdf",
        extractor: "pdfjs_text_and_paths",
        pageWidth: Math.round(pageBox[2] - pageBox[0]),
        pageHeight: Math.round(pageBox[3] - pageBox[1]),
        extractedText,
        textRuns,
        axisLines: vectors.axisLines,
        vectorPathCount: vectors.vectorPathCount,
      },
    });
  }
  return images;
}
