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
    list.appendChild(createDeckRow(deck));
  }
}

function createDeckRow(deck) {
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

  const menu = document.createElement("details");
  menu.className = "deck-menu";
  const summary = document.createElement("summary");
  summary.className = "btn";
  summary.textContent = "⋮";
  menu.appendChild(summary);

  const menuBody = document.createElement("div");
  menuBody.className = "deck-menu-body";

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.textContent = "リネーム";
  renameBtn.addEventListener("click", () => {
    menu.open = false;
    startRename(row, deck);
  });

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "複製";
  copyBtn.addEventListener("click", async () => {
    menu.open = false;
    await copyDeck(deck);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "danger";
  deleteBtn.textContent = "削除";
  deleteBtn.addEventListener("click", async () => {
    menu.open = false;
    if (!confirm(`「${deck.name}」を削除します。よろしいですか?`)) return;
    await Api.deleteDeck(deck.id);
    await render();
  });

  menuBody.appendChild(renameBtn);
  menuBody.appendChild(copyBtn);
  menuBody.appendChild(deleteBtn);
  menu.appendChild(menuBody);

  actions.appendChild(viewLink);
  actions.appendChild(editLink);
  actions.appendChild(menu);

  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

function startRename(row, deck) {
  row.innerHTML = "";

  const input = document.createElement("input");
  input.type = "text";
  input.value = deck.name;
  input.className = "rename-input";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn primary";
  saveBtn.textContent = "保存";
  saveBtn.addEventListener("click", async () => {
    const name = input.value.trim();
    if (!name) return;
    const full = await Api.getDeck(deck.id);
    await Api.saveDeck({ id: deck.id, name, cards: full.cards, poolIds: full.poolIds || [] });
    await render();
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn";
  cancelBtn.textContent = "キャンセル";
  cancelBtn.addEventListener("click", render);

  row.appendChild(input);
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);
}

async function copyDeck(deck) {
  const full = await Api.getDeck(deck.id);
  await Api.saveDeck({
    name: `${deck.name} のコピー`,
    cards: full.cards,
    poolIds: full.poolIds || [],
  });
  await render();
}

render();
