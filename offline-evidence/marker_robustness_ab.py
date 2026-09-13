from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance
from scipy import ndimage


ROOT = Path(__file__).parent / "foster-crops"
CASES = {
    "page1-color": ("page1-upright.png", (760, 500, 1435, 900), 12),
    "page2-shadow": ("page2-upright-fixed.png", (420, 470, 1215, 920), 0),
}


def variants(image):
    yielded = {
        "original": image,
        "exposure-20": ImageEnhance.Brightness(image).enhance(0.8),
        "exposure+20": ImageEnhance.Brightness(image).enhance(1.2),
        "contrast-20": ImageEnhance.Contrast(image).enhance(0.8),
        "contrast+20": ImageEnhance.Contrast(image).enhance(1.2),
    }
    rgb = np.asarray(image).astype(np.float32)
    for name, scale in {
        "warm-cast": (1.10, 1.00, 0.90),
        "cool-cast": (0.90, 1.00, 1.10),
    }.items():
        yielded[name] = Image.fromarray(np.clip(rgb * np.asarray(scale), 0, 255).astype(np.uint8))
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=55)
    buffer.seek(0)
    yielded["jpeg-55"] = Image.open(buffer).convert("RGB")
    return yielded


def marker_mask(image, normalized=False):
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    red, green, blue = [rgb[:, :, index] for index in range(3)]
    high = rgb.max(axis=2)
    low = rgb.min(axis=2)
    red_dimension = ((red - green) >= 10) & ((red - blue) >= 8) & (red >= 75) & (np.abs(green - blue) <= 25)
    if not normalized:
        return ((high - low) >= 14) & (high >= 70) & (low <= 150) & ~red_dimension
    saturation = (high - low) / np.maximum(1, high)
    blue_marker = (blue - np.maximum(red, green) >= 6) | ((blue - red >= 10) & (blue - green >= 5))
    yellow_marker = (np.minimum(red, green) - blue >= 8) & (np.abs(red - green) <= 30)
    return (saturation >= 0.14) & (high >= 45) & (low <= 190) & (blue_marker | yellow_marker) & ~red_dimension


def family_masks(image):
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    red, green, blue = [rgb[:, :, index] for index in range(3)]
    blue_marker = (blue - np.maximum(red, green) >= 6) | ((blue - red >= 10) & (blue - green >= 5))
    yellow_marker = (np.minimum(red, green) - blue >= 8) & (np.abs(red - green) <= 30)
    return blue_marker, yellow_marker


def components(mask, image=None):
    blue_mask, yellow_mask = family_masks(image) if image is not None else (None, None)
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
    objects = ndimage.find_objects(labels)
    output = []
    for label_id, slices in enumerate(objects, start=1):
        if slices is None:
            continue
        ys, xs = slices
        pixels = int(np.count_nonzero(labels[ys, xs] == label_id))
        item = {
            "x": int(xs.start), "y": int(ys.start),
            "width": int(xs.stop - xs.start), "height": int(ys.stop - ys.start),
            "pixels": pixels,
        }
        if image is not None:
            component = labels[ys, xs] == label_id
            item["blue"] = int(np.count_nonzero(component & blue_mask[ys, xs]))
            item["yellow"] = int(np.count_nonzero(component & yellow_mask[ys, xs]))
        output.append(item)
    return output


def gap(left, right):
    x = max(0, max(left["x"], right["x"]) - min(left["x"] + left["width"], right["x"] + right["width"]))
    y = max(0, max(left["y"], right["y"]) - min(left["y"] + left["height"], right["y"] + right["height"]))
    return (x * x + y * y) ** 0.5


def combine(left, right):
    x, y = min(left["x"], right["x"]), min(left["y"], right["y"])
    edge = max(left["x"] + left["width"], right["x"] + right["width"])
    bottom = max(left["y"] + left["height"], right["y"] + right["height"])
    return {
        "x": x, "y": y, "width": edge - x, "height": bottom - y,
        "pixels": left["pixels"] + right["pixels"],
        "blue": left.get("blue", 0) + right.get("blue", 0),
        "yellow": left.get("yellow", 0) + right.get("yellow", 0),
    }


def merge_fragments(items, max_gap=12):
    merged = [dict(item) for item in items if item["pixels"] > 0 and item["width"] > 0 and item["height"] > 0]
    changed = True
    while changed:
        changed = False
        for left in range(len(merged)):
            for right in range(left + 1, len(merged)):
                if gap(merged[left], merged[right]) > max_gap:
                    continue
                smaller = min(merged[left]["pixels"], merged[right]["pixels"])
                larger = max(merged[left]["pixels"], merged[right]["pixels"])
                if smaller > 12 and smaller / larger > 0.25:
                    continue
                merged[left] = combine(merged[left], merged[right])
                merged.pop(right)
                changed = True
                break
            if changed:
                break
    return merged


def reliable_count(items, require_two_families=False):
    candidates = []
    for item in items:
        area = item["width"] * item["height"]
        fill = item["pixels"] / max(1, area)
        aspect = item["width"] / max(1, item["height"])
        if item["pixels"] >= 5 and area <= 2500 and fill >= 0.025 and 0.18 <= aspect <= 5.5:
            candidates.append(item)
    if len(candidates) < 2:
        return len(candidates), False
    areas = sorted(item["width"] * item["height"] for item in candidates)
    median = areas[len(areas) // 2]
    similar = [item for item in candidates if median * 0.22 <= item["width"] * item["height"] <= median * 4.5]
    if len(similar) < 2 or len(similar) / len(candidates) < 0.7:
        return 0, False
    if require_two_families:
        blue = sum(item.get("blue", 0) for item in similar)
        yellow = sum(item.get("yellow", 0) for item in similar)
        if blue < 5 or yellow < 5:
            return 0, False
    return len(similar), True


for case_name, (filename, box, expected) in CASES.items():
    crop = Image.open(ROOT / filename).convert("RGB").crop(box)
    for variant_name, image in variants(crop).items():
        current_count, current_reliable = reliable_count(merge_fragments(components(marker_mask(image), image)), True)
        count, reliable = reliable_count(merge_fragments(components(marker_mask(image, normalized=True), image)), True)
        verdict = "PASS" if (8 <= count <= 18 if expected else not reliable) else "FAIL"
        print(
            f"{case_name:12} {variant_name:12} "
            f"current={current_count:2}/{str(current_reliable):5} normalized={count:2}/{str(reliable):5} "
            f"expected={'markers' if expected else 'none':7} {verdict}"
        )
