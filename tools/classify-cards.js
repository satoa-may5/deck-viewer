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

const path = require("path");
const { Jimp } = require("jimp");

const TEMPLATES_DIR = path.join(__dirname, "cost-templates");

const TYPE_MAP = {
  "Cost-character": "character",
  "Cost-event": "event",
  "Cost-field": "field",
};
const COLOR_MAP = { B: "青", G: "緑", P: "紫", R: "赤", Y: "黄" };
const COST_RE = /(\d+)$/;

// Inner fraction (y0, y1, x0, x1) of each template's own alpha-mask bounding
// box that contains just the digit glyph, excluding the color-name label
// above it and the badge's outer border/gold trim.
const DIGIT_INSET = [0.28, 0.9, 0.12, 0.88];
// Padding (px) around the digit crop to search within on the real card, to
// absorb a few pixels of real-card/template misalignment.
const DIGIT_SEARCH_PAD = 10;

async function walkPngFiles(dir) {
  const fs = require("fs");
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkPngFiles(full)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) out.push(full);
  }
  return out;
}

let cachedTemplates = null;

async function loadTemplates() {
  if (cachedTemplates) return cachedTemplates;

  const files = (await walkPngFiles(TEMPLATES_DIR)).sort();
  const templates = [];

  for (const file of files) {
    const typeDir = path.basename(path.dirname(path.dirname(file)));
    const colorDir = path.basename(path.dirname(file));
    const cardType = TYPE_MAP[typeDir];
    const color = COLOR_MAP[colorDir];
    const stem = path.basename(file, ".png");
    const costMatch = COST_RE.exec(stem);
    if (!cardType || !color || !costMatch) continue;

    const img = await Jimp.read(file);
    const { data, width, height } = img.bitmap;

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
    if (y1 < 0) continue; // fully transparent, shouldn't happen

    const h = y1 - y0 + 1;
    const w = x1 - x0 + 1;
    const digitBBox = {
      y0: y0 + Math.floor(h * DIGIT_INSET[0]),
      y1: y0 + Math.floor(h * DIGIT_INSET[1]),
      x0: x0 + Math.floor(w * DIGIT_INSET[2]),
      x1: x0 + Math.floor(w * DIGIT_INSET[3]),
    };

    templates.push({
      data,
      width,
      height,
      bbox: { y0, y1, x0, x1 },
      digitBBox,
      digitGray: extractGray(data, width, digitBBox),
      type: cardType,
      color,
      cost: parseInt(costMatch[1], 10),
    });
  }

  if (templates.length === 0) {
    throw new Error(`No valid cost templates found under ${TEMPLATES_DIR}`);
  }
  cachedTemplates = templates;
  return templates;
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

  // Stage A: color, scored across every type/cost combination.
  const colorBest = new Map();
  for (const t of templates) {
    const score = maskedDiffScore(dataFor(t), t.width, t);
    if (!colorBest.has(t.color) || score < colorBest.get(t.color)) colorBest.set(t.color, score);
  }
  const bestColor = [...colorBest.entries()].reduce((a, b) => (b[1] < a[1] ? b : a))[0];

  // Stage B: type, restricted to the chosen color.
  const sameColor = templates.filter((t) => t.color === bestColor);
  const typeBest = new Map();
  for (const t of sameColor) {
    const score = maskedDiffScore(dataFor(t), t.width, t);
    if (!typeBest.has(t.type) || score < typeBest.get(t.type)) typeBest.set(t.type, score);
  }
  const bestType = [...typeBest.entries()].reduce((a, b) => (b[1] < a[1] ? b : a))[0];

  // Stage C: cost, restricted to the chosen color+type, on the digit crop.
  const candidates = sameColor.filter((t) => t.type === bestType);
  let bestCost = null;
  let bestScore = -2;
  for (const t of candidates) {
    const score = digitCorrelationScore(dataFor(t), t.width, t.height, t);
    if (score > bestScore) {
      bestScore = score;
      bestCost = t.cost;
    }
  }

  return { type: bestType, color: bestColor, cost: bestCost };
}

module.exports = { loadTemplates, classifyImage };
