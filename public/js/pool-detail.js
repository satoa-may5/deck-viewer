const params = new URLSearchParams(location.search);
const poolId = params.get("id");

const nameInput = document.getElementById("pool-name-input");
const cardListEl = document.getElementById("card-list");
const viewToggle = document.getElementById("view-toggle");

const VIEW_MODE_KEY = "deck-viewer-pool-view-mode";
let viewMode = localStorage.getItem(VIEW_MODE_KEY) || "list";

function updateViewToggleUI() {
  for (const btn of viewToggle.querySelectorAll(".view-toggle-btn")) {
    btn.classList.toggle("active", btn.dataset.view === viewMode);
  }
}

function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem(VIEW_MODE_KEY, mode);
  updateViewToggleUI();
  renderCards();
}

viewToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-toggle-btn");
  if (!btn) return;
  setViewMode(btn.dataset.view);
});

function dragHandle() {
  const span = document.createElement("span");
  span.className = "drag-handle";
  span.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  return span;
}

function displayName(card) {
  return card.name || "(名称未設定)";
}

async function renderCards() {
  const cards = await Api.getCards(poolId);
  if (cards.length === 0) {
    cardListEl.className = "";
    cardListEl.innerHTML =
      '<div class="empty-state">まだカードがありません。右下の＋ボタンから追加してください。</div>';
    return;
  }
  if (viewMode === "grid") {
    renderGridView(cards);
  } else {
    renderListView(cards);
  }
}

// ---- List view ----

function cardCaption(card) {
  return card.cost !== null && card.cost !== undefined ? `必要エナジー ${card.cost}` : "";
}

function renderListView(cards) {
  cardListEl.className = "deck-list";
  cardListEl.innerHTML = "";
  for (const card of cards) {
    cardListEl.appendChild(createCardRow(card));
  }
}

function createCardRow(card) {
  const row = document.createElement("div");
  row.className = "card-row";
  row.dataset.id = card.id;

  const thumb = document.createElement("div");
  thumb.className = "card-row-thumb";
  const img = document.createElement("img");
  img.src = Api.cardImageUrl(card);
  img.alt = displayName(card);
  thumb.appendChild(img);

  const info = document.createElement("div");
  info.className = "card-row-info";
  const title = document.createElement("strong");
  title.textContent = displayName(card);
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
    if (!confirm(`「${displayName(card)}」を削除します。よろしいですか?`)) return;
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
  nameField.placeholder = "(空欄可)";
  nameField.value = card.name || "";

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
    await Api.updateCard(card.id, { name: nameField.value.trim(), cost: costField.value });
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

// ---- Grid view ----

function renderGridView(cards) {
  cardListEl.className = "grid";
  cardListEl.innerHTML = "";
  for (const card of cards) {
    cardListEl.appendChild(createCardGridItem(card));
  }
}

function createCardGridItem(card) {
  const item = document.createElement("div");
  item.className = "card-item";
  item.dataset.id = card.id;

  const frame = document.createElement("div");
  frame.className = "card-frame";
  const img = document.createElement("img");
  img.src = Api.cardImageUrl(card);
  img.alt = displayName(card);
  frame.appendChild(img);
  item.appendChild(frame);

  const caption = document.createElement("div");
  caption.className = "card-caption";
  caption.textContent = displayName(card);
  item.appendChild(caption);

  const actions = document.createElement("div");
  actions.className = "card-grid-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "icon-btn";
  editBtn.title = "編集";
  editBtn.textContent = "✎";
  editBtn.addEventListener("click", () => startGridRename(caption, card));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn danger";
  deleteBtn.title = "削除";
  deleteBtn.textContent = "🗑";
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`「${displayName(card)}」を削除します。よろしいですか?`)) return;
    await Api.deleteCard(card.id);
    await renderCards();
  });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  item.appendChild(actions);

  return item;
}

function startGridRename(caption, card) {
  caption.innerHTML = "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "grid-rename-input";
  input.placeholder = "(空欄可)";
  input.value = card.name || "";

  let done = false;
  const save = async () => {
    if (done) return;
    done = true;
    await Api.updateCard(card.id, { name: input.value.trim() });
    await renderCards();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      done = true;
      renderCards();
    }
  });
  input.addEventListener("blur", save);

  caption.appendChild(input);
  input.focus();
  input.select();
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
const modalNameInput = document.getElementById("modal-card-name");
const modalStatus = document.getElementById("modal-status");

const cropPopup = document.getElementById("crop-popup");
const cropPopupStage = document.getElementById("crop-popup-stage");

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

function refreshImageArea() {
  if (croppedBlob) showImagePreview();
  else showImagePlaceholder();
}

function openCropPopup(file) {
  cropPopupStage.innerHTML = "";
  cropPopup.hidden = false;
  cropTool = new CropTool(cropPopupStage);
  cropTool.loadFile(file);
}

function closeCropPopup() {
  cropPopup.hidden = true;
}

document.getElementById("crop-popup-ok").addEventListener("click", async () => {
  croppedBlob = await cropTool.toBlob(OUTPUT_W, OUTPUT_H);
  closeCropPopup();
  refreshImageArea();
});

document.getElementById("crop-popup-cancel").addEventListener("click", closeCropPopup);
document.getElementById("crop-popup-close").addEventListener("click", closeCropPopup);

modalFileInput.addEventListener("change", () => {
  const file = modalFileInput.files[0];
  if (!file) return;
  openCropPopup(file);
});

function openAddCardModal() {
  croppedBlob = null;
  cropTool = null;
  modalNameInput.value = "";
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
  if (e.key !== "Escape") return;
  if (!cropPopup.hidden) closeCropPopup();
  else if (!modal.hidden) closeAddCardModal();
});

document.getElementById("modal-save-btn").addEventListener("click", async () => {
  const name = modalNameInput.value.trim();

  if (!croppedBlob) {
    setModalStatus("画像を選択してください", "error");
    return;
  }

  setModalStatus("保存中...", "");
  try {
    const card = await Api.addCard({ name, cost: "", poolId, imageBlob: croppedBlob });
    setModalStatus(`「${displayName(card)}」を登録しました。続けて追加できます。`, "success");
    croppedBlob = null;
    cropTool = null;
    modalNameInput.value = "";
    modalFileInput.value = "";
    showImagePlaceholder();
    await renderCards();
  } catch (err) {
    setModalStatus(err.message, "error");
  }
});

async function init() {
  updateViewToggleUI();

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
