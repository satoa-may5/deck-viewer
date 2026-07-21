async function render() {
  const params = new URLSearchParams(location.search);
  const deckId = params.get("id");
  const grid = document.getElementById("grid");

  if (!deckId) {
    grid.innerHTML = '<div class="empty-state">デッキIDが指定されていません</div>';
    return;
  }

  const [deck, cards] = await Promise.all([Api.getDeck(deckId), Api.getCards()]);
  if (!deck) {
    grid.innerHTML = '<div class="empty-state">デッキが見つかりません</div>';
    return;
  }

  const cardById = Object.fromEntries(cards.map((c) => [c.id, c]));

  document.getElementById("deck-name").textContent = deck.name;
  document.getElementById("edit-link").href = `builder.html?id=${encodeURIComponent(deck.id)}`;
  const totalCards = deck.cards.reduce((sum, c) => sum + c.count, 0);
  document.getElementById("deck-meta").textContent = `${deck.cards.length}種類 / 合計${totalCards}枚`;

  grid.innerHTML = "";
  for (const entry of deck.cards) {
    grid.appendChild(createCardElement(cardById[entry.cardId] || null, entry.cardId, entry.count));
  }
}

render();
