const tabs = document.getElementById("tabs");
const panelDecks = document.getElementById("panel-decks");
const panelPools = document.getElementById("panel-pools");
const deckListEl = document.getElementById("deck-list");
const poolListEl = document.getElementById("pool-list");
const poolViewToggle = document.getElementById("pool-view-toggle");
const deckViewToggle = document.getElementById("deck-view-toggle");

const ACTIVE_TAB_KEY = "deck-viewer-active-tab";
let activeTab = localStorage.getItem(ACTIVE_TAB_KEY) || "decks";

function setActiveTab(tab) {
  activeTab = tab;
  localStorage.setItem(ACTIVE_TAB_KEY, tab);
  for (const btn of tabs.querySelectorAll(".tab-btn")) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  panelDecks.hidden = tab !== "decks";
  panelPools.hidden = tab !== "pools";
}

tabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  setActiveTab(btn.dataset.tab);
});

// ---- View mode (list / grid), default grid, per list ----

const POOL_VIEW_KEY = "deck-viewer-home-pool-view";
const DECK_VIEW_KEY = "deck-viewer-home-deck-view";
let poolViewMode = localStorage.getItem(POOL_VIEW_KEY) || "grid";
let deckViewMode = localStorage.getItem(DECK_VIEW_KEY) || "grid";

function updateViewToggleUI(toggleEl, mode) {
  for (const btn of toggleEl.querySelectorAll(".view-toggle-btn")) {
    btn.classList.toggle("active", btn.dataset.view === mode);
  }
}

poolViewToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-toggle-btn");
  if (!btn) return;
  poolViewMode = btn.dataset.view;
  localStorage.setItem(POOL_VIEW_KEY, poolViewMode);
  updateViewToggleUI(poolViewToggle, poolViewMode);
  renderPools();
});

deckViewToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-toggle-btn");
  if (!btn) return;
  deckViewMode = btn.dataset.view;
  localStorage.setItem(DECK_VIEW_KEY, deckViewMode);
  updateViewToggleUI(deckViewToggle, deckViewMode);
  renderDecks();
});

function dragHandle() {
  const span = document.createElement("span");
  span.className = "drag-handle";
  span.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  return span;
}

function createMenu(actionDefs) {
  const menu = document.createElement("details");
  menu.className = "deck-menu";
  const summary = document.createElement("summary");
  summary.className = "icon-btn";
  summary.textContent = "⋮";
  menu.appendChild(summary);

  const menuBody = document.createElement("div");
  menuBody.className = "deck-menu-body";
  for (const { label, danger, onClick } of actionDefs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    if (danger) btn.className = "danger";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      menu.open = false;
      await onClick();
    });
    menuBody.appendChild(btn);
  }
  menu.appendChild(menuBody);
  return menu;
}

function startRename(row, currentName, onSave, onCancel) {
  row.innerHTML = "";

  const input = document.createElement("input");
  input.type = "text";
  input.value = currentName;
  input.className = "rename-input";

  const save = async () => {
    const name = input.value.trim();
    if (!name) return;
    await onSave(name);
  };

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn primary";
  saveBtn.textContent = "保存";
  saveBtn.addEventListener("click", save);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn";
  cancelBtn.textContent = "キャンセル";
  cancelBtn.addEventListener("click", onCancel);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") onCancel();
  });

  row.appendChild(input);
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);

  input.focus();
  input.select();
}

// Same rename interaction as startRename, but for a compact grid tile caption
// (used by pool/deck grid tiles) rather than a full list row.
function startCaptionRename(captionEl, currentName, onSave, onCancel) {
  captionEl.innerHTML = "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "grid-rename-input";
  input.value = currentName;

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    if (commit) {
      const name = input.value.trim();
      if (name) {
        await onSave(name);
        return;
      }
    }
    onCancel();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));

  captionEl.appendChild(input);
  input.focus();
  input.select();
}

function createThumbnailFrame(thumbnailUrl, name, onClick) {
  const frame = document.createElement("div");
  frame.className = "card-frame editable-frame";
  if (thumbnailUrl) {
    const img = document.createElement("img");
    img.src = thumbnailUrl;
    img.alt = name;
    img.draggable = false;
    frame.appendChild(img);
  } else {
    frame.classList.add("missing");
    frame.textContent = "🂠";
  }
  frame.addEventListener("click", onClick);
  return frame;
}

// 一覧表示(横並びの行)用の小さいサムネイル。グリッド表示の.card-frameと同じ
// 画像/欠落時のフォールバック方針だが、クリックでの遷移は行全体(.deck-info)
// 側が既に担っているためここには付けない。
function createRowThumb(thumbnailUrl, name) {
  const thumb = document.createElement("div");
  thumb.className = "card-row-thumb";
  if (thumbnailUrl) {
    const img = document.createElement("img");
    img.src = thumbnailUrl;
    img.alt = name;
    img.draggable = false;
    thumb.appendChild(img);
  } else {
    thumb.classList.add("missing");
    thumb.textContent = "🂠";
  }
  return thumb;
}

// ---- Decks ----

const DECK_FAVORITES_ONLY_KEY = "deck-viewer-deck-favorites-only";
let deckFavoritesOnly = localStorage.getItem(DECK_FAVORITES_ONLY_KEY) === "true";
const deckFavoritesOnlyBtn = document.getElementById("deck-favorites-only-btn");

function updateDeckFavoritesOnlyUI() {
  deckFavoritesOnlyBtn.classList.toggle("active", deckFavoritesOnly);
  deckFavoritesOnlyBtn.setAttribute("aria-pressed", String(deckFavoritesOnly));
}

deckFavoritesOnlyBtn.addEventListener("click", () => {
  deckFavoritesOnly = !deckFavoritesOnly;
  localStorage.setItem(DECK_FAVORITES_ONLY_KEY, String(deckFavoritesOnly));
  updateDeckFavoritesOnlyUI();
  renderDecks();
});

async function toggleDeckFavorite(deck) {
  await Api.updateDeck(deck.id, { favorite: !deck.favorite });
  await renderDecks();
}

function createDeckFavoriteBtn(deck, { overlay = false } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = overlay ? "icon-btn favorite card-frame-favorite-btn" : "icon-btn favorite";
  btn.classList.toggle("active", Boolean(deck.favorite));
  btn.title = deck.favorite ? "お気に入りから外す" : "お気に入りに追加";
  btn.textContent = deck.favorite ? "★" : "☆";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await toggleDeckFavorite(deck);
  });
  return btn;
}

async function renderDecks() {
  updateDeckFavoritesOnlyUI();
  let decks = await Api.getDecks();
  if (deckFavoritesOnly) decks = decks.filter((d) => d.favorite);
  if (decks.length === 0) {
    deckListEl.className = "";
    deckListEl.innerHTML = deckFavoritesOnly
      ? '<div class="empty-state">お気に入りのデッキがありません。</div>'
      : '<div class="empty-state">まだデッキがありません。上の「＋ デッキを作る」から作成してください。</div>';
    return;
  }
  if (deckViewMode === "grid") {
    deckListEl.className = "grid";
    deckListEl.innerHTML = "";
    for (const deck of decks) deckListEl.appendChild(createDeckGridItem(deck));
  } else {
    deckListEl.className = "deck-list";
    deckListEl.innerHTML = "";
    for (const deck of decks) deckListEl.appendChild(createDeckRow(deck));
  }
}

function deckMenuActions(deck, row) {
  return [
    {
      label: "リネーム",
      onClick: () => {
        startRename(
          row,
          deck.name,
          async (name) => {
            const full = await Api.getDeck(deck.id);
            await Api.saveDeck({
              id: deck.id,
              name,
              cards: full.cards,
              poolIds: full.poolIds || [],
              thumbnailCardId: full.thumbnailCardId || null,
            });
            await renderDecks();
          },
          renderDecks
        );
      },
    },
    {
      label: "複製",
      onClick: async () => {
        const full = await Api.getDeck(deck.id);
        await Api.saveDeck({
          name: `${deck.name} のコピー`,
          cards: full.cards,
          poolIds: full.poolIds || [],
          thumbnailCardId: full.thumbnailCardId || null,
        });
        await renderDecks();
      },
    },
    {
      label: "削除",
      danger: true,
      onClick: async () => {
        if (!(await showConfirm(`「${deck.name}」を削除します。よろしいですか?`))) return;
        await Api.deleteDeck(deck.id);
        await renderDecks();
      },
    },
  ];
}

function createDeckRow(deck) {
  const row = document.createElement("div");
  row.className = "deck-row";
  row.dataset.id = deck.id;

  const info = document.createElement("div");
  info.className = "deck-info";
  const title = document.createElement("strong");
  title.textContent = deck.name;
  const small = document.createElement("small");
  small.textContent = `合計 ${deck.totalCount}枚`;
  info.appendChild(title);
  info.appendChild(small);

  const actions = document.createElement("div");
  actions.className = "nav-links";

  const viewLink = document.createElement("a");
  viewLink.className = "btn";
  viewLink.href = `deck-view.html?id=${encodeURIComponent(deck.id)}`;
  viewLink.textContent = "画像出力";

  const editLink = document.createElement("a");
  editLink.className = "btn";
  editLink.href = `builder.html?id=${encodeURIComponent(deck.id)}`;
  editLink.textContent = "編集";

  const menu = createMenu(deckMenuActions(deck, row));

  actions.appendChild(createDeckFavoriteBtn(deck));
  actions.appendChild(viewLink);
  actions.appendChild(editLink);
  actions.appendChild(menu);

  const main = document.createElement("div");
  main.className = "deck-row-main";
  main.appendChild(dragHandle());
  main.appendChild(createRowThumb(deck.thumbnailUrl, deck.name));
  main.appendChild(info);

  row.appendChild(main);
  row.appendChild(actions);
  return row;
}

function createDeckGridItem(deck) {
  const item = document.createElement("div");
  item.className = "card-item";
  item.dataset.id = deck.id;

  const frame = createThumbnailFrame(deck.thumbnailUrl, deck.name, () => {
    location.href = `builder.html?id=${encodeURIComponent(deck.id)}`;
  });
  frame.appendChild(createDeckFavoriteBtn(deck, { overlay: true }));
  item.appendChild(frame);

  const caption = document.createElement("div");
  caption.className = "card-caption";
  caption.textContent = deck.name;
  item.appendChild(caption);

  const sub = document.createElement("div");
  sub.className = "card-caption cost";
  sub.textContent = `合計 ${deck.totalCount}枚`;
  item.appendChild(sub);

  const tileActions = document.createElement("div");
  tileActions.className = "grid-tile-actions";

  const viewBtn = document.createElement("a");
  viewBtn.className = "icon-btn";
  viewBtn.title = "画像出力";
  viewBtn.textContent = "⬇";
  viewBtn.href = `deck-view.html?id=${encodeURIComponent(deck.id)}`;

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "icon-btn";
  renameBtn.title = "リネーム";
  renameBtn.textContent = "✎";
  renameBtn.addEventListener("click", () => {
    startCaptionRename(
      caption,
      deck.name,
      async (name) => {
        const full = await Api.getDeck(deck.id);
        await Api.saveDeck({
          id: deck.id,
          name,
          cards: full.cards,
          poolIds: full.poolIds || [],
          thumbnailCardId: full.thumbnailCardId || null,
        });
        await renderDecks();
      },
      renderDecks
    );
  });

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "icon-btn";
  copyBtn.title = "複製";
  copyBtn.textContent = "⧉";
  copyBtn.addEventListener("click", async () => {
    const full = await Api.getDeck(deck.id);
    await Api.saveDeck({
      name: `${deck.name} のコピー`,
      cards: full.cards,
      poolIds: full.poolIds || [],
      thumbnailCardId: full.thumbnailCardId || null,
    });
    await renderDecks();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn danger";
  deleteBtn.title = "削除";
  deleteBtn.textContent = "🗑";
  deleteBtn.addEventListener("click", async () => {
    if (!(await showConfirm(`「${deck.name}」を削除します。よろしいですか?`))) return;
    await Api.deleteDeck(deck.id);
    await renderDecks();
  });

  tileActions.appendChild(viewBtn);
  tileActions.appendChild(renameBtn);
  tileActions.appendChild(copyBtn);
  tileActions.appendChild(deleteBtn);
  item.appendChild(tileActions);

  return item;
}

makeSortable(deckListEl, {
  itemSelector: ".deck-row",
  onReorder: async (order) => {
    await Api.reorderDecks(order);
    await renderDecks();
  },
});

makeSortable(deckListEl, {
  itemSelector: ".card-item",
  handleSelector: ".card-frame",
  axis: "grid",
  onReorder: async (order) => {
    await Api.reorderDecks(order);
    await renderDecks();
  },
});

// ---- Card pools ----

const POOL_FAVORITES_ONLY_KEY = "deck-viewer-pool-favorites-only";
let poolFavoritesOnly = localStorage.getItem(POOL_FAVORITES_ONLY_KEY) === "true";
const poolFavoritesOnlyBtn = document.getElementById("pool-favorites-only-btn");

function updatePoolFavoritesOnlyUI() {
  poolFavoritesOnlyBtn.classList.toggle("active", poolFavoritesOnly);
  poolFavoritesOnlyBtn.setAttribute("aria-pressed", String(poolFavoritesOnly));
}

poolFavoritesOnlyBtn.addEventListener("click", () => {
  poolFavoritesOnly = !poolFavoritesOnly;
  localStorage.setItem(POOL_FAVORITES_ONLY_KEY, String(poolFavoritesOnly));
  updatePoolFavoritesOnlyUI();
  renderPools();
});

async function toggleFavorite(pool) {
  await Api.updatePool(pool.id, { favorite: !pool.favorite });
  await renderPools();
}

function createFavoriteBtn(pool, { overlay = false } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = overlay ? "icon-btn favorite card-frame-favorite-btn" : "icon-btn favorite";
  btn.classList.toggle("active", Boolean(pool.favorite));
  btn.title = pool.favorite ? "お気に入りから外す" : "お気に入りに追加";
  btn.textContent = pool.favorite ? "★" : "☆";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await toggleFavorite(pool);
  });
  return btn;
}

async function renderPools() {
  updatePoolFavoritesOnlyUI();
  let pools = await Api.getPools();
  if (poolFavoritesOnly) pools = pools.filter((p) => p.favorite);
  if (pools.length === 0) {
    poolListEl.className = "";
    poolListEl.innerHTML = poolFavoritesOnly
      ? '<div class="empty-state">お気に入りのカードプールがありません。</div>'
      : '<div class="empty-state">まだカードプールがありません。上の「＋ カードプールを作る」から作成してください。</div>';
    return;
  }
  if (poolViewMode === "grid") {
    poolListEl.className = "grid";
    poolListEl.innerHTML = "";
    for (const pool of pools) poolListEl.appendChild(createPoolGridItem(pool));
  } else {
    poolListEl.className = "deck-list";
    poolListEl.innerHTML = "";
    for (const pool of pools) poolListEl.appendChild(createPoolRow(pool));
  }
}

// Deleting a pool cascades to delete its cards too, so any deck that has one
// of those cards in its own card list (not just decks referencing the pool)
// would end up with dangling card references. Look that up so the delete
// confirmation can warn about which decks are affected before it happens.
async function findDecksUsingPool(poolId) {
  // GET /api/decks only returns list-view summaries (no `cards` array), so
  // each deck's full record has to be fetched individually to check its
  // actual card references.
  const [poolCards, deckSummaries] = await Promise.all([Api.getCards(poolId), Api.getDecks()]);
  const poolCardIds = new Set(poolCards.map((c) => c.id));
  const fullDecks = await Promise.all(deckSummaries.map((d) => Api.getDeck(d.id)));
  return fullDecks
    .filter((deck) => deck && deck.cards.some((entry) => poolCardIds.has(entry.cardId)))
    .map((deck) => deck.name);
}

async function buildPoolDeleteWarning(pool) {
  const lines = [
    pool.cardCount > 0
      ? `「${pool.name}」を削除します。プール内の${pool.cardCount}枚のカードも一緒に削除されます。`
      : `「${pool.name}」を削除します。`,
  ];
  const affectedDeckNames = await findDecksUsingPool(pool.id);
  if (affectedDeckNames.length > 0) {
    lines.push(
      "",
      "このカードプールを削除すると、以下のデッキからカードの情報が失われます。よろしいですか?"
    );
    for (const name of affectedDeckNames) lines.push(`・${name}`);
  } else {
    lines.push("よろしいですか?");
  }
  return lines.join("\n");
}

function createPoolRow(pool) {
  const row = document.createElement("div");
  row.className = "deck-row";
  row.dataset.id = pool.id;

  const info = document.createElement("div");
  info.className = "deck-info clickable";
  const title = document.createElement("strong");
  title.textContent = pool.name;
  const small = document.createElement("small");
  small.textContent = `${pool.cardCount}枚のカード`;
  info.appendChild(title);
  info.appendChild(small);
  info.addEventListener("click", () => {
    location.href = `pool-detail.html?id=${encodeURIComponent(pool.id)}`;
  });

  const actions = document.createElement("div");
  actions.className = "nav-links";

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "icon-btn";
  renameBtn.title = "リネーム";
  renameBtn.textContent = "✎";
  renameBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    startRename(
      row,
      pool.name,
      async (name) => {
        await Api.renamePool(pool.id, name);
        await renderPools();
      },
      renderPools
    );
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn danger";
  deleteBtn.title = "削除";
  deleteBtn.textContent = "🗑";
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!(await showConfirm(await buildPoolDeleteWarning(pool)))) return;
    await Api.deletePool(pool.id);
    await renderPools();
  });

  actions.appendChild(createFavoriteBtn(pool));
  actions.appendChild(renameBtn);
  actions.appendChild(deleteBtn);

  const main = document.createElement("div");
  main.className = "deck-row-main";
  main.appendChild(dragHandle());
  main.appendChild(createRowThumb(pool.thumbnailUrl, pool.name));
  main.appendChild(info);

  row.appendChild(main);
  row.appendChild(actions);
  return row;
}

function createPoolGridItem(pool) {
  const item = document.createElement("div");
  item.className = "card-item";
  item.dataset.id = pool.id;

  const frame = createThumbnailFrame(pool.thumbnailUrl, pool.name, () => {
    location.href = `pool-detail.html?id=${encodeURIComponent(pool.id)}`;
  });
  frame.appendChild(createFavoriteBtn(pool, { overlay: true }));

  item.appendChild(frame);

  const caption = document.createElement("div");
  caption.className = "card-caption";
  caption.textContent = pool.name;
  item.appendChild(caption);

  const sub = document.createElement("div");
  sub.className = "card-caption cost";
  sub.textContent = `${pool.cardCount}枚のカード`;
  item.appendChild(sub);

  const tileActions = document.createElement("div");
  tileActions.className = "grid-tile-actions";

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "icon-btn";
  renameBtn.title = "リネーム";
  renameBtn.textContent = "✎";
  renameBtn.addEventListener("click", () => {
    startCaptionRename(
      caption,
      pool.name,
      async (name) => {
        await Api.renamePool(pool.id, name);
        await renderPools();
      },
      renderPools
    );
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn danger";
  deleteBtn.title = "削除";
  deleteBtn.textContent = "🗑";
  deleteBtn.addEventListener("click", async () => {
    if (!(await showConfirm(await buildPoolDeleteWarning(pool)))) return;
    await Api.deletePool(pool.id);
    await renderPools();
  });

  tileActions.appendChild(renameBtn);
  tileActions.appendChild(deleteBtn);
  item.appendChild(tileActions);

  return item;
}

makeSortable(poolListEl, {
  itemSelector: ".deck-row",
  onReorder: async (order) => {
    await Api.reorderPools(order);
    await renderPools();
  },
});

makeSortable(poolListEl, {
  itemSelector: ".card-item",
  handleSelector: ".card-frame",
  axis: "grid",
  onReorder: async (order) => {
    await Api.reorderPools(order);
    await renderPools();
  },
});

document.getElementById("create-deck-row").addEventListener("click", async () => {
  const deck = await Api.saveDeck({ name: "新しいデッキ", cards: [], poolIds: [] });
  await renderDecks();
  if (deckViewMode === "grid") {
    const item = deckListEl.querySelector(`[data-id="${deck.id}"]`);
    const caption = item && item.querySelector(".card-caption");
    if (!caption) return;
    startCaptionRename(
      caption,
      deck.name,
      async (name) => {
        const full = await Api.getDeck(deck.id);
        await Api.saveDeck({
          id: deck.id,
          name,
          cards: full.cards,
          poolIds: full.poolIds || [],
          thumbnailCardId: full.thumbnailCardId || null,
        });
        await renderDecks();
      },
      renderDecks
    );
    return;
  }
  const row = deckListEl.querySelector(`[data-id="${deck.id}"]`);
  if (!row) return;
  startRename(
    row,
    deck.name,
    async (name) => {
      const full = await Api.getDeck(deck.id);
      await Api.saveDeck({
        id: deck.id,
        name,
        cards: full.cards,
        poolIds: full.poolIds || [],
        thumbnailCardId: full.thumbnailCardId || null,
      });
      await renderDecks();
    },
    renderDecks
  );
});

document.getElementById("create-pool-row").addEventListener("click", async () => {
  const pool = await Api.createPool("新しいカードプール");
  await renderPools();
  if (poolViewMode === "grid") {
    const item = poolListEl.querySelector(`[data-id="${pool.id}"]`);
    const caption = item && item.querySelector(".card-caption");
    if (!caption) return;
    startCaptionRename(
      caption,
      pool.name,
      async (name) => {
        await Api.renamePool(pool.id, name);
        await renderPools();
      },
      renderPools
    );
    return;
  }
  const row = poolListEl.querySelector(`[data-id="${pool.id}"]`);
  if (!row) return;
  startRename(
    row,
    pool.name,
    async (name) => {
      await Api.renamePool(pool.id, name);
      await renderPools();
    },
    renderPools
  );
});

// ---- Import a pre-made card pool from GitHub (pool-exports/*.dvpool) ----

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// manifest.releaseは"2026-07-31"のようなISO日付文字列。
function formatReleaseDate(release) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(release || "");
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${y}年${Number(mo)}月${Number(d)}日`;
}

const importPoolBtn = document.getElementById("import-pool-btn");
const importModal = document.getElementById("import-pool-modal");
const importListEl = document.getElementById("import-pool-list");
const importPoolSearchInput = document.getElementById("import-pool-search-input");
const importPoolYearMenu = document.getElementById("import-pool-year-menu");
const importPoolYearBtnLabel = document.getElementById("import-pool-year-btn-label");
const importPoolYearBody = document.getElementById("import-pool-year-body");

let latestGithubPools = [];
let selectedImportYear = "";
const IMPORT_LIST_VISIBLE_ROWS = 8;
let importListRowHeightLocked = false;

function closeImportModal() {
  importModal.hidden = true;
}

function updateImportYearMenu() {
  const years = [...new Set(latestGithubPools.map((p) => (p.release || "").slice(0, 4)).filter(Boolean))].sort(
    (a, b) => b.localeCompare(a)
  );
  if (!years.includes(selectedImportYear)) selectedImportYear = "";

  importPoolYearBody.innerHTML = "";
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.textContent = "すべての年";
  allBtn.className = selectedImportYear === "" ? "active" : "";
  allBtn.addEventListener("click", () => {
    selectedImportYear = "";
    importPoolYearMenu.open = false;
    updateImportYearMenu();
    renderImportList();
  });
  importPoolYearBody.appendChild(allBtn);

  for (const year of years) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${year}年`;
    btn.className = year === selectedImportYear ? "active" : "";
    btn.addEventListener("click", () => {
      selectedImportYear = year;
      importPoolYearMenu.open = false;
      updateImportYearMenu();
      renderImportList();
    });
    importPoolYearBody.appendChild(btn);
  }

  importPoolYearBtnLabel.textContent = selectedImportYear ? `${selectedImportYear}年` : "年";
  importPoolYearMenu.classList.toggle("has-selection", Boolean(selectedImportYear));
}

document.addEventListener("click", (e) => {
  if (importPoolYearMenu.open && !e.target.closest("#import-pool-year-menu")) {
    importPoolYearMenu.open = false;
  }
});

async function openImportModal() {
  importModal.hidden = false;
  importPoolSearchInput.value = "";
  selectedImportYear = "";
  importListRowHeightLocked = false;
  importListEl.style.height = "auto";
  importListEl.innerHTML = "読み込み中...";

  try {
    latestGithubPools = await Api.getGithubPools();
  } catch (err) {
    latestGithubPools = [];
    importListEl.innerHTML = '<div class="empty-state">GitHubからの取得に失敗しました。</div>';
    return;
  }
  // リリース日が新しい順(同じ場合の順序は問わない)。releaseが無いものは末尾に回す。
  latestGithubPools.sort((a, b) => (b.release || "").localeCompare(a.release || ""));
  updateImportYearMenu();
  renderImportList();
}

function renderImportList() {
  if (!Array.isArray(latestGithubPools) || latestGithubPools.length === 0) {
    importListEl.innerHTML = '<div class="empty-state">インポートできるカードプールがありません。</div>';
    return;
  }
  const query = importPoolSearchInput.value.trim().toLowerCase();
  const githubPools = latestGithubPools.filter((item) => {
    if (query && !item.poolName.toLowerCase().includes(query)) return false;
    if (selectedImportYear && (item.release || "").slice(0, 4) !== selectedImportYear) return false;
    return true;
  });
  if (githubPools.length === 0) {
    importListEl.innerHTML = '<div class="empty-state">該当するカードプールが見つかりません。</div>';
    return;
  }

  importListEl.innerHTML = "";
  for (const item of githubPools) {
    const row = document.createElement("div");
    row.className = "deck-row";

    const info = document.createElement("div");
    info.className = "deck-info";
    const title = document.createElement("strong");
    title.textContent = item.poolName;
    const small = document.createElement("small");
    const releaseText = formatReleaseDate(item.release);
    small.textContent = releaseText ? `${releaseText} ・ ${formatFileSize(item.size)}` : formatFileSize(item.size);
    info.appendChild(title);
    info.appendChild(small);

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "btn primary";
    importBtn.textContent = "インポート";
    importBtn.addEventListener("click", async () => {
      importBtn.disabled = true;
      importBtn.textContent = "ダウンロード中...";
      try {
        await Api.importGithubPool(item.name);
        closeImportModal();
        await renderPools();
      } catch (err) {
        alert(err.message);
        importBtn.disabled = false;
        importBtn.textContent = "インポート";
      }
    });

    const main = document.createElement("div");
    main.className = "deck-row-main";
    main.appendChild(info);

    row.appendChild(main);
    row.appendChild(importBtn);
    importListEl.appendChild(row);
  }

  lockImportListHeight();
}

// 表示件数に関わらず常に8件分の縦幅になるよう、実測した1行分の高さ(+行間)を
// 元に固定する。行の見た目自体は内容によらず一定なので、最初にリストへ実際の
// 行が描画されたときに一度だけ測れば十分(検索や年の絞り込みで件数が変わっても
// 測り直す必要はない)。
function lockImportListHeight() {
  if (importListRowHeightLocked) return;
  const firstRow = importListEl.querySelector(".deck-row");
  if (!firstRow) return;
  importListRowHeightLocked = true;
  const rowHeight = firstRow.getBoundingClientRect().height;
  const gap = parseFloat(getComputedStyle(importListEl).rowGap || "0") || 0;
  const height = rowHeight * IMPORT_LIST_VISIBLE_ROWS + gap * (IMPORT_LIST_VISIBLE_ROWS - 1);
  importListEl.style.height = `${height}px`;
}

// IME変換中(例:「ア」を打とうとしている途中の「あ」)にも"input"イベントは
// 発火するため、変換確定前に検索が走って毎打鍵ちらつくのを避ける。変換中かどうかは
// isComposingで判定し、変換確定時(compositionend)に改めて検索をかける。
importPoolSearchInput.addEventListener("input", (e) => {
  if (e.isComposing) return;
  renderImportList();
});
importPoolSearchInput.addEventListener("compositionend", renderImportList);

importPoolBtn.addEventListener("click", openImportModal);
document.getElementById("close-import-modal-btn").addEventListener("click", closeImportModal);

// ---- Import a .dvpool file from the user's own device ----

const importPoolLocalRow = document.getElementById("import-pool-local-row");
const importPoolFileInput = document.getElementById("import-pool-file-input");

importPoolLocalRow.addEventListener("click", () => importPoolFileInput.click());

importPoolFileInput.addEventListener("change", async () => {
  const file = importPoolFileInput.files[0];
  importPoolFileInput.value = "";
  if (!file) return;
  try {
    await Api.importPoolZip(file);
    closeImportModal();
    await renderPools();
  } catch (err) {
    alert(err.message);
  }
});

// ---- Export a card pool as a downloadable .dvpool file ----

const exportPoolBtn = document.getElementById("export-pool-btn");
const exportModal = document.getElementById("export-pool-modal");
const exportListEl = document.getElementById("export-pool-list");

function closeExportModal() {
  exportModal.hidden = true;
}

async function openExportModal() {
  exportModal.hidden = false;
  exportListEl.innerHTML = "読み込み中...";

  const pools = await Api.getPools();
  if (pools.length === 0) {
    exportListEl.innerHTML = '<div class="empty-state">カードプールがありません。</div>';
    return;
  }

  exportListEl.innerHTML = "";
  for (const pool of pools) {
    const row = document.createElement("div");
    row.className = "deck-row";

    const info = document.createElement("div");
    info.className = "deck-info";
    const title = document.createElement("strong");
    title.textContent = pool.name;
    const small = document.createElement("small");
    small.textContent = `${pool.cardCount}枚`;
    info.appendChild(title);
    info.appendChild(small);

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "btn primary";
    exportBtn.textContent = "エクスポート";
    exportBtn.addEventListener("click", () => {
      // The endpoint responds with Content-Disposition: attachment, so
      // navigating an <a> to it downloads the file without leaving this page.
      const a = document.createElement("a");
      a.href = Api.exportPoolZipUrl(pool.id);
      a.click();
    });

    const main = document.createElement("div");
    main.className = "deck-row-main";
    main.appendChild(info);

    row.appendChild(main);
    row.appendChild(exportBtn);
    exportListEl.appendChild(row);
  }
}

exportPoolBtn.addEventListener("click", openExportModal);
document.getElementById("close-export-modal-btn").addEventListener("click", closeExportModal);
bindModalDismissal(exportModal, { onCancel: closeExportModal });
bindModalDismissal(importModal, { onCancel: closeImportModal });

// ---- Import a .dvdeck file from the user's own device ----

const importDeckBtn = document.getElementById("import-deck-btn");
const importDeckFileInput = document.getElementById("import-deck-file-input");

importDeckBtn.addEventListener("click", () => importDeckFileInput.click());

importDeckFileInput.addEventListener("change", async () => {
  const file = importDeckFileInput.files[0];
  importDeckFileInput.value = "";
  if (!file) return;
  try {
    await Api.importDeckZip(file);
    await renderDecks();
  } catch (err) {
    alert(err.message);
  }
});

updateViewToggleUI(poolViewToggle, poolViewMode);
updateViewToggleUI(deckViewToggle, deckViewMode);
setActiveTab(activeTab);
renderDecks();
renderPools();
