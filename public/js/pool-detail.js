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

async function setThumbnail(card) {
  currentPool = await Api.updatePool(poolId, { thumbnailCardId: card.id });
  exitThumbnailMode();
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
  if (thumbnailMode) return;
  selectMode = true;
  selectedIds.clear();
  selectModeBtn.hidden = true;
  selectionBar.hidden = false;
  thumbnailModeBtn.hidden = true;
  updateSelectionUI();
  renderCards();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  selectModeBtn.hidden = false;
  selectionBar.hidden = true;
  thumbnailModeBtn.hidden = false;
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

// ---- Thumbnail selection mode ----

const thumbnailModeBtn = document.getElementById("thumbnail-mode-btn");
let thumbnailMode = false;

function enterThumbnailMode() {
  if (selectMode) return;
  thumbnailMode = true;
  thumbnailModeBtn.textContent = "サムネイルにするカードを選択(キャンセル)";
  thumbnailModeBtn.classList.add("active");
  selectModeBtn.hidden = true;
  renderCards();
}

function exitThumbnailMode() {
  thumbnailMode = false;
  thumbnailModeBtn.textContent = "サムネイルを設定";
  thumbnailModeBtn.classList.remove("active");
  selectModeBtn.hidden = false;
  renderCards();
}

thumbnailModeBtn.addEventListener("click", () => {
  if (thumbnailMode) exitThumbnailMode();
  else enterThumbnailMode();
});

async function renderCards() {
  latestCards = await Api.getCards(poolId);
  cardCountEl.textContent = `${latestCards.length}枚`;
  updateFilterUI(latestCards);
  const visibleCards = latestCards.filter(cardMatchesFilters);

  if (latestCards.length === 0) {
    cardListEl.className = "";
    cardListEl.innerHTML =
      '<div class="empty-state">まだカードがありません。右下の＋ボタンから追加してください。</div>';
    return;
  }
  if (visibleCards.length === 0) {
    cardListEl.className = "";
    cardListEl.innerHTML = '<div class="empty-state">絞り込み条件に一致するカードがありません。</div>';
    return;
  }
  if (viewMode === "grid") {
    renderGridView(visibleCards);
  } else {
    renderListView(visibleCards);
  }
}

// ---- Filtering (type / color / cost range / parallel) ----

// UAのカードは5色(赤/青/緑/黄/紫)のみ。常にこの5色を表示する(データに存在するかは問わない)。
const CARD_COLORS = ["赤", "青", "緑", "黄", "紫"];

const COLOR_SWATCHES = {
  "赤": { bg: "#e53e3e", text: "#fff" },
  "青": { bg: "#3182ce", text: "#fff" },
  "緑": { bg: "#38a169", text: "#fff" },
  "黄": { bg: "#d69e2e", text: "#1a202c" },
  "紫": { bg: "#805ad5", text: "#fff" },
};

const COST_RANGE_MIN = 0;
const COST_RANGE_MAX = 15;

const filterState = {
  types: new Set(),
  colors: new Set(),
  costMin: COST_RANGE_MIN,
  costMax: COST_RANGE_MAX,
  excludeParallel: false,
};

const filterTypeGroup = document.getElementById("filter-type-group");
const filterColorGroup = document.getElementById("filter-color-group");
const filterParallelCheckbox = document.getElementById("filter-parallel-checkbox");
const filterClearBtn = document.getElementById("filter-clear-btn");
const filterCostMinInput = document.getElementById("filter-cost-min");
const filterCostMaxInput = document.getElementById("filter-cost-max");
const filterCostFill = document.getElementById("filter-cost-fill");
const filterCostMinLabel = document.getElementById("filter-cost-min-label");
const filterCostMaxLabel = document.getElementById("filter-cost-max-label");

function createFilterCheckbox(label, checked, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "filter-checkbox-item";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  wrapper.appendChild(input);
  wrapper.appendChild(document.createTextNode(label));
  return wrapper;
}

function createFilterPill(label, active, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "filter-pill";
  btn.setAttribute("aria-pressed", String(active));
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function applyColorSwatch(pill, colorName, active) {
  const swatch = COLOR_SWATCHES[colorName];
  if (!swatch) return;
  pill.style.borderColor = swatch.bg;
  if (active) {
    pill.style.background = swatch.bg;
    pill.style.color = swatch.text;
  }
}

function toggleInSet(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function updateCostSliderUI() {
  const range = COST_RANGE_MAX - COST_RANGE_MIN;
  const leftPct = ((filterState.costMin - COST_RANGE_MIN) / range) * 100;
  const rightPct = ((filterState.costMax - COST_RANGE_MIN) / range) * 100;
  filterCostFill.style.left = `${leftPct}%`;
  filterCostFill.style.width = `${rightPct - leftPct}%`;
  filterCostMinLabel.textContent = filterState.costMin;
  filterCostMaxLabel.textContent = filterState.costMax;
  filterCostMinInput.value = filterState.costMin;
  filterCostMaxInput.value = filterState.costMax;
}

filterCostMinInput.addEventListener("input", () => {
  let value = Number(filterCostMinInput.value);
  if (value > filterState.costMax) value = filterState.costMax;
  filterState.costMin = value;
  updateCostSliderUI();
  renderCards();
});

filterCostMaxInput.addEventListener("input", () => {
  let value = Number(filterCostMaxInput.value);
  if (value < filterState.costMin) value = filterState.costMin;
  filterState.costMax = value;
  updateCostSliderUI();
  renderCards();
});

function updateFilterUI() {
  filterTypeGroup.innerHTML = "";
  for (const [value, label] of Object.entries(CARD_TYPE_LABELS)) {
    filterTypeGroup.appendChild(
      createFilterCheckbox(label, filterState.types.has(value), () => {
        toggleInSet(filterState.types, value);
        renderCards();
      })
    );
  }

  filterColorGroup.innerHTML = "";
  for (const color of CARD_COLORS) {
    const active = filterState.colors.has(color);
    const pill = createFilterPill(color, active, () => {
      toggleInSet(filterState.colors, color);
      renderCards();
    });
    applyColorSwatch(pill, color, active);
    filterColorGroup.appendChild(pill);
  }

  updateCostSliderUI();
  filterParallelCheckbox.checked = filterState.excludeParallel;
}

filterParallelCheckbox.addEventListener("change", () => {
  filterState.excludeParallel = filterParallelCheckbox.checked;
  renderCards();
});

filterClearBtn.addEventListener("click", () => {
  filterState.types.clear();
  filterState.colors.clear();
  filterState.costMin = COST_RANGE_MIN;
  filterState.costMax = COST_RANGE_MAX;
  filterState.excludeParallel = false;
  updateFilterUI();
  renderCards();
});

function cardMatchesFilters(card) {
  if (filterState.types.size > 0 && !filterState.types.has(card.type)) return false;
  if (filterState.colors.size > 0 && !filterState.colors.has(card.color)) return false;
  if (filterState.costMin > COST_RANGE_MIN || filterState.costMax < COST_RANGE_MAX) {
    if (card.cost === null || card.cost === undefined) return false;
    if (card.cost < filterState.costMin || card.cost > filterState.costMax) return false;
  }
  if (filterState.excludeParallel && card.parallel) return false;
  return true;
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
  const isThumbnail = currentPool && currentPool.thumbnailCardId === card.id;
  if (isThumbnail) row.classList.add("is-thumbnail");

  const thumb = document.createElement("div");
  thumb.className = "card-row-thumb";
  const img = document.createElement("img");
  img.src = Api.cardImageUrl(card);
  img.alt = displayName(card);
  img.draggable = false;
  thumb.appendChild(img);
  if (isThumbnail) {
    const badge = document.createElement("span");
    badge.className = "thumbnail-indicator";
    badge.title = "カードプールのサムネイル";
    badge.textContent = "★";
    thumb.appendChild(badge);
  }

  if (thumbnailMode) {
    row.classList.add("selectable-row");
    row.addEventListener("click", (e) => {
      if (e.target.closest(".drag-handle")) return;
      setThumbnail(card);
    });
  } else if (selectMode) {
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

  if (thumbnailMode) {
    frame.classList.add("selectable-frame");
    frame.addEventListener("click", () => setThumbnail(card));
  } else if (selectMode) {
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

  if (currentPool && currentPool.thumbnailCardId === card.id) {
    const badge = document.createElement("span");
    badge.className = "thumbnail-indicator";
    badge.title = "カードプールのサムネイル";
    badge.textContent = "★";
    frame.appendChild(badge);
  }

  if (!thumbnailMode && !selectMode) {
    const zoomBtn = document.createElement("button");
    zoomBtn.type = "button";
    zoomBtn.className = "grid-zoom-btn";
    zoomBtn.title = "拡大表示";
    zoomBtn.textContent = "⤢";
    zoomBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCardZoom(card);
    });
    frame.appendChild(zoomBtn);
  }

  item.appendChild(frame);

  const caption = document.createElement("div");
  caption.className = "card-caption";
  caption.textContent = displayName(card);
  item.appendChild(caption);

  return item;
}

// ---- Card zoom lightbox ----

const cardZoomOverlay = document.getElementById("card-zoom-overlay");
const cardZoomImg = document.getElementById("card-zoom-img");

function openCardZoom(card) {
  cardZoomImg.src = Api.cardImageUrl(card);
  cardZoomImg.alt = displayName(card);
  cardZoomOverlay.hidden = false;
}

function closeCardZoom() {
  cardZoomOverlay.hidden = true;
}

document.getElementById("card-zoom-close").addEventListener("click", closeCardZoom);
bindModalDismissal(cardZoomOverlay, { onCancel: closeCardZoom });

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

// ---- Auto-fill card info (type/color/cost) ----
//
// Runs as a background job on the server (see server.js /api/pools/:id/auto-fill-info);
// this modal only starts it and can be closed immediately after — completion is
// reported globally via card-info-jobs.js's toast, independent of whether this
// page is still open. The button itself shows a persistent completion mark
// (green + checkmark) until the modal is opened again, tracked per-pool in
// localStorage since the server only remembers the single latest job per pool.

const autoFillBtn = document.getElementById("auto-fill-info-btn");
const autoFillModal = document.getElementById("auto-fill-modal");
const autoFillOverwriteCheckbox = document.getElementById("auto-fill-overwrite-checkbox");
const autoFillRunBtn = document.getElementById("auto-fill-run-btn");
const autoFillStatus = document.getElementById("auto-fill-status");

const AUTO_FILL_SEEN_KEY_PREFIX = "deck-viewer-seen-card-info-job:";
let lastAutoFillJobId = null;
let lastAutoFillJobStatus = null;

function setAutoFillStatus(message, kind) {
  autoFillStatus.textContent = message;
  autoFillStatus.className = `status-message ${kind || ""}`;
}

function updateAutoFillButtonState() {
  if (!poolId) return;
  const job = getCardInfoJob(poolId);
  const seenJobId = localStorage.getItem(AUTO_FILL_SEEN_KEY_PREFIX + poolId);
  const isUnseenCompletion = Boolean(
    job && (job.status === "done" || job.status === "error") && job.id !== seenJobId
  );
  autoFillBtn.classList.toggle("auto-fill-done", isUnseenCompletion);
  autoFillBtn.textContent = isUnseenCompletion
    ? "カードの情報を自動取得する ✓"
    : "カードの情報を自動取得する";
}

function markAutoFillSeen() {
  if (!poolId) return;
  const job = getCardInfoJob(poolId);
  if (job) localStorage.setItem(AUTO_FILL_SEEN_KEY_PREFIX + poolId, job.id);
  updateAutoFillButtonState();
}

document.addEventListener("card-info-jobs-updated", () => {
  updateAutoFillButtonState();
  const job = getCardInfoJob(poolId);
  if (!job) return;
  if (job.id !== lastAutoFillJobId) {
    lastAutoFillJobId = job.id;
    lastAutoFillJobStatus = job.status;
  } else if (job.status !== lastAutoFillJobStatus) {
    lastAutoFillJobStatus = job.status;
    // Refresh so newly-detected type/color/cost show up without a manual reload.
    if (job.status === "done") renderCards();
  }
});

function openAutoFillModal() {
  markAutoFillSeen();
  autoFillOverwriteCheckbox.checked = false;
  setAutoFillStatus("", "");
  autoFillModal.hidden = false;
}

function closeAutoFillModal() {
  autoFillModal.hidden = true;
}

autoFillBtn.addEventListener("click", openAutoFillModal);
document.getElementById("auto-fill-close-btn").addEventListener("click", closeAutoFillModal);
bindModalDismissal(autoFillModal, { onCancel: closeAutoFillModal });

autoFillRunBtn.addEventListener("click", async () => {
  if (!poolId) return;
  autoFillRunBtn.disabled = true;
  setAutoFillStatus("開始しています...", "");
  try {
    await Api.startAutoFillInfo(poolId, autoFillOverwriteCheckbox.checked);
    setAutoFillStatus(
      "実行を開始しました。このポップアップを閉じたり他の画面に移動しても処理は続きます。完了すると通知が表示されます。",
      "success"
    );
  } catch (err) {
    setAutoFillStatus(err.message, "error");
  } finally {
    autoFillRunBtn.disabled = false;
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
