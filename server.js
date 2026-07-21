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
  const pool = { id: `pool-${Date.now()}`, name, createdAt: new Date().toISOString() };
  pools.push(pool);
  writePools(pools);
  res.status(201).json(pool);
});

app.patch("/api/pools/:id", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "カードプール名は必須です" });
  }

  const pools = readPools();
  const pool = pools.find((p) => p.id === req.params.id);
  if (!pool) return res.status(404).json({ error: "カードプールが見つかりません" });
  pool.name = name;
  writePools(pools);
  res.json(pool);
});

// ---- Cards ----

app.get("/api/cards", (req, res) => {
  const cards = readCards();
  if (req.query.poolId) {
    return res.json(cards.filter((c) => c.poolId === req.query.poolId));
  }
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
    createdAt: new Date().toISOString(),
  };
  cards.push(card);
  writeCards(cards);
  res.status(201).json(card);
});

// ---- Decks ----

app.get("/api/decks", (req, res) => {
  const decks = listDecks().map((d) => ({
    id: d.id,
    name: d.name,
    totalCount: d.cards.reduce((sum, c) => sum + c.count, 0),
    updatedAt: d.updatedAt,
  }));
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
  const deck = {
    id: deckId,
    name,
    poolIds: Array.isArray(poolIds) ? poolIds : [],
    cards,
    updatedAt: new Date().toISOString(),
  };
  writeDeck(deck);
  res.status(200).json(deck);
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
