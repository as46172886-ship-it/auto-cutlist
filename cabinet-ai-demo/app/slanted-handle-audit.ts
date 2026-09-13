export type ColorMarkerComponent = {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
  bluePixels?: number;
  yellowPixels?: number;
};

export type SlantedHandleMarkerEvidence = {
  count: number;
  reliable: boolean;
  sourceImageName?: string;
  evidence?: string;
  bluePixels?: number;
  yellowPixels?: number;
};

export type CropMarkerEvidence = SlantedHandleMarkerEvidence & { cabinetId: string };

const rounded = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));

/**
 * Select blue/yellow/green machining marks while rejecting neutral drawing ink
 * and the red/magenta dimension rules handled by the dimension OCR helper.
 */
export function isSlantedHandleMarkerPixel(red: number, green: number, blue: number) {
  const highest = Math.max(red, green, blue);
  const lowest = Math.min(red, green, blue);
  const chroma = highest - lowest;
  // Red/magenta dimension ink keeps G and B near each other. A yellow handle
  // marker may also be red-dominant, but its blue channel is much lower.
  const redDimension = red - green >= 10 && red - blue >= 8 && red >= 75 && Math.abs(green - blue) <= 25;
  // Faded paper shadows are often mildly yellow (all channels still >150).
  // Requiring one genuinely darker channel keeps those photographs fail-closed.
  return chroma >= 14 && highest >= 70 && lowest <= 150 && !redDimension;
}

function slantedHandleMarkerPixelFamily(red: number, green: number, blue: number) {
  if (!isSlantedHandleMarkerPixel(red, green, blue)) return 0;
  const blueMarker = blue - Math.max(red, green) >= 6 || (blue - red >= 10 && blue - green >= 5);
  const yellowMarker = Math.min(red, green) - blue >= 8 && Math.abs(red - green) <= 30;
  return blueMarker ? 1 : yellowMarker ? 2 : 0;
}

const componentGap = (left: ColorMarkerComponent, right: ColorMarkerComponent) => {
  const x = Math.max(0, Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width));
  const y = Math.max(0, Math.max(left.y, right.y) - Math.min(left.y + left.height, right.y + right.height));
  return Math.hypot(x, y);
};

function combine(left: ColorMarkerComponent, right: ColorMarkerComponent): ColorMarkerComponent {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  const combined: ColorMarkerComponent = { x, y, width: rightEdge - x, height: bottomEdge - y, pixels: left.pixels + right.pixels };
  if (left.bluePixels !== undefined || right.bluePixels !== undefined) combined.bluePixels = rounded(left.bluePixels) + rounded(right.bluePixels);
  if (left.yellowPixels !== undefined || right.yellowPixels !== undefined) combined.yellowPixels = rounded(left.yellowPixels) + rounded(right.yellowPixels);
  return combined;
}

/** Merge anti-aliased fragments belonging to one printed triangle. */
export function mergeNearbyMarkerFragments(components: ColorMarkerComponent[], maxGapPx = 12) {
  const merged = components.filter((item) => item.pixels > 0 && item.width > 0 && item.height > 0).map((item) => ({ ...item }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let left = 0; left < merged.length; left += 1) {
      for (let right = left + 1; right < merged.length; right += 1) {
        if (componentGap(merged[left], merged[right]) > maxGapPx) continue;
        const smaller = Math.min(merged[left].pixels, merged[right].pixels);
        const larger = Math.max(merged[left].pixels, merged[right].pixels);
        // Merge a tiny anti-aliased satellite into its main triangle, but keep
        // two similarly sized neighbouring handle marks as separate evidence.
        if (smaller > 12 && smaller / larger > 0.25) continue;
        merged[left] = combine(merged[left], merged[right]);
        merged.splice(right, 1);
        changed = true;
        break outer;
      }
    }
  }
  return merged;
}

/** Extract sparse 8-connected color components without retaining image data. */
export function colorMarkerComponents(rgba: ArrayLike<number>, width: number, height: number) {
  const pixelCount = Math.max(0, Math.floor(width)) * Math.max(0, Math.floor(height));
  if (!pixelCount || rgba.length < pixelCount * 4) return [] as ColorMarkerComponent[];
  const mask = new Uint8Array(pixelCount);
  const family = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const red = Number(rgba[offset]);
    const green = Number(rgba[offset + 1]);
    const blue = Number(rgba[offset + 2]);
    if (isSlantedHandleMarkerPixel(red, green, blue)) mask[pixel] = 1;
    family[pixel] = slantedHandleMarkerPixelFamily(red, green, blue);
  }
  const queue = new Int32Array(pixelCount);
  const components: ColorMarkerComponent[] = [];
  for (let seed = 0; seed < pixelCount; seed += 1) {
    if (mask[seed] !== 1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    mask[seed] = 2;
    let minX = seed % width;
    let maxX = minX;
    let minY = Math.floor(seed / width);
    let maxY = minY;
    let bluePixels = 0;
    let yellowPixels = 0;
    while (head < tail) {
      const pixel = queue[head++];
      if (family[pixel] === 1) bluePixels += 1;
      if (family[pixel] === 2) yellowPixels += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
          const neighbour = (y + dy) * width + x + dx;
          if (mask[neighbour] !== 1) continue;
          mask[neighbour] = 2;
          queue[tail++] = neighbour;
        }
      }
    }
    components.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, pixels: tail, bluePixels, yellowPixels });
  }
  return components;
}

/**
 * Color is only accepted as evidence when several compact marks have similar
 * sizes. Paper tint, shadows and isolated dimension fragments fail closed.
 */
export function reliableSlantedHandleMarkerCount(components: ColorMarkerComponent[]) {
  const candidates = components.filter((item) => {
    const area = item.width * item.height;
    const fill = item.pixels / Math.max(1, area);
    const aspect = item.width / Math.max(1, item.height);
    return item.pixels >= 5 && area <= 2500 && fill >= 0.025 && aspect >= 0.18 && aspect <= 5.5;
  });
  if (candidates.length < 2) return { count: candidates.length, reliable: false };
  const areas = candidates.map((item) => item.width * item.height).sort((a, b) => a - b);
  const medianArea = areas[Math.floor(areas.length / 2)];
  const similarlySized = candidates.filter((item) => {
    const area = item.width * item.height;
    return area >= medianArea * 0.22 && area <= medianArea * 4.5;
  });
  if (similarlySized.length < 2 || similarlySized.length / candidates.length < 0.7) return { count: 0, reliable: false };
  const result: SlantedHandleMarkerEvidence = { count: similarlySized.length, reliable: true };
  if (similarlySized.some((item) => item.bluePixels !== undefined || item.yellowPixels !== undefined)) {
    result.bluePixels = similarlySized.reduce((sum, item) => sum + rounded(item.bluePixels), 0);
    result.yellowPixels = similarlySized.reduce((sum, item) => sum + rounded(item.yellowPixels), 0);
  }
  return result;
}

export function collectSlantedHandleMarkerEvidence(evidence: CropMarkerEvidence[]): SlantedHandleMarkerEvidence | undefined {
  const candidates = evidence.filter((item) => rounded(item.count) > 0 && rounded(item.count) <= 30 && String(item.cabinetId || "").trim());
  if (!candidates.length) return undefined;
  const bestByCabinet = new Map<string, CropMarkerEvidence>();
  for (const item of candidates) {
    const current = bestByCabinet.get(item.cabinetId);
    if (!current || (item.reliable && !current.reliable) || (item.reliable === current.reliable && rounded(item.count) > rounded(current.count))) bestByCabinet.set(item.cabinetId, item);
  }
  const selected = [...bestByCabinet.values()];
  const total = selected.reduce((sum, item) => sum + rounded(item.count), 0);
  if (!selected.some((item) => item.reliable) && !(total >= 2 && selected.length >= 2)) return undefined;
  const hasColorFamilyEvidence = selected.some((item) => item.bluePixels !== undefined || item.yellowPixels !== undefined);
  const bluePixels = selected.reduce((sum, item) => sum + rounded(item.bluePixels), 0);
  const yellowPixels = selected.reduce((sum, item) => sum + rounded(item.yellowPixels), 0);
  // Actual Foster machining marks contain both blue and yellow print families.
  // Requiring both when image-derived metadata exists rejects warm paper shadows
  // and JPEG chroma artifacts; a one-colour scan simply contributes no evidence.
  if (hasColorFamilyEvidence && (bluePixels < 5 || yellowPixels < 5)) return undefined;
  const sourceNames = [...new Set(selected.map((item) => String(item.sourceImageName || "").trim()).filter(Boolean))];
  return {
    count: total,
    reliable: true,
    sourceImageName: sourceNames.join("、"),
    evidence: selected.map((item) => String(item.evidence || "").trim()).filter(Boolean).join("；"),
    ...(hasColorFamilyEvidence ? { bluePixels, yellowPixels } : {}),
  };
}

export function normalizeSlantedHandleMarkerEvidence(value: unknown, requireColorFamilies = false): SlantedHandleMarkerEvidence | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Partial<SlantedHandleMarkerEvidence>;
  const count = rounded(input.count);
  if (input.reliable !== true || count < 1 || count > 200) return undefined;
  if (requireColorFamilies && (rounded(input.bluePixels) < 5 || rounded(input.yellowPixels) < 5)) return undefined;
  return {
    count,
    reliable: true,
    sourceImageName: String(input.sourceImageName || "").slice(0, 180),
    evidence: String(input.evidence || "").slice(0, 500),
    ...(input.bluePixels !== undefined || input.yellowPixels !== undefined ? {
      bluePixels: Math.min(100000, rounded(input.bluePixels)),
      yellowPixels: Math.min(100000, rounded(input.yellowPixels)),
    } : {}),
  };
}

export function slantedHandleConsistencyNote(
  evidence: SlantedHandleMarkerEvidence | undefined,
  materialHandleCount: unknown,
  hardwareHandleCount: unknown,
) {
  if (!evidence?.reliable || rounded(evidence.count) < 1) return "";
  const markerCount = rounded(evidence.count);
  const materialCount = rounded(materialHandleCount);
  const hardwareCount = rounded(hardwareHandleCount);
  const source = evidence.sourceImageName ? `（${evidence.sourceImageName}）` : "";
  if (markerCount === materialCount && markerCount === hardwareCount) {
    return `斜把交叉核對通過${source}：彩色加工標記、門板／屜頭備註與斜手把五金皆為${markerCount}。`;
  }
  return `斜把交叉核對不一致${source}：彩色加工標記${markerCount}、門板／屜頭備註${materialCount}、斜手把五金${hardwareCount}；只提示人工確認，不自動改數量。`;
}
