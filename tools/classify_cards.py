"""Detect a card's type/color/cost from its image using template matching
against the badge (hexagon=character / diamond=event / rounded-square=field)
printed in the top-left corner of every Union Arena-style card.

This replaces make_manifests.py's classify_image(), which scored every
type/color/cost template jointly in one pass. That worked well for color
(a big, saturated, near-uniform area that dominates the comparison) but was
unreliable for cost specifically: within a same-color/type badge, only the
printed digit differs between cost variants, and it's a small fraction of
the masked pixels being compared -- the surrounding badge fill, border, and
color-name label are nearly identical across all 9 cost variants, so the
"real" signal (the digit) was diluted by a majority of near-identical noise.

This version stages the decision instead: pick color first (unstaged, since
that already works), then type restricted to that color, then cost
restricted to that color+type -- comparing only a cropped inner region
containing just the digit glyph (excluding the label/border, which are now
guaranteed identical across candidates) via normalized cross-correlation,
which is also less sensitive to lighting/gradient differences between the
flat template render and a real printed card than a raw pixel diff.

Usage:
    classify_cards.py <request.json> <response.json>

request.json:  [{"id": "card-123", "path": "C:\\...\\card-123.jpg"}, ...]
response.json: {"card-123": {"type": "character", "color": "青", "cost": 3}, ...}
                (a card is omitted from the response if it couldn't be read)
"""

import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "cost-templates"

TYPE_MAP = {
    "Cost-character": "character",
    "Cost-event": "event",
    "Cost-field": "field",
}
COLOR_MAP = {"B": "青", "G": "緑", "P": "紫", "R": "赤", "Y": "黄"}
COST_RE = re.compile(r"(\d+)$")

# Inner fraction (y0, y1, x0, x1) of each template's own alpha-mask bounding
# box that contains just the digit glyph, excluding the color-name label
# above it and the badge's outer border/gold trim -- picked by visual
# inspection of the templates (the label sits in the top ~28%, the border
# margin is the outer ~12% left/right and ~12% bottom).
DIGIT_INSET = (0.28, 0.90, 0.12, 0.88)


def load_templates():
    templates = []
    for p in sorted(TEMPLATES_DIR.rglob("*.png")):
        card_type = TYPE_MAP.get(p.parent.parent.name)
        color = COLOR_MAP.get(p.parent.name)
        m = COST_RE.search(p.stem)
        if card_type is None or color is None or m is None:
            continue

        img = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
        if img is None or img.ndim < 3 or img.shape[2] != 4:
            continue
        mask = img[:, :, 3] > 0
        if not np.any(mask):
            continue

        ys, xs = mask.nonzero()
        y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
        h, w = y1 - y0 + 1, x1 - x0 + 1
        dy0 = y0 + int(h * DIGIT_INSET[0])
        dy1 = y0 + int(h * DIGIT_INSET[1])
        dx0 = x0 + int(w * DIGIT_INSET[2])
        dx1 = x0 + int(w * DIGIT_INSET[3])

        templates.append({
            "rgb": img[:, :, :3].astype(np.float32),
            "mask": mask,
            "shape": img.shape[:2],
            "digit_bbox": (dy0, dy1, dx0, dx1),
            "type": card_type,
            "color": color,
            "cost": int(m.group(1)),
        })

    if not templates:
        raise RuntimeError(f"No valid cost templates found under {TEMPLATES_DIR}")
    return templates


def _resize_cache(img, templates):
    cache = {}
    for t in templates:
        shape = t["shape"]
        if shape not in cache:
            h, w = shape
            cache[shape] = cv2.resize(img, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)
    return cache


def _masked_diff_score(resized, t):
    diff = np.abs(resized - t["rgb"])
    return float(np.mean(diff[t["mask"]]))


# Real cards sit a few pixels off from where the template's own badge
# happens to fall after resizing (different source scans/crops per set), and
# a fixed-position pixel comparison is extremely sensitive to that on a
# high-frequency target like a digit's stroke edges -- a 2-3px offset was
# enough to tank the correlation score even when the digit visually lined
# up. Searching a padded window around the expected position with
# cv2.matchTemplate (rather than comparing one fixed crop directly) finds
# the best alignment instead of assuming it, which fixed a confirmed
# misclassification (see project notes: CSM-1-034, event/3 badge).
DIGIT_SEARCH_PAD = 10


def _digit_correlation_score(resized, t):
    dy0, dy1, dx0, dx1 = t["digit_bbox"]
    h, w = resized.shape[:2]
    sy0, sy1 = max(0, dy0 - DIGIT_SEARCH_PAD), min(h, dy1 + DIGIT_SEARCH_PAD)
    sx0, sx1 = max(0, dx0 - DIGIT_SEARCH_PAD), min(w, dx1 + DIGIT_SEARCH_PAD)
    search = cv2.cvtColor(resized[sy0:sy1, sx0:sx1].astype(np.uint8), cv2.COLOR_BGR2GRAY)
    tmpl = cv2.cvtColor(t["rgb"][dy0:dy1, dx0:dx1].astype(np.uint8), cv2.COLOR_BGR2GRAY)
    if search.shape[0] < tmpl.shape[0] or search.shape[1] < tmpl.shape[1]:
        return -2.0
    result = cv2.matchTemplate(search, tmpl, cv2.TM_CCOEFF_NORMED)
    return float(result.max())


def classify_image(image_path: Path, templates):
    img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if img is None:
        return None

    resized_by_shape = _resize_cache(img, templates)

    # Stage A: color, scored across every type/cost combination.
    color_best = {}
    for t in templates:
        score = _masked_diff_score(resized_by_shape[t["shape"]], t)
        if t["color"] not in color_best or score < color_best[t["color"]]:
            color_best[t["color"]] = score
    best_color = min(color_best, key=color_best.get)

    # Stage B: type, restricted to the chosen color.
    same_color = [t for t in templates if t["color"] == best_color]
    type_best = {}
    for t in same_color:
        score = _masked_diff_score(resized_by_shape[t["shape"]], t)
        if t["type"] not in type_best or score < type_best[t["type"]]:
            type_best[t["type"]] = score
    best_type = min(type_best, key=type_best.get)

    # Stage C: cost, restricted to the chosen color+type, on the digit crop.
    candidates = [t for t in same_color if t["type"] == best_type]
    best_cost = None
    best_score = -2.0
    for t in candidates:
        score = _digit_correlation_score(resized_by_shape[t["shape"]], t)
        if score > best_score:
            best_score = score
            best_cost = t["cost"]

    return {"type": best_type, "color": best_color, "cost": best_cost}


def main():
    if len(sys.argv) != 3:
        print("usage: classify_cards.py <request.json> <response.json>", file=sys.stderr)
        sys.exit(1)

    request_path = Path(sys.argv[1])
    response_path = Path(sys.argv[2])
    requests = json.loads(request_path.read_text(encoding="utf-8"))

    templates = load_templates()

    result = {}
    for entry in requests:
        card_id = entry["id"]
        image_path = Path(entry["path"])
        try:
            classification = classify_image(image_path, templates)
        except Exception as exc:  # noqa: BLE001 - report and continue
            print(f"  ! {card_id}: {exc}", file=sys.stderr)
            continue
        if classification is None:
            print(f"  ! {card_id}: failed to read image", file=sys.stderr)
            continue
        result[card_id] = classification
        print(f"  {card_id}: {classification}", file=sys.stderr)

    response_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
