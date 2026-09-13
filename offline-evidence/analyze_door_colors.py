from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).parent / "foster-crops"
CASES = [
    ("page1-door-band", "page1-upright.png", (760, 500, 1435, 900)),
    ("page2-door-band", "page2-upright-fixed.png", (420, 470, 1215, 920)),
]

rows = []
for name, image_name, box in CASES:
    crop = Image.open(ROOT / image_name).convert("RGB").crop(box)
    rgb = np.asarray(crop, dtype=np.uint8)
    high = rgb.max(axis=2).astype(np.int16)
    low = rgb.min(axis=2).astype(np.int16)
    chroma = high - low
    red, green, blue = [rgb[:, :, index].astype(np.int16) for index in range(3)]

    # Door symbols in the Foster print are blue/yellow wedges. Exclude the red
    # dimension ink and near-neutral black cabinet/dashed lines.
    red_dimension = (red - green >= 10) & (red - blue >= 8) & (red >= 75)
    colored = (chroma >= 18) & (high <= 235) & ~red_dimension
    colored = ndimage.binary_opening(colored, structure=np.ones((2, 2), dtype=bool))
    labels, count = ndimage.label(colored)
    objects = ndimage.find_objects(labels)
    components = []
    for label_id, slices in enumerate(objects, start=1):
        if slices is None:
            continue
        ys, xs = slices
        component = labels[ys, xs] == label_id
        area = int(component.sum())
        width, height = int(xs.stop - xs.start), int(ys.stop - ys.start)
        if area < 8 or area > 1000 or width < 2 or height < 2 or width > 80 or height > 80:
            continue
        pixels = rgb[ys, xs][component]
        components.append({
            "x": int(xs.start), "y": int(ys.start), "width": width, "height": height,
            "area": area, "fill": round(area / (width * height), 3),
            "mean_rgb": [int(round(v)) for v in pixels.mean(axis=0)],
        })
    components.sort(key=lambda item: (item["y"], item["x"]))
    rows.append({"name": name, "box": box, "components": components})

    preview = crop.copy()
    draw = ImageDraw.Draw(preview)
    for index, item in enumerate(components, start=1):
        draw.rectangle((item["x"], item["y"], item["x"] + item["width"], item["y"] + item["height"]), outline="lime", width=2)
        draw.text((item["x"], max(0, item["y"] - 12)), str(index), fill="red")
    preview.save(ROOT / f"{name}-components.png")

print(json.dumps(rows, ensure_ascii=False, indent=2))
