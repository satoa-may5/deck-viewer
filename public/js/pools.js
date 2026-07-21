const listEl = document.getElementById("pool-list");
const statusEl = document.getElementById("status");

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status-message ${kind || ""}`;
}

async function render() {
  const pools = await Api.getPools();

  if (pools.length === 0) {
    listEl.innerHTML = '<div class="empty-state">まだカードプールがありません。上のフォームから作成してください。</div>';
    return;
  }

  listEl.innerHTML = "";
  for (const pool of pools) {
    const row = document.createElement("div");
    row.className = "deck-row";

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

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "btn";
    renameBtn.textContent = "リネーム";
    renameBtn.addEventListener("click", () => startRename(row, pool));

    actions.appendChild(addLink);
    actions.appendChild(renameBtn);

    row.appendChild(info);
    row.appendChild(actions);
    listEl.appendChild(row);
  }
}

function startRename(row, pool) {
  row.innerHTML = "";

  const input = document.createElement("input");
  input.type = "text";
  input.value = pool.name;
  input.className = "rename-input";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn primary";
  saveBtn.textContent = "保存";
  saveBtn.addEventListener("click", async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      await Api.renamePool(pool.id, name);
      await render();
    } catch (err) {
      setStatus(err.message, "error");
    }
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

document.getElementById("create-pool-btn").addEventListener("click", async () => {
  const nameInput = document.getElementById("new-pool-name");
  const name = nameInput.value.trim();
  if (!name) return;
  try {
    await Api.createPool(name);
    nameInput.value = "";
    setStatus("", "");
    await render();
  } catch (err) {
    setStatus(err.message, "error");
  }
});

render();
