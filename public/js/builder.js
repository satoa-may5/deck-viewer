let allCards = [];
let allPools = [];
let deckId = null;
let deckThumbnailCardId = null;
const deckCounts = new Map(); // cardId -> count
const selectedPoolIds = new Set();

const poolCheckboxList = document.getElementById("pool-checkbox-list");
const deckGrid = document.getElementById("deck-grid");
const collectionGrid = document.getElementById("collection-grid");
const nameInput = document.getElementById("deck-name-input");
const saveStatus = document.getElementById("save-status");

function attachTap(el, action) {
  let downX = 0;
  let downY = 0;
  el.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });
  el.addEventListener("pointerup", (e) => {
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    // Only a real tap/click triggers add-remove — anything that moved more than
    // this is a scroll/swipe gesture and should just scroll normally.
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) action();
  });
}

// Quick, non-blocking exit flourish: clones just the tapped card's thumbnail
// frame (not the whole tile — that includes the caption below it, which
// would stretch the image vertically to fill the extra height) into a
// fixed-position ghost sitting behind the grid, sliding sideways at the same
// y-position while fading out, then vanishing. Purely decorative — the
// actual state update and re-render happen immediately alongside it, so it
// never adds input latency.
function animateCardExit(sourceEl, direction) {
  const frame = sourceEl.querySelector(".card-frame");
  if (!frame) return;
  const rect = frame.getBoundingClientRect();

  const ghost = frame.cloneNode(true);
  ghost.style.position = "fixed";
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.margin = "0";
  ghost.style.zIndex = "-1";
  ghost.style.pointerEvents = "none";
  ghost.style.transition = "transform 0.1s ease-in, opacity 0.1s ease-in";
  document.body.appendChild(ghost);

  const dx = direction === "left" ? -60 : 60;
  requestAnimationFrame(() => {
    ghost.style.transform = `translateX(${dx}px)`;
    ghost.style.opacity = "0";
  });
  setTimeout(() => ghost.remove(), 110);
}

function addToDeck(cardId) {
  deckCounts.set(cardId, (deckCounts.get(cardId) || 0) + 1);
  renderPanes();
}

function removeFromDeck(cardId) {
  const current = deckCounts.get(cardId) || 0;
  if (current <= 1) {
    deckCounts.delete(cardId);
    if (deckThumbnailCardId === cardId) deckThumbnailCardId = null;
  } else {
    deckCounts.set(cardId, current - 1);
  }
  renderPanes();
}

// ---- Deck thumbnail selection mode ----

const deckThumbnailModeBtn = document.getElementById("deck-thumbnail-mode-btn");
let deckThumbnailMode = false;

function enterDeckThumbnailMode() {
  deckThumbnailMode = true;
  deckThumbnailModeBtn.textContent = "サムネイルにするカードを選択(キャンセル)";
  deckThumbnailModeBtn.classList.add("active");
  renderPanes();
}

function exitDeckThumbnailMode() {
  deckThumbnailMode = false;
  deckThumbnailModeBtn.textContent = "サムネイルを設定";
  deckThumbnailModeBtn.classList.remove("active");
  renderPanes();
}

function setDeckThumbnail(cardId) {
  deckThumbnailCardId = cardId;
  exitDeckThumbnailMode();
}

deckThumbnailModeBtn.addEventListener("click", () => {
  if (deckThumbnailMode) exitDeckThumbnailMode();
  else enterDeckThumbnailMode();
});

// ---- Filtering (collection pane only: type / color / cost range / parallel) ----

const CARD_TYPE_LABELS = { character: "キャラクター", event: "イベント", field: "フィールド" };

// UAのカードは5色(赤/青/緑/黄/紫)のみ。常にこの5色を表示する(データに存在するかは問わない)。
const CARD_COLORS = ["赤", "青", "緑", "黄", "紫"];

const COLOR_SWATCHES = {
  "赤": { bg: "#e53e3e", text: "#fff" },
  "青": { bg: "#3182ce", text: "#fff" },
  "緑": { bg: "#38a169", text: "#fff" },
  "黄": { bg: "#d69e2e", text: "#1a202c" },
  "紫": { bg: "#805ad5", text: "#fff" },
};

const COST_RANGE_MIN = 0;
const COST_RANGE_MAX = 15;

const filterState = {
  types: new Set(),
  colors: new Set(),
  costMin: COST_RANGE_MIN,
  costMax: COST_RANGE_MAX,
  excludeParallel: false,
};

const filterTypeGroup = document.getElementById("filter-type-group");
const filterColorGroup = document.getElementById("filter-color-group");
const filterParallelCheckbox = document.getElementById("filter-parallel-checkbox");
const filterClearBtn = document.getElementById("filter-clear-btn");
const filterCostMinInput = document.getElementById("filter-cost-min");
const filterCostMaxInput = document.getElementById("filter-cost-max");
const filterCostFill = document.getElementById("filter-cost-fill");
const filterCostMinLabel = document.getElementById("filter-cost-min-label");
const filterCostMaxLabel = document.getElementById("filter-cost-max-label");

function createFilterCheckbox(label, checked, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "filter-checkbox-item";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  wrapper.appendChild(input);
  wrapper.appendChild(document.createTextNode(label));
  return wrapper;
}

function createFilterPill(label, active, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "filter-pill";
  btn.setAttribute("aria-pressed", String(active));
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function applyColorSwatch(pill, colorName, active) {
  const swatch = COLOR_SWATCHES[colorName];
  if (!swatch) return;
  pill.style.borderColor = swatch.bg;
  if (active) {
    pill.style.background = swatch.bg;
    pill.style.color = swatch.text;
  }
}

function toggleInSet(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function updateCostSliderUI() {
  const range = COST_RANGE_MAX - COST_RANGE_MIN;
  const leftPct = ((filterState.costMin - COST_RANGE_MIN) / range) * 100;
  const rightPct = ((filterState.costMax - COST_RANGE_MIN) / range) * 100;
  filterCostFill.style.left = `${leftPct}%`;
  filterCostFill.style.width = `${rightPct - leftPct}%`;
  filterCostMinLabel.textContent = filterState.costMin;
  filterCostMaxLabel.textContent = filterState.costMax;
  filterCostMinInput.value = filterState.costMin;
  filterCostMaxInput.value = filterState.costMax;
}

filterCostMinInput.addEventListener("input", () => {
  let value = Number(filterCostMinInput.value);
  if (value > filterState.costMax) value = filterState.costMax;
  filterState.costMin = value;
  updateCostSliderUI();
  renderPanes();
});

filterCostMaxInput.addEventListener("input", () => {
  let value = Number(filterCostMaxInput.value);
  if (value < filterState.costMin) value = filterState.costMin;
  filterState.costMax = value;
  updateCostSliderUI();
  renderPanes();
});

function updateFilterUI() {
  filterTypeGroup.innerHTML = "";
  for (const [value, label] of Object.entries(CARD_TYPE_LABELS)) {
    filterTypeGroup.appendChild(
      createFilterCheckbox(label, filterState.types.has(value), () => {
        toggleInSet(filterState.types, value);
        renderPanes();
      })
    );
  }

  filterColorGroup.innerHTML = "";
  for (const color of CARD_COLORS) {
    const active = filterState.colors.has(color);
    const pill = createFilterPill(color, active, () => {
      toggleInSet(filterState.colors, color);
      renderPanes();
    });
    applyColorSwatch(pill, color, active);
    filterColorGroup.appendChild(pill);
  }

  updateCostSliderUI();
  filterParallelCheckbox.checked = filterState.excludeParallel;
}

filterParallelCheckbox.addEventListener("change", () => {
  filterState.excludeParallel = filterParallelCheckbox.checked;
  renderPanes();
});

filterClearBtn.addEventListener("click", () => {
  filterState.types.clear();
  filterState.colors.clear();
  filterState.costMin = COST_RANGE_MIN;
  filterState.costMax = COST_RANGE_MAX;
  filterState.excludeParallel = false;
  updateFilterUI();
  renderPanes();
});

function cardMatchesFilters(card) {
  if (filterState.types.size > 0 && !filterState.types.has(card.type)) return false;
  if (filterState.colors.size > 0 && !filterState.colors.has(card.color)) return false;
  if (filterState.costMin > COST_RANGE_MIN || filterState.costMax < COST_RANGE_MAX) {
    if (card.cost === null || card.cost === undefined) return false;
    if (card.cost < filterState.costMin || card.cost > filterState.costMax) return false;
  }
  if (filterState.excludeParallel && card.parallel) return false;
  return true;
}

function renderPoolPicker() {
  poolCheckboxList.innerHTML = "";
  if (allPools.length === 0) {
    poolCheckboxList.innerHTML = '<div class="empty-state">カードプールがありません。「カードプール管理」から作成してください。</div>';
    return;
  }
  for (const pool of allPools) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pool-toggle";
    const isSelected = selectedPoolIds.has(pool.id);
    toggle.setAttribute("aria-pressed", String(isSelected));
    toggle.textContent = `${pool.name} (${pool.cardCount}枚)`;
    toggle.addEventListener("click", () => {
      if (selectedPoolIds.has(pool.id)) selectedPoolIds.delete(pool.id);
      else selectedPoolIds.add(pool.id);
      toggle.setAttribute("aria-pressed", String(selectedPoolIds.has(pool.id)));
      renderPanes();
    });
    poolCheckboxList.appendChild(toggle);
  }
}

function renderPanes() {
  const cardById = Object.fromEntries(allCards.map((c) => [c.id, c]));

  deckGrid.innerHTML = "";
  for (const [cardId, count] of deckCounts) {
    const el = createCardElement(cardById[cardId] || null, cardId, count, {
      isThumbnail: deckThumbnailCardId === cardId,
    });
    if (deckThumbnailMode) {
      el.addEventListener("click", () => setDeckThumbnail(cardId));
    } else {
      attachTap(el, () => {
        animateCardExit(el, "right");
        removeFromDeck(cardId);
      });
    }
    deckGrid.appendChild(el);
  }

  // Type/color filters are a fixed, known set of options, so they're always
  // populated regardless of whether a pool is selected yet.
  updateFilterUI();

  collectionGrid.innerHTML = "";
  if (selectedPoolIds.size === 0) {
    collectionGrid.innerHTML = '<div class="empty-state">上で参照するカードプールを選択してください</div>';
    return;
  }
  const poolCards = allCards.filter((c) => selectedPoolIds.has(c.poolId));
  const visibleCards = poolCards.filter(cardMatchesFilters);
  if (poolCards.length === 0) {
    collectionGrid.innerHTML = '<div class="empty-state">選択したカードプールにカードがありません。「カードを追加」から登録してください。</div>';
  } else if (visibleCards.length === 0) {
    collectionGrid.innerHTML = '<div class="empty-state">絞り込み条件に一致するカードがありません。</div>';
  } else {
    for (const card of visibleCards) {
      const count = deckCounts.get(card.id) || null;
      const el = createCardElement(card, card.id, count);
      attachTap(el, () => {
        animateCardExit(el, "left");
        addToDeck(card.id);
      });
      collectionGrid.appendChild(el);
    }
  }
}

async function init() {
  const params = new URLSearchParams(location.search);
  deckId = params.get("id");

  [allCards, allPools] = await Promise.all([Api.getCards(), Api.getPools()]);

  if (deckId) {
    const deck = await Api.getDeck(deckId);
    if (deck) {
      nameInput.value = deck.name;
      for (const entry of deck.cards) {
        deckCounts.set(entry.cardId, entry.count);
      }
      for (const poolId of deck.poolIds || []) {
        selectedPoolIds.add(poolId);
      }
      deckThumbnailCardId = deck.thumbnailCardId || null;
    }
  }

  renderPoolPicker();
  renderPanes();
}

async function saveDeck() {
  const name = nameInput.value.trim();
  if (!name) {
    saveStatus.textContent = "デッキ名を入力してください";
    saveStatus.className = "status-message error";
    return false;
  }
  const cards = [...deckCounts].map(([cardId, count]) => ({ cardId, count }));
  const poolIds = [...selectedPoolIds];
  try {
    const deck = await Api.saveDeck({ id: deckId, name, cards, poolIds, thumbnailCardId: deckThumbnailCardId });
    deckId = deck.id;
    history.replaceState(null, "", `builder.html?id=${encodeURIComponent(deckId)}`);
    saveStatus.textContent = "保存しました";
    saveStatus.className = "status-message success";
    return true;
  } catch (err) {
    saveStatus.textContent = err.message;
    saveStatus.className = "status-message error";
    return false;
  }
}

const SKIP_DISCARD_WARNING_KEY = "deck-viewer-skip-discard-warning";

document.getElementById("save-back-btn").addEventListener("click", async () => {
  if (await saveDeck()) location.href = "index.html";
});

document.getElementById("discard-back-btn").addEventListener("click", async () => {
  if (localStorage.getItem(SKIP_DISCARD_WARNING_KEY) === "true") {
    location.href = "index.html";
    return;
  }
  const result = await showConfirm("作業内容が失われますが大丈夫ですか?", {
    confirmText: "戻る",
    checkboxLabel: "次回以降表示しない",
  });
  if (!result.confirmed) return;
  if (result.checked) localStorage.setItem(SKIP_DISCARD_WARNING_KEY, "true");
  location.href = "index.html";
});

init();
