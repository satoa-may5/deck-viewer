const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { loadTemplates: loadCardInfoTemplates, classifyImage } = require("./tools/classify-cards");

// Static assets (public/) are read-only and safe to bundle inside a pkg snapshot,
// so they're resolved relative to the script itself (__dirname), which pkg
// transparently redirects into the snapshot filesystem. Data/images are written
// at runtime, so as a packaged exe they must live in a real, writable directory
// next to the exe rather than inside the read-only snapshot.
const ASSETS_ROOT = __dirname;
const APP_ROOT = process.pkg ? path.dirname(process.execPath) : __dirname;
const DATA_DIR = path.join(APP_ROOT, "data");
const DECKS_DIR = path.join(DATA_DIR, "decks");
const IMAGES_DIR = path.join(APP_ROOT, "images");
const CARDS_FILE = path.join(DATA_DIR, "cards.json");
const POOLS_FILE = path.join(DATA_DIR, "cardpools.json");
// pool-exports/ ships pre-made card pools: read-only content the developer prepares
// ahead of time (via the export endpoint, run locally — there's no export UI) and
// bundles into the exe snapshot at build time via pkg's assets config, the same way
// public/ is bundled. That's why it's resolved from ASSETS_ROOT rather than
// APP_ROOT — a packaged exe's snapshot is read-only, so this can only ever be a
// read source at runtime for whoever downloads and runs the exe; there is no
// network fetch or git operation involved on their end at all.
const EXPORTS_DIR = path.join(ASSETS_ROOT, "pool-exports");

for (const dir of [DATA_DIR, DECKS_DIR, IMAGES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
if (!process.pkg) {
  // Only creatable on a real filesystem — a packaged exe's snapshot is read-only,
  // and by the time it's packaged this either already has bundled content or is
  // legitimately absent (handled gracefully by the read side below).
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}
if (!fs.existsSync(CARDS_FILE)) {
  fs.writeFileSync(CARDS_FILE, "[]\n");
}
if (!fs.existsSync(POOLS_FILE)) {
  fs.writeFileSync(POOLS_FILE, "[]\n");
}

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

function readCards() {
  return JSON.parse(fs.readFileSync(CARDS_FILE, "utf8"));
}

function writeCards(cards) {
  fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2) + "\n");
}

function readPools() {
  return JSON.parse(fs.readFileSync(POOLS_FILE, "utf8"));
}

function writePools(pools) {
  fs.writeFileSync(POOLS_FILE, JSON.stringify(pools, null, 2) + "\n");
}

function readDeck(id) {
  const file = path.join(DECKS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeDeck(deck) {
  fs.writeFileSync(
    path.join(DECKS_DIR, `${deck.id}.json`),
    JSON.stringify(deck, null, 2) + "\n"
  );
}

function listDecks() {
  return fs
    .readdirSync(DECKS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DECKS_DIR, f), "utf8")));
}

function nextDeckOrder() {
  const decks = listDecks();
  return decks.reduce((max, d) => Math.max(max, typeof d.order === "number" ? d.order : 0), 0) + 1;
}

function nextCardOrder(cards) {
  return cards.reduce((max, c) => Math.max(max, typeof c.order === "number" ? c.order : 0), 0) + 1;
}

// Appends " (1)", " (2)", ... until `desired` no longer collides with anything
// in `existingNames` (case-sensitive exact match, matching how names are shown
// in the UI). Pass the current name in `existingNames` when renaming something
// in place so it doesn't collide with itself.
function uniqueName(desired, existingNames) {
  if (!existingNames.includes(desired)) return desired;
  let n = 1;
  while (existingNames.includes(`${desired} (${n})`)) n++;
  return `${desired} (${n})`;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(ASSETS_ROOT, "public")));
app.use("/images", express.static(IMAGES_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// ---- Card pools ----

function cardImageUrl(card) {
  return card ? `/images/${card.id}.${card.imageExt}` : null;
}

app.get("/api/pools", (req, res) => {
  const pools = readPools();
  const cards = readCards();
  res.json(
    pools.map((p) => ({
      ...p,
      cardCount: cards.filter((c) => c.poolId === p.id).length,
      thumbnailUrl: cardImageUrl(cards.find((c) => c.id === p.thumbnailCardId)),
    }))
  );
});

app.post("/api/pools", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "カードプール名は必須です" });
  }

  const pools = readPools();
  const pool = {
    id: `pool-${Date.now()}`,
    name: uniqueName(name, pools.map((p) => p.name)),
    favorite: false,
    createdAt: new Date().toISOString(),
  };
  pools.push(pool);
  writePools(pools);
  res.status(201).json(pool);
});

app.patch("/api/pools/:id", (req, res) => {
  const pools = readPools();
  const pool = pools.find((p) => p.id === req.params.id);
  if (!pool) return res.status(404).json({ error: "カードプールが見つかりません" });

  if (req.body.name !== undefined) {
    const name = (req.body.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "カードプール名は必須です" });
    }
    const otherNames = pools.filter((p) => p.id !== pool.id).map((p) => p.name);
    pool.name = uniqueName(name, otherNames);
  }
  if (req.body.favorite !== undefined) {
    pool.favorite = Boolean(req.body.favorite);
  }
  if (req.body.thumbnailCardId !== undefined) {
    const thumbnailCardId = req.body.thumbnailCardId;
    if (thumbnailCardId === null) {
      pool.thumbnailCardId = null;
    } else {
      const card = readCards().find((c) => c.id === thumbnailCardId && c.poolId === pool.id);
      if (!card) {
        return res.status(400).json({ error: "指定されたカードがこのプールに見つかりません" });
      }
      pool.thumbnailCardId = thumbnailCardId;
    }
  }
  writePools(pools);
  res.json(pool);
});

app.post("/api/pools/reorder", (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: "orderは配列である必要があります" });
  }
  const pools = readPools();
  if (order.length !== pools.length || !order.every((id) => pools.some((p) => p.id === id))) {
    return res.status(400).json({ error: "orderには全てのカードプールIDを過不足なく含めてください" });
  }
  const byId = Object.fromEntries(pools.map((p) => [p.id, p]));
  writePools(order.map((id) => byId[id]));
  res.status(204).end();
});

app.delete("/api/pools/:id", (req, res) => {
  const pools = readPools();
  const pool = pools.find((p) => p.id === req.params.id);
  if (!pool) return res.status(404).json({ error: "カードプールが見つかりません" });

  const cards = readCards();
  const remainingCards = cards.filter((c) => c.poolId !== req.params.id);
  const removedCards = cards.filter((c) => c.poolId === req.params.id);
  for (const card of removedCards) {
    const file = path.join(IMAGES_DIR, `${card.id}.${card.imageExt}`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  writeCards(remainingCards);
  writePools(pools.filter((p) => p.id !== req.params.id));
  res.status(204).end();
});

// ---- Card pool import (pre-bundled, read-only) ----
//
// There is no export UI — pools are prepared ahead of time either by dropping a
// folder of images straight into pool-exports/<name>/images/ (manifest.json is
// optional: card names default to their image filename, and the pool name
// defaults to the folder name), or by calling the export endpoint directly (e.g.
// with curl) against an existing pool. Either way the result gets bundled into the
// exe at build time via pkg's assets config, and whoever downloads and runs the
// exe only ever sees the import side: picking a bundled pool and clicking a
// button. No network fetch, no git, no commands on their end.

function defaultNameFromImage(image) {
  return image ? path.basename(image, path.extname(image)) : "";
}

const CARD_TYPES = ["character", "event", "field"];

function normalizeCardType(type) {
  return CARD_TYPES.includes(type) ? type : "";
}

function readManifest(folder) {
  const manifestFile = path.join(folder, "manifest.json");
  if (!fs.existsSync(manifestFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } catch (err) {
    return null;
  }
}

// Explicit manifest.cards wins (lets you pick names/order/cost/color/parallel by
// hand); otherwise every image file found in images/ is used, sorted by filename,
// with cost/color/parallel left at their defaults (unknown from a filename alone).
function resolveManifestCards(folder, manifest) {
  if (Array.isArray(manifest.cards)) {
    return manifest.cards
      .filter((item) => item && item.image)
      .map((item) => ({
        image: item.image,
        name: (item.name && String(item.name).trim()) || defaultNameFromImage(item.image),
        cost: item.cost ?? null,
        color: (item.color && String(item.color).trim()) || "",
        parallel: Boolean(item.parallel),
        type: normalizeCardType(item.type),
      }));
  }
  const imagesFolder = path.join(folder, "images");
  if (!fs.existsSync(imagesFolder)) return [];
  return fs
    .readdirSync(imagesFolder)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map((image) => ({ image, name: defaultNameFromImage(image), cost: null, color: "", parallel: false, type: "" }));
}

app.get("/api/pool-exports", (req, res) => {
  if (!fs.existsSync(EXPORTS_DIR)) return res.json([]);
  const entries = fs.readdirSync(EXPORTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  const exportList = [];
  for (const entry of entries) {
    const folder = path.join(EXPORTS_DIR, entry.name);
    const manifest = readManifest(folder);
    if (manifest === null) continue; // malformed manifest.json
    const cards = resolveManifestCards(folder, manifest);
    if (cards.length === 0) continue; // nothing importable here
    exportList.push({
      folderId: entry.name,
      poolName: manifest.poolName || entry.name,
      cardCount: cards.length,
      exportedAt: manifest.exportedAt || null,
    });
  }
  res.json(exportList);
});

// Dev-only: no button calls this. Run it locally (e.g. via curl) to prepare a
// pool-exports/<poolId>/ folder before `npm run build:exe` bundles it in.
app.post("/api/pools/:id/export", (req, res) => {
  const pools = readPools();
  const pool = pools.find((p) => p.id === req.params.id);
  if (!pool) return res.status(404).json({ error: "カードプールが見つかりません" });

  const cards = readCards()
    .filter((c) => c.poolId === pool.id)
    .sort((a, b) => (typeof a.order === "number" ? a.order : 0) - (typeof b.order === "number" ? b.order : 0));

  const folder = path.join(EXPORTS_DIR, pool.id);
  const imagesFolder = path.join(folder, "images");
  fs.mkdirSync(imagesFolder, { recursive: true });

  const manifestCards = [];
  let thumbnailImage = null;
  for (const card of cards) {
    const srcImage = path.join(IMAGES_DIR, `${card.id}.${card.imageExt}`);
    if (!fs.existsSync(srcImage)) continue;
    const imageName = `${card.id}.${card.imageExt}`;
    fs.writeFileSync(path.join(imagesFolder, imageName), fs.readFileSync(srcImage));
    manifestCards.push({
      name: card.name,
      cost: card.cost,
      color: card.color || "",
      parallel: Boolean(card.parallel),
      type: normalizeCardType(card.type),
      image: imageName,
    });
    if (card.id === pool.thumbnailCardId) thumbnailImage = imageName;
  }

  const manifest = {
    poolName: pool.name,
    thumbnail: thumbnailImage,
    exportedAt: new Date().toISOString(),
    cards: manifestCards,
  };
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  res.json({ folderId: pool.id, poolName: pool.name, cardCount: manifestCards.length });
});

app.post("/api/pool-exports/:folderId/import", (req, res) => {
  const folder = path.join(EXPORTS_DIR, req.params.folderId);
  if (!fs.existsSync(folder)) {
    return res.status(404).json({ error: "インポート元が見つかりません" });
  }
  const manifest = readManifest(folder);
  if (manifest === null) {
    return res.status(400).json({ error: "manifest.jsonの形式が不正です" });
  }
  const manifestCards = resolveManifestCards(folder, manifest);
  if (manifestCards.length === 0) {
    return res.status(400).json({ error: "インポートできる画像が見つかりません" });
  }

  const poolName = (req.body && req.body.name && req.body.name.trim()) || manifest.poolName || req.params.folderId;
  const pools = readPools();
  const newPool = {
    id: `pool-${Date.now()}`,
    name: uniqueName(poolName, pools.map((p) => p.name)),
    favorite: false,
    thumbnailCardId: null,
    createdAt: new Date().toISOString(),
  };
  pools.push(newPool);

  const cards = readCards();
  let order = nextCardOrder(cards);
  const imagesFolder = path.join(folder, "images");
  let imported = 0;
  manifestCards.forEach((item, index) => {
    const srcImage = path.join(imagesFolder, item.image);
    if (!fs.existsSync(srcImage)) return;
    const ext = path.extname(item.image).slice(1);
    const id = `card-${Date.now() + index}`;
    fs.writeFileSync(path.join(IMAGES_DIR, `${id}.${ext}`), fs.readFileSync(srcImage));
    cards.push({
      id,
      name: item.name,
      cost: item.cost,
      color: item.color,
      parallel: item.parallel,
      type: item.type,
      poolId: newPool.id,
      imageExt: ext,
      order: order++,
      createdAt: new Date().toISOString(),
    });
    if (manifest.thumbnail && item.image === manifest.thumbnail) newPool.thumbnailCardId = id;
    imported++;
  });
  writePools(pools);
  writeCards(cards);

  res.status(201).json({ pool: newPool, cardCount: imported });
});

// ---- Cards ----

app.get("/api/cards", (req, res) => {
  let cards = readCards();
  if (req.query.poolId) {
    cards = cards.filter((c) => c.poolId === req.query.poolId);
  }
  cards = [...cards].sort(
    (a, b) => (typeof a.order === "number" ? a.order : 0) - (typeof b.order === "number" ? b.order : 0)
  );
  res.json(cards);
});

app.post("/api/cards", upload.single("image"), (req, res) => {
  const { name, cost, poolId, color, parallel, type } = req.body;

  if (!poolId) {
    return res.status(400).json({ error: "カードプールを選択してください" });
  }
  const pools = readPools();
  if (!pools.some((p) => p.id === poolId)) {
    return res.status(400).json({ error: "指定されたカードプールが見つかりません" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "画像が送信されていません" });
  }
  const ext = MIME_TO_EXT[req.file.mimetype];
  if (!ext) {
    return res.status(400).json({ error: `対応していない画像形式です: ${req.file.mimetype}` });
  }

  const cards = readCards();
  const id = `card-${Date.now()}`;
  fs.writeFileSync(path.join(IMAGES_DIR, `${id}.${ext}`), req.file.buffer);

  const card = {
    id,
    name: (name || "").trim(),
    cost: cost === undefined || cost === "" ? null : Number(cost),
    color: (color || "").trim(),
    parallel: parallel === true || parallel === "true",
    type: normalizeCardType(type),
    poolId,
    imageExt: ext,
    order: nextCardOrder(cards),
    createdAt: new Date().toISOString(),
  };
  cards.push(card);
  writeCards(cards);
  res.status(201).json(card);
});

app.patch("/api/cards/:id", (req, res) => {
  const cards = readCards();
  const card = cards.find((c) => c.id === req.params.id);
  if (!card) return res.status(404).json({ error: "カードが見つかりません" });

  if (req.body.name !== undefined) {
    card.name = (req.body.name || "").trim();
  }
  if (req.body.cost !== undefined) {
    card.cost = req.body.cost === "" || req.body.cost === null ? null : Number(req.body.cost);
  }
  if (req.body.color !== undefined) {
    card.color = (req.body.color || "").trim();
  }
  if (req.body.parallel !== undefined) {
    card.parallel = Boolean(req.body.parallel);
  }
  if (req.body.type !== undefined) {
    card.type = normalizeCardType(req.body.type);
  }
  // A manual edit to any auto-detected field counts as the user having
  // reviewed it, so the "自動取得の結果が怪しい" warning mark no longer applies.
  if (req.body.type !== undefined || req.body.color !== undefined || req.body.cost !== undefined) {
    card.infoUncertain = false;
  }
  // Optional: also push this card's type/color/cost onto its own parallel
  // printings (see parseCardNameParts below for how a parallel is identified
  // by name) -- lets the manual uncertain-card review flow fix a whole
  // print run in one edit instead of repeating it per parallel.
  if (req.body.applyToParallels) {
    const parts = parseCardNameParts(card.name);
    if (parts && !parts.isParallel) {
      const poolMates = cards.filter((c) => c.poolId === card.poolId && c.id !== card.id);
      for (const mate of poolMates) {
        const mateParts = parseCardNameParts(mate.name);
        if (!mateParts || !mateParts.isParallel || mateParts.code !== parts.code) continue;
        mate.type = card.type;
        mate.color = card.color;
        mate.cost = card.cost;
        mate.infoUncertain = false;
      }
    }
  }
  writeCards(cards);
  res.json(card);
});

app.post("/api/cards/:id/image", upload.single("image"), (req, res) => {
  const cards = readCards();
  const card = cards.find((c) => c.id === req.params.id);
  if (!card) return res.status(404).json({ error: "カードが見つかりません" });
  if (!req.file) {
    return res.status(400).json({ error: "画像が送信されていません" });
  }
  const ext = MIME_TO_EXT[req.file.mimetype];
  if (!ext) {
    return res.status(400).json({ error: `対応していない画像形式です: ${req.file.mimetype}` });
  }

  const oldFile = path.join(IMAGES_DIR, `${card.id}.${card.imageExt}`);
  if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
  fs.writeFileSync(path.join(IMAGES_DIR, `${card.id}.${ext}`), req.file.buffer);
  card.imageExt = ext;
  writeCards(cards);
  res.json(card);
});

app.post("/api/cards/reorder", (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: "orderは配列である必要があります" });
  }
  const cards = readCards();
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  if (!order.every((id) => byId[id])) {
    return res.status(400).json({ error: "指定されたカードが見つかりません" });
  }
  order.forEach((id, index) => {
    byId[id].order = index;
  });
  writeCards(cards);
  res.status(204).end();
});

app.delete("/api/cards/:id", (req, res) => {
  const cards = readCards();
  const card = cards.find((c) => c.id === req.params.id);
  if (!card) return res.status(404).json({ error: "カードが見つかりません" });

  const file = path.join(IMAGES_DIR, `${card.id}.${card.imageExt}`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  writeCards(cards.filter((c) => c.id !== req.params.id));
  res.status(204).end();
});

// ---- Card info auto-detection ----
//
// Classifies each card's type/color/cost from its image via
// tools/classify-cards.js (template matching against tools/cost-templates/,
// running in-process via Jimp -- pure JS, no native bindings or external
// interpreter -- so this works the same from the packaged exe as it does in
// dev; an earlier version shelled out to Python+OpenCV, which broke the
// single-portable-exe distribution goal since recipients don't have that
// installed). Classifying a whole pool can still take a little while, so it
// runs as a background job: the request returns immediately with a job id,
// and the frontend polls GET /api/card-info-jobs for status/results across
// page navigations.

// poolId -> job. One job per pool at a time; only ever the latest job for
// that pool is kept (starting a new one replaces it).
const cardInfoJobs = new Map();

// Parallel/foil printings render the cost badge in a completely different
// style -- often a metallic/inverted digit -- that the template library
// (built from flat, non-foil renders) doesn't represent. Rather than
// classify them directly and risk a wrong read, they inherit type/color/cost
// from their same-pool non-parallel base card when one can be identified by
// name.
//
// Names follow "<SET>_<CODE>" optionally followed by "_p<N>" (e.g.
// "UA53BT_CSM-1-017", "UA53BT_CSM-1-017_p1"), where <CODE> is the part that
// actually identifies the card (e.g. "CSM-1-017") and is stable across
// reprints/parallels even when <SET> isn't: a card can equally be a parallel
// via the "_p<N>" suffix (same SET as its base), via a SET of literally
// "UAPR" instead of a real set code (e.g. "UAPR_KMR-2-052" parallels
// "EX12BT_KMR-2-052" -- a *different* SET than its own prefix), or both at
// once (e.g. "UAPR_KMR-1-021_p1" also parallels "UA29BT_KMR-1-021"). So the
// base lookup has to match on <CODE> alone, not on SET_CODE as a whole, and
// "UAPR" needs to count as a parallel marker even with no "_p<N>" suffix.
function parseCardNameParts(name) {
  const m = /^([^_]+)_(.+)$/.exec(name || "");
  if (!m) return null;
  const [, set, rest] = m;
  const suffixMatch = /^(.*)_p\d+$/.exec(rest);
  const code = suffixMatch ? suffixMatch[1] : rest;
  const isParallel = set === "UAPR" || Boolean(suffixMatch);
  return { code, isParallel };
}

app.post("/api/pools/:id/auto-fill-info", (req, res) => {
  const pool = readPools().find((p) => p.id === req.params.id);
  if (!pool) return res.status(404).json({ error: "カードプールが見つかりません" });

  const existingJob = cardInfoJobs.get(pool.id);
  if (existingJob && existingJob.status === "running") {
    return res.status(409).json({ error: "このカードプールは既に処理中です" });
  }

  const poolCards = readCards().filter((c) => c.poolId === pool.id && c.imageExt);
  if (poolCards.length === 0) {
    return res.status(400).json({ error: "画像付きのカードがありません" });
  }

  const job = {
    id: `job-${Date.now()}`,
    poolId: pool.id,
    poolName: pool.name,
    status: "running",
    overwrite: Boolean(req.body && req.body.overwrite),
    startedAt: new Date().toISOString(),
    classifyStartedAt: null, // set once template loading finishes, see runAutoFillInfoJob
    finishedAt: null,
    progress: { current: 0, total: poolCards.length },
    summary: null,
    error: null,
  };
  cardInfoJobs.set(pool.id, job);
  res.status(202).json(withEta(job));

  runAutoFillInfoJob(job, poolCards).catch((err) => {
    job.status = "error";
    job.error = err && err.message ? err.message : String(err);
    job.finishedAt = new Date().toISOString();
  });
});

function isEmptyValue(v) {
  return v === "" || v === null || v === undefined;
}

// A classification is flagged uncertain (surfaced as a warning mark in the
// UI) when its cost match's raw correlation score falls below this. Picked
// empirically against 1028 real cards: confidently-correct matches scored
// ~0.55-0.85, while the one genuine unfixable case (a cost value with no
// template in any color) scored 0.42-0.45 -- 0.5 sits cleanly in the gap
// with zero false positives in that test set.
const COST_CONFIDENCE_THRESHOLD = 0.5;

async function runAutoFillInfoJob(job, poolCards) {
  const byCode = new Map(); // code -> non-parallel base card
  for (const card of poolCards) {
    const parts = parseCardNameParts(card.name);
    if (parts && !parts.isParallel) byCode.set(parts.code, card);
  }

  const directCards = [];
  const inheritPairs = []; // [card, baseCard]
  for (const card of poolCards) {
    const parts = parseCardNameParts(card.name);
    const base = parts && parts.isParallel ? byCode.get(parts.code) : null;
    if (base) {
      inheritPairs.push([card, base]);
    } else {
      directCards.push(card);
    }
  }

  // Progress/ETA only track directCards -- inheritPairs are just copied from
  // their already-classified base afterward (no per-card classification
  // work, effectively instant), so counting them in the total made the bar
  // stall at the real work's pace and then jump straight to 100% once the
  // inherit pass ran, and inflated the ETA by however many parallels the
  // pool had (their "remaining work" was counted but never actually cost
  // any time).
  job.progress.total = directCards.length;

  const templates = await loadCardInfoTemplates();
  // Timestamped separately from job.startedAt: the first auto-fill run since
  // the server started pays a one-time cost here (reading ~275 template PNG
  // files via Jimp), which used to get baked into the elapsed-time/current
  // average ETA used, making the very first few cards' estimate wildly high
  // and then crash down fast as later, template-load-free cards pulled the
  // average back toward the real per-card pace. Measuring elapsed from here
  // instead keeps the average pace estimate representative of actual
  // classification work from the start.
  job.classifyStartedAt = new Date().toISOString();
  const results = {};
  for (const card of directCards) {
    const info = await classifyImage(path.join(IMAGES_DIR, `${card.id}.${card.imageExt}`), templates);
    if (info) results[card.id] = info;
    job.progress.current++;
    // classifyImage's template matching is synchronous, CPU-heavy work that
    // otherwise runs card-after-card with no gap, starving the event loop and
    // making every other request (including plain page loads) sluggish for
    // the whole job's duration. Yielding once per card lets pending requests
    // get a turn in between, at the cost of the job itself taking slightly
    // longer wall-clock time.
    await new Promise((resolve) => setImmediate(resolve));
  }

  const cards = readCards();
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  let updated = 0;
  let skipped = 0;
  let uncertain = 0;

  const applyResult = (card, info) => {
    const target = cardsById.get(card.id);
    if (!info || !target) {
      skipped++;
      return;
    }
    const canWrite = (field) => job.overwrite || isEmptyValue(target[field]);
    let changed = false;
    if (canWrite("type") && info.type) {
      target.type = info.type;
      changed = true;
    }
    if (canWrite("color") && info.color) {
      target.color = info.color;
      changed = true;
    }
    if (canWrite("cost") && !isEmptyValue(info.cost)) {
      target.cost = info.cost;
      changed = true;
    }
    const isUncertain = typeof info.costConfidence === "number" && info.costConfidence < COST_CONFIDENCE_THRESHOLD;
    if (target.infoUncertain !== isUncertain) {
      target.infoUncertain = isUncertain;
      changed = true;
    }
    if (isUncertain) uncertain++;
    if (changed) updated++;
    else skipped++;
  };

  for (const card of directCards) {
    applyResult(card, results[card.id]);
  }
  for (const [card, base] of inheritPairs) {
    const baseTarget = cardsById.get(base.id);
    const info =
      results[base.id] ||
      (baseTarget && (baseTarget.type || baseTarget.color || !isEmptyValue(baseTarget.cost))
        ? { type: baseTarget.type, color: baseTarget.color, cost: baseTarget.cost, costConfidence: baseTarget.infoUncertain ? 0 : 1 }
        : null);
    applyResult(card, info);
  }

  writeCards(cards);

  job.status = "done";
  job.finishedAt = new Date().toISOString();
  job.summary = {
    total: poolCards.length,
    classified: directCards.filter((c) => results[c.id]).length,
    inherited: inheritPairs.length,
    updated,
    skipped,
    uncertain,
  };
}

// Estimated remaining seconds, derived from how long the job has taken to
// reach its current progress so far (no fixed per-card cost is assumed,
// since classification time varies with image size/format). Not stored on
// the job itself -- computed fresh on every read so it stays accurate as
// time passes between polls.
function withEta(job) {
  if (job.status !== "running" || !job.progress || job.progress.current === 0 || !job.classifyStartedAt) {
    return { ...job, etaSeconds: null };
  }
  const elapsedMs = Date.now() - new Date(job.classifyStartedAt).getTime();
  const perCardMs = elapsedMs / job.progress.current;
  const remainingMs = perCardMs * (job.progress.total - job.progress.current);
  return { ...job, etaSeconds: Math.max(0, Math.round(remainingMs / 1000)) };
}

app.get("/api/card-info-jobs", (req, res) => {
  res.json([...cardInfoJobs.values()].map(withEta));
});

// ---- Decks ----

app.get("/api/decks", (req, res) => {
  const cards = readCards();
  const decks = listDecks()
    .map((d) => ({
      id: d.id,
      name: d.name,
      totalCount: d.cards.reduce((sum, c) => sum + c.count, 0),
      thumbnailUrl: cardImageUrl(cards.find((c) => c.id === d.thumbnailCardId)),
      updatedAt: d.updatedAt,
      order: typeof d.order === "number" ? d.order : 0,
    }))
    .sort((a, b) => a.order - b.order);
  res.json(decks);
});

app.get("/api/decks/:id", (req, res) => {
  const deck = readDeck(req.params.id);
  if (!deck) return res.status(404).json({ error: "デッキが見つかりません" });
  res.json(deck);
});

app.post("/api/decks", (req, res) => {
  const { id, name, cards, poolIds, thumbnailCardId } = req.body;
  if (!name) {
    return res.status(400).json({ error: "デッキ名は必須です" });
  }
  if (!Array.isArray(cards)) {
    return res.status(400).json({ error: "cardsは配列である必要があります" });
  }

  const deckId = id && ID_PATTERN.test(id) ? id : `deck-${Date.now()}`;
  const existing = readDeck(deckId);
  const otherNames = listDecks()
    .filter((d) => d.id !== deckId)
    .map((d) => d.name);
  // Silently dropped rather than rejected: a stale thumbnail pointing at a card
  // no longer in the deck shouldn't block saving the rest of the deck.
  const validThumbnail =
    thumbnailCardId && cards.some((c) => c.cardId === thumbnailCardId) ? thumbnailCardId : null;
  const deck = {
    id: deckId,
    name: uniqueName(name, otherNames),
    poolIds: Array.isArray(poolIds) ? poolIds : [],
    cards,
    thumbnailCardId: validThumbnail,
    order: existing ? existing.order ?? nextDeckOrder() : nextDeckOrder(),
    updatedAt: new Date().toISOString(),
  };
  writeDeck(deck);
  res.status(200).json(deck);
});

app.post("/api/decks/reorder", (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: "orderは配列である必要があります" });
  }
  const decks = listDecks();
  if (order.length !== decks.length || !order.every((id) => decks.some((d) => d.id === id))) {
    return res.status(400).json({ error: "orderには全てのデッキIDを過不足なく含めてください" });
  }
  const byId = Object.fromEntries(decks.map((d) => [d.id, d]));
  order.forEach((id, index) => {
    writeDeck({ ...byId[id], order: index });
  });
  res.status(204).end();
});

app.delete("/api/decks/:id", (req, res) => {
  const file = path.join(DECKS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "デッキが見つかりません" });
  fs.unlinkSync(file);
  res.status(204).end();
});

function openBrowser(url) {
  const { exec } = require("child_process");
  if (process.platform === "win32") {
    exec(`start "" "${url}"`);
  } else if (process.platform === "darwin") {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`deck-viewer server running: ${url}`);
  // Only auto-open when running as a packaged exe — during `npm start`/`npm run dev`
  // this would pop a new browser tab on every restart, which is just noise for development.
  if (process.pkg) {
    openBrowser(url);
  }
});
