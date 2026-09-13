import type { SourceImage } from "./image-crop";
import type { CabinetCropInput } from "./segmentation";

type Mode = "ocr_gray" | "line_binary";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("無法建立掃描增強圖。"));
    image.src = dataUrl;
  });
}

export function histogramLevelBounds(histogram: ArrayLike<number>, total: number, lowRatio = 0.008, highRatio = 0.99) {
  const lowTarget = total * lowRatio;
  const highTarget = total * highRatio;
  let cumulative = 0;
  let low = 0;
  let high = 255;
  for (let value = 0; value < 256; value += 1) {
    cumulative += Number(histogram[value] || 0);
    if (cumulative >= lowTarget) { low = value; break; }
  }
  cumulative = 0;
  for (let value = 0; value < 256; value += 1) {
    cumulative += Number(histogram[value] || 0);
    if (cumulative >= highTarget) { high = value; break; }
  }
  if (high - low < 36) return { low: Math.max(0, low - 18), high: Math.min(255, high + 18) };
  return { low, high };
}

export function adaptiveLinePixels(gray: Uint8ClampedArray, width: number, height: number, radius: number, bias = 10) {
  const stride = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let row = 0;
    for (let x = 1; x <= width; x += 1) {
      row += gray[(y - 1) * width + x - 1];
      integral[y * stride + x] = integral[(y - 1) * stride + x] + row;
    }
  }
  const output = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const sum = integral[(bottom + 1) * stride + right + 1] - integral[top * stride + right + 1]
        - integral[(bottom + 1) * stride + left] + integral[top * stride + left];
      const count = (right - left + 1) * (bottom - top + 1);
      output[y * width + x] = gray[y * width + x] < sum / count - bias ? 0 : 255;
    }
  }
  return output;
}

export function lineEnhancementInkRatio(binary: ArrayLike<number>) {
  if (!binary.length) return 0;
  let ink = 0;
  for (let index = 0; index < binary.length; index += 1) if (Number(binary[index]) < 128) ink += 1;
  return ink / binary.length;
}

export function lineEnhancementLooksUsable(binary: ArrayLike<number>) {
  const ratio = lineEnhancementInkRatio(binary);
  return ratio >= 0.002 && ratio <= 0.45;
}

export function scanEncodingForMode(mode: Mode) {
  return mode === "line_binary" ? "image/png" : "image/jpeg";
}

async function enhancedDataUrl(dataUrl: string, mode: Mode, maxSideOverride?: number, qualityOverride?: number) {
  const image = await loadImage(dataUrl);
  const maxSide = maxSideOverride || (mode === "line_binary" ? 1800 : 2200);
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("瀏覽器無法建立掃描增強畫布。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8ClampedArray(canvas.width * canvas.height);
  const histogram = new Uint32Array(256);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    const value = Math.round(pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114);
    gray[index] = value;
    histogram[value] += 1;
  }
  const { low, high } = histogramLevelBounds(histogram, gray.length);
  const range = Math.max(1, high - low);
  for (let index = 0; index < gray.length; index += 1) gray[index] = clamp(Math.round((gray[index] - low) * 255 / range), 0, 255);
  const output = mode === "line_binary"
    ? adaptiveLinePixels(gray, canvas.width, canvas.height, clamp(Math.round(Math.min(canvas.width, canvas.height) / 55), 10, 30), 11)
    : gray;
  if (mode === "line_binary" && !lineEnhancementLooksUsable(output)) throw new Error("線稿增強密度異常，保留原始裁切。");
  for (let index = 0; index < output.length; index += 1) {
    const offset = index * 4;
    const value = output[index];
    pixels.data[offset] = value;
    pixels.data[offset + 1] = value;
    pixels.data[offset + 2] = value;
    pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const encoding = scanEncodingForMode(mode);
  return encoding === "image/png"
    ? canvas.toDataURL(encoding)
    : canvas.toDataURL(encoding, qualityOverride ?? 0.94);
}

/**
 * W/H/D only needs dimension text and cabinet boundaries.  A bounded grayscale
 * copy reaches the model much faster than the high-quality source while the
 * original remains available to the later, per-cabinet structure passes.
 */
export async function createCarcassScanImages(images: SourceImage[], profile: "primary" | "retry" = "primary") {
  const maxSide = profile === "primary" ? 1800 : 1300;
  const quality = profile === "primary" ? 0.9 : 0.82;
  return await Promise.all(images.map(async (image) => {
    try {
      return { name: image.name, dataUrl: await enhancedDataUrl(image.dataUrl, "ocr_gray", maxSide, quality) };
    } catch {
      return image;
    }
  }));
}

/** Full-page grayscale copy for notes, mirrors, kickboards and independent pieces. */
export async function createOverviewEnhancements(images: SourceImage[], limit = 3) {
  const enhanced: SourceImage[] = [];
  for (const image of images.slice(0, limit)) {
    try {
      enhanced.push({ name: `${image.name}#OCR灰階增強`, dataUrl: await enhancedDataUrl(image.dataUrl, "ocr_gray") });
    } catch {
      // Raw input remains available; preprocessing failure must never block a scan.
    }
  }
  return enhanced;
}

/** One line-emphasized copy per cabinet; raw crop is always sent beside it. */
export async function createCabinetEnhancements(crops: CabinetCropInput[]) {
  const enhanced: CabinetCropInput[] = [];
  const used = new Set<string>();
  for (const crop of crops) {
    if (used.has(crop.cabinetId)) continue;
    used.add(crop.cabinetId);
    try {
      enhanced.push({
        ...crop,
        name: `${crop.name}#線稿增強`,
        dataUrl: await enhancedDataUrl(crop.dataUrl, "line_binary"),
        focus: `${crop.focus || crop.region}；自適應二值化線稿，需與原始裁切交叉核對`,
      });
    } catch {
      // Raw crop remains available.
    }
  }
  return enhanced;
}
