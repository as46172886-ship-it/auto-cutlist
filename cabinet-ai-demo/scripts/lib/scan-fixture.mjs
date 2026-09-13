import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("不是有效的 JPEG 檔案");
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (SOF_MARKERS.has(marker)) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  throw new Error("JPEG 缺少可讀的尺寸標記");
}

export async function validateScanFixture(manifest, rootPath) {
  const files = [];
  const errors = [];
  for (const expected of manifest.files || []) {
    const path = resolve(rootPath, expected.relativePath);
    try {
      const bytes = new Uint8Array(await readFile(path));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const dimensions = jpegDimensions(bytes);
      const mismatches = [];
      if (sha256 !== expected.sha256) mismatches.push("SHA-256 不一致");
      if (bytes.byteLength !== expected.sizeBytes) mismatches.push(`檔案大小 ${bytes.byteLength}≠${expected.sizeBytes}`);
      if (dimensions.width !== expected.width || dimensions.height !== expected.height) {
        mismatches.push(`像素 ${dimensions.width}×${dimensions.height}≠${expected.width}×${expected.height}`);
      }
      files.push({ role: expected.role, path, sha256, sizeBytes: bytes.byteLength, ...dimensions, ok: mismatches.length === 0 });
      errors.push(...mismatches.map((message) => `${expected.role}: ${message}`));
    } catch (error) {
      errors.push(`${expected.role}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: errors.length === 0, files, errors };
}
