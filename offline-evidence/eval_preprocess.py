from pathlib import Path
from collections import Counter
import json, re, subprocess
import numpy as np
from PIL import Image

ROOT = Path(__file__).parent / "foster-images"
EXPECTED = {
    "C769D906-AD76-496E-9DB3-674B8064F26E.jpeg": ["100", "1472", "88", "360", "1000", "1000", "500", "350", "509"],
    "905DC350-E2DC-4684-9A8A-042DB0E94860.jpeg": ["95", "640", "25", "640", "25", "120", "540", "390", "500", "95", "415", "24", "201", "25", "640", "25", "22", "460", "920", "920", "28", "460", "460", "350", "350", "500", "500", "500", "540", "2348"],
}

def bounds(hist, total, low_ratio=.008, high_ratio=.99):
    cumulative = np.cumsum(hist)
    low = int(np.searchsorted(cumulative, total * low_ratio))
    high = int(np.searchsorted(cumulative, total * high_ratio))
    if high - low < 36:
        low, high = max(0, low - 18), min(255, high + 18)
    return low, high

def adaptive(gray, radius, bias=11):
    h, w = gray.shape
    integral = np.zeros((h + 1, w + 1), dtype=np.uint64)
    integral[1:, 1:] = gray.astype(np.uint64).cumsum(0).cumsum(1)
    ys, xs = np.indices((h, w))
    top, bottom = np.maximum(0, ys - radius), np.minimum(h - 1, ys + radius)
    left, right = np.maximum(0, xs - radius), np.minimum(w - 1, xs + radius)
    sums = integral[bottom + 1, right + 1] - integral[top, right + 1] - integral[bottom + 1, left] + integral[top, left]
    counts = (right - left + 1) * (bottom - top + 1)
    return np.where(gray < sums / counts - bias, 0, 255).astype(np.uint8)

def ocr(path):
    result = subprocess.run(["tesseract", str(path), "stdout", "-l", "eng", "--psm", "11"], capture_output=True, text=True, check=True)
    return result.stdout

def score(expected, text):
    actual = Counter(re.findall(r"\d+", text))
    wanted = Counter(expected)
    matched = sum((wanted & actual).values())
    return {"matched": matched, "expected": sum(wanted.values()), "recall": round(100 * matched / sum(wanted.values()), 1), "tokens": sorted(actual.elements())}

results = []
prepared = []
for name, expected in EXPECTED.items():
    source = Image.open(ROOT / name).convert("RGB").rotate(90, expand=True)
    gray = np.asarray(source.convert("L"), dtype=np.uint8)
    hist = np.bincount(gray.ravel(), minlength=256)
    low, high = bounds(hist, gray.size)
    stretched = np.clip(np.rint((gray.astype(float) - low) * 255 / max(1, high - low)), 0, 255).astype(np.uint8)
    radius = max(10, min(30, round(min(gray.shape) / 55)))
    binary = adaptive(stretched, radius)
    base = ROOT / Path(name).stem
    gray_path, binary_path = base.with_suffix(".gray.png"), base.with_suffix(".binary.png")
    Image.fromarray(stretched).save(gray_path)
    Image.fromarray(binary).save(binary_path)
    gray_text, binary_text = ocr(gray_path), ocr(binary_path)
    results.append({
        "name": name, "bounds": [low, high], "radius": radius,
        "binary_ink_ratio": round(float((binary < 128).mean()), 4),
        "gray": score(expected, gray_text), "binary": score(expected, binary_text),
        "gray_text": gray_text.strip(), "binary_text": binary_text.strip(),
    })
    prepared.append((name, expected, stretched))
print(json.dumps(results, ensure_ascii=False, indent=2))

grid = []
for radius in (10, 16, 21, 28):
    for bias in (7, 11, 15):
        matched = total = 0
        per_image = []
        for name, expected, stretched in prepared:
            variant = adaptive(stretched, radius, bias)
            path = ROOT / f"grid-r{radius}-b{bias}-{Path(name).stem}.png"
            Image.fromarray(variant).save(path)
            item = score(expected, ocr(path))
            matched += item["matched"]
            total += item["expected"]
            per_image.append(item["recall"])
        grid.append({"radius": radius, "bias": bias, "matched": matched, "expected": total, "recall": round(100 * matched / total, 1), "per_image": per_image})
print(json.dumps(sorted(grid, key=lambda row: (-row["matched"], row["radius"], row["bias"])), ensure_ascii=False, indent=2))
