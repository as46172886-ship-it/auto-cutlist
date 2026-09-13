import type { CabinetCropInput, NormalizedCropBox, SegmentationPlan } from "./segmentation";
import { colorMarkerComponents, mergeNearbyMarkerFragments, reliableSlantedHandleMarkerCount } from "./slanted-handle-audit.ts";

export type SourceImage = { name: string; dataUrl: string };
type PixelCrop = { x: number; y: number; width: number; height: number };
type RelativeFocusBox = { focus: string; x: number; y: number; width: number; height: number };
type DetectedCabinetFrame = { boundariesPx: number[]; score: number; exteriorLeftLinePx?: number; exteriorRightLinePx?: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizedCropToPixels(box: NormalizedCropBox, imageWidth: number, imageHeight: number, paddingRatio = 0.012): PixelCrop {
  const x = clamp(Number(box.x) || 0, 0, 1000);
  const y = clamp(Number(box.y) || 0, 0, 1000);
  const width = clamp(Number(box.width) || 1, 1, 1000 - x);
  const height = clamp(Number(box.height) || 1, 1, 1000 - y);
  const rawX = imageWidth * x / 1000;
  const rawY = imageHeight * y / 1000;
  const rawWidth = imageWidth * width / 1000;
  const rawHeight = imageHeight * height / 1000;
  const padX = rawWidth * paddingRatio;
  const padY = rawHeight * paddingRatio;
  const left = clamp(Math.floor(rawX - padX), 0, imageWidth - 1);
  const top = clamp(Math.floor(rawY - padY), 0, imageHeight - 1);
  const right = clamp(Math.ceil(rawX + rawWidth + padX), left + 1, imageWidth);
  const bottom = clamp(Math.ceil(rawY + rawHeight + padY), top + 1, imageHeight);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("無法在瀏覽器開啟裁切來源圖片。"));
    image.src = dataUrl;
  });
}

function uprightCanvas(image: HTMLImageElement, rotation: 0 | 90 | 180 | 270) {
  const swap = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? image.naturalHeight : image.naturalWidth;
  canvas.height = swap ? image.naturalWidth : image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("瀏覽器無法建立圖面裁切畫布。");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (rotation === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(image, 0, 0);
  return canvas;
}

const ORIENTATION_CANDIDATES = [0, 90, 180, 270] as const;

/**
 * Put all four pixel rotations on one fixed, upright sheet. Vision models may
 * auto-orient a lone photograph before reasoning, which erases the distinction
 * between the source pixels and an upright view. The fixed labels on this
 * sheet survive that preprocessing and let the model return the exact source
 * rotation needed by the later crop code.
 */
export async function createOrientationGuides(images: SourceImage[]) {
  return await Promise.all(images.map(async (source) => {
    const image = await loadImage(source.dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = 1800;
    canvas.height = 1800;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("瀏覽器無法建立四方向候選畫布。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const cellWidth = canvas.width / 2;
    const cellHeight = canvas.height / 2;
    for (let index = 0; index < ORIENTATION_CANDIDATES.length; index += 1) {
      const rotation = ORIENTATION_CANDIDATES[index];
      const column = index % 2;
      const row = Math.floor(index / 2);
      const cellX = column * cellWidth;
      const cellY = row * cellHeight;
      context.strokeStyle = "#1d3f34";
      context.lineWidth = 8;
      context.strokeRect(cellX + 12, cellY + 12, cellWidth - 24, cellHeight - 24);
      context.fillStyle = "#102f27";
      context.font = "700 42px sans-serif";
      context.fillText(`候選：原圖順時針 ${rotation}°`, cellX + cellWidth / 2, cellY + 60);

      const candidate = uprightCanvas(image, rotation);
      const maxWidth = cellWidth - 80;
      const maxHeight = cellHeight - 150;
      const scale = Math.min(maxWidth / candidate.width, maxHeight / candidate.height);
      const drawWidth = Math.max(1, Math.round(candidate.width * scale));
      const drawHeight = Math.max(1, Math.round(candidate.height * scale));
      const drawX = cellX + (cellWidth - drawWidth) / 2;
      const drawY = cellY + 110 + (maxHeight - drawHeight) / 2;
      context.drawImage(candidate, drawX, drawY, drawWidth, drawHeight);
    }

    return { name: source.name, dataUrl: canvas.toDataURL("image/jpeg", 0.94) };
  }));
}

/** Apply the locked pixel rotation before the focused W/H/D scan. */
export async function createUprightImages(
  images: SourceImage[],
  rotations: Array<{ imageName: string; rotationToUprightDeg: 0 | 90 | 180 | 270 }>,
) {
  const rotationByName = new Map(rotations.map((item) => [item.imageName, item.rotationToUprightDeg] as const));
  return await Promise.all(images.map(async (source) => {
    const image = await loadImage(source.dataUrl);
    const canvas = uprightCanvas(image, rotationByName.get(source.name) || 0);
    const longest = Math.max(canvas.width, canvas.height);
    if (longest <= 2600) return { name: source.name, dataUrl: canvas.toDataURL("image/jpeg", 0.96) };
    const scale = 2600 / longest;
    const reduced = document.createElement("canvas");
    reduced.width = Math.max(1, Math.round(canvas.width * scale));
    reduced.height = Math.max(1, Math.round(canvas.height * scale));
    const context = reduced.getContext("2d");
    if (!context) throw new Error("瀏覽器無法建立旋正圖面畫布。");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(canvas, 0, 0, reduced.width, reduced.height);
    return { name: source.name, dataUrl: reduced.toDataURL("image/jpeg", 0.96) };
  }));
}

/**
 * Select the complete cabinet run from a one-dimensional vertical-line score.
 * The AI supplies the bottom width chain, but its crop coordinates are only a
 * rough hint.  We therefore search the actual upright pixels for two outer
 * boundaries whose intervening side-panel lines agree with every cumulative
 * width ratio.  This prevents a consistently shifted AI box from assigning a
 * neighbouring cabinet's shelves or door symbol to the wrong cabinet.
 */
export function selectCabinetFrameFromVerticalScores(scores: number[], cabinetWidthsMm: number[]): DetectedCabinetFrame | null {
  if (scores.length < 40 || cabinetWidthsMm.length < 2 || cabinetWidthsMm.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const totalWidth = cabinetWidthsMm.reduce((sum, value) => sum + value, 0);
  if (!(totalWidth > 0)) return null;
  const ratios = [0];
  let cumulative = 0;
  for (const width of cabinetWidthsMm) {
    cumulative += width;
    ratios.push(cumulative / totalWidth);
  }

  const suppressionRadius = Math.max(4, Math.round(scores.length / 220));
  const ranked = scores.map((score, index) => ({ index, score })).sort((a, b) => b.score - a.score);
  const candidates: number[] = [];
  for (const item of ranked) {
    if (item.score <= 0) break;
    if (candidates.every((candidate) => Math.abs(candidate - item.index) > suppressionRadius)) candidates.push(item.index);
    if (candidates.length >= 72) break;
  }
  if (candidates.length < ratios.length) return null;

  const strongest = Math.max(...scores);
  const localPeak = (position: number, radius: number) => {
    const start = Math.max(0, Math.round(position) - radius);
    const end = Math.min(scores.length - 1, Math.round(position) + radius);
    let bestIndex = start;
    for (let index = start + 1; index <= end; index += 1) {
      if (scores[index] > scores[bestIndex]) bestIndex = index;
    }
    return { index: bestIndex, score: scores[bestIndex], offset: Math.abs(bestIndex - position) };
  };

  let best: { score: number; boundariesPx: number[]; strengths: number[] } | null = null;
  for (const left of candidates) {
    for (const right of candidates) {
      const span = right - left;
      if (span < scores.length * 0.25) continue;
      const searchRadius = Math.max(6, Math.round(span * 0.02));
      const peaks = ratios.map((ratio) => localPeak(left + ratio * span, searchRadius));
      const boundariesPx = [left, ...peaks.slice(1, -1).map((peak) => peak.index), right];
      if (boundariesPx.some((value, index) => index > 0 && value <= boundariesPx[index - 1] + 2)) continue;
      const strengths = peaks.map((peak) => peak.score);
      const offsetPenalty = peaks.reduce((sum, peak) => sum + peak.offset, 0) * 2;
      const score = strengths[0] * 1.5 + strengths.at(-1)! * 1.5
        + strengths.slice(1, -1).reduce((sum, value) => sum + value, 0) - offsetPenalty;
      if (!best || score > best.score) best = { score, boundariesPx, strengths };
    }
  }
  if (!best) return null;
  const internalStrengths = best.strengths.slice(1, -1);
  if (best.strengths[0] < strongest * 0.42 || best.strengths.at(-1)! < strongest * 0.42) return null;
  if (internalStrengths.some((value) => value < strongest * 0.16)) return null;
  const frameSpan = best.boundariesPx.at(-1)! - best.boundariesPx[0];
  const neighbourWindow = frameSpan * 0.08;
  const minimumNeighbourGap = suppressionRadius * 1.5;
  const exteriorLeftLinePx = candidates
    .filter((candidate) => candidate < best!.boundariesPx[0] - minimumNeighbourGap && candidate >= best!.boundariesPx[0] - neighbourWindow && scores[candidate] >= strongest * 0.4)
    .sort((a, b) => scores[b] - scores[a])[0];
  const exteriorRightLinePx = candidates
    .filter((candidate) => candidate > best!.boundariesPx.at(-1)! + minimumNeighbourGap && candidate <= best!.boundariesPx.at(-1)! + neighbourWindow && scores[candidate] >= strongest * 0.4)
    .sort((a, b) => scores[b] - scores[a])[0];
  return { boundariesPx: best.boundariesPx, score: best.score, exteriorLeftLinePx, exteriorRightLinePx };
}

function verticalLineScores(source: HTMLCanvasElement, plannedBoxes: NormalizedCropBox[]) {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const plannedTop = Math.min(...plannedBoxes.map((box) => box.y));
  const plannedBottom = Math.max(...plannedBoxes.map((box) => box.y + box.height));
  let top = Math.floor(source.height * clamp((plannedTop - 35) / 1000, 0.04, 0.9));
  let bottom = Math.ceil(source.height * clamp((plannedBottom + 35) / 1000, 0.1, 0.96));
  if (bottom - top < source.height * 0.25) {
    top = Math.floor(source.height * 0.1);
    bottom = Math.ceil(source.height * 0.9);
  }
  const height = Math.max(1, bottom - top);
  const pixels = context.getImageData(0, top, source.width, height).data;
  const scores = Array.from({ length: source.width }, () => 0);
  for (let x = 0; x < source.width; x += 1) {
    let run = 0;
    let longestRun = 0;
    let gap = 0;
    let darkCount = 0;
    for (let y = 0; y < height; y += 1) {
      let darkest = 255;
      for (let dx = -1; dx <= 1; dx += 1) {
        const sampleX = clamp(x + dx, 0, source.width - 1);
        const offset = (y * source.width + sampleX) * 4;
        const gray = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
        darkest = Math.min(darkest, gray);
      }
      if (darkest < 135) {
        run += gap + 1;
        gap = 0;
        darkCount += 1;
      } else if (run > 0 && gap < 3) {
        gap += 1;
      } else {
        longestRun = Math.max(longestRun, run);
        run = 0;
        gap = 0;
      }
    }
    scores[x] = Math.max(longestRun, run) + darkCount * 0.15;
  }
  return scores;
}

async function detectedHorizontalSpans(
  plan: SegmentationPlan,
  sourceByName: Map<string, SourceImage>,
  getUpright: (image: SourceImage, rotation: 0 | 90 | 180 | 270) => Promise<HTMLCanvasElement>,
) {
  const spans = new Map<string, { x: number; width: number; edgeHint?: string }>();
  const groups = new Map<string, Array<{ cabinet: SegmentationPlan["cabinets"][number]; boxes: NormalizedCropBox[]; rotation: 0 | 90 | 180 | 270; sourceImageName: string }>>();
  for (const cabinet of plan.cabinets) {
    const bySource = new Map<string, { boxes: NormalizedCropBox[]; rotation: 0 | 90 | 180 | 270; sourceImageName: string }>();
    for (const crop of cabinet.sourceCrops) {
      const key = `${crop.sourceImageName}:${crop.rotationToUprightDeg}`;
      const current = bySource.get(key) || { boxes: [], rotation: crop.rotationToUprightDeg, sourceImageName: crop.sourceImageName };
      current.boxes.push(crop.box);
      bySource.set(key, current);
    }
    for (const [sourceRotation, value] of bySource) {
      const groupKey = `${cabinet.elevationId}:${sourceRotation}`;
      const current = groups.get(groupKey) || [];
      current.push({ cabinet, boxes: value.boxes, rotation: value.rotation, sourceImageName: value.sourceImageName });
      groups.set(groupKey, current);
    }
  }

  for (const group of groups.values()) {
    const ordered = group.sort((a, b) => a.cabinet.widthOrder - b.cabinet.widthOrder);
    if (ordered.length < 2 || ordered.some((entry) => !(entry.cabinet.bottomSegmentMm > 0))) continue;
    const sourceImageName = ordered[0].sourceImageName;
    const source = sourceByName.get(sourceImageName);
    if (!source) continue;
    const upright = await getUpright(source, ordered[0].rotation);
    const boxes = ordered.flatMap((entry) => entry.boxes);
    const frame = selectCabinetFrameFromVerticalScores(verticalLineScores(upright, boxes), ordered.map((entry) => entry.cabinet.bottomSegmentMm));
    if (!frame || frame.boundariesPx.length !== ordered.length + 1) continue;
    ordered.forEach((entry, index) => {
      const left = frame.boundariesPx[index];
      const right = frame.boundariesPx[index + 1];
      const padding = Math.max(6, (right - left) * 0.035);
      const paddedLeft = clamp(left - padding, 0, upright.width - 1);
      const paddedRight = clamp(right + padding, paddedLeft + 1, upright.width);
      spans.set(`${sourceImageName}:${entry.rotation}:${entry.cabinet.elevationId}:${entry.cabinet.cabinetId}`, {
        x: paddedLeft / upright.width * 1000,
        width: (paddedRight - paddedLeft) / upright.width * 1000,
        edgeHint: index === 0 && frame.exteriorLeftLinePx !== undefined
          ? "左外側另有一條與櫃身分離的全高牆／收口線；依R34建立1片標準填縫板：100×相鄰桶身外高，不含腳高與上方留空；圖面明標其他寬時優先"
          : index === ordered.length - 1 && frame.exteriorRightLinePx !== undefined
            ? "右外側另有一條與櫃身分離的全高牆／收口線；依R34建立1片標準填縫板：100×相鄰桶身外高，不含腳高與上方留空；圖面明標其他寬時優先"
            : undefined,
      });
    });
  }
  return spans;
}

export function emphasizeDiagonalDoorGeometry(data: Uint8ClampedArray, width: number, height: number) {
  if (width < 9 || height < 9 || data.length < width * height * 4) return data;
  const darkNeutral = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (gray < 175 && chroma < 60) darkNeutral[pixel] = 1;
  }

  const kept = new Uint8Array(width * height);
  const isDark = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && darkNeutral[y * width + x] === 1;
  const support = (x: number, y: number, dx: number, dy: number) => {
    let positive = 0;
    let negative = 0;
    const perpendicularX = Math.sign(-dy);
    const perpendicularY = Math.sign(dx);
    for (let step = 1; step <= 4; step += 1) {
      for (let offset = -1; offset <= 1; offset += 1) {
        if (isDark(x + dx * step + perpendicularX * offset, y + dy * step + perpendicularY * offset)) {
          positive += 1;
          break;
        }
      }
      for (let offset = -1; offset <= 1; offset += 1) {
        if (isDark(x - dx * step + perpendicularX * offset, y - dy * step + perpendicularY * offset)) {
          negative += 1;
          break;
        }
      }
    }
    return positive >= 2 && negative >= 2 ? positive + negative : 0;
  };
  const diagonalDirections = [[1, 1], [2, 1], [1, 2]] as const;
  for (let y = 5; y < height - 5; y += 1) {
    for (let x = 5; x < width - 5; x += 1) {
      const pixel = y * width + x;
      if (!darkNeutral[pixel]) continue;
      const diagonal = Math.max(...diagonalDirections.flatMap(([dx, dy]) => [support(x, y, dx, dy), support(x, y, dx, -dy)]));
      const orthogonal = Math.max(support(x, y, 1, 0), support(x, y, 0, 1));
      if (diagonal >= 5 && diagonal >= orthogonal + 1) kept[pixel] = 1;
    }
  }

  const keptCount = kept.reduce((total, value) => total + value, 0);
  const minimumEvidence = Math.max(12, Math.round(width * height * 0.0002));
  const maximumEvidence = Math.round(width * height * 0.09);
  // Fail closed: a nearly empty mask has no usable chevron, while a flooded
  // mask is usually page skew, texture or compression noise. Keep the normal
  // high-contrast crop in either case so the next AI pass never sees a blank
  // or misleading replacement image.
  if (keptCount < minimumEvidence || keptCount > maximumEvidence) return data;

  // A one-pixel halo keeps thin, broken door chevrons visible after PNG
  // resampling, while the source crop remains the authority for final proof.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let highlighted = false;
      for (let dy = -1; dy <= 1 && !highlighted; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sampleX = x + dx;
          const sampleY = y + dy;
          if (sampleX >= 0 && sampleX < width && sampleY >= 0 && sampleY < height && kept[sampleY * width + sampleX]) {
            highlighted = true;
            break;
          }
        }
      }
      const offset = (y * width + x) * 4;
      const value = highlighted ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }
  return data;
}

function enlargedCrop(source: HTMLCanvasElement, box: NormalizedCropBox, scanPass: 1 | 2 | 3, diagonalDoorGeometry = false) {
  const crop = normalizedCropToPixels(box, source.width, source.height);
  const longest = Math.max(crop.width, crop.height);
  const targetLongest = diagonalDoorGeometry ? 1500 : scanPass === 1 ? 1900 : scanPass === 2 ? 2200 : 2400;
  const allowedScale = diagonalDoorGeometry ? 2.6 : scanPass === 1 ? 2.8 : scanPass === 2 ? 3.6 : 4.2;
  const maxLongest = diagonalDoorGeometry ? 1800 : scanPass === 1 ? 2400 : scanPass === 2 ? 2600 : 2800;
  const scale = clamp(targetLongest / Math.max(1, longest), 1, allowedScale);
  const maxScale = maxLongest / Math.max(1, longest);
  const finalScale = Math.min(scale, maxScale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width * finalScale));
  canvas.height = Math.max(1, Math.round(crop.height * finalScale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("瀏覽器無法建立放大裁切畫布。");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  if (scanPass > 1) {
    // Printed < / > marks are often only one or two pixels wide in a phone
    // photo. Preserve them as PNG and raise line contrast for the focused
    // passes instead of repeatedly feeding the model a softened JPEG.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const red = pixels.data[index];
      const green = pixels.data[index + 1];
      const blue = pixels.data[index + 2];
      const gray = red * 0.299 + green * 0.587 + blue * 0.114;
      const contrasted = clamp((gray - 128) * 1.65 + 128, 0, 255);
      const lineEnhanced = contrasted < 205 ? contrasted * 0.78 : Math.min(255, contrasted * 1.04);
      pixels.data[index] = lineEnhanced;
      pixels.data[index + 1] = lineEnhanced;
      pixels.data[index + 2] = lineEnhanced;
    }
    if (diagonalDoorGeometry) emphasizeDiagonalDoorGeometry(pixels.data, canvas.width, canvas.height);
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png");
  }
  return canvas.toDataURL("image/jpeg", 0.96);
}

export function isChromaticRedDimensionPixel(red: number, green: number, blue: number) {
  return red - green >= 10 && red - blue >= 8 && red >= 75;
}

/**
 * Keep the ordinary crop as the visual authority, then add this dimension-only
 * auxiliary view. Printed red/magenta dimension rules are whitened while the
 * neutral black numerals and cabinet geometry remain untouched. This prevents
 * a long dimension rule from joining several digits into one OCR/vision shape.
 */
function redSuppressedDimensionCrop(source: HTMLCanvasElement, box: NormalizedCropBox) {
  const crop = normalizedCropToPixels(box, source.width, source.height);
  const longest = Math.max(crop.width, crop.height);
  const scale = Math.min(clamp(1900 / Math.max(1, longest), 1, 2.8), 2400 / Math.max(1, longest));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("瀏覽器無法建立尺寸線分離畫布。");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    if (!isChromaticRedDimensionPixel(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2])) continue;
    pixels.data[index] = 255;
    pixels.data[index + 1] = 255;
    pixels.data[index + 2] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

function slantedHandleMarkerEvidence(source: HTMLCanvasElement, box: NormalizedCropBox, cabinetId: string, sourceImageName: string) {
  const crop = normalizedCropToPixels(box, source.width, source.height, 0);
  const maxSide = 1200;
  const scale = Math.min(1, maxSide / Math.max(crop.width, crop.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const fragments = colorMarkerComponents(pixels, canvas.width, canvas.height);
  const maxGap = clamp(Math.round(Math.min(canvas.width, canvas.height) / 90), 3, 12);
  const merged = mergeNearbyMarkerFragments(fragments, maxGap);
  const result = reliableSlantedHandleMarkerCount(merged);
  if (!result.count) return undefined;
  return {
    cabinetId,
    count: result.count,
    reliable: result.reliable,
    sourceImageName,
    bluePixels: result.bluePixels,
    yellowPixels: result.yellowPixels,
    evidence: `${cabinetId}門面彩色小標記${result.count}個；僅供斜把交叉核對`,
  };
}

export function doorScanTilesForPass(scanPass: 1 | 2 | 3, diagonalDoorGeometry = false): RelativeFocusBox[] {
  if (scanPass === 1) return [{ focus: "全桶", x: 0, y: 0, width: 1, height: 1 }];
  if (scanPass === 2 && diagonalDoorGeometry) return [{ focus: "全桶門向", x: 0, y: 0, width: 1, height: 1 }];
  if (scanPass === 2) return [
    { focus: "上半部", x: 0, y: 0, width: 1, height: 0.58 },
    { focus: "下半部", x: 0, y: 0.42, width: 1, height: 0.58 },
  ];
  return [
    { focus: "左上", x: 0, y: 0, width: 0.58, height: 0.58 },
    { focus: "右上", x: 0.42, y: 0, width: 0.58, height: 0.58 },
    { focus: "左下", x: 0, y: 0.42, width: 0.58, height: 0.58 },
    { focus: "右下", x: 0.42, y: 0.42, width: 0.58, height: 0.58 },
  ];
}

export function subCropBox(box: NormalizedCropBox, focus: RelativeFocusBox): NormalizedCropBox {
  return {
    x: box.x + box.width * focus.x,
    y: box.y + box.height * focus.y,
    width: box.width * focus.width,
    height: box.height * focus.height,
  };
}

export async function createCabinetCrops(images: SourceImage[], plan: SegmentationPlan): Promise<CabinetCropInput[]> {
  const sourceByName = new Map(images.map((image) => [image.name, image]));
  const imageCache = new Map<string, Promise<HTMLImageElement>>();
  const uprightCache = new Map<string, Promise<HTMLCanvasElement>>();

  const getUpright = (image: SourceImage, rotation: 0 | 90 | 180 | 270) => {
    const key = `${image.name}:${rotation}`;
    let pending = uprightCache.get(key);
    if (!pending) {
      let loaded = imageCache.get(image.name);
      if (!loaded) {
        loaded = loadImage(image.dataUrl);
        imageCache.set(image.name, loaded);
      }
      pending = loaded.then((element) => uprightCanvas(element, rotation));
      uprightCache.set(key, pending);
    }
    return pending;
  };

  const horizontalSpans = await detectedHorizontalSpans(plan, sourceByName, getUpright);

  const crops: CabinetCropInput[] = [];
  for (const cabinet of plan.cabinets) {
    const focusKeys = new Set(cabinet.sourceCrops
      .filter((crop) => crop.role === "door" || crop.role === "front" || crop.role === "internal")
      .sort((a, b) => ({ door: 0, front: 1, internal: 2 }[a.role as "door" | "front" | "internal"] ?? 9) - ({ door: 0, front: 1, internal: 2 }[b.role as "door" | "front" | "internal"] ?? 9))
      .slice(0, 2)
      .map((crop) => `${crop.sourceImageName}:${crop.cropId}`));
    for (const planned of cabinet.sourceCrops) {
      const source = sourceByName.get(planned.sourceImageName);
      if (!source) continue;
      const upright = await getUpright(source, planned.rotationToUprightDeg);
      const detected = horizontalSpans.get(`${planned.sourceImageName}:${planned.rotationToUprightDeg}:${cabinet.elevationId}:${cabinet.cabinetId}`);
      const correctedBox = detected ? { ...planned.box, x: detected.x, width: detected.width } : planned.box;
      const markerEvidence = (planned.role === "door" || planned.role === "front")
        ? slantedHandleMarkerEvidence(upright, correctedBox, cabinet.cabinetId, planned.sourceImageName)
        : undefined;
      const passes: Array<1 | 2 | 3> = [1];
      if (focusKeys.has(`${planned.sourceImageName}:${planned.cropId}`)) passes.push(2, 3);
      for (const scanPass of passes) {
        const diagonalDoorGeometry = scanPass === 2 && (planned.role === "door" || planned.role === "front");
        for (const focus of doorScanTilesForPass(scanPass, diagonalDoorGeometry)) {
          const focusKey = focus.focus.replaceAll("部", "");
          crops.push({
            name: `${cabinet.cabinetId}__${planned.role}__${planned.cropId}__p${scanPass}_${focusKey}.${scanPass === 1 ? "jpg" : "png"}`,
            dataUrl: enlargedCrop(upright, subCropBox(correctedBox, focus), scanPass, diagonalDoorGeometry),
            cabinetId: cabinet.cabinetId,
            cropId: `${planned.cropId}__p${scanPass}_${focusKey}`,
            role: planned.role,
            sourceImageName: planned.sourceImageName,
            region: detected ? `${planned.region}（左右框已依實際側板線與底寬比例校正${detected.edgeHint ? `；${detected.edgeHint}` : ""}）` : planned.region,
            scanPass,
            focus: scanPass === 1 ? focus.focus : diagonalDoorGeometry
              ? `${focus.focus}（門向輔助圖；斜線證據不足或氾濫時自動退回高對比，須與原始裁切交叉核對）`
              : `${focus.focus}（線稿增強）`,
            slantedHandleMarkerEvidence: scanPass === 1 ? markerEvidence : undefined,
          });
          if (scanPass === 1 && planned.role === "dimension") {
            crops.push({
              name: `${cabinet.cabinetId}__dimension__${planned.cropId}__p1_redless.png`,
              dataUrl: redSuppressedDimensionCrop(upright, correctedBox),
              cabinetId: cabinet.cabinetId,
              cropId: `${planned.cropId}__p1_redless`,
              role: planned.role,
              sourceImageName: planned.sourceImageName,
              region: `${planned.region}（紅色尺寸線已移除；需與原始裁切交叉核對）`,
              scanPass: 1,
              focus: "尺寸數字輔助圖（紅線移除、黑字保留）",
            });
          }
        }
      }
    }
  }
  return crops;
}
