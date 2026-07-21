let allCards = [];
let deckId = null;
const deckCounts = new Map(); // cardId -> count

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
  } else {
    deckCounts.set(cardId, current - 1);
  }
  renderPanes();
}

function renderPanes() {
  const cardById = Object.fromEntries(allCards.map((c) => [c.id, c]));

  deckGrid.innerHTML = "";
  if (deckCounts.size === 0) {
    deckGrid.innerHTML = '<div class="empty-state">下の一覧からカードを追加してください</div>';
  } else {
    for (const [cardId, count] of deckCounts) {
      const el = createCardElement(cardById[cardId] || null, cardId, count);
      attachTapOrSwipe(el, () => removeFromDeck(cardId));
      deckGrid.appendChild(el);
    }
  }

  collectionGrid.innerHTML = "";
  if (allCards.length === 0) {
    collectionGrid.innerHTML = '<div class="empty-state">登録済みのカードがありません。「カードを追加」から登録してください。</div>';
  } else {
    for (const card of allCards) {
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

  allCards = await Api.getCards();

  if (deckId) {
    const deck = await Api.getDeck(deckId);
    if (deck) {
      nameInput.value = deck.name;
      for (const entry of deck.cards) {
        deckCounts.set(entry.cardId, entry.count);
      }
    }
  }

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
  try {
    const deck = await Api.saveDeck({ id: deckId, name, cards });
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
