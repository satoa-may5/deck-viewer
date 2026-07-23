const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

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

const app = express();
app.use(express.json());
app.use(express.static(path.join(ASSETS_ROOT, "public")));
app.use("/images", express.static(IMAGES_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// ---- Card pools ----

app.get("/api/pools", (req, res) => {
  const pools = readPools();
  const cards = readCards();
  res.json(
    pools.map((p) => ({
      ...p,
      cardCount: cards.filter((c) => c.poolId === p.id).length,
    }))
  );
});

app.post("/api/pools", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "カードプール名は必須です" });
  }

  const pools = readPools();
  const pool = { id: `pool-${Date.now()}`, name, favorite: false, createdAt: new Date().toISOString() };
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
    pool.name = name;
  }
  if (req.body.favorite !== undefined) {
    pool.favorite = Boolean(req.body.favorite);
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
  }

  const manifest = {
    poolName: pool.name,
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
    name: poolName,
    favorite: false,
    createdAt: new Date().toISOString(),
  };
  pools.push(newPool);
  writePools(pools);

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
    imported++;
  });
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

// ---- Decks ----

app.get("/api/decks", (req, res) => {
  const decks = listDecks()
    .map((d) => ({
      id: d.id,
      name: d.name,
      totalCount: d.cards.reduce((sum, c) => sum + c.count, 0),
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
  const { id, name, cards, poolIds } = req.body;
  if (!name) {
    return res.status(400).json({ error: "デッキ名は必須です" });
  }
  if (!Array.isArray(cards)) {
    return res.status(400).json({ error: "cardsは配列である必要があります" });
  }

  const deckId = id && ID_PATTERN.test(id) ? id : `deck-${Date.now()}`;
  const existing = readDeck(deckId);
  const deck = {
    id: deckId,
    name,
    poolIds: Array.isArray(poolIds) ? poolIds : [],
    cards,
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
