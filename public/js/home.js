async function render() {
  const list = document.getElementById("deck-list");
  const decks = await Api.getDecks();

  if (decks.length === 0) {
    list.innerHTML = '<div class="empty-state">まだデッキがありません。「＋ 新しいデッキ」から作成してください。</div>';
    return;
  }

  decks.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  list.innerHTML = "";
  for (const deck of decks) {
    const row = document.createElement("div");
    row.className = "deck-row";

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
    viewLink.textContent = "表示";
    const editLink = document.createElement("a");
    editLink.className = "btn";
    editLink.href = `builder.html?id=${encodeURIComponent(deck.id)}`;
    editLink.textContent = "編集";
    actions.appendChild(viewLink);
    actions.appendChild(editLink);

    row.appendChild(info);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

render();
