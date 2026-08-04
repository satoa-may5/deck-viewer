const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
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
// Pre-made card pools now live as committed pool-exports/*.dvpool files in the
// (public) GitHub repo and are fetched live at import time — see the
// "Pre-made card pool import from GitHub" section below. Nothing is bundled
// into the exe for this anymore.
const GITHUB_REPO = "satoa-may5/deck-viewer";
const GITHUB_BRANCH = "master";

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
// A pool export bundles every card's image into one zip, easily well past a
// single card image's 15MB limit above for any pool of real size.
const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// ホーム画面のクレジット表記(バージョン)がpackage.jsonとズレないよう、
// バージョン文字列自体はここから配る(index.htmlに手書きで埋め込まない)。
const APP_VERSION = require("./package.json").version;

app.get("/api/version", (req, res) => {
  res.json({ version: APP_VERSION });
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

// ---- Pre-made card pool import from GitHub ----
//
// Pools are prepared ahead of time by exporting them as a .dvpool file (the
// "カードプールをエクスポート" button, see the export-zip endpoint below) and
// committing that file under pool-exports/ in this GitHub repo (public, so no
// auth is needed to fetch it). The app fetches the current file listing and,
// on import, the raw file bytes, straight from GitHub at runtime -- nothing
// is bundled into the exe, and whoever downloads and runs the exe only ever
// sees the import side: picking a pool from the list and clicking a button.
// No git, no commands on their end.

function defaultNameFromImage(image) {
  return image ? path.basename(image, path.extname(image)) : "";
}

const CARD_TYPES = ["character", "event", "field"];
const TRIGGER_TYPES = ["active", "drow", "final", "get", "raid", "special", "color"];

function normalizeCardType(type) {
  return CARD_TYPES.includes(type) ? type : "";
}

function normalizeTrigger(trigger) {
  return TRIGGER_TYPES.includes(trigger) ? trigger : "";
}

// attribute (特徴) arrives as a real array in a JSON body (PATCH) but has to be
// JSON-stringified by the client for multipart form submission (POST with an
// image file), so this accepts either.
function normalizeAttribute(attribute) {
  let arr = attribute;
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch (err) {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim());
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

// Explicit manifest.cards wins (lets you pick cardName/order/cost/color/parallel
// by hand); otherwise every image file found in images/ is used, sorted by
// filename, with everything else left at its default (unknown from a filename
// alone).
//
// `name` (the app's internal identifier -- shown as a fallback caption, used
// for CARD-001-style auto-numbering and parallel-print detection) is always
// derived from the image filename, never from manifest.cards[].name. That
// field instead populates `cardName`, the real/display card name -- earlier
// manifests used `name` for both roles at once, but once a manifest can also
// carry a genuine display name (rarity/ap/bp/attribute/generatedEnergy/effect
// packs), those two things need to be kept separate.
function resolveManifestCards(folder, manifest) {
  if (Array.isArray(manifest.cards)) {
    return manifest.cards
      .filter((item) => item && item.image)
      .map((item) => ({
        image: item.image,
        name: defaultNameFromImage(item.image),
        cardName: (item.name && String(item.name).trim()) || "",
        cost: item.cost ?? null,
        color: (item.color && String(item.color).trim()) || "",
        parallel: Boolean(item.parallel),
        type: normalizeCardType(item.type),
        trigger: normalizeTrigger(item.trigger),
        rarity: (item.rarity && String(item.rarity).trim()) || "",
        ap: typeof item.ap === "number" ? item.ap : null,
        bp: item.bp !== undefined && item.bp !== null ? String(item.bp).trim() : "",
        attribute: normalizeAttribute(item.attribute),
        generatedEnergy:
          item.generatedEnergy !== undefined && item.generatedEnergy !== null
            ? String(item.generatedEnergy).trim()
            : "",
        effect: (item.effect && String(item.effect).trim()) || "",
      }));
  }
  const imagesFolder = path.join(folder, "images");
  if (!fs.existsSync(imagesFolder)) return [];
  return fs
    .readdirSync(imagesFolder)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map((image) => ({
      image,
      name: defaultNameFromImage(image),
      cardName: "",
      cost: null,
      color: "",
      parallel: false,
      type: "",
      trigger: "",
      rarity: "",
      ap: null,
      bp: "",
      attribute: [],
      generatedEnergy: "",
      effect: "",
    }));
}

// Shared by the GitHub-hosted .dvpool import and the user-facing local-file
// zip import below -- both end up with a manifest + an images/ folder on
// disk (extracted to a temp dir first), so the actual pool/card-creation
// logic is identical either way.
function importPoolFromFolder(folder, manifest, manifestCards, desiredName) {
  const pools = readPools();
  const newPool = {
    id: `pool-${Date.now()}`,
    name: uniqueName(desiredName, pools.map((p) => p.name)),
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
      cardName: item.cardName || "",
      cost: item.cost,
      color: item.color,
      parallel: item.parallel,
      type: item.type,
      trigger: item.trigger,
      rarity: item.rarity || "",
      ap: item.ap ?? null,
      bp: item.bp || "",
      attribute: item.attribute || [],
      generatedEnergy: item.generatedEnergy || "",
      effect: item.effect || "",
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

  return { pool: newPool, cardCount: imported };
}

const GITHUB_DVPOOL_NAME = /^[A-Za-z0-9._-]+\.dvpool$/;

// 以前は一覧取得のたびにGitHubのContents APIを叩き、さらに新規/更新された
// .dvpoolごとに本体(数十MBのzip)を丸ごとダウンロードしてmanifest.jsonだけを
// 読む、という重い処理をしていた(サーバー再起動直後の初回アクセスが特に遅い
// 原因だった)。pool-exports/index.json(tools/build-pool-export-index.jsで
// .dvpoolを追加/更新するたびに作り直し、一緒にコミットしておく事前生成済みの
// 一覧)を1回fetchするだけで済むようにした。
let githubPoolListCache = null; // { fetchedAt, pools }
const GITHUB_POOL_LIST_CACHE_TTL = 60 * 1000; // 短時間の連打で何度もfetchしないための最小限のTTL

async function listGithubPools() {
  if (githubPoolListCache && Date.now() - githubPoolListCache.fetchedAt < GITHUB_POOL_LIST_CACHE_TTL) {
    return githubPoolListCache.pools;
  }
  const indexUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/pool-exports/index.json`;
  const res = await fetch(indexUrl, { headers: { "User-Agent": "deck-viewer" } });
  if (!res.ok) throw new Error(`index fetch failed: ${res.status}`);
  const entries = await res.json();
  const pools = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && GITHUB_DVPOOL_NAME.test(e.name))
    .map((e) => ({
      name: e.name,
      poolName: e.poolName || path.basename(e.name, ".dvpool"),
      release: e.release || null,
      size: e.size,
    }));
  githubPoolListCache = { fetchedAt: Date.now(), pools };
  return pools;
}

app.get("/api/github-pools", async (req, res) => {
  try {
    res.json(await listGithubPools());
  } catch (err) {
    res.status(502).json({ error: "GitHubからの取得に失敗しました" });
  }
});

app.post("/api/github-pools/import", async (req, res) => {
  const name = req.body && req.body.fileName;
  if (!name || !GITHUB_DVPOOL_NAME.test(name)) {
    return res.status(400).json({ error: "不正なファイル名です" });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dv-github-pool-"));
  try {
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/pool-exports/${name}`;
    const fileRes = await fetch(rawUrl, { headers: { "User-Agent": "deck-viewer" } });
    if (!fileRes.ok) {
      return res.status(502).json({ error: "GitHubからのダウンロードに失敗しました" });
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    try {
      new AdmZip(buffer).extractAllTo(tempDir, true);
    } catch (err) {
      return res.status(400).json({ error: "ファイルの読み込みに失敗しました" });
    }
    const manifest = readManifest(tempDir);
    if (manifest === null) {
      return res.status(400).json({ error: "manifest.jsonの形式が不正です" });
    }
    const manifestCards = resolveManifestCards(tempDir, manifest);
    if (manifestCards.length === 0) {
      return res.status(400).json({ error: "インポートできる画像が見つかりません" });
    }
    const poolName =
      (req.body && req.body.name && req.body.name.trim()) || manifest.poolName || path.basename(name, ".dvpool");
    res.status(201).json(importPoolFromFolder(tempDir, manifest, manifestCards, poolName));
  } catch (err) {
    res.status(502).json({ error: "GitHubからのダウンロードに失敗しました" });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---- Card pool export/import as a downloadable .dvpool file ----
//
// A raw pool-exports/<id>/ folder isn't something you'd want to hand someone
// to download directly (a bare folder full of loose files), so this zips the
// same manifest.json + images/ structure into one file instead -- .dvpool is
// just a renamed .zip, not a real distinct format, but keeps it from being
// mistaken for a generic archive the OS might try to "helpfully" auto-extract.

app.get("/api/pools/:id/export-zip", (req, res) => {
  const pool = readPools().find((p) => p.id === req.params.id);
  if (!pool) return res.status(404).json({ error: "カードプールが見つかりません" });

  const cards = readCards()
    .filter((c) => c.poolId === pool.id)
    .sort((a, b) => (typeof a.order === "number" ? a.order : 0) - (typeof b.order === "number" ? b.order : 0));

  const zip = new AdmZip();
  const manifestCards = [];
  let thumbnailImage = null;
  for (const card of cards) {
    const srcImage = path.join(IMAGES_DIR, `${card.id}.${card.imageExt}`);
    if (!fs.existsSync(srcImage)) continue;
    const imageName = `${card.id}.${card.imageExt}`;
    zip.addFile(`images/${imageName}`, fs.readFileSync(srcImage));
    // manifest.json's "name" key round-trips through cardName, not the app's
    // internal name/identifier -- see resolveManifestCards for why (import
    // always re-derives that identifier from the image filename instead).
    manifestCards.push({
      name: card.cardName || "",
      cost: card.cost,
      color: card.color || "",
      parallel: Boolean(card.parallel),
      type: normalizeCardType(card.type),
      trigger: normalizeTrigger(card.trigger),
      rarity: card.rarity || "",
      ap: typeof card.ap === "number" ? card.ap : null,
      bp: card.bp || "",
      attribute: Array.isArray(card.attribute) ? card.attribute : [],
      generatedEnergy: card.generatedEnergy || "",
      effect: card.effect || "",
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
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));

  const filename = `${pool.name}.dvpool`;
  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  res.send(zip.toBuffer());
});

app.post("/api/pools/import-zip", uploadZip.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ファイルが送信されていません" });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dv-pool-import-"));
  try {
    const zip = new AdmZip(req.file.buffer);
    zip.extractAllTo(tempDir, true);
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return res.status(400).json({ error: "エクスポートファイルの読み込みに失敗しました" });
  }

  try {
    const manifest = readManifest(tempDir);
    if (manifest === null) {
      return res.status(400).json({ error: "manifest.jsonの形式が不正です" });
    }
    const manifestCards = resolveManifestCards(tempDir, manifest);
    if (manifestCards.length === 0) {
      return res.status(400).json({ error: "インポートできる画像が見つかりません" });
    }
    const poolName =
      (req.body && req.body.name && req.body.name.trim()) || manifest.poolName || "インポートしたカードプール";
    res.status(201).json(importPoolFromFolder(tempDir, manifest, manifestCards, poolName));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
  const {
    name,
    cardName,
    cost,
    poolId,
    color,
    parallel,
    type,
    trigger,
    rarity,
    ap,
    bp,
    attribute,
    generatedEnergy,
    effect,
    unedited,
  } = req.body;

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
    cardName: (cardName || "").trim(),
    cost: cost === undefined || cost === "" ? null : Number(cost),
    color: (color || "").trim(),
    parallel: parallel === true || parallel === "true",
    type: normalizeCardType(type),
    trigger: normalizeTrigger(trigger),
    rarity: (rarity || "").trim(),
    ap: ap === undefined || ap === "" ? null : Number(ap),
    bp: (bp || "").trim(),
    attribute: normalizeAttribute(attribute),
    generatedEnergy: (generatedEnergy || "").trim(),
    effect: (effect || "").trim(),
    // 複数枚追加フロー(画像だけ登録し、情報入力は後回し)で作られたカードにだけ
    // 立つフラグ。「1枚追加」経由なら常にfalse(そちらは毎回このフォームを
    // 経由するため、情報が空でも「未編集」扱いにはしない)。
    unedited: unedited === true || unedited === "true",
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

  // このエンドポイントは常に「カードを編集」モーダルの保存からしか呼ばれない
  // ため、到達した時点で「未編集」ではなくなったとみなしてよい。
  card.unedited = false;

  if (req.body.name !== undefined) {
    card.name = (req.body.name || "").trim();
  }
  if (req.body.cardName !== undefined) {
    card.cardName = (req.body.cardName || "").trim();
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
  if (req.body.trigger !== undefined) {
    card.trigger = normalizeTrigger(req.body.trigger);
  }
  if (req.body.rarity !== undefined) {
    card.rarity = (req.body.rarity || "").trim();
  }
  if (req.body.ap !== undefined) {
    card.ap = req.body.ap === "" || req.body.ap === null ? null : Number(req.body.ap);
  }
  if (req.body.bp !== undefined) {
    card.bp = (req.body.bp || "").trim();
  }
  if (req.body.attribute !== undefined) {
    card.attribute = normalizeAttribute(req.body.attribute);
  }
  if (req.body.generatedEnergy !== undefined) {
    card.generatedEnergy = (req.body.generatedEnergy || "").trim();
  }
  if (req.body.effect !== undefined) {
    card.effect = (req.body.effect || "").trim();
  }
  // A manual edit to any auto-detected field counts as the user having
  // reviewed it, so the "自動取得の結果が怪しい" warning mark no longer applies.
  if (
    req.body.type !== undefined ||
    req.body.color !== undefined ||
    req.body.cost !== undefined ||
    req.body.trigger !== undefined
  ) {
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
        mate.trigger = card.trigger;
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
  // Rolling window of recent card-completion timestamps, used by withEta()
  // for a LOCAL pace estimate instead of the cumulative average since the
  // job started. A cumulative average still drifted noticeably (V8 JIT
  // warmup makes the first several cards genuinely slower than steady-state,
  // and that keeps dragging a from-the-start average down for the entire
  // job, not just the first few cards -- observed counting down at roughly
  // 2 estimated seconds per real second). A short recent window tracks
  // actual current pace instead.
  job.recentTimings = [];
  const results = {};
  for (const card of directCards) {
    const info = await classifyImage(path.join(IMAGES_DIR, `${card.id}.${card.imageExt}`), templates);
    if (info) results[card.id] = info;
    job.progress.current++;
    job.recentTimings.push(Date.now());
    if (job.recentTimings.length > 20) job.recentTimings.shift();
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
    // Unlike cost/color/type, "" is a real, confidently-determined answer for
    // trigger (most cards genuinely have none) rather than "couldn't tell" --
    // so it's written whenever canWrite() allows it, not gated on truthiness.
    if (canWrite("trigger") && info.trigger !== undefined && target.trigger !== info.trigger) {
      target.trigger = info.trigger;
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
        ? {
            type: baseTarget.type,
            color: baseTarget.color,
            cost: baseTarget.cost,
            trigger: baseTarget.trigger,
            costConfidence: baseTarget.infoUncertain ? 0 : 1,
          }
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
  const timings = job.recentTimings || [];
  let perCardMs;
  if (timings.length >= 2) {
    // Local pace: how long the last few cards actually took, not the whole
    // job's average -- keeps up with the real current speed instead of
    // being dragged down by slower cards earlier in the job.
    perCardMs = (timings[timings.length - 1] - timings[0]) / (timings.length - 1);
  } else {
    // Not enough recent samples yet (job just started) -- fall back to the
    // cumulative average for the first card or two.
    perCardMs = (Date.now() - new Date(job.classifyStartedAt).getTime()) / job.progress.current;
  }
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
      favorite: Boolean(d.favorite),
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

app.patch("/api/decks/:id", (req, res) => {
  const deck = readDeck(req.params.id);
  if (!deck) return res.status(404).json({ error: "デッキが見つかりません" });
  if (req.body.favorite !== undefined) {
    deck.favorite = Boolean(req.body.favorite);
  }
  deck.updatedAt = new Date().toISOString();
  writeDeck(deck);
  res.json(deck);
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

// ---- Deck export/import as a downloadable .dvdeck file ----
//
// A deck only ever references card ids that belong to whatever pool(s) it
// was built from -- meaningless on a different install where those ids
// don't exist. So exporting bundles each referenced card's own data +
// image (not just the deck's own {cardId,count} list), and importing
// recreates those cards fresh (new ids) in a brand-new pool made just for
// this deck, then points the new deck at that.

app.get("/api/decks/:id/export-zip", (req, res) => {
  const deck = readDeck(req.params.id);
  if (!deck) return res.status(404).json({ error: "デッキが見つかりません" });

  const cardsById = new Map(readCards().map((c) => [c.id, c]));

  const zip = new AdmZip();
  const manifestCards = [];
  let thumbnailImage = null;
  for (const entry of deck.cards) {
    const card = cardsById.get(entry.cardId);
    if (!card || !card.imageExt) continue; // stale/orphaned reference -- skip, don't fail the whole export
    const srcImage = path.join(IMAGES_DIR, `${card.id}.${card.imageExt}`);
    if (!fs.existsSync(srcImage)) continue;
    const imageName = `${card.id}.${card.imageExt}`;
    zip.addFile(`images/${imageName}`, fs.readFileSync(srcImage));
    manifestCards.push({
      name: card.cardName || "",
      cost: card.cost,
      color: card.color || "",
      parallel: Boolean(card.parallel),
      type: normalizeCardType(card.type),
      trigger: normalizeTrigger(card.trigger),
      rarity: card.rarity || "",
      ap: typeof card.ap === "number" ? card.ap : null,
      bp: card.bp || "",
      attribute: Array.isArray(card.attribute) ? card.attribute : [],
      generatedEnergy: card.generatedEnergy || "",
      effect: card.effect || "",
      count: entry.count,
      image: imageName,
    });
    if (card.id === deck.thumbnailCardId) thumbnailImage = imageName;
  }

  const manifest = {
    deckName: deck.name,
    thumbnail: thumbnailImage,
    exportedAt: new Date().toISOString(),
    cards: manifestCards,
  };
  zip.addFile("deck.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));

  const filename = `${deck.name}.dvdeck`;
  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  res.send(zip.toBuffer());
});

app.post("/api/decks/import-zip", uploadZip.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ファイルが送信されていません" });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dv-deck-import-"));
  try {
    const zip = new AdmZip(req.file.buffer);
    zip.extractAllTo(tempDir, true);
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return res.status(400).json({ error: "エクスポートファイルの読み込みに失敗しました" });
  }

  try {
    const manifestFile = path.join(tempDir, "deck.json");
    if (!fs.existsSync(manifestFile)) {
      return res.status(400).json({ error: "deck.jsonの形式が不正です" });
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    } catch (err) {
      return res.status(400).json({ error: "deck.jsonの形式が不正です" });
    }
    const manifestCards = Array.isArray(manifest.cards) ? manifest.cards : [];
    if (manifestCards.length === 0) {
      return res.status(400).json({ error: "インポートできるカードが見つかりません" });
    }

    const deckName = (req.body && req.body.name && req.body.name.trim()) || manifest.deckName || "インポートしたデッキ";

    // A deck can't exist without its cards living in some pool -- give this
    // import a fresh one of its own rather than trying to merge into an
    // existing pool.
    const pools = readPools();
    const newPool = {
      id: `pool-${Date.now()}`,
      name: uniqueName(`${deckName} のカード`, pools.map((p) => p.name)),
      favorite: false,
      thumbnailCardId: null,
      createdAt: new Date().toISOString(),
    };
    pools.push(newPool);

    const cards = readCards();
    let order = nextCardOrder(cards);
    const imagesFolder = path.join(tempDir, "images");
    const deckCards = [];
    let thumbnailCardId = null;
    manifestCards.forEach((item, index) => {
      if (!item || !item.image) return;
      const srcImage = path.join(imagesFolder, item.image);
      if (!fs.existsSync(srcImage)) return;
      const ext = path.extname(item.image).slice(1);
      const id = `card-${Date.now() + index}`;
      fs.writeFileSync(path.join(IMAGES_DIR, `${id}.${ext}`), fs.readFileSync(srcImage));
      cards.push({
        id,
        name: defaultNameFromImage(item.image),
        cardName: (item.name && String(item.name).trim()) || "",
        cost: item.cost ?? null,
        color: (item.color && String(item.color).trim()) || "",
        parallel: Boolean(item.parallel),
        type: normalizeCardType(item.type),
        trigger: normalizeTrigger(item.trigger),
        rarity: (item.rarity && String(item.rarity).trim()) || "",
        ap: typeof item.ap === "number" ? item.ap : null,
        bp: item.bp !== undefined && item.bp !== null ? String(item.bp).trim() : "",
        attribute: normalizeAttribute(item.attribute),
        generatedEnergy:
          item.generatedEnergy !== undefined && item.generatedEnergy !== null
            ? String(item.generatedEnergy).trim()
            : "",
        effect: (item.effect && String(item.effect).trim()) || "",
        poolId: newPool.id,
        imageExt: ext,
        order: order++,
        createdAt: new Date().toISOString(),
      });
      const count = Number.isFinite(item.count) && item.count > 0 ? Math.floor(item.count) : 1;
      deckCards.push({ cardId: id, count });
      if (manifest.thumbnail && item.image === manifest.thumbnail) thumbnailCardId = id;
    });
    if (deckCards.length === 0) {
      return res.status(400).json({ error: "インポートできる画像が見つかりません" });
    }
    newPool.thumbnailCardId = thumbnailCardId;
    writePools(pools);
    writeCards(cards);

    const otherDeckNames = listDecks().map((d) => d.name);
    const deck = {
      id: `deck-${Date.now()}`,
      name: uniqueName(deckName, otherDeckNames),
      poolIds: [newPool.id],
      cards: deckCards,
      thumbnailCardId,
      order: nextDeckOrder(),
      updatedAt: new Date().toISOString(),
    };
    writeDeck(deck);

    res.status(201).json({ deck, pool: newPool, cardCount: deckCards.length });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// Without this, a Multer error (e.g. a file over the configured size limit)
// falls through to Express's default HTML error page instead of the JSON
// every client here expects -- res.json() on the client then fails with
// "Unexpected token '<', "<!DOCTYPE "... is not valid JSON", masking the
// real "file too large" cause.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "ファイルサイズが大きすぎます" : err.message;
    return res.status(400).json({ error: message });
  }
  next(err);
});

// callbackは省略可(通常起動時は使わない)。EADDRINUSE時のように直後に
// process.exit()する場合は必ずcallback経由で呼ぶこと -- exec()は子プロセスの
// 起動を待たずに即座にreturnする非同期処理なので、呼び出し直後に
// process.exit()すると、OSに子プロセスを渡しきる前にイベントループごと
// 強制終了させてしまい、ブラウザが開かないことがある。
function openBrowser(url, callback) {
  const { exec } = require("child_process");
  const command =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  // exec(command, undefined) throws under pkg's child_process shim ("callback
  // argument must be of type function") even though plain Node accepts it --
  // only pass the second argument when there actually is one.
  if (callback) exec(command, callback);
  else exec(command);
}

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, "0.0.0.0", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`deck-viewer server running: ${url}`);
  // Only auto-open when running as a packaged exe — during `npm start`/`npm run dev`
  // this would pop a new browser tab on every restart, which is just noise for development.
  if (process.pkg) {
    openBrowser(url);
  }
  // Pre-warms githubPoolMetaCache in the background so the FIRST person to open
  // "カードプールをインポート" isn't the one stuck waiting on however many tens
  // of MB the pool-exports/*.dvpool files add up to -- by the time anyone
  // actually opens that modal, this has usually already finished. Fire-and-
  // forget: a failure here (offline, GitHub down) just means the first real
  // request pays the normal cost, same as before this existed.
  listGithubPools().catch(() => {});
  // Keeps refreshing in the background for as long as the server runs (not
  // just once at startup), so the cache stays warm even if nobody opens the
  // import modal for a while and a new .dvpool gets pushed to the repo in
  // the meantime. listGithubPools() itself is cheap on repeat calls (only
  // re-downloads a .dvpool's manifest when its GitHub blob sha changed), so
  // this doesn't add meaningful load.
  setInterval(() => {
    listGithubPools().catch(() => {});
  }, 5 * 60 * 1000);
});

// exeを既に起動した状態(前回のウィンドウを閉じ忘れている、二重にダブルクリック
// してしまった等)でもう一度起動すると、このプロセスはポートを掴めずに
// クラッシュして一瞬でウィンドウが消えるだけになり、ブラウザも開かれない
// (「.exeを実行しても何も起きない」ように見える典型パターン)。 EADDRINUSE
// の場合は、既に立っている方のサーバーを対象にブラウザだけ開いて素直に
// 終了する -- 実行するたびに必ずブラウザが開く、という体験を優先する。
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && process.pkg) {
    // exec()のコールバックを待ってから終了する(理由はopenBrowser()のコメント参照)。
    openBrowser(`http://localhost:${PORT}`, () => process.exit(0));
    return;
  }
  throw err;
});
