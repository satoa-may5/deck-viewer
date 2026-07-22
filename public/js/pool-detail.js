const params = new URLSearchParams(location.search);
const poolId = params.get("id");

const nameInput = document.getElementById("pool-name-input");
const cardListEl = document.getElementById("card-list");

function dragHandle() {
  const span = document.createElement("span");
  span.className = "drag-handle";
  span.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  return span;
}

async function renderCards() {
  const cards = await Api.getCards(poolId);
  cardListEl.innerHTML = "";
  if (cards.length === 0) {
    cardListEl.innerHTML =
      '<div class="empty-state">まだカードがありません。右下の＋ボタンから追加してください。</div>';
    return;
  }
  for (const card of cards) {
    cardListEl.appendChild(createCardRow(card));
  }
}

function cardCaption(card) {
  return card.cost !== null && card.cost !== undefined ? `${card.id} / エナジー${card.cost}` : card.id;
}

function createCardRow(card) {
  const row = document.createElement("div");
  row.className = "card-row";
  row.dataset.id = card.id;

  const thumb = document.createElement("div");
  thumb.className = "card-row-thumb";
  const img = document.createElement("img");
  img.src = Api.cardImageUrl(card);
  img.alt = card.name;
  thumb.appendChild(img);

  const info = document.createElement("div");
  info.className = "card-row-info";
  const title = document.createElement("strong");
  title.textContent = card.name;
  const small = document.createElement("small");
  small.textContent = cardCaption(card);
  info.appendChild(title);
  info.appendChild(small);

  const actions = document.createElement("div");
  actions.className = "nav-links";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "icon-btn";
  editBtn.title = "編集";
  editBtn.textContent = "✎";
  editBtn.addEventListener("click", () => startEditCard(row, card));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn danger";
  deleteBtn.title = "削除";
  deleteBtn.textContent = "🗑";
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`「${card.name}」を削除します。よろしいですか?`)) return;
    await Api.deleteCard(card.id);
    await renderCards();
  });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  row.appendChild(dragHandle());
  row.appendChild(thumb);
  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

function startEditCard(row, card) {
  row.innerHTML = "";
  row.appendChild(dragHandle());

  const thumb = document.createElement("div");
  thumb.className = "card-row-thumb";
  const img = document.createElement("img");
  img.src = Api.cardImageUrl(card);
  thumb.appendChild(img);
  row.appendChild(thumb);

  const form = document.createElement("div");
  form.className = "card-edit-form";

  const nameField = document.createElement("input");
  nameField.type = "text";
  nameField.value = card.name;

  const costField = document.createElement("input");
  costField.type = "number";
  costField.min = "0";
  costField.step = "1";
  costField.placeholder = "エナジー";
  costField.value = card.cost !== null && card.cost !== undefined ? card.cost : "";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn primary";
  saveBtn.textContent = "保存";
  saveBtn.addEventListener("click", async () => {
    const name = nameField.value.trim();
    if (!name) return;
    await Api.updateCard(card.id, { name, cost: costField.value });
    await renderCards();
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn";
  cancelBtn.textContent = "キャンセル";
  cancelBtn.addEventListener("click", renderCards);

  form.appendChild(nameField);
  form.appendChild(costField);
  form.appendChild(saveBtn);
  form.appendChild(cancelBtn);
  row.appendChild(form);
}

makeSortable(cardListEl, {
  itemSelector: ".card-row",
  onReorder: async (order) => {
    await Api.reorderCards(order);
    await renderCards();
  },
});

nameInput.addEventListener("change", async () => {
  const name = nameInput.value.trim();
  if (!name || !poolId) return;
  await Api.renamePool(poolId, name);
});

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") nameInput.blur();
});

// ---- Add-card modal ----

const OUTPUT_W = 630;
const OUTPUT_H = 880;

const modal = document.getElementById("add-card-modal");
const modalImageArea = document.getElementById("modal-image-area");
const modalFileInput = document.getElementById("modal-file-input");
const modalIdInput = document.getElementById("modal-card-id");
const modalNameInput = document.getElementById("modal-card-name");
const modalCostInput = document.getElementById("modal-card-cost");
const modalStatus = document.getElementById("modal-status");

let cropTool = null;
let croppedBlob = null;

function setModalStatus(message, kind) {
  modalStatus.textContent = message;
  modalStatus.className = `status-message ${kind || ""}`;
}

function showImagePlaceholder() {
  modalImageArea.innerHTML = "";
  const placeholder = document.createElement("div");
  placeholder.className = "image-placeholder";
  placeholder.textContent = "＋ 画像を選択";
  placeholder.addEventListener("click", () => modalFileInput.click());
  modalImageArea.appendChild(placeholder);
}

function showCropStage() {
  modalImageArea.innerHTML = "";
  const stage = document.createElement("div");
  stage.className = "crop-stage";
  modalImageArea.appendChild(stage);

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "btn primary";
  confirmBtn.style.width = "100%";
  confirmBtn.textContent = "この範囲で決定";
  confirmBtn.addEventListener("click", async () => {
    croppedBlob = await cropTool.toBlob(OUTPUT_W, OUTPUT_H);
    showImagePreview();
  });
  modalImageArea.appendChild(confirmBtn);

  return stage;
}

function showImagePreview() {
  modalImageArea.innerHTML = "";
  const preview = document.createElement("div");
  preview.className = "image-preview";
  const img = document.createElement("img");
  img.src = URL.createObjectURL(croppedBlob);
  preview.appendChild(img);
  preview.addEventListener("click", () => modalFileInput.click());
  modalImageArea.appendChild(preview);
}

modalFileInput.addEventListener("change", async () => {
  const file = modalFileInput.files[0];
  if (!file) return;
  const stage = showCropStage();
  cropTool = new CropTool(stage);
  await cropTool.loadFile(file);
});

function openAddCardModal() {
  croppedBlob = null;
  cropTool = null;
  modalIdInput.value = "";
  modalNameInput.value = "";
  modalCostInput.value = "";
  setModalStatus("", "");
  showImagePlaceholder();
  modal.hidden = false;
}

function closeAddCardModal() {
  modal.hidden = true;
}

document.getElementById("open-add-card-btn").addEventListener("click", openAddCardModal);
document.getElementById("close-modal-btn").addEventListener("click", closeAddCardModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeAddCardModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeAddCardModal();
});

document.getElementById("modal-save-btn").addEventListener("click", async () => {
  const id = modalIdInput.value.trim();
  const name = modalNameInput.value.trim();
  const cost = modalCostInput.value;

  if (!croppedBlob) {
    setModalStatus("画像を選択してください", "error");
    return;
  }
  if (!id || !name) {
    setModalStatus("カード番号とカード名は必須です", "error");
    return;
  }

  setModalStatus("保存中...", "");
  try {
    await Api.addCard({ id, name, cost, poolId, imageBlob: croppedBlob });
    setModalStatus(`「${name}」を登録しました。続けて追加できます。`, "success");
    croppedBlob = null;
    cropTool = null;
    modalIdInput.value = "";
    modalNameInput.value = "";
    modalCostInput.value = "";
    modalFileInput.value = "";
    showImagePlaceholder();
    await renderCards();
  } catch (err) {
    setModalStatus(err.message, "error");
  }
});

async function init() {
  if (!poolId) {
    nameInput.disabled = true;
    cardListEl.innerHTML = '<div class="empty-state">カードプールが指定されていません</div>';
    return;
  }
  const pools = await Api.getPools();
  const pool = pools.find((p) => p.id === poolId);
  if (!pool) {
    nameInput.disabled = true;
    cardListEl.innerHTML = '<div class="empty-state">カードプールが見つかりません</div>';
    return;
  }
  nameInput.value = pool.name;
  await renderCards();
}

init();
