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

function attachTapOrSwipe(el, action) {
  let downX = 0;
  let downY = 0;
  el.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });
  el.addEventListener("pointerup", (e) => {
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    const isTap = Math.abs(dx) < 10 && Math.abs(dy) < 10;
    const isHorizontalSwipe = Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.5;
    if (isTap || isHorizontalSwipe) action();
  });
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

function toggleDeckThumbnail(cardId) {
  deckThumbnailCardId = deckThumbnailCardId === cardId ? null : cardId;
  renderPanes();
}

// ---- Filtering (collection pane only: type / color / cost / parallel) ----

const CARD_TYPE_LABELS = { character: "キャラクター", event: "イベント", field: "フィールド" };
const filterState = { types: new Set(), colors: new Set(), costs: new Set(), parallelOnly: false };

const filterBar = document.getElementById("filter-bar");
const filterToggleBtn = document.getElementById("filter-toggle-btn");
const filterTypeGroup = document.getElementById("filter-type-group");
const filterColorGroup = document.getElementById("filter-color-group");
const filterCostGroup = document.getElementById("filter-cost-group");
const filterParallelCheckbox = document.getElementById("filter-parallel-checkbox");
const filterClearBtn = document.getElementById("filter-clear-btn");

filterToggleBtn.addEventListener("click", () => {
  filterBar.hidden = !filterBar.hidden;
});

function createFilterPill(label, active, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "filter-pill";
  btn.setAttribute("aria-pressed", String(active));
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function toggleInSet(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function clearPills(group) {
  group.querySelectorAll(".filter-pill").forEach((el) => el.remove());
}

function updateFilterUI(cards) {
  clearPills(filterTypeGroup);
  for (const [value, label] of Object.entries(CARD_TYPE_LABELS)) {
    if (!cards.some((c) => c.type === value)) continue;
    filterTypeGroup.appendChild(
      createFilterPill(label, filterState.types.has(value), () => {
        toggleInSet(filterState.types, value);
        renderPanes();
      })
    );
  }

  clearPills(filterColorGroup);
  const colors = [...new Set(cards.map((c) => c.color).filter(Boolean))].sort();
  for (const color of colors) {
    filterColorGroup.appendChild(
      createFilterPill(color, filterState.colors.has(color), () => {
        toggleInSet(filterState.colors, color);
        renderPanes();
      })
    );
  }

  clearPills(filterCostGroup);
  const costs = [...new Set(cards.map((c) => c.cost).filter((c) => c !== null && c !== undefined))].sort(
    (a, b) => a - b
  );
  for (const cost of costs) {
    filterCostGroup.appendChild(
      createFilterPill(String(cost), filterState.costs.has(cost), () => {
        toggleInSet(filterState.costs, cost);
        renderPanes();
      })
    );
  }

  filterParallelCheckbox.checked = filterState.parallelOnly;
}

filterParallelCheckbox.addEventListener("change", () => {
  filterState.parallelOnly = filterParallelCheckbox.checked;
  renderPanes();
});

filterClearBtn.addEventListener("click", () => {
  filterState.types.clear();
  filterState.colors.clear();
  filterState.costs.clear();
  filterState.parallelOnly = false;
  renderPanes();
});

function cardMatchesFilters(card) {
  if (filterState.types.size > 0 && !filterState.types.has(card.type)) return false;
  if (filterState.colors.size > 0 && !filterState.colors.has(card.color)) return false;
  if (filterState.costs.size > 0 && !filterState.costs.has(card.cost)) return false;
  if (filterState.parallelOnly && !card.parallel) return false;
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
  if (deckCounts.size === 0) {
    deckGrid.innerHTML = '<div class="empty-state">下の一覧からカードを追加してください</div>';
  } else {
    for (const [cardId, count] of deckCounts) {
      const el = createCardElement(cardById[cardId] || null, cardId, count, {
        active: deckThumbnailCardId === cardId,
        onToggle: () => toggleDeckThumbnail(cardId),
      });
      attachTapOrSwipe(el, () => removeFromDeck(cardId));
      deckGrid.appendChild(el);
    }
  }

  collectionGrid.innerHTML = "";
  if (selectedPoolIds.size === 0) {
    collectionGrid.innerHTML = '<div class="empty-state">上で参照するカードプールを選択してください</div>';
    return;
  }
  const poolCards = allCards.filter((c) => selectedPoolIds.has(c.poolId));
  updateFilterUI(poolCards);
  const visibleCards = poolCards.filter(cardMatchesFilters);
  if (poolCards.length === 0) {
    collectionGrid.innerHTML = '<div class="empty-state">選択したカードプールにカードがありません。「カードを追加」から登録してください。</div>';
  } else if (visibleCards.length === 0) {
    collectionGrid.innerHTML = '<div class="empty-state">絞り込み条件に一致するカードがありません。</div>';
  } else {
    for (const card of visibleCards) {
      const count = deckCounts.get(card.id) || null;
      const el = createCardElement(card, card.id, count);
      attachTapOrSwipe(el, () => addToDeck(card.id));
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

document.getElementById("save-btn").addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) {
    saveStatus.textContent = "デッキ名を入力してください";
    saveStatus.className = "status-message error";
    return;
  }
  const cards = [...deckCounts].map(([cardId, count]) => ({ cardId, count }));
  const poolIds = [...selectedPoolIds];
  try {
    const deck = await Api.saveDeck({ id: deckId, name, cards, poolIds, thumbnailCardId: deckThumbnailCardId });
    deckId = deck.id;
    history.replaceState(null, "", `builder.html?id=${encodeURIComponent(deckId)}`);
    saveStatus.textContent = "保存しました";
    saveStatus.className = "status-message success";
  } catch (err) {
    saveStatus.textContent = err.message;
    saveStatus.className = "status-message error";
  }
});

init();
