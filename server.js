const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DECKS_DIR = path.join(DATA_DIR, "decks");
const IMAGES_DIR = path.join(ROOT, "images");
const CARDS_FILE = path.join(DATA_DIR, "cards.json");
const POOLS_FILE = path.join(DATA_DIR, "cardpools.json");

for (const dir of [DATA_DIR, DECKS_DIR, IMAGES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
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
  "image/webp": "webp",
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
app.use(express.static(path.join(ROOT, "public")));
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
  const { id, name, cost, poolId } = req.body;

  if (!id || !ID_PATTERN.test(id)) {
    return res.status(400).json({ error: "カードIDが不正です(英数字・.・_・-のみ使用できます)" });
  }
  if (!name) {
    return res.status(400).json({ error: "カード名は必須です" });
  }
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
  if (cards.some((c) => c.id === id)) {
    return res.status(409).json({ error: `カードID "${id}" は既に登録されています` });
  }

  fs.writeFileSync(path.join(IMAGES_DIR, `${id}.${ext}`), req.file.buffer);

  const card = {
    id,
    name,
    cost: cost === undefined || cost === "" ? null : Number(cost),
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
    const name = (req.body.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "カード名は必須です" });
    }
    card.name = name;
  }
  if (req.body.cost !== undefined) {
    card.cost = req.body.cost === "" || req.body.cost === null ? null : Number(req.body.cost);
  }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`deck-viewer server running: http://localhost:${PORT}`);
});
