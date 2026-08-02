let allCards = [];
let allPools = [];
let deckId = null;
let deckThumbnailCardId = null;
const deckCounts = new Map(); // cardId -> count
const selectedPoolIds = new Set();

const poolCheckboxList = document.getElementById("pool-checkbox-list");
const deckGrid = document.getElementById("deck-grid");
const collectionGrid = document.getElementById("collection-grid");
const nameInput = document.getElementById("deck-name-input");
const saveStatus = document.getElementById("save-status");

function attachTap(el, action) {
  let downX = 0;
  let downY = 0;
  el.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });
  el.addEventListener("pointerup", (e) => {
    // Dragging the card out and releasing it back near its starting point
    // (e.g. a reorder that ends up where it began) has a small net
    // displacement too, so checking distance alone would misread it as a
    // tap. makeSortable() adds this class the moment a real drag begins
    // (independent of net displacement) and only removes it in its own
    // pointerup handler, which — thanks to normal event bubble order —
    // fires after this element-level listener, so the class is still
    // present here for the whole gesture if a drag happened.
    if (el.classList.contains("dragging")) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    // Only a real tap/click triggers add-remove — anything that moved more than
    // this is a scroll/swipe gesture and should just scroll normally.
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) action();
  });
}

// .builder-grid .card-item:active .card-frame shrinks to this scale while
// pressed (see style.css) — the exit ghost should be based on the card's
// normal size, not whatever momentarily-shrunk size is on screen right as
// the tap releases.
const PRESSED_SCALE = 0.94;

// Quick, non-blocking exit flourish: clones just the tapped card's thumbnail
// frame (not the whole tile — that includes the caption below it, which
// would stretch the image vertically to fill the extra height) into a ghost
// that slides sideways at the same y-position while fading out, then
// vanishes. position:fixed + appending to document.body (not the pane's own
// grid) is deliberate — .pane has overflow-y:auto, so a ghost positioned
// relative to the grid gets clipped the moment it crosses the pane's edge.
// A high z-index keeps it above the live (re-rendered) grid content, e.g.
// so it stays visible in the add case where the tapped card remains in
// place in the collection grid.
function prepareCardExit(sourceEl, direction) {
  const frame = sourceEl.querySelector(".card-frame");
  if (!frame) return null;
  let frameRect = frame.getBoundingClientRect();
  if (frame.matches(":active")) {
    const cx = frameRect.left + frameRect.width / 2;
    const cy = frameRect.top + frameRect.height / 2;
    const width = frameRect.width / PRESSED_SCALE;
    const height = frameRect.height / PRESSED_SCALE;
    frameRect = new DOMRect(cx - width / 2, cy - height / 2, width, height);
  }
  const ghost = frame.cloneNode(true);

  return () => {
    ghost.style.position = "fixed";
    ghost.style.left = `${frameRect.left}px`;
    ghost.style.top = `${frameRect.top}px`;
    ghost.style.width = `${frameRect.width}px`;
    ghost.style.height = `${frameRect.height}px`;
    ghost.style.margin = "0";
    ghost.style.zIndex = "999";
    ghost.style.pointerEvents = "none";
    ghost.style.transition = "transform 0.1s ease-in, opacity 0.1s ease-in";
    document.body.appendChild(ghost);

    const dx = direction === "left" ? -60 : 60;
    requestAnimationFrame(() => {
      ghost.style.transform = `translateX(${dx}px)`;
      ghost.style.opacity = "0";
    });
    setTimeout(() => ghost.remove(), 110);
  };
}

// ---- Undo/redo (deck composition: add/remove/reorder/sort/thumbnail) ----
// Deliberately scoped to the deck's card composition, not the deck name or
// which pools are referenced -- those are ordinary text/selection edits, not
// the kind of "oops" action this is meant to step back from.

const HISTORY_LIMIT = 30; // within the requested 20-50 range
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");
// Named deckHistory, not history -- that shadowed the global window.history
// object, which broke history.replaceState(...) (later in this file, after
// saving) with "history.replaceState is not a function".
let deckHistory = [];
let historyIndex = -1;
let restoringHistory = false;

function snapshotDeck() {
  return { counts: [...deckCounts.entries()], thumbnail: deckThumbnailCardId };
}

function pushHistory() {
  if (restoringHistory) return;
  deckHistory = deckHistory.slice(0, historyIndex + 1);
  deckHistory.push(snapshotDeck());
  if (deckHistory.length > HISTORY_LIMIT) deckHistory.shift();
  historyIndex = deckHistory.length - 1;
  updateUndoRedoButtons();
}

function restoreSnapshot(snapshot) {
  restoringHistory = true;
  deckCounts.clear();
  for (const [cardId, count] of snapshot.counts) deckCounts.set(cardId, count);
  deckThumbnailCardId = snapshot.thumbnail;
  renderPanes();
  restoringHistory = false;
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  restoreSnapshot(deckHistory[historyIndex]);
  updateUndoRedoButtons();
}

function redo() {
  if (historyIndex >= deckHistory.length - 1) return;
  historyIndex++;
  restoreSnapshot(deckHistory[historyIndex]);
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= deckHistory.length - 1;
}

undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (key === "y" || (key === "z" && e.shiftKey)) {
    e.preventDefault();
    redo();
  }
});

function addToDeck(cardId) {
  deckCounts.set(cardId, (deckCounts.get(cardId) || 0) + 1);
  renderPanes();
  pushHistory();
}

function removeFromDeck(cardId) {
  const current = deckCounts.get(cardId) || 0;
  if (current <= 1) {
    deckCounts.delete(cardId);
    if (deckThumbnailCardId === cardId) deckThumbnailCardId = null;
  } else {
    deckCounts.set(cardId, current - 1);
  }
  renderPanes();
  pushHistory();
}

// ---- Deck pane menu (サムネイルを設定 / 統計情報を表示) ----
// A small dropdown rather than two separate buttons in the title row.

const deckMenuBtn = document.getElementById("deck-menu-btn");
const deckMenuDropdown = document.getElementById("deck-menu-dropdown");

function closeDeckMenu() {
  deckMenuDropdown.hidden = true;
}

deckMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  deckMenuDropdown.hidden = !deckMenuDropdown.hidden;
});

document.addEventListener("click", (e) => {
  if (!deckMenuDropdown.hidden && !e.target.closest(".deck-menu-wrap")) closeDeckMenu();
});

// Blinking gradient-blue highlight on both the menu button (frame + the
// three lines) and the "サムネイルを設定" item inside it while the deck has
// no thumbnail set yet -- kept in sync by toggling both classes together
// here, in the same tick, using the same CSS animation.
function updateDeckMenuIndicator() {
  const needsThumbnail = !deckThumbnailCardId;
  deckMenuBtn.classList.toggle("needs-thumbnail", needsThumbnail);
  deckThumbnailModeBtn.classList.toggle("needs-thumbnail", needsThumbnail && !deckThumbnailMode);
}

// ---- Deck thumbnail selection mode ----

const deckThumbnailModeBtn = document.getElementById("deck-thumbnail-mode-btn");
const deckThumbnailModeLabel = deckThumbnailModeBtn.querySelector(".deck-menu-item-label");
let deckThumbnailMode = false;

function enterDeckThumbnailMode() {
  deckThumbnailMode = true;
  deckThumbnailModeLabel.textContent = "選択をキャンセル";
  deckThumbnailModeBtn.classList.add("active");
  deckGrid.classList.add("thumbnail-select-mode");
  closeDeckMenu();
  renderPanes();
}

function exitDeckThumbnailMode() {
  deckThumbnailMode = false;
  deckThumbnailModeLabel.textContent = "サムネイルを設定";
  deckThumbnailModeBtn.classList.remove("active");
  deckGrid.classList.remove("thumbnail-select-mode");
  renderPanes();
}

function setDeckThumbnail(cardId) {
  deckThumbnailCardId = cardId;
  exitDeckThumbnailMode();
  pushHistory();
}

deckThumbnailModeBtn.addEventListener("click", () => {
  if (deckThumbnailMode) exitDeckThumbnailMode();
  else enterDeckThumbnailMode();
});

// ---- Deck stats popup (必要エナジー分布 / トリガー内訳) ----

const TRIGGER_LABELS = {
  active: "アクティブ",
  drow: "ドロー",
  final: "ファイナル",
  get: "ゲット",
  raid: "レイド",
  special: "スペシャル",
  color: "カラー",
};

// Display order for the stats popup -- deliberately not the same order as
// TRIGGER_LABELS (which mirrors the type's internal/alphabetical grouping).
const TRIGGER_DISPLAY_ORDER = ["", "get", "drow", "active", "raid", "color", "special", "final"];

const deckStatsBtn = document.getElementById("deck-stats-btn");
const deckStatsModal = document.getElementById("deck-stats-modal");
const statsManaCurveEl = document.getElementById("stats-mana-curve");
const statsTriggerListEl = document.getElementById("stats-trigger-list");

// Bars start at 0 and grow to their real size on the next frame, so the
// width/height CSS transition (see .stats-mana-bar/.stats-trigger-bar,
// ease-out -- fast then decelerating) actually plays instead of snapping
// straight to the final size.
function animateGrow(el, prop, targetValue) {
  el.style[prop] = "0%";
  // A single rAF often isn't enough to guarantee the "0%" above was actually
  // painted before the target value is applied (both can land in the same
  // frame, which skips the transition entirely and just snaps to the final
  // size) -- a short timeout is a more reliable way to force that first
  // frame in before triggering the transition.
  setTimeout(() => {
    el.style[prop] = targetValue;
  }, 20);
}

function renderDeckStats() {
  const cardById = Object.fromEntries(allCards.map((c) => [c.id, c]));

  const buckets = new Array(9).fill(0); // costs 0..7, 8 = "8+"
  const triggerCounts = { "": 0, ...Object.fromEntries(Object.keys(TRIGGER_LABELS).map((k) => [k, 0])) };
  for (const [cardId, count] of deckCounts) {
    const card = cardById[cardId];
    if (!card) continue;
    if (card.cost !== null && card.cost !== undefined) {
      buckets[Math.min(card.cost, 8)] += count;
    }
    const trigger = card.trigger || "";
    triggerCounts[trigger] = (triggerCounts[trigger] || 0) + count;
  }

  const maxBucket = Math.max(1, ...buckets);
  statsManaCurveEl.innerHTML = "";

  const countsRow = document.createElement("div");
  countsRow.className = "stats-mana-row stats-mana-counts-row";
  const barsRow = document.createElement("div");
  barsRow.className = "stats-mana-row stats-mana-bars-row";
  const labelsRow = document.createElement("div");
  labelsRow.className = "stats-mana-row stats-mana-labels-row";

  const bars = [];
  buckets.forEach((count, cost) => {
    const countEl = document.createElement("div");
    countEl.className = "stats-mana-count";
    countEl.textContent = count > 0 ? String(count) : "";
    countsRow.appendChild(countEl);

    const barCol = document.createElement("div");
    barCol.className = "stats-mana-bar-col";
    const bar = document.createElement("div");
    bar.className = "stats-mana-bar";
    barCol.appendChild(bar);
    barsRow.appendChild(barCol);
    bars.push([bar, Math.max((count / maxBucket) * 100, count > 0 ? 3 : 0)]);

    const label = document.createElement("div");
    label.className = "stats-mana-label";
    label.textContent = cost === 8 ? "8+" : String(cost);
    labelsRow.appendChild(label);
  });

  statsManaCurveEl.appendChild(countsRow);
  statsManaCurveEl.appendChild(barsRow);
  statsManaCurveEl.appendChild(labelsRow);
  for (const [bar, pct] of bars) animateGrow(bar, "height", `${pct}%`);

  statsTriggerListEl.innerHTML = "";
  const maxTrigger = Math.max(1, ...Object.values(triggerCounts));
  const triggerBars = [];
  for (const key of TRIGGER_DISPLAY_ORDER) {
    const count = triggerCounts[key] || 0;
    const row = document.createElement("div");
    row.className = "stats-trigger-row";
    const nameEl = document.createElement("span");
    nameEl.className = "stats-trigger-name";
    nameEl.textContent = key === "" ? "トリガーなし" : TRIGGER_LABELS[key];
    const barWrap = document.createElement("div");
    barWrap.className = "stats-trigger-bar-wrap";
    const bar = document.createElement("div");
    bar.className = "stats-trigger-bar";
    const countEl = document.createElement("strong");
    countEl.className = "stats-trigger-count";
    countEl.textContent = `${count}枚`;
    barWrap.appendChild(bar);
    row.appendChild(nameEl);
    row.appendChild(barWrap);
    row.appendChild(countEl);
    statsTriggerListEl.appendChild(row);
    triggerBars.push([bar, (count / maxTrigger) * 100]);
  }
  for (const [bar, pct] of triggerBars) animateGrow(bar, "width", `${pct}%`);
}

function openDeckStats() {
  closeDeckMenu();
  renderDeckStats();
  deckStatsModal.hidden = false;
}

function closeDeckStats() {
  deckStatsModal.hidden = true;
}

deckStatsBtn.addEventListener("click", openDeckStats);
document.getElementById("deck-stats-close-btn").addEventListener("click", closeDeckStats);
bindModalDismissal(deckStatsModal, { onCancel: closeDeckStats });

// ---- Deck export/import as a .dvdeck zip file ----

const deckExportZipBtn = document.getElementById("deck-export-zip-btn");
const deckImportZipBtn = document.getElementById("deck-import-zip-btn");
const deckImportZipInput = document.getElementById("deck-import-zip-input");

deckExportZipBtn.addEventListener("click", () => {
  closeDeckMenu();
  if (!deckId) {
    saveStatus.textContent = "エクスポートする前に一度保存してください";
    saveStatus.className = "status-message error";
    return;
  }
  const a = document.createElement("a");
  a.href = Api.exportDeckZipUrl(deckId);
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
});

deckImportZipBtn.addEventListener("click", () => {
  closeDeckMenu();
  deckImportZipInput.click();
});

deckImportZipInput.addEventListener("change", async () => {
  const file = deckImportZipInput.files[0];
  deckImportZipInput.value = "";
  if (!file) return;
  const result = await showConfirm("現在の変更は破棄されますがよろしいですか？", { confirmText: "インポート" });
  if (!result.confirmed) return;
  try {
    const { deck } = await Api.importDeckZip(file);
    location.href = `builder.html?id=${encodeURIComponent(deck.id)}`;
  } catch (err) {
    saveStatus.textContent = err.message;
    saveStatus.className = "status-message error";
  }
});

document.getElementById("deck-sort-cost-btn").addEventListener("click", () => {
  const cardById = Object.fromEntries(allCards.map((c) => [c.id, c]));
  const entries = [...deckCounts.entries()].sort(([idA], [idB]) => {
    const costA = cardById[idA] ? cardById[idA].cost : null;
    const costB = cardById[idB] ? cardById[idB].cost : null;
    const hasA = costA !== null && costA !== undefined;
    const hasB = costB !== null && costB !== undefined;
    if (!hasA && !hasB) return 0;
    if (!hasA) return 1;
    if (!hasB) return -1;
    return costA - costB;
  });
  deckCounts.clear();
  for (const [cardId, count] of entries) deckCounts.set(cardId, count);
  renderPanes();
  pushHistory();
});

// ---- Filtering (collection pane only: type / color / cost range / parallel) ----

const CARD_TYPE_LABELS = { character: "キャラクター", event: "イベント", field: "フィールド" };

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
const BP_RANGE_MIN = 0;
const BP_RANGE_MAX = 6000;

const filterState = {
  types: new Set(),
  colors: new Set(),
  triggers: new Set(),
  rarities: new Set(),
  aps: new Set(),
  attributes: new Set(),
  generatedEnergies: new Set(),
  costMin: COST_RANGE_MIN,
  costMax: COST_RANGE_MAX,
  bpMin: BP_RANGE_MIN,
  bpMax: BP_RANGE_MAX,
  excludeParallel: false,
  excludeAllColor: true, // on by default, unlike the other filters -- see updateFilterUI()
  searchQuery: "", // matches against cardName / effect, see cardMatchesFilters
};

const filterTypeGroup = document.getElementById("filter-type-group");
const filterColorGroup = document.getElementById("filter-color-group");
const filterTriggerGroup = document.getElementById("filter-trigger-group");
const filterRarityGroup = document.getElementById("filter-rarity-group");
const filterApGroup = document.getElementById("filter-ap-group");
const filterAttributeGroup = document.getElementById("filter-attribute-group");
const filterGeneratedEnergyGroup = document.getElementById("filter-generated-energy-group");
const filterParallelCheckbox = document.getElementById("filter-parallel-checkbox");
const filterAllColorWrap = document.getElementById("filter-all-color-wrap");
const filterAllColorCheckbox = document.getElementById("filter-all-color-checkbox");
const filterClearBtn = document.getElementById("filter-clear-btn");
const filterSearchInput = document.getElementById("filter-search-input");
const filterCostMinInput = document.getElementById("filter-cost-min");
const filterCostMaxInput = document.getElementById("filter-cost-max");
const filterCostFill = document.getElementById("filter-cost-fill");
const filterCostMinLabel = document.getElementById("filter-cost-min-label");
const filterCostMaxLabel = document.getElementById("filter-cost-max-label");
const filterBpMinInput = document.getElementById("filter-bp-min");
const filterBpMaxInput = document.getElementById("filter-bp-max");
const filterBpFill = document.getElementById("filter-bp-fill");
const filterBpMinLabel = document.getElementById("filter-bp-min-label");
const filterBpMaxLabel = document.getElementById("filter-bp-max-label");

// BPは"2000"のような普通の数値のほか"4000+"/"4000-"(接尾辞)、値自体が無い"-"も
// 入りうる自由入力の文字列。絞り込みのスライダーは先頭の数値部分だけを見る。
function parseBpValue(bp) {
  if (!bp) return null;
  const m = /^(\d+)/.exec(String(bp).trim());
  return m ? parseInt(m[1], 10) : null;
}

// プール個別ページ(pool-detail.js)のdistinctValuesと同じ: rarity/ap/attribute/
// generatedEnergyは固定の選択肢ではなく実データから動的に集める。ここでは
// 「現在選択中のカードプール」に属するカードだけを対象にする(色の絞り込みの
// 「全て」除外チェックボックスの表示判定と同じ範囲)。
function distinctValues(cards, field, { isArray = false } = {}) {
  const values = new Set();
  for (const card of cards) {
    if (isArray) {
      for (const v of card[field] || []) values.add(v);
    } else if (card[field] !== null && card[field] !== undefined && card[field] !== "") {
      values.add(card[field]);
    }
  }
  return [...values].sort((a, b) => String(a).localeCompare(String(b), "ja"));
}

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

// See the identical block in pool-detail.js for why: two overlapping native
// range inputs can only ever hand a click/drag to whichever paint order
// currently favors, which without this permanently strands the other thumb
// once both land on the same value, no matter which side of it you grab.
// The wrapper drives the whole interaction itself instead. When the thumbs
// aren't tied, pointerdown commits to the closer one immediately; when they
// ARE tied, committing immediately backfires (grabbing exactly on the tied
// pixel always resolves to the same thumb regardless of which way you then
// drag, since no movement has happened yet to reveal intent), so it stays
// undecided until the first move that actually goes to a different value,
// and that direction picks the thumb.
//
// Shared between the 必要エナジー (cost) and BP sliders (see pool-detail.js's
// identical helper).
function setupRangeSlider({ minInput, maxInput, fillEl, minLabel, maxLabel, rangeMin, rangeMax, getMin, setMin, getMax, setMax, onChange }) {
  const wrap = minInput.closest(".range-slider-wrap");
  let draggingThumb = null; // "min" | "max" | null
  let dragTiedValue = null; // set while a down-on-tied-thumbs drag hasn't picked a direction yet

  function valueFromClientX(clientX) {
    const rect = wrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(rangeMin + pct * (rangeMax - rangeMin));
  }

  function pickThumb(clientX) {
    const pointerValue = valueFromClientX(clientX);
    const minVal = getMin();
    const maxVal = getMax();
    if (minVal === maxVal) return pointerValue <= minVal ? "min" : "max";
    return Math.abs(pointerValue - minVal) < Math.abs(pointerValue - maxVal) ? "min" : "max";
  }

  function updateUI() {
    const range = rangeMax - rangeMin;
    const minVal = getMin();
    const maxVal = getMax();
    const leftPct = ((minVal - rangeMin) / range) * 100;
    const rightPct = ((maxVal - rangeMin) / range) * 100;
    fillEl.style.left = `${leftPct}%`;
    fillEl.style.width = `${rightPct - leftPct}%`;
    minLabel.textContent = minVal;
    maxLabel.textContent = maxVal;
    minInput.value = minVal;
    maxInput.value = maxVal;
  }

  function moveThumb(clientX) {
    const value = valueFromClientX(clientX);
    if (draggingThumb === "min") setMin(Math.min(value, getMax()));
    else setMax(Math.max(value, getMin()));
    updateUI();
    onChange();
  }

  wrap.addEventListener("pointerdown", (e) => {
    const minVal = getMin();
    const maxVal = getMax();
    if (minVal === maxVal) {
      draggingThumb = null;
      dragTiedValue = minVal;
    } else {
      draggingThumb = pickThumb(e.clientX);
      dragTiedValue = null;
      moveThumb(e.clientX);
    }
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener("pointermove", (e) => {
    if (draggingThumb) {
      moveThumb(e.clientX);
    } else if (dragTiedValue !== null) {
      const value = valueFromClientX(e.clientX);
      if (value < dragTiedValue) draggingThumb = "min";
      else if (value > dragTiedValue) draggingThumb = "max";
      if (draggingThumb) moveThumb(e.clientX);
    }
  });
  wrap.addEventListener("pointerup", (e) => {
    if (!draggingThumb && dragTiedValue !== null) {
      draggingThumb = pickThumb(e.clientX);
      moveThumb(e.clientX);
    }
    draggingThumb = null;
    dragTiedValue = null;
  });
  wrap.addEventListener("pointercancel", () => {
    draggingThumb = null;
    dragTiedValue = null;
  });

  minInput.addEventListener("input", () => {
    let value = Number(minInput.value);
    if (value > getMax()) value = getMax();
    setMin(value);
    updateUI();
    onChange();
  });
  maxInput.addEventListener("input", () => {
    let value = Number(maxInput.value);
    if (value < getMin()) value = getMin();
    setMax(value);
    updateUI();
    onChange();
  });

  return { updateUI };
}

const costSlider = setupRangeSlider({
  minInput: filterCostMinInput,
  maxInput: filterCostMaxInput,
  fillEl: filterCostFill,
  minLabel: filterCostMinLabel,
  maxLabel: filterCostMaxLabel,
  rangeMin: COST_RANGE_MIN,
  rangeMax: COST_RANGE_MAX,
  getMin: () => filterState.costMin,
  setMin: (v) => (filterState.costMin = v),
  getMax: () => filterState.costMax,
  setMax: (v) => (filterState.costMax = v),
  onChange: renderPanes,
});

const bpSlider = setupRangeSlider({
  minInput: filterBpMinInput,
  maxInput: filterBpMaxInput,
  fillEl: filterBpFill,
  minLabel: filterBpMinLabel,
  maxLabel: filterBpMaxLabel,
  rangeMin: BP_RANGE_MIN,
  rangeMax: BP_RANGE_MAX,
  getMin: () => filterState.bpMin,
  setMin: (v) => (filterState.bpMin = v),
  getMax: () => filterState.bpMax,
  setMax: (v) => (filterState.bpMax = v),
  onChange: renderPanes,
});

function updateFilterUI() {
  filterTypeGroup.innerHTML = "";
  for (const [value, label] of Object.entries(CARD_TYPE_LABELS)) {
    filterTypeGroup.appendChild(
      createFilterCheckbox(label, filterState.types.has(value), () => {
        toggleInSet(filterState.types, value);
        renderPanes();
      })
    );
  }

  filterColorGroup.innerHTML = "";
  for (const color of CARD_COLORS) {
    const active = filterState.colors.has(color);
    const pill = createFilterPill(color, active, () => {
      toggleInSet(filterState.colors, color);
      renderPanes();
    });
    applyColorSwatch(pill, color, active);
    filterColorGroup.appendChild(pill);
  }

  filterTriggerGroup.innerHTML = "";
  for (const [value, label] of Object.entries({ "": "トリガーなし", ...TRIGGER_LABELS })) {
    filterTriggerGroup.appendChild(
      createFilterCheckbox(label, filterState.triggers.has(value), () => {
        toggleInSet(filterState.triggers, value);
        renderPanes();
      })
    );
  }

  // rarity/ap/attribute/generatedEnergyの選択肢も、色の「全て」除外チェックボックス
  // と同じく現在選択中のカードプールのカードだけを対象に動的生成する。
  const poolCardsForFilter = allCards.filter((c) => selectedPoolIds.has(c.poolId));

  filterRarityGroup.innerHTML = "";
  for (const rarity of distinctValues(poolCardsForFilter, "rarity")) {
    filterRarityGroup.appendChild(
      createFilterPill(rarity, filterState.rarities.has(rarity), () => {
        toggleInSet(filterState.rarities, rarity);
        renderPanes();
      })
    );
  }

  filterApGroup.innerHTML = "";
  for (const ap of distinctValues(poolCardsForFilter, "ap")) {
    filterApGroup.appendChild(
      createFilterPill(String(ap), filterState.aps.has(ap), () => {
        toggleInSet(filterState.aps, ap);
        renderPanes();
      })
    );
  }

  filterAttributeGroup.innerHTML = "";
  for (const attribute of distinctValues(poolCardsForFilter, "attribute", { isArray: true })) {
    filterAttributeGroup.appendChild(
      createFilterPill(attribute, filterState.attributes.has(attribute), () => {
        toggleInSet(filterState.attributes, attribute);
        renderPanes();
      })
    );
  }

  filterGeneratedEnergyGroup.innerHTML = "";
  for (const ge of distinctValues(poolCardsForFilter, "generatedEnergy")) {
    filterGeneratedEnergyGroup.appendChild(
      createFilterPill(ge, filterState.generatedEnergies.has(ge), () => {
        toggleInSet(filterState.generatedEnergies, ge);
        renderPanes();
      })
    );
  }

  costSlider.updateUI();
  bpSlider.updateUI();
  filterParallelCheckbox.checked = filterState.excludeParallel;
  // Only shown once there's actually something for it to filter out, same as
  // pool-detail.js -- scoped to the currently-selected pools' cards, not
  // every card in the collection.
  filterAllColorWrap.hidden = !poolCardsForFilter.some((c) => c.color === "全て");
  filterAllColorCheckbox.checked = filterState.excludeAllColor;
}

filterSearchInput.addEventListener("input", () => {
  filterState.searchQuery = filterSearchInput.value.trim();
  renderPanes();
});

filterParallelCheckbox.addEventListener("change", () => {
  filterState.excludeParallel = filterParallelCheckbox.checked;
  renderPanes();
});

filterAllColorCheckbox.addEventListener("change", () => {
  filterState.excludeAllColor = filterAllColorCheckbox.checked;
  renderPanes();
});

filterClearBtn.addEventListener("click", () => {
  filterState.types.clear();
  filterState.colors.clear();
  filterState.triggers.clear();
  filterState.rarities.clear();
  filterState.aps.clear();
  filterState.attributes.clear();
  filterState.generatedEnergies.clear();
  filterState.costMin = COST_RANGE_MIN;
  filterState.costMax = COST_RANGE_MAX;
  filterState.bpMin = BP_RANGE_MIN;
  filterState.bpMax = BP_RANGE_MAX;
  filterState.excludeParallel = false;
  filterState.excludeAllColor = false;
  filterState.searchQuery = "";
  filterSearchInput.value = "";
  updateFilterUI();
  renderPanes();
});

function cardMatchesFilters(card) {
  if (filterState.types.size > 0 && !filterState.types.has(card.type)) return false;
  // "全て"(ALL/colorless) cards match every color filter, not just an "全て" pill.
  if (filterState.colors.size > 0 && card.color !== "全て" && !filterState.colors.has(card.color)) return false;
  if (filterState.excludeAllColor && card.color === "全て") return false;
  // card.trigger is undefined on cards saved before this field existed --
  // treat that the same as "" (no trigger) rather than as a non-match.
  if (filterState.triggers.size > 0 && !filterState.triggers.has(card.trigger || "")) return false;
  if (filterState.rarities.size > 0 && !filterState.rarities.has(card.rarity || "")) return false;
  if (filterState.aps.size > 0 && !filterState.aps.has(card.ap ?? null)) return false;
  if (filterState.generatedEnergies.size > 0 && !filterState.generatedEnergies.has(card.generatedEnergy || "")) {
    return false;
  }
  if (filterState.attributes.size > 0) {
    const cardAttributes = card.attribute || [];
    if (![...filterState.attributes].some((a) => cardAttributes.includes(a))) return false;
  }
  if (filterState.costMin > COST_RANGE_MIN || filterState.costMax < COST_RANGE_MAX) {
    if (card.cost === null || card.cost === undefined) return false;
    if (card.cost < filterState.costMin || card.cost > filterState.costMax) return false;
  }
  if (filterState.bpMin > BP_RANGE_MIN || filterState.bpMax < BP_RANGE_MAX) {
    const bpValue = parseBpValue(card.bp);
    if (bpValue === null) return false;
    if (bpValue < filterState.bpMin || bpValue > filterState.bpMax) return false;
  }
  if (filterState.excludeParallel && card.parallel) return false;
  if (filterState.searchQuery) {
    const query = filterState.searchQuery.toLowerCase();
    const haystack = `${card.cardName || ""} ${card.effect || ""}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

const POOL_PICKER_FAVORITES_ONLY_KEY = "deck-viewer-pool-picker-favorites-only";
let poolPickerFavoritesOnly = localStorage.getItem(POOL_PICKER_FAVORITES_ONLY_KEY) === "true";
const poolPickerFavoritesOnlyBtn = document.getElementById("pool-picker-favorites-only-btn");

function updatePoolPickerFavoritesOnlyUI() {
  poolPickerFavoritesOnlyBtn.classList.toggle("active", poolPickerFavoritesOnly);
  poolPickerFavoritesOnlyBtn.setAttribute("aria-pressed", String(poolPickerFavoritesOnly));
}

poolPickerFavoritesOnlyBtn.addEventListener("click", () => {
  poolPickerFavoritesOnly = !poolPickerFavoritesOnly;
  localStorage.setItem(POOL_PICKER_FAVORITES_ONLY_KEY, String(poolPickerFavoritesOnly));
  updatePoolPickerFavoritesOnlyUI();
  renderPoolPicker();
});

function renderPoolPicker() {
  updatePoolPickerFavoritesOnlyUI();
  poolCheckboxList.innerHTML = "";
  if (allPools.length === 0) {
    poolCheckboxList.innerHTML = '<div class="empty-state">カードプールがありません。「カードプール管理」から作成してください。</div>';
    return;
  }
  // 絞り込みは選択肢の表示/非表示だけに影響する(既に選択中のプールがお気に入りで
  // なくなっても選択状態自体は保持される、他の絞り込み機能と同じ挙動)。
  const visiblePools = poolPickerFavoritesOnly ? allPools.filter((p) => p.favorite) : allPools;
  if (visiblePools.length === 0) {
    poolCheckboxList.innerHTML = '<div class="empty-state">お気に入りのカードプールがありません。</div>';
    return;
  }
  for (const pool of visiblePools) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pool-toggle";
    const isSelected = selectedPoolIds.has(pool.id);
    toggle.setAttribute("aria-pressed", String(isSelected));
    toggle.textContent = `${pool.name} (${pool.cardCount}枚)`;
    toggle.addEventListener("click", () => {
      if (selectedPoolIds.has(pool.id)) selectedPoolIds.delete(pool.id);
      else selectedPoolIds.add(pool.id);
      toggle.setAttribute("aria-pressed", String(selectedPoolIds.has(pool.id)));
      renderPanes();
    });
    poolCheckboxList.appendChild(toggle);
  }
}

function renderPanes() {
  const cardById = Object.fromEntries(allCards.map((c) => [c.id, c]));

  const totalCount = [...deckCounts.values()].reduce((sum, count) => sum + count, 0);
  document.getElementById("deck-total-count").textContent = `${totalCount}枚`;
  updateDeckMenuIndicator();

  deckGrid.innerHTML = "";
  for (const [cardId, count] of deckCounts) {
    const el = createCardElement(cardById[cardId] || null, cardId, count, {
      isThumbnail: deckThumbnailCardId === cardId,
    });
    if (deckThumbnailMode) {
      el.addEventListener("click", () => setDeckThumbnail(cardId));
    } else {
      attachTap(el, () => {
        const spawnGhost = prepareCardExit(el, "right");
        removeFromDeck(cardId);
        if (spawnGhost) spawnGhost();
      });
    }
    deckGrid.appendChild(el);
  }

  // Type/color filters are a fixed, known set of options, so they're always
  // populated regardless of whether a pool is selected yet.
  updateFilterUI();

  collectionGrid.innerHTML = "";
  if (selectedPoolIds.size === 0) {
    collectionGrid.innerHTML = '<div class="empty-state">上で参照するカードプールを選択してください</div>';
    return;
  }
  const poolCards = allCards.filter((c) => selectedPoolIds.has(c.poolId));
  const visibleCards = poolCards.filter(cardMatchesFilters);
  if (poolCards.length === 0) {
    collectionGrid.innerHTML = '<div class="empty-state">選択したカードプールにカードがありません。「カードを追加」から登録してください。</div>';
  } else if (visibleCards.length === 0) {
    collectionGrid.innerHTML = '<div class="empty-state">絞り込み条件に一致するカードがありません。</div>';
  } else {
    for (const card of visibleCards) {
      const count = deckCounts.get(card.id) || null;
      const el = createCardElement(card, card.id, count);
      attachTap(el, () => {
        const spawnGhost = prepareCardExit(el, "left");
        addToDeck(card.id);
        if (spawnGhost) spawnGhost();
      });
      collectionGrid.appendChild(el);
    }
  }
}

makeSortable(deckGrid, {
  itemSelector: ".card-item",
  handleSelector: ".card-frame",
  axis: "grid",
  onReorder: (order) => {
    const reordered = new Map();
    for (const cardId of order) {
      reordered.set(cardId, deckCounts.get(cardId));
    }
    deckCounts.clear();
    for (const [cardId, count] of reordered) deckCounts.set(cardId, count);
    renderPanes();
    pushHistory();
  },
});

async function init() {
  const params = new URLSearchParams(location.search);
  deckId = params.get("id");

  [allCards, allPools] = await Promise.all([Api.getCards(), Api.getPools()]);

  if (deckId) {
    const deck = await Api.getDeck(deckId);
    if (deck) {
      nameInput.value = deck.name;
      for (const entry of deck.cards) {
        deckCounts.set(entry.cardId, entry.count);
      }
      for (const poolId of deck.poolIds || []) {
        selectedPoolIds.add(poolId);
      }
      deckThumbnailCardId = deck.thumbnailCardId || null;
    }
  }

  renderPoolPicker();
  renderPanes();

  // Baseline snapshot -- undoing all the way back lands on the deck as it
  // was when the page loaded, not an empty deck.
  deckHistory = [snapshotDeck()];
  historyIndex = 0;
  updateUndoRedoButtons();
}

async function saveDeck() {
  const name = nameInput.value.trim();
  if (!name) {
    saveStatus.textContent = "デッキ名を入力してください";
    saveStatus.className = "status-message error";
    return false;
  }
  const cards = [...deckCounts].map(([cardId, count]) => ({ cardId, count }));
  const poolIds = [...selectedPoolIds];
  try {
    const deck = await Api.saveDeck({ id: deckId, name, cards, poolIds, thumbnailCardId: deckThumbnailCardId });
    deckId = deck.id;
    history.replaceState(null, "", `builder.html?id=${encodeURIComponent(deckId)}`);
    saveStatus.textContent = "保存しました";
    saveStatus.className = "status-message success";
    return true;
  } catch (err) {
    saveStatus.textContent = err.message;
    saveStatus.className = "status-message error";
    return false;
  }
}

const SKIP_DISCARD_WARNING_KEY = "deck-viewer-skip-discard-warning";

document.getElementById("save-back-btn").addEventListener("click", async () => {
  if (await saveDeck()) location.href = "index.html";
});

document.getElementById("discard-back-btn").addEventListener("click", async () => {
  if (localStorage.getItem(SKIP_DISCARD_WARNING_KEY) === "true") {
    location.href = "index.html";
    return;
  }
  const result = await showConfirm("作業内容が失われますが大丈夫ですか?", {
    confirmText: "戻る",
    checkboxLabel: "次回以降表示しない",
  });
  if (!result.confirmed) return;
  if (result.checked) localStorage.setItem(SKIP_DISCARD_WARNING_KEY, "true");
  location.href = "index.html";
});

document.getElementById("export-image-btn").addEventListener("click", () => {
  if (!deckId) return;
  // Export should reflect what's currently on screen, not the last-saved
  // version — stash the in-memory state for deck-view.js to pick up instead
  // of fetching the (possibly stale) saved deck.
  const draft = {
    name: nameInput.value.trim() || "無題のデッキ",
    cards: [...deckCounts].map(([cardId, count]) => ({ cardId, count })),
    poolIds: [...selectedPoolIds],
    thumbnailCardId: deckThumbnailCardId,
  };
  sessionStorage.setItem(`deck-export-draft:${deckId}`, JSON.stringify(draft));
  location.href = `deck-view.html?id=${encodeURIComponent(deckId)}`;
});

init();
