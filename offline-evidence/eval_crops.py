from collections import Counter
from pathlib import Path
import json, re, subprocess

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).parent / "foster-crops"

# Coordinates are drawing regions, not answer-driven production rules. Expected
# tokens are used only to score this offline A/B experiment.
CASES = [
    {
        "name": "page1-side-vertical-dims",
        "image": "page1-upright.png",
        "box": (270, 450, 345, 940),
        "rotate": -90,
        "expected": ["95", "640", "25", "640", "25"],
    },
    {
        "name": "page1-side-labels",
        "image": "page1-upright.png",
        "box": (340, 430, 650, 1010),
        "rotate": 0,
        "expected": ["120", "540", "390", "500"],
    },
    {
        "name": "page1-front-vertical-dims",
        "image": "page1-upright.png",
        "box": (690, 490, 790, 950),
        "rotate": -90,
        "expected": ["95", "415", "24", "201", "25", "640", "25"],
    },
    {
        "name": "page1-front-bottom-dims",
        "image": "page1-upright.png",
        "box": (770, 875, 1435, 1015),
        "rotate": 0,
        "expected": ["22", "460", "920", "920", "28", "500", "500", "500"],
    },
    {
        "name": "page1-front-top-labels",
        "image": "page1-upright.png",
        "box": (780, 340, 1430, 570),
        "rotate": 0,
        "expected": ["460", "460", "350", "350", "540", "2348"],
    },
    {
        "name": "page2-left-vertical-dims",
        "image": "page2-upright-fixed.png",
        "box": (330, 450, 430, 980),
        "rotate": -90,
        "expected": ["100", "1472", "88"],
    },
    {
        "name": "page2-bottom-dims",
        "image": "page2-upright-fixed.png",
        "box": (410, 900, 1230, 1025),
        "rotate": 0,
        "expected": ["360", "1000", "1000", "500"],
    },
    {
        "name": "page2-labels",
        "image": "page2-upright-fixed.png",
        "box": (500, 350, 1100, 1070),
        "rotate": 0,
        "expected": ["350", "509"],
    },
]


def adaptive(gray, radius=21, bias=11):
    a = np.asarray(gray, dtype=np.uint8)
    h, w = a.shape
    integral = np.zeros((h + 1, w + 1), dtype=np.uint64)
    integral[1:, 1:] = a.astype(np.uint64).cumsum(0).cumsum(1)
    ys, xs = np.indices((h, w))
    top, bottom = np.maximum(0, ys - radius), np.minimum(h - 1, ys + radius)
    left, right = np.maximum(0, xs - radius), np.minimum(w - 1, xs + radius)
    sums = integral[bottom + 1, right + 1] - integral[top, right + 1] - integral[bottom + 1, left] + integral[top, left]
    counts = (right - left + 1) * (bottom - top + 1)
    return Image.fromarray(np.where(a < sums / counts - bias, 0, 255).astype(np.uint8))


def preprocess(crop, variant, scale):
    working = crop
    if variant.startswith("red-removed"):
        rgb = np.asarray(crop.convert("RGB"), dtype=np.uint8).copy()
        red = rgb[:, :, 0].astype(np.int16)
        green = rgb[:, :, 1].astype(np.int16)
        blue = rgb[:, :, 2].astype(np.int16)
        # Printed dimension lines are red/magenta while dimension numerals are
        # neutral dark ink. Remove only chromatic red pixels and retain black
        # text, cabinet outlines, and anti-aliased numeral edges.
        mask = (red - green >= 10) & (red - blue >= 8) & (red >= 75)
        rgb[mask] = 255
        working = Image.fromarray(rgb)
    gray = working.convert("L")
    if variant == "gray":
        result = ImageEnhance.Contrast(gray).enhance(1.7)
    elif variant == "unsharp":
        result = ImageEnhance.Contrast(gray).enhance(1.5).filter(ImageFilter.UnsharpMask(radius=2, percent=180, threshold=3))
    elif variant == "adaptive":
        result = adaptive(ImageEnhance.Contrast(gray).enhance(1.35), 21, 11)
    elif variant == "adaptive-soft":
        result = adaptive(ImageEnhance.Contrast(gray).enhance(1.25), 16, 7)
    elif variant == "red-removed-gray":
        result = ImageEnhance.Contrast(gray).enhance(1.7)
    elif variant == "red-removed-adaptive":
        result = adaptive(ImageEnhance.Contrast(gray).enhance(1.25), 16, 7)
    else:
        raise ValueError(variant)
    return result.resize((result.width * scale, result.height * scale), Image.Resampling.LANCZOS)


def ocr(path, psm):
    run = subprocess.run([
        "tesseract", str(path), "stdout", "-l", "eng", "--psm", str(psm),
    ], capture_output=True, text=True, check=True)
    return run.stdout


def score(expected, text):
    wanted = Counter(expected)
    actual = Counter(re.findall(r"\d+", text))
    matched = sum((wanted & actual).values())
    return matched, sum(wanted.values()), sorted(actual.elements())


rows = []
for case in CASES:
    source = Image.open(ROOT / case["image"]).convert("RGB")
    crop = source.crop(case["box"])
    if case.get("rotate"):
        crop = crop.rotate(case["rotate"], expand=True)
    crop.save(ROOT / f'{case["name"]}-original.png')
    for variant in ("gray", "adaptive-soft", "red-removed-gray", "red-removed-adaptive"):
        for scale in (2, 3):
            prepared = preprocess(crop, variant, scale)
            path = ROOT / f'{case["name"]}-{variant}-{scale}x.png'
            prepared.save(path)
            for psm in (6, 7, 11):
                text = ocr(path, psm)
                matched, total, tokens = score(case["expected"], text)
                rows.append({
                    "case": case["name"], "variant": variant, "scale": scale,
                    "psm": psm, "matched": matched, "expected": total,
                    "recall": round(100 * matched / total, 1), "tokens": tokens,
                })

best_per_case = {}
for case in CASES:
    candidates = [r for r in rows if r["case"] == case["name"]]
    best_per_case[case["name"]] = sorted(candidates, key=lambda r: (-r["matched"], len(r["tokens"]), r["variant"], r["scale"], r["psm"]))[:8]

configs = {}
for row in rows:
    key = (row["variant"], row["scale"], row["psm"])
    agg = configs.setdefault(key, {"matched": 0, "expected": 0, "per_case": []})
    agg["matched"] += row["matched"]
    agg["expected"] += row["expected"]
    agg["per_case"].append(row["recall"])

best_configs = []
for (variant, scale, psm), agg in configs.items():
    best_configs.append({
        "variant": variant, "scale": scale, "psm": psm,
        "matched": agg["matched"], "expected": agg["expected"],
        "recall": round(100 * agg["matched"] / agg["expected"], 1),
        "per_case": agg["per_case"],
    })
best_configs.sort(key=lambda r: (-r["matched"], r["variant"], r["scale"], r["psm"]))

print(json.dumps({"best_configs": best_configs[:12], "best_per_case": best_per_case}, ensure_ascii=False, indent=2))
