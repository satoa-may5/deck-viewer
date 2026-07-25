// Detect a card's type/color/cost from its image using template matching
// against the badge (hexagon=character / diamond=event / rounded-square=field)
// printed in the top-left corner of every Union Arena-style card.
//
// This is a pure-JS port of classify_cards.py (kept for reference/history —
// see that file's header for the full design rationale, including why the
// decision is staged color -> type -> cost instead of one joint comparison,
// and why cost specifically compares only a cropped digit region via a
// sliding search rather than a fixed-position pixel diff). It runs in-process
// via Jimp (pure JS, no native bindings) instead of shelling out to Python +
// OpenCV, because the auto-fill-info feature needs to work from the packaged
// exe too, where end users have neither Python nor OpenCV installed.

const fs = require("fs");
const path = require("path");
const { Jimp } = require("jimp");

const TEMPLATES_DIR = path.join(__dirname, "cost-templates");
const ICONS_DIR = path.join(TEMPLATES_DIR, "icons");

const TYPE_MAP = {
  "Cost-character": "character",
  "Cost-event": "event",
  "Cost-field": "field",
};
// tools/cost-templates/icons/ico_<type>_energy_<color><cost>.png: a maker-
// provided set of tightly-cropped badge icons with much better cost/color
// coverage than the original Cost-character/Cost-event/Cost-field templates
// (e.g. character costs up to 15, plus an "ALL" rainbow badge for the
// colorless/any-color event cards previously misclassified into one of the
// 5 real colors). These icons carry no card-canvas position of their own,
// so the original templates are still loaded first, purely to look up each
// type's badge position/size on a real card -- each icon is resized to that
// position's dimensions and composited onto a blank canvas at that position,
// producing a template in the same representation the rest of this module
// already expects. This is why loadLegacyTypeBBoxes() below only extracts a
// bbox per type instead of building full template objects.
const ICON_FILE_RE = /^ico_(character|event|field)_energy_([a-z]+)(\d+)\.png$/i;
const ICON_COLOR_MAP = { blue: "青", green: "緑", purple: "紫", red: "赤", yellow: "黄", all: "全て" };
const LEGACY_COLOR_MAP = { B: "青", G: "緑", P: "紫", R: "赤", Y: "黄" };
const COST_RE = /(\d+)$/;
const CANVAS_W = 600;
const CANVAS_H = 838;

// Inner fraction (y0, y1, x0, x1) of each template's own alpha-mask bounding
// box that contains just the digit glyph, excluding the color-name label
// above it and the badge's outer border/gold trim.
const DIGIT_INSET = [0.28, 0.9, 0.12, 0.88];
// Padding (px) around the digit crop to search within on the real card, to
// absorb a few pixels of real-card/template misalignment.
const DIGIT_SEARCH_PAD = 10;

async function walkPngFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkPngFiles(full)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) out.push(full);
  }
  return out;
}

function findAlphaBBox(data, width, height) {
  let y0 = height, y1 = -1, x0 = width, x1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
  }
  return y1 < 0 ? null : { y0, y1, x0, x1 };
}

function bboxToDigitBBox(bbox) {
  const h = bbox.y1 - bbox.y0 + 1;
  const w = bbox.x1 - bbox.x0 + 1;
  return {
    y0: bbox.y0 + Math.floor(h * DIGIT_INSET[0]),
    y1: bbox.y0 + Math.floor(h * DIGIT_INSET[1]),
    x0: bbox.x0 + Math.floor(w * DIGIT_INSET[2]),
    x1: bbox.x0 + Math.floor(w * DIGIT_INSET[3]),
  };
}

// Reads the original Cost-character/Cost-event/Cost-field templates: full
// template objects for color/type scoring (these stay sharp -- created
// directly at their target size, unlike the icons/ set below which needs an
// extra resize step that softens the shape edges color/type discrimination
// depends on), plus each type's badge position/size on a full card canvas
// (consistent across colors/costs within a type), needed to place the icons/
// set's badges below.
async function loadLegacyTemplates() {
  const templates = [];
  const bboxByType = {};
  for (const [dirName, cardType] of Object.entries(TYPE_MAP)) {
    const dir = path.join(TEMPLATES_DIR, dirName);
    if (!fs.existsSync(dir)) continue;
    const files = (await walkPngFiles(dir)).sort();
    for (const file of files) {
      const colorDir = path.basename(path.dirname(file));
      const color = LEGACY_COLOR_MAP[colorDir];
      const costMatch = COST_RE.exec(path.basename(file, ".png"));
      if (!color || !costMatch) continue;

      const img = await Jimp.read(file);
      const { data, width, height } = img.bitmap;
      const bbox = findAlphaBBox(data, width, height);
      if (!bbox) continue;
      if (!bboxByType[cardType]) bboxByType[cardType] = bbox;

      const digitBBox = bboxToDigitBBox(bbox);
      templates.push({
        data,
        width,
        height,
        bbox,
        digitBBox,
        digitGray: extractGray(data, width, digitBBox),
        type: cardType,
        color,
        cost: parseInt(costMatch[1], 10),
      });
    }
  }
  return { templates, bboxByType };
}

// Materializes tools/cost-templates/icons/ico_<type>_energy_<color><cost>.png
// (see the module header for why) into the same template shape as
// loadLegacyTemplates() by resizing each icon into its type's badge
// position/size and compositing it onto a blank card-sized canvas.
async function loadIconTemplates(bboxByType) {
  const iconFiles = fs.existsSync(ICONS_DIR)
    ? fs.readdirSync(ICONS_DIR).filter((f) => f.toLowerCase().endsWith(".png")).sort()
    : [];

  const templates = [];
  for (const file of iconFiles) {
    const m = ICON_FILE_RE.exec(file);
    if (!m) continue;
    const [, cardType, colorWord, costStr] = m;
    const color = ICON_COLOR_MAP[colorWord.toLowerCase()];
    const refBBox = bboxByType[cardType];
    if (!color || !refBBox) continue;

    const icon = await Jimp.read(path.join(ICONS_DIR, file));
    const w = refBBox.x1 - refBBox.x0 + 1;
    const h = refBBox.y1 - refBBox.y0 + 1;
    const resizedIcon = icon.bitmap.width === w && icon.bitmap.height === h ? icon : icon.clone().resize({ w, h });

    const canvas = new Jimp({ width: CANVAS_W, height: CANVAS_H, color: 0x00000000 });
    canvas.composite(resizedIcon, refBBox.x0, refBBox.y0);
    const { data, width, height } = canvas.bitmap;
    const bbox = { y0: refBBox.y0, y1: refBBox.y0 + h - 1, x0: refBBox.x0, x1: refBBox.x0 + w - 1 };
    const digitBBox = bboxToDigitBBox(bbox);

    templates.push({
      data,
      width,
      height,
      bbox,
      digitBBox,
      digitGray: extractGray(data, width, digitBBox),
      type: cardType,
      color,
      cost: parseInt(costStr, 10),
    });
  }
  return templates;
}

let cachedTemplates = null;

async function loadTemplates() {
  if (cachedTemplates) return cachedTemplates;

  const { templates: legacyTemplates, bboxByType } = await loadLegacyTemplates();
  const iconTemplates = await loadIconTemplates(bboxByType);
  const templates = [...legacyTemplates, ...iconTemplates];

  if (templates.length === 0) {
    throw new Error(`No valid cost templates found under ${TEMPLATES_DIR}`);
  }
  cachedTemplates = templates;
  return templates;
}

// See detectAllColorHueRange()'s doc comment (in classifyImage) for why this
// exists. Threshold and sat-min were picked from real samples: 4 known ALL
// cards ranged 268-308 degrees, ordinary cards (including one with a bright
// gold border throwing off a few low-saturation samples) stayed at 111-210.
const ALL_COLOR_HUE_RANGE_THRESHOLD = 230;
const ALL_COLOR_MIN_SATURATION_DIFF = 40;

function rgbToHue(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < ALL_COLOR_MIN_SATURATION_DIFF) return null; // near black/white/gray: unstable hue, likely border/label/gold trim
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function circularHueRange(hues) {
  if (hues.length < 2) return 0;
  const sorted = [...hues].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 360;
    maxGap = Math.max(maxGap, next - sorted[i]);
  }
  return 360 - maxGap;
}

function detectAllColorHueRange(resizedData, width, bbox) {
  const cx = (bbox.x0 + bbox.x1) / 2;
  const cy = (bbox.y0 + bbox.y1) / 2;
  const rx = (bbox.x1 - bbox.x0) * 0.25;
  const ry = (bbox.y1 - bbox.y0) * 0.25;
  const hues = [];
  for (let a = 0; a < 360; a += 15) {
    const x = Math.round(cx + rx * Math.cos((a * Math.PI) / 180));
    const y = Math.round(cy + ry * Math.sin((a * Math.PI) / 180));
    const i = (y * width + x) * 4;
    const h = rgbToHue(resizedData[i], resizedData[i + 1], resizedData[i + 2]);
    if (h !== null) hues.push(h);
  }
  return circularHueRange(hues);
}

function extractGray(data, width, box) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((box.y0 + y) * width + (box.x0 + x)) * 4;
      out[y * w + x] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
  }
  return out;
}

// Groups templates by (width,height) canvas size and resizes the source
// image once per distinct size (in practice there is only one size).
async function resizedVariants(sourceImg, templates) {
  const seen = new Map();
  for (const t of templates) {
    const key = `${t.width}x${t.height}`;
    if (!seen.has(key)) {
      const resized =
        sourceImg.bitmap.width === t.width && sourceImg.bitmap.height === t.height
          ? sourceImg
          : sourceImg.clone().resize({ w: t.width, h: t.height });
      seen.set(key, resized.bitmap.data);
    }
  }
  return seen;
}

function maskedDiffScore(resizedData, width, t) {
  const { y0, y1, x0, x1 } = t.bbox;
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      if (t.data[i + 3] === 0) continue; // outside the badge silhouette
      sum += Math.abs(resizedData[i] - t.data[i]);
      sum += Math.abs(resizedData[i + 1] - t.data[i + 1]);
      sum += Math.abs(resizedData[i + 2] - t.data[i + 2]);
      count += 3;
    }
  }
  return count > 0 ? sum / count : Infinity;
}

// cv2.matchTemplate(..., TM_CCOEFF_NORMED).max() equivalent: slide the
// template's digit crop over a padded window of the resized source and
// return the best (highest) normalized cross-correlation found, rather than
// assuming the fixed template-derived position lines up exactly.
function digitCorrelationScore(resizedData, width, height, t) {
  const tw = t.digitBBox.x1 - t.digitBBox.x0;
  const th = t.digitBBox.y1 - t.digitBBox.y0;

  const sy0 = Math.max(0, t.digitBBox.y0 - DIGIT_SEARCH_PAD);
  const sy1 = Math.min(height, t.digitBBox.y1 + DIGIT_SEARCH_PAD);
  const sx0 = Math.max(0, t.digitBBox.x0 - DIGIT_SEARCH_PAD);
  const sx1 = Math.min(width, t.digitBBox.x1 + DIGIT_SEARCH_PAD);
  const sw = sx1 - sx0;
  const sh = sy1 - sy0;
  if (sw < tw || sh < th) return -2;

  const search = new Float64Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = ((sy0 + y) * width + (sx0 + x)) * 4;
      search[y * sw + x] = resizedData[i] * 0.299 + resizedData[i + 1] * 0.587 + resizedData[i + 2] * 0.114;
    }
  }

  const tmpl = t.digitGray;
  let tmplMean = 0;
  for (let i = 0; i < tmpl.length; i++) tmplMean += tmpl[i];
  tmplMean /= tmpl.length;
  let tmplNormSq = 0;
  const tmplCentered = new Float64Array(tmpl.length);
  for (let i = 0; i < tmpl.length; i++) {
    tmplCentered[i] = tmpl[i] - tmplMean;
    tmplNormSq += tmplCentered[i] * tmplCentered[i];
  }
  const tmplNorm = Math.sqrt(tmplNormSq);
  if (tmplNorm < 1e-6) return -2;

  let best = -2;
  const maxOy = sh - th;
  const maxOx = sw - tw;
  for (let oy = 0; oy <= maxOy; oy++) {
    for (let ox = 0; ox <= maxOx; ox++) {
      let windowMean = 0;
      for (let y = 0; y < th; y++) {
        const rowStart = (oy + y) * sw + ox;
        for (let x = 0; x < tw; x++) windowMean += search[rowStart + x];
      }
      windowMean /= tmpl.length;

      let dot = 0;
      let windowNormSq = 0;
      for (let y = 0; y < th; y++) {
        const rowStart = (oy + y) * sw + ox;
        for (let x = 0; x < tw; x++) {
          const v = search[rowStart + x] - windowMean;
          dot += v * tmplCentered[y * tw + x];
          windowNormSq += v * v;
        }
      }
      const denom = Math.sqrt(windowNormSq) * tmplNorm;
      const score = denom > 1e-6 ? dot / denom : -2;
      if (score > best) best = score;
    }
  }
  return best;
}

async function classifyImage(imagePath, templates) {
  let img;
  try {
    img = await Jimp.read(imagePath);
  } catch (err) {
    return null;
  }

  const variants = await resizedVariants(img, templates);
  const dataFor = (t) => variants.get(`${t.width}x${t.height}`);

  // Stage A: color, scored across every type/cost combination. "全て" (the
  // ALL/rainbow badge) is deliberately excluded here -- see the ALL-color
  // check below for why plain pixel-diff scoring can't be trusted with it.
  const colorBest = new Map();
  for (const t of templates) {
    if (t.color === "全て") continue;
    const score = maskedDiffScore(dataFor(t), t.width, t);
    if (!colorBest.has(t.color) || score < colorBest.get(t.color)) colorBest.set(t.color, score);
  }
  let bestColor = [...colorBest.entries()].reduce((a, b) => (b[1] < a[1] ? b : a))[0];

  // Stage B: type, restricted to the chosen color.
  const sameColor = templates.filter((t) => t.color === bestColor);
  const typeBest = new Map();
  for (const t of sameColor) {
    const score = maskedDiffScore(dataFor(t), t.width, t);
    if (!typeBest.has(t.type) || score < typeBest.get(t.type)) typeBest.set(t.type, score);
  }
  const bestType = [...typeBest.entries()].reduce((a, b) => (b[1] < a[1] ? b : a))[0];

  // "ALL" (rainbow, colorless/any-color) badge check, applied to the type
  // Stage B already settled on rather than tried independently across all 3
  // types: an independent check ended up picking whichever type's card-art
  // corner happened to have the widest hue spread, which is often NOT where
  // the real badge is for a non-ALL card (random art has plenty of hue
  // variance too) -- restricting the check to the type Stage B already
  // trusts avoids that false-positive path. Plain pixel-diff scoring
  // (Stage A above) can't be trusted for this one badge because a rainbow
  // gradient is far more sensitive to the few pixels of real-card/template
  // misalignment than a uniform fill is, so a solid color's template --
  // insensitive to exactly where it lines up -- reliably "wins" the
  // comparison even against a genuine ALL badge. Hue sampled around the
  // badge's interior gem-fill ring sidesteps that: a real single color, even
  // under radial gradient shading, keeps roughly one hue throughout, while
  // an ALL badge's gradient sweeps through most of the color wheel.
  if (templates.some((t) => t.type === bestType && t.color === "全て")) {
    const ref = sameColor.find((t) => t.type === bestType) || templates.find((t) => t.type === bestType);
    const range = detectAllColorHueRange(dataFor(ref), ref.width, ref.bbox);
    if (range > ALL_COLOR_HUE_RANGE_THRESHOLD) bestColor = "全て";
  }

  // Stage C: cost, restricted to the chosen type but -- unlike color/type --
  // searched across EVERY color's templates of that type, not just the
  // matched color's. The digit crop is grayscale and mean-normalized before
  // correlating (see digitCorrelationScore), which empirically turned out to
  // be color-invariant enough that a same-type digit template from a
  // completely different color reliably still finds the right cost
  // (verified against 1028 real card images: identical results, sometimes
  // via a cross-color match, with no regression on cards where the matched
  // color's own template was available). This is what actually closes most
  // of the template library's coverage gaps -- e.g. Cost-event/P has no
  // purple0/purple8, but blue/green/red/yellow's event-cost-0/8 templates
  // cover it once cost search isn't restricted to the matched color. A
  // genuine OCR pass on the isolated digit region was tried first and
  // discarded: this game's bold display-font digits didn't match Tesseract's
  // trained font shapes reliably even after masking/binarizing the crop, so
  // it read wrong or empty far more often than this correlation approach.
  const candidates = templates.filter((t) => t.type === bestType);
  let bestCost = null;
  let bestScore = -2;
  for (const t of candidates) {
    const score = digitCorrelationScore(dataFor(t), t.width, t.height, t);
    if (score > bestScore) {
      bestScore = score;
      bestCost = t.cost;
    }
  }

  // costConfidence is the winning candidate's raw correlation score (-1..1),
  // not a margin over the runner-up: cross-color matches on the *correct*
  // cost cluster together near the top (that's the point of searching
  // across colors), so a small gap to 2nd place turned out NOT to mean
  // low confidence -- confidently-correct cards scored ~0.7-0.85 outright,
  // while genuinely ambiguous ones (no good template for the real cost, or
  // a multi-digit "10"-style cost the fixed-size digit crop doesn't fully
  // capture) scored ~0.4-0.5 even for their best candidate, regardless of
  // how close the runner-up was.
  return { type: bestType, color: bestColor, cost: bestCost, costConfidence: bestScore };
}

module.exports = { loadTemplates, classifyImage };
