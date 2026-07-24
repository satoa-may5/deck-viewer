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
  const visibleCards = allCards.filter((c) => selectedPoolIds.has(c.poolId));
  if (visibleCards.length === 0) {
    collectionGrid.innerHTML = '<div class="empty-state">選択したカードプールにカードがありません。「カードを追加」から登録してください。</div>';
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
