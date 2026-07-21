const tabs = document.getElementById("tabs");
const panelDecks = document.getElementById("panel-decks");
const panelPools = document.getElementById("panel-pools");
const deckListEl = document.getElementById("deck-list");
const poolListEl = document.getElementById("pool-list");

let activeTab = "decks";

function setActiveTab(tab) {
  activeTab = tab;
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

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn primary";
  saveBtn.textContent = "保存";
  saveBtn.addEventListener("click", async () => {
    const name = input.value.trim();
    if (!name) return;
    await onSave(name);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn";
  cancelBtn.textContent = "キャンセル";
  cancelBtn.addEventListener("click", onCancel);

  row.appendChild(input);
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);
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
        if (!confirm(`「${deck.name}」を削除します。よろしいですか?`)) return;
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

async function renderPools() {
  const pools = await Api.getPools();
  poolListEl.innerHTML = "";
  for (let i = 0; i < pools.length; i++) {
    poolListEl.appendChild(
      createPoolRow(pools[i], { isFirst: i === 0, isLast: i === pools.length - 1 }, pools)
    );
  }
}

function createPoolRow(pool, position, pools) {
  const row = document.createElement("div");
  row.className = "deck-row";

  const reorder = createReorderButtons(
    async () => {
      await movePool(pools, pool.id, -1);
    },
    async () => {
      await movePool(pools, pool.id, 1);
    },
    position
  );

  const info = document.createElement("div");
  info.className = "deck-info";
  const title = document.createElement("strong");
  title.textContent = pool.name;
  const small = document.createElement("small");
  small.textContent = `${pool.cardCount}枚のカード`;
  info.appendChild(title);
  info.appendChild(small);

  const actions = document.createElement("div");
  actions.className = "nav-links";

  const addLink = document.createElement("a");
  addLink.className = "btn";
  addLink.href = "add-card.html";
  addLink.textContent = "カードを追加";

  const menu = createMenu([
    {
      label: "リネーム",
      onClick: () => {
        startRename(
          row,
          pool.name,
          async (name) => {
            await Api.renamePool(pool.id, name);
            await renderPools();
          },
          renderPools
        );
      },
    },
    {
      label: "削除",
      danger: true,
      onClick: async () => {
        const warning =
          pool.cardCount > 0
            ? `「${pool.name}」を削除します。プール内の${pool.cardCount}枚のカードも一緒に削除されます。よろしいですか?`
            : `「${pool.name}」を削除します。よろしいですか?`;
        if (!confirm(warning)) return;
        await Api.deletePool(pool.id);
        await renderPools();
      },
    },
  ]);

  actions.appendChild(addLink);
  actions.appendChild(menu);

  const main = document.createElement("div");
  main.className = "deck-row-main";
  main.appendChild(reorder);
  main.appendChild(info);

  row.appendChild(main);
  row.appendChild(actions);
  return row;
}

async function movePool(pools, poolId, delta) {
  const ids = pools.map((p) => p.id);
  const index = ids.indexOf(poolId);
  const target = index + delta;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await Api.reorderPools(ids);
  await renderPools();
}

document.getElementById("create-pool-row").addEventListener("click", function startCreatePool() {
  const btn = this;
  const row = document.createElement("div");
  row.className = "ghost-row ghost-row-active";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "カードプール名";
  input.className = "rename-input";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "btn primary";
  confirmBtn.textContent = "作成";
  const submit = async () => {
    const name = input.value.trim();
    if (!name) return;
    await Api.createPool(name);
    row.replaceWith(btn);
    await renderPools();
  };
  confirmBtn.addEventListener("click", submit);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn";
  cancelBtn.textContent = "キャンセル";
  cancelBtn.addEventListener("click", () => row.replaceWith(btn));

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") row.replaceWith(btn);
  });

  row.appendChild(input);
  row.appendChild(confirmBtn);
  row.appendChild(cancelBtn);
  btn.replaceWith(row);
  input.focus();
});

setActiveTab("decks");
renderDecks();
renderPools();
