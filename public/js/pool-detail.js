const params = new URLSearchParams(location.search);
const poolId = params.get("id");

const nameInput = document.getElementById("pool-name-input");
const cardCountEl = document.getElementById("pool-card-count");
const cardListEl = document.getElementById("card-list");
const viewToggle = document.getElementById("view-toggle");

const VIEW_MODE_KEY = "deck-viewer-pool-view-mode";
let viewMode = localStorage.getItem(VIEW_MODE_KEY) || "grid";
let latestCards = [];
let currentPool = null;

async function toggleThumbnail(card) {
  const nextId = currentPool.thumbnailCardId === card.id ? null : card.id;
  currentPool = await Api.updatePool(poolId, { thumbnailCardId: nextId });
  renderCards();
}

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

// ---- Auto card naming (CARD-001, CARD-002, ...) ----

function computeNextCardNumber(cards) {
  let max = 0;
  for (const c of cards) {
    const m = /^CARD-(\d+)$/.exec(c.name || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

function formatCardName(n) {
  return `CARD-${String(n).padStart(3, "0")}`;
}

// ---- Bulk selection ----

const selectModeBtn = document.getElementById("select-mode-btn");
const selectionBar = document.getElementById("selection-bar");
const selectionCountEl = document.getElementById("selection-count");
const selectionDeleteBtn = document.getElementById("selection-delete-btn");
const selectionCancelBtn = document.getElementById("selection-cancel-btn");

let selectMode = false;
let selectedIds = new Set();

function updateSelectionUI() {
  selectionCountEl.textContent = selectedIds.size > 0 ? `${selectedIds.size}件選択中` : "選択してください";
  selectionDeleteBtn.disabled = selectedIds.size === 0;
}

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateSelectionUI();
}

function enterSelectMode() {
  selectMode = true;
  selectedIds.clear();
  selectModeBtn.hidden = true;
  selectionBar.hidden = false;
  updateSelectionUI();
  renderCards();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  selectModeBtn.hidden = false;
  selectionBar.hidden = true;
  renderCards();
}

selectModeBtn.addEventListener("click", enterSelectMode);
selectionCancelBtn.addEventListener("click", exitSelectMode);

selectionDeleteBtn.addEventListener("click", async () => {
  if (selectedIds.size === 0) return;
  if (!(await showConfirm(`選択した${selectedIds.size}件のカードを削除します。よろしいですか?`))) return;
  for (const id of selectedIds) {
    await Api.deleteCard(id);
  }
  selectMode = false;
  selectedIds.clear();
  selectModeBtn.hidden = false;
  selectionBar.hidden = true;
  await renderCards();
});

async function renderCards() {
  latestCards = await Api.getCards(poolId);
  cardCountEl.textContent = `${latestCards.length}枚`;
  if (latestCards.length === 0) {
    cardListEl.className = "";
    cardListEl.innerHTML =
      '<div class="empty-state">まだカードがありません。右下の＋ボタンから追加してください。</div>';
    return;
  }
  if (viewMode === "grid") {
    renderGridView(latestCards);
  } else {
    renderListView(latestCards);
  }
}

// ---- List view ----

const CARD_TYPE_LABELS = { character: "キャラクター", event: "イベント", field: "フィールド" };

function cardCaption(card) {
  const parts = [];
  if (card.type && CARD_TYPE_LABELS[card.type]) parts.push(CARD_TYPE_LABELS[card.type]);
  if (card.cost !== null && card.cost !== undefined) parts.push(`必要エナジー ${card.cost}`);
  if (card.color) parts.push(card.color);
  if (card.parallel) parts.push("パラレル");
  return parts.join(" ・ ");
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
  if (selectMode && selectedIds.has(card.id)) row.classList.add("selected");

  const thumb = document.createElement("div");
  thumb.className = "card-row-thumb";
  const img = document.createElement("img");
  img.src = Api.cardImageUrl(card);
  img.alt = displayName(card);
  img.draggable = false;
  thumb.appendChild(img);

  if (selectMode) {
    row.classList.add("selectable-row");
    row.addEventListener("click", (e) => {
      if (e.target.closest(".drag-handle")) return;
      toggleSelect(card.id);
      row.classList.toggle("selected", selectedIds.has(card.id));
    });
  } else {
    row.classList.add("editable-row");
    row.addEventListener("click", (e) => {
      if (e.target.closest(".drag-handle")) return;
      openEditCardModal(card);
    });
  }

  const info = document.createElement("div");
  info.className = "card-row-info";
  const title = document.createElement("strong");
  title.textContent = displayName(card);
  const small = document.createElement("small");
  small.textContent = cardCaption(card);
  info.appendChild(title);
  info.appendChild(small);

  row.appendChild(dragHandle());
  row.appendChild(thumb);
  row.appendChild(info);
  return row;
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
  img.draggable = false;
  frame.appendChild(img);

  if (selectMode) {
    frame.classList.add("selectable-frame");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "grid-select-checkbox";
    checkbox.checked = selectedIds.has(card.id);
    checkbox.addEventListener("click", (e) => e.stopPropagation());
    checkbox.addEventListener("change", () => toggleSelect(card.id));
    frame.appendChild(checkbox);
    frame.addEventListener("click", (e) => {
      if (e.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      toggleSelect(card.id);
    });
  } else {
    frame.classList.add("editable-frame");
    frame.addEventListener("click", () => openEditCardModal(card));
  }

  const thumbnailBtn = document.createElement("button");
  thumbnailBtn.type = "button";
  thumbnailBtn.className = "grid-thumbnail-btn";
  thumbnailBtn.classList.toggle("active", currentPool && currentPool.thumbnailCardId === card.id);
  thumbnailBtn.title = "カードプールのサムネイルに設定";
  thumbnailBtn.textContent = "★";
  thumbnailBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleThumbnail(card);
  });
  frame.appendChild(thumbnailBtn);

  item.appendChild(frame);

  const caption = document.createElement("div");
  caption.className = "card-caption";
  caption.textContent = displayName(card);
  item.appendChild(caption);

  return item;
}

makeSortable(cardListEl, {
  itemSelector: ".card-row",
  onReorder: async (order) => {
    await Api.reorderCards(order);
    await renderCards();
  },
});

makeSortable(cardListEl, {
  itemSelector: ".card-item",
  handleSelector: ".card-frame",
  axis: "grid",
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

// ---- Add/edit-card modal ----

const OUTPUT_W = 630;
const OUTPUT_H = 880;

const modal = document.getElementById("add-card-modal");
const modalTitle = document.getElementById("modal-title");
const modalImageArea = document.getElementById("modal-image-area");
const modalFileInput = document.getElementById("modal-file-input");
const modalNameInput = document.getElementById("modal-card-name");
const modalTypeInput = document.getElementById("modal-card-type");
const modalCostInput = document.getElementById("modal-card-cost");
const modalColorInput = document.getElementById("modal-card-color");
const modalParallelInput = document.getElementById("modal-card-parallel");
const modalSaveBtn = document.getElementById("modal-save-btn");
const modalStatus = document.getElementById("modal-status");

const cropPopup = document.getElementById("crop-popup");
const cropPopupStage = document.getElementById("crop-popup-stage");

let cropTool = null;
let croppedBlob = null;
let editingCard = null; // null = adding a new card, otherwise the card being edited

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

function showImagePreview(src) {
  modalImageArea.innerHTML = "";
  const preview = document.createElement("div");
  preview.className = "image-preview";
  const img = document.createElement("img");
  img.src = src;
  img.draggable = false;
  preview.appendChild(img);
  preview.addEventListener("click", () => modalFileInput.click());
  modalImageArea.appendChild(preview);
}

function refreshImageArea() {
  if (croppedBlob) showImagePreview(URL.createObjectURL(croppedBlob));
  else if (editingCard) showImagePreview(Api.cardImageUrl(editingCard));
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
  modalFileInput.value = "";
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
  editingCard = null;
  croppedBlob = null;
  cropTool = null;
  modalNameInput.value = "";
  modalNameInput.placeholder = formatCardName(computeNextCardNumber(latestCards));
  modalTypeInput.value = "";
  modalCostInput.value = "";
  modalColorInput.value = "";
  modalParallelInput.checked = false;
  setModalStatus("", "");
  modalTitle.textContent = "カードを追加";
  modalSaveBtn.textContent = "保存する";
  showImagePlaceholder();
  modal.hidden = false;
}

function openEditCardModal(card) {
  editingCard = card;
  croppedBlob = null;
  cropTool = null;
  modalNameInput.value = card.name || "";
  modalNameInput.placeholder = formatCardName(computeNextCardNumber(latestCards));
  modalTypeInput.value = card.type || "";
  modalCostInput.value = card.cost !== null && card.cost !== undefined ? card.cost : "";
  modalColorInput.value = card.color || "";
  modalParallelInput.checked = Boolean(card.parallel);
  setModalStatus("", "");
  modalTitle.textContent = "カードを編集";
  modalSaveBtn.textContent = "保存する";
  showImagePreview(Api.cardImageUrl(card));
  modal.hidden = false;
}

function closeAddCardModal() {
  modal.hidden = true;
  modalFileInput.value = "";
}

document.getElementById("open-add-card-btn").addEventListener("click", openAddCardModal);
document.getElementById("close-modal-btn").addEventListener("click", closeAddCardModal);

// Bind add-card-modal before crop-popup so crop-popup (opened on top of it) is
// treated as the topmost modal — Enter/Escape act on whichever is actually on top.
bindModalDismissal(modal, {
  onCancel: closeAddCardModal,
  onConfirm: () => modalSaveBtn.click(),
});
bindModalDismissal(cropPopup, {
  onCancel: closeCropPopup,
  onConfirm: () => document.getElementById("crop-popup-ok").click(),
});

modalSaveBtn.addEventListener("click", async () => {
  const name = modalNameInput.value.trim() || modalNameInput.placeholder;
  const type = modalTypeInput.value;
  const cost = modalCostInput.value;
  const color = modalColorInput.value.trim();
  const parallel = modalParallelInput.checked;

  if (editingCard) {
    setModalStatus("保存中...", "");
    try {
      if (croppedBlob) {
        await Api.replaceCardImage(editingCard.id, croppedBlob);
      }
      await Api.updateCard(editingCard.id, { name, type, cost, color, parallel });
      closeAddCardModal();
      await renderCards();
    } catch (err) {
      setModalStatus(err.message, "error");
    }
    return;
  }

  if (!croppedBlob) {
    setModalStatus("画像を選択してください", "error");
    return;
  }

  setModalStatus("保存中...", "");
  try {
    const card = await Api.addCard({ name, cost, color, parallel, type, poolId, imageBlob: croppedBlob });
    setModalStatus(`「${displayName(card)}」を登録しました。続けて追加できます。`, "success");
    croppedBlob = null;
    cropTool = null;
    modalNameInput.value = "";
    modalTypeInput.value = "";
    modalCostInput.value = "";
    modalColorInput.value = "";
    modalParallelInput.checked = false;
    modalFileInput.value = "";
    showImagePlaceholder();
    await renderCards();
    modalNameInput.placeholder = formatCardName(computeNextCardNumber(latestCards));
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
  currentPool = pool;
  nameInput.value = pool.name;
  await renderCards();
}

init();
