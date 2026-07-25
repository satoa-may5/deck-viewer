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

// Two overlapping native <input type="range"> elements can only ever hand a
// click/drag to whichever one paint order currently favors -- when both
// thumbs land on the same value, that's a single fixed choice, so the other
// thumb becomes ungrabbable at that position no matter which side of it you
// grab. Rather than fight the browser's own thumb-drag hit-testing (which
// resolves at the moment of the native pointerdown, too early to react to),
// the wrapper drives the whole interaction itself. When the thumbs aren't
// tied, pointerdown can commit to the closer one immediately. When they ARE
// tied, though, committing immediately backfires: picking by which side of
// the tied value the down-point falls on means grabbing *exactly on* the
// tied pixel always resolves to the same thumb regardless of which way you
// then drag, since no movement has happened yet to reveal intent -- so
// dragging right from dead center could still only ever pull min (which
// immediately re-clamps to max and looks like nothing moved). Instead, a
// down on a tied pair stays undecided until the first move that actually
// goes to a different value, and *that* direction picks the thumb -- so
// grabbing the exact overlap point and dragging either way works.
const filterCostSliderWrap = filterCostMinInput.closest(".range-slider-wrap");
let draggingCostThumb = null; // "min" | "max" | null
let costDragTiedValue = null; // set while a down-on-tied-thumbs drag hasn't picked a direction yet

function costValueFromClientX(clientX) {
  const rect = filterCostSliderWrap.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(COST_RANGE_MIN + pct * (COST_RANGE_MAX - COST_RANGE_MIN));
}

function pickCostThumb(clientX) {
  const pointerValue = costValueFromClientX(clientX);
  const minVal = Number(filterCostMinInput.value);
  const maxVal = Number(filterCostMaxInput.value);
  if (minVal === maxVal) return pointerValue <= minVal ? "min" : "max";
  return Math.abs(pointerValue - minVal) < Math.abs(pointerValue - maxVal) ? "min" : "max";
}

function moveCostThumb(clientX) {
  const input = draggingCostThumb === "min" ? filterCostMinInput : filterCostMaxInput;
  input.value = costValueFromClientX(clientX);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

filterCostSliderWrap.addEventListener("pointerdown", (e) => {
  const minVal = Number(filterCostMinInput.value);
  const maxVal = Number(filterCostMaxInput.value);
  if (minVal === maxVal) {
    draggingCostThumb = null;
    costDragTiedValue = minVal;
  } else {
    draggingCostThumb = pickCostThumb(e.clientX);
    costDragTiedValue = null;
    moveCostThumb(e.clientX);
  }
  filterCostSliderWrap.setPointerCapture(e.pointerId);
});
filterCostSliderWrap.addEventListener("pointermove", (e) => {
  if (draggingCostThumb) {
    moveCostThumb(e.clientX);
  } else if (costDragTiedValue !== null) {
    const value = costValueFromClientX(e.clientX);
    if (value < costDragTiedValue) draggingCostThumb = "min";
    else if (value > costDragTiedValue) draggingCostThumb = "max";
    if (draggingCostThumb) moveCostThumb(e.clientX);
  }
});
filterCostSliderWrap.addEventListener("pointerup", (e) => {
  // A plain click (no drag) on a tied pair never resolved a direction above
  // -- fall back to the down-position tie-break so a simple click-to-jump
  // still does something.
  if (!draggingCostThumb && costDragTiedValue !== null) {
    draggingCostThumb = pickCostThumb(e.clientX);
    moveCostThumb(e.clientX);
  }
  draggingCostThumb = null;
  costDragTiedValue = null;
});
filterCostSliderWrap.addEventListener("pointercancel", () => {
  draggingCostThumb = null;
  costDragTiedValue = null;
});

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
  // "全て"(ALL/colorless) cards match every color filter, not just an "全て" pill.
  if (filterState.colors.size > 0 && card.color !== "全て" && !filterState.colors.has(card.color)) return false;
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
  if (card.infoUncertain) {
    const warning = document.createElement("span");
    warning.className = "uncertain-badge";
    warning.title = "自動取得に問題がある可能性があります";
    warning.textContent = "⚠";
    thumb.appendChild(warning);
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
  if (card.infoUncertain) {
    const warning = document.createElement("span");
    warning.className = "uncertain-badge";
    warning.title = "自動取得に問題がある可能性があります";
    warning.textContent = "⚠";
    frame.appendChild(warning);
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
// The actual panel (form/running/complete views) is a single shared,
// site-wide component owned by card-info-jobs.js — it has to be, since a
// running or unconfirmed job needs to stay visible in the corner across page
// navigations, not just while this specific page is open. This page only
// owns the trigger button (its green-checkmark "unseen completion" state,
// specifically for THIS pool) and refreshing the card list once THIS pool's
// job finishes, since only pool-detail.js has renderCards()/latestCards.

const autoFillBtn = document.getElementById("auto-fill-info-btn");
let lastAutoFillJobId = null;
let lastAutoFillJobStatus = null;

function updateAutoFillButtonState() {
  if (!poolId) return;
  const job = getCardInfoJob(poolId);
  const isUnseenCompletion = Boolean(
    job && (job.status === "done" || job.status === "error") && !isJobConfirmed(job)
  );
  autoFillBtn.classList.toggle("auto-fill-done", isUnseenCompletion);
  autoFillBtn.textContent = isUnseenCompletion
    ? "カードの情報を自動取得する ✓"
    : "カードの情報を自動取得する";
}

document.addEventListener("card-info-jobs-updated", () => {
  updateAutoFillButtonState();
  const job = getCardInfoJob(poolId);
  if (!job) return;

  // A job for a small pool can finish before the very first poll after it
  // was started, in which case it's never observed mid-"running" -- so
  // "the job id is new to us" has to trigger the same done/error handling
  // as "the status changed", not just a silent baseline update.
  const isNewJob = job.id !== lastAutoFillJobId;
  const statusChanged = isNewJob || job.status !== lastAutoFillJobStatus;
  lastAutoFillJobId = job.id;
  lastAutoFillJobStatus = job.status;

  if (statusChanged && (job.status === "done" || job.status === "error")) {
    renderCards(); // pick up newly-detected type/color/cost without a manual reload
  }
});

autoFillBtn.addEventListener("click", () => {
  if (!poolId || !currentPool) return;
  requestAutoFillPanel(poolId, currentPool.name);
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
