const tabs = document.getElementById("tabs");
const panelDecks = document.getElementById("panel-decks");
const panelPools = document.getElementById("panel-pools");
const deckListEl = document.getElementById("deck-list");
const poolListEl = document.getElementById("pool-list");

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

function createReorderButtons(onMoveUp, onMoveDown, { isFirst, isLast }) {
  const wrap = document.createElement("div");
  wrap.className = "reorder-btns";

  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.textContent = "▲";
  upBtn.disabled = isFirst;
  upBtn.addEventListener("click", onMoveUp);

  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.textContent = "▼";
  downBtn.disabled = isLast;
  downBtn.addEventListener("click", onMoveDown);

  wrap.appendChild(upBtn);
  wrap.appendChild(downBtn);
  return wrap;
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
    btn.addEventListener("click", async () => {
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

// ---- Decks ----

async function renderDecks() {
  const decks = await Api.getDecks();
  deckListEl.innerHTML = "";
  for (let i = 0; i < decks.length; i++) {
    deckListEl.appendChild(
      createDeckRow(decks[i], { isFirst: i === 0, isLast: i === decks.length - 1 }, decks)
    );
  }
}

function createDeckRow(deck, position, decks) {
  const row = document.createElement("div");
  row.className = "deck-row";

  const reorder = createReorderButtons(
    async () => {
      await moveDeck(decks, deck.id, -1);
    },
    async () => {
      await moveDeck(decks, deck.id, 1);
    },
    position
  );

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

  const menu = createMenu([
    {
      label: "リネーム",
      onClick: () => {
        startRename(
          row,
          deck.name,
          async (name) => {
            const full = await Api.getDeck(deck.id);
            await Api.saveDeck({ id: deck.id, name, cards: full.cards, poolIds: full.poolIds || [] });
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
  ]);

  actions.appendChild(viewLink);
  actions.appendChild(editLink);
  actions.appendChild(menu);

  const main = document.createElement("div");
  main.className = "deck-row-main";
  main.appendChild(reorder);
  main.appendChild(info);

  row.appendChild(main);
  row.appendChild(actions);
  return row;
}

async function moveDeck(decks, deckId, delta) {
  const ids = decks.map((d) => d.id);
  const index = ids.indexOf(deckId);
  const target = index + delta;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await Api.reorderDecks(ids);
  await renderDecks();
}

// ---- Card pools ----

function dragHandle() {
  const span = document.createElement("span");
  span.className = "drag-handle";
  span.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  return span;
}

async function renderPools() {
  const pools = await Api.getPools();
  poolListEl.innerHTML = "";
  for (const pool of pools) {
    poolListEl.appendChild(createPoolRow(pool));
  }
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

  const favBtn = document.createElement("button");
  favBtn.type = "button";
  favBtn.className = "icon-btn" + (pool.favorite ? " favorited" : "");
  favBtn.title = "お気に入り";
  favBtn.textContent = pool.favorite ? "★" : "☆";
  favBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await Api.updatePool(pool.id, { favorite: !pool.favorite });
    await renderPools();
  });

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
    const warning =
      pool.cardCount > 0
        ? `「${pool.name}」を削除します。プール内の${pool.cardCount}枚のカードも一緒に削除されます。よろしいですか?`
        : `「${pool.name}」を削除します。よろしいですか?`;
    if (!(await showConfirm(warning))) return;
    await Api.deletePool(pool.id);
    await renderPools();
  });

  actions.appendChild(favBtn);
  actions.appendChild(renameBtn);
  actions.appendChild(deleteBtn);

  const main = document.createElement("div");
  main.className = "deck-row-main";
  main.appendChild(dragHandle());
  main.appendChild(info);

  row.appendChild(main);
  row.appendChild(actions);
  return row;
}

makeSortable(poolListEl, {
  itemSelector: ".deck-row",
  onReorder: async (order) => {
    await Api.reorderPools(order);
    await renderPools();
  },
});

document.getElementById("create-pool-row").addEventListener("click", async () => {
  const pool = await Api.createPool("新しいカードプール");
  await renderPools();
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

// ---- Import card pool (git-based sharing) ----

const importPoolBtn = document.getElementById("import-pool-btn");
const importModal = document.getElementById("import-pool-modal");
const importListEl = document.getElementById("import-pool-list");

function closeImportModal() {
  importModal.hidden = true;
}

async function openImportModal() {
  importModal.hidden = false;
  importListEl.innerHTML = "読み込み中...";

  const exportsList = await Api.getPoolExports();
  if (exportsList.length === 0) {
    importListEl.innerHTML =
      '<div class="empty-state">インポートできるカードプールがありません。pool-exports/ フォルダにエクスポート済みのプールを置いてください。</div>';
    return;
  }

  importListEl.innerHTML = "";
  for (const item of exportsList) {
    const row = document.createElement("div");
    row.className = "deck-row";

    const info = document.createElement("div");
    info.className = "deck-info";
    const title = document.createElement("strong");
    title.textContent = item.poolName;
    const small = document.createElement("small");
    small.textContent = `${item.cardCount}枚`;
    info.appendChild(title);
    info.appendChild(small);

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "btn primary";
    importBtn.textContent = "インポート";
    importBtn.addEventListener("click", async () => {
      importBtn.disabled = true;
      try {
        await Api.importPoolExport(item.folderId);
        closeImportModal();
        await renderPools();
      } catch (err) {
        alert(err.message);
        importBtn.disabled = false;
      }
    });

    const main = document.createElement("div");
    main.className = "deck-row-main";
    main.appendChild(info);

    row.appendChild(main);
    row.appendChild(importBtn);
    importListEl.appendChild(row);
  }
}

importPoolBtn.addEventListener("click", openImportModal);
document.getElementById("close-import-modal-btn").addEventListener("click", closeImportModal);
bindModalDismissal(importModal, { onCancel: closeImportModal });

setActiveTab(activeTab);
renderDecks();
renderPools();
