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

// BPは"2000"のような普通の数値のほか"4000+"/"4000-"(以上/以下を表す接尾辞)、
// カードによっては値自体が無い"-"も入りうる自由入力の文字列。絞り込みのスライダーは
// 先頭の数値部分だけを見る(接尾辞は表示上そのまま残し、比較には使わない)。
function parseBpValue(bp) {
  if (!bp) return null;
  const m = /^(\d+)/.exec(String(bp).trim());
  return m ? parseInt(m[1], 10) : null;
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

const uncertainReviewBtn = document.getElementById("uncertain-review-btn");
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
  uncertainReviewBtn.hidden = !latestCards.some((c) => c.infoUncertain);
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
const BP_RANGE_MIN = 0;
// 必要エナジー/BPの上限は固定値ではなく、プールの実データにある最大値まで
// (BPは500刻み、必要エナジーは1刻み)。filterState.costRangeMax/bpRangeMaxに
// 都度計算して入れる -- 詳細はrefreshRangeBounds()参照。
const BP_STEP = 500;

// 消費APは1/2/3で固定。発生エナジーは1/1+/2/2+/3で固定。プールに存在しない値は
// ピルをdisabledにする(選べないことが見た目でも分かるように)。
const AP_VALUES = [1, 2, 3];
const GENERATED_ENERGY_VALUES = ["1", "1+", "2", "2+", "3"];

// レアリティは★の有無を統合して扱う(例: "R"と"R★"は同じ"R"として絞り込む)。
// 選択肢自体はプールの実データに関わらずこの固定順で常に表示する。
const RARITY_ORDER = ["SR", "R", "U", "C", "PcSR", "PcR", "PcC", "UR", "SP", "PR"];
function baseRarity(rarity) {
  return (rarity || "").replace(/★+$/, "");
}

const filterState = {
  types: new Set(),
  colors: new Set(),
  triggers: new Set(),
  rarities: new Set(),
  aps: new Set(),
  attributes: new Set(),
  generatedEnergies: new Set(),
  costMin: COST_RANGE_MIN,
  costMax: COST_RANGE_MIN,
  costRangeMax: COST_RANGE_MIN,
  bpMin: BP_RANGE_MIN,
  bpMax: BP_RANGE_MIN,
  bpRangeMax: BP_RANGE_MIN,
  excludeParallel: false,
  excludeAllColor: true, // on by default, unlike the other filters -- see updateFilterUI()
  searchQuery: "", // matches against cardName / effect, see cardMatchesFilters
};

// 必要エナジー/BPの上限をプールの実データの最大値に追従させる。以前の上限
// ちょうどに絞り込みのmaxが合わせてあった場合(=「上限なし」の意味で使われていた
// 場合)は新しい上限に追従させ、ユーザーが意図的にそれより低い値へ絞っていた
// 場合はそのまま維持する(ただし新しい上限を超えていたらクランプする)。
function refreshRangeBounds(cards, getValue, step, state, minKey, maxKey, rangeMaxKey) {
  let max = 0;
  for (const card of cards) {
    const v = getValue(card);
    if (v !== null && v !== undefined) max = Math.max(max, v);
  }
  const newRangeMax = Math.max(step, Math.ceil(max / step) * step);
  const wasUnrestricted = state[maxKey] >= state[rangeMaxKey];
  state[rangeMaxKey] = newRangeMax;
  if (wasUnrestricted || state[maxKey] > newRangeMax) state[maxKey] = newRangeMax;
  if (state[minKey] > newRangeMax) state[minKey] = newRangeMax;
}

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
//
// Shared between the 必要エナジー (cost) and BP sliders, which are otherwise
// identical in every way except their range and where they read/write in
// filterState -- pulled out into one generic controller once a second range
// slider needed the exact same delicate drag logic as the first.
function setupRangeSlider({ minInput, maxInput, fillEl, minLabel, maxLabel, getRangeMin, getRangeMax, getMin, setMin, getMax, setMax, onChange }) {
  const wrap = minInput.closest(".range-slider-wrap");
  let draggingThumb = null; // "min" | "max" | null
  let dragTiedValue = null; // set while a down-on-tied-thumbs drag hasn't picked a direction yet

  function valueFromClientX(clientX) {
    const rangeMin = getRangeMin();
    const rangeMax = getRangeMax();
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
    const rangeMin = getRangeMin();
    const rangeMax = getRangeMax();
    minInput.min = rangeMin;
    minInput.max = rangeMax;
    maxInput.min = rangeMin;
    maxInput.max = rangeMax;
    const range = rangeMax - rangeMin || 1;
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
    // A plain click (no drag) on a tied pair never resolved a direction above
    // -- fall back to the down-position tie-break so a simple click-to-jump
    // still does something.
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
  getRangeMin: () => COST_RANGE_MIN,
  getRangeMax: () => filterState.costRangeMax,
  getMin: () => filterState.costMin,
  setMin: (v) => (filterState.costMin = v),
  getMax: () => filterState.costMax,
  setMax: (v) => (filterState.costMax = v),
  onChange: renderCards,
});

const bpSlider = setupRangeSlider({
  minInput: filterBpMinInput,
  maxInput: filterBpMaxInput,
  fillEl: filterBpFill,
  minLabel: filterBpMinLabel,
  maxLabel: filterBpMaxLabel,
  getRangeMin: () => BP_RANGE_MIN,
  getRangeMax: () => filterState.bpRangeMax,
  getMin: () => filterState.bpMin,
  setMin: (v) => (filterState.bpMin = v),
  getMax: () => filterState.bpMax,
  setMax: (v) => (filterState.bpMax = v),
  onChange: renderCards,
});

// Gathers the distinct non-empty values actually present across `cards` for
// `field` (or, for an array field like attribute, every distinct element),
// sorted for stable pill ordering -- used for rarity/ap/attribute/
// generatedEnergy, whose possible values aren't a small fixed set the way
// type/color/trigger are, so the filter pills are built from whatever's
// actually in this pool rather than a hardcoded list.
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

  filterTriggerGroup.innerHTML = "";
  for (const [value, label] of Object.entries({ "": "トリガーなし", ...TRIGGER_LABELS })) {
    filterTriggerGroup.appendChild(
      createFilterCheckbox(label, filterState.triggers.has(value), () => {
        toggleInSet(filterState.triggers, value);
        renderCards();
      })
    );
  }

  // レアリティは★の有無を問わず固定順で常に全部表示する(distinctValuesの動的収集
  // 対象外 -- baseRarity()で統合するため候補自体が実データに依存しない)。
  filterRarityGroup.innerHTML = "";
  for (const rarity of RARITY_ORDER) {
    filterRarityGroup.appendChild(
      createFilterPill(rarity, filterState.rarities.has(rarity), () => {
        toggleInSet(filterState.rarities, rarity);
        renderCards();
      })
    );
  }
  shrinkPillTextToFit(filterRarityGroup);

  // 消費APは1/2/3固定、プールに存在しない値はボタンをdisabledにする。
  const presentAps = new Set(latestCards.map((c) => c.ap).filter((v) => v !== null && v !== undefined));
  filterApGroup.innerHTML = "";
  for (const ap of AP_VALUES) {
    const pill = createFilterPill(String(ap), filterState.aps.has(ap), () => {
      toggleInSet(filterState.aps, ap);
      renderCards();
    });
    if (!presentAps.has(ap)) pill.disabled = true;
    filterApGroup.appendChild(pill);
  }

  filterAttributeGroup.innerHTML = "";
  for (const attribute of distinctValues(latestCards, "attribute", { isArray: true })) {
    filterAttributeGroup.appendChild(
      createFilterPill(attribute, filterState.attributes.has(attribute), () => {
        toggleInSet(filterState.attributes, attribute);
        renderCards();
      })
    );
  }
  shrinkPillTextToFit(filterAttributeGroup);

  // 発生エナジーは1/1+/2/2+/3固定、プールに存在しない値はボタンをdisabledにする。
  const presentGeneratedEnergies = new Set(latestCards.map((c) => c.generatedEnergy).filter(Boolean));
  filterGeneratedEnergyGroup.innerHTML = "";
  for (const ge of GENERATED_ENERGY_VALUES) {
    const pill = createFilterPill(ge, filterState.generatedEnergies.has(ge), () => {
      toggleInSet(filterState.generatedEnergies, ge);
      renderCards();
    });
    if (!presentGeneratedEnergies.has(ge)) pill.disabled = true;
    filterGeneratedEnergyGroup.appendChild(pill);
  }

  refreshRangeBounds(latestCards, (c) => c.cost, 1, filterState, "costMin", "costMax", "costRangeMax");
  refreshRangeBounds(latestCards, (c) => parseBpValue(c.bp), BP_STEP, filterState, "bpMin", "bpMax", "bpRangeMax");
  costSlider.updateUI();
  bpSlider.updateUI();
  filterParallelCheckbox.checked = filterState.excludeParallel;
  // Only shown once there's actually something for it to filter out.
  filterAllColorWrap.hidden = !latestCards.some((c) => c.color === "全て");
  filterAllColorCheckbox.checked = filterState.excludeAllColor;
}

filterSearchInput.addEventListener("input", () => {
  filterState.searchQuery = filterSearchInput.value.trim();
  renderCards();
});

filterParallelCheckbox.addEventListener("change", () => {
  filterState.excludeParallel = filterParallelCheckbox.checked;
  renderCards();
});

filterAllColorCheckbox.addEventListener("change", () => {
  filterState.excludeAllColor = filterAllColorCheckbox.checked;
  renderCards();
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
  filterState.costMax = filterState.costRangeMax;
  filterState.bpMin = BP_RANGE_MIN;
  filterState.bpMax = filterState.bpRangeMax;
  filterState.excludeParallel = false;
  filterState.excludeAllColor = false;
  filterState.searchQuery = "";
  filterSearchInput.value = "";
  updateFilterUI();
  renderCards();
});

function cardMatchesFilters(card) {
  if (filterState.types.size > 0 && !filterState.types.has(card.type)) return false;
  // "全て"(ALL/colorless) cards match every color filter, not just an "全て" pill.
  if (filterState.colors.size > 0 && card.color !== "全て" && !filterState.colors.has(card.color)) return false;
  if (filterState.excludeAllColor && card.color === "全て") return false;
  if (filterState.costMin > COST_RANGE_MIN || filterState.costMax < filterState.costRangeMax) {
    if (card.cost === null || card.cost === undefined) return false;
    if (card.cost < filterState.costMin || card.cost > filterState.costMax) return false;
  }
  if (filterState.bpMin > BP_RANGE_MIN || filterState.bpMax < filterState.bpRangeMax) {
    const bpValue = parseBpValue(card.bp);
    if (bpValue === null) return false;
    if (bpValue < filterState.bpMin || bpValue > filterState.bpMax) return false;
  }
  if (filterState.excludeParallel && card.parallel) return false;
  // card.trigger is undefined on cards saved before this field existed --
  // treat that the same as "" (no trigger) rather than as a non-match.
  if (filterState.triggers.size > 0 && !filterState.triggers.has(card.trigger || "")) return false;
  if (filterState.rarities.size > 0 && !filterState.rarities.has(baseRarity(card.rarity))) return false;
  if (filterState.aps.size > 0 && !filterState.aps.has(card.ap ?? null)) return false;
  if (filterState.generatedEnergies.size > 0 && !filterState.generatedEnergies.has(card.generatedEnergy || "")) {
    return false;
  }
  if (filterState.attributes.size > 0) {
    const cardAttributes = card.attribute || [];
    if (![...filterState.attributes].some((a) => cardAttributes.includes(a))) return false;
  }
  if (filterState.searchQuery) {
    const query = filterState.searchQuery.toLowerCase();
    const haystack = `${card.cardName || ""} ${card.effect || ""}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

// レアリティ/特徴のボタンは横幅いっぱいで縦に並ぶため、長い文字列(特に特徴)が
// 入りきらないことがある。折りたたみが開いた瞬間(閉じている間は幅の計測ができない
// ため)にだけ計測し、はみ出していれば収まるまでフォントサイズを下げる。
function shrinkPillTextToFit(container) {
  for (const pill of container.querySelectorAll(".filter-pill")) {
    pill.style.fontSize = "";
    let fontSize = parseFloat(getComputedStyle(pill).fontSize);
    const minPx = 10;
    while (pill.scrollWidth > pill.clientWidth && fontSize > minPx) {
      fontSize -= 1;
      pill.style.fontSize = `${fontSize}px`;
    }
  }
}

const filterRarityAccordion = document.getElementById("filter-rarity-accordion");
const filterAttributeAccordion = document.getElementById("filter-attribute-accordion");
filterRarityAccordion.addEventListener("toggle", () => {
  if (filterRarityAccordion.open) shrinkPillTextToFit(filterRarityGroup);
});
filterAttributeAccordion.addEventListener("toggle", () => {
  if (filterAttributeAccordion.open) shrinkPillTextToFit(filterAttributeGroup);
});

// 折りたたみ一覧を「全部閉じた状態でちょうど収まる高さ」に固定し、それ以上は
// スクロールで見せる(スクロールバー自体はCSSで非表示)。閉じている<details>の
// 中身はレイアウトに寄与しないため、この高さは実際にどんな絞り込み候補が
// 入っているかに関係なく一定 -- ページ読み込み時に一度だけ測って固定すればよい。
function lockFilterAccordionHeight() {
  const el = document.getElementById("filter-accordion-scroll");
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
lockFilterAccordionHeight();

// ---- List view ----

const CARD_TYPE_LABELS = { character: "キャラクター", event: "イベント", field: "フィールド" };
const TRIGGER_LABELS = {
  active: "アクティブ",
  drow: "ドロー",
  final: "ファイナル",
  get: "ゲット",
  raid: "レイド",
  special: "スペシャル",
  color: "カラー",
};

function cardCaption(card) {
  const parts = [];
  if (card.type && CARD_TYPE_LABELS[card.type]) parts.push(CARD_TYPE_LABELS[card.type]);
  if (card.rarity) parts.push(card.rarity);
  if (card.cost !== null && card.cost !== undefined) parts.push(`必要エナジー ${card.cost}`);
  if (card.ap !== null && card.ap !== undefined) parts.push(`AP ${card.ap}`);
  if (card.bp) parts.push(`BP ${card.bp}`);
  if (card.color) parts.push(card.color);
  if (card.generatedEnergy) parts.push(`発生エナジー ${card.generatedEnergy}`);
  if (card.attribute && card.attribute.length > 0) parts.push(card.attribute.join("/"));
  if (card.trigger && TRIGGER_LABELS[card.trigger]) parts.push(`トリガー: ${TRIGGER_LABELS[card.trigger]}`);
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

  const thumb = document.createElement("div");
  thumb.className = "card-row-thumb";
  if (isThumbnail) {
    thumb.classList.add("is-thumbnail");
    thumb.title = "カードプールのサムネイル";
  }
  const img = document.createElement("img");
  img.src = Api.cardImageUrl(card);
  img.alt = displayName(card);
  img.draggable = false;
  thumb.appendChild(img);
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
    // The flush border lives on the frame (tight fit around the card
    // image); the small protruding banner lives on the item instead, since
    // the frame clips to its own rounded corners for the card image, which
    // would also clip the banner where it's meant to peek out above the
    // card's own top edge.
    frame.classList.add("is-thumbnail");
    item.classList.add("is-thumbnail");
    item.title = "カードプールのサムネイル";
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

function openImageZoom(src, alt) {
  cardZoomImg.src = src;
  cardZoomImg.alt = alt || "";
  cardZoomOverlay.hidden = false;
}

function openCardZoom(card) {
  openImageZoom(Api.cardImageUrl(card), displayName(card));
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
const modalCardNameInput = document.getElementById("modal-card-cardname");
const modalTypeInput = document.getElementById("modal-card-type");
const modalCostInput = document.getElementById("modal-card-cost");
const modalColorInput = document.getElementById("modal-card-color");
const modalTriggerInput = document.getElementById("modal-card-trigger");
const modalParallelInput = document.getElementById("modal-card-parallel");
const modalRarityInput = document.getElementById("modal-card-rarity");
const modalApInput = document.getElementById("modal-card-ap");
const modalBpInput = document.getElementById("modal-card-bp");
const modalAttributeInput = document.getElementById("modal-card-attribute");
const modalGeneratedEnergyInput = document.getElementById("modal-card-generated-energy");
const modalEffectInput = document.getElementById("modal-card-effect");

// 特徴(attribute)はカンマ区切りのテキスト欄で入力する(タグピッカー等は今回作らず、
// マニュアル入力時は簡易さを優先)。
function parseAttributeInput(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
const modalSaveBtn = document.getElementById("modal-save-btn");
const modalStatus = document.getElementById("modal-status");
const modalActionsNormal = document.getElementById("modal-actions-normal");
const modalActionsReview = document.getElementById("modal-actions-review");
const modalApplyParallelWrap = document.getElementById("modal-apply-parallel-wrap");
const modalApplyParallelCheckbox = document.getElementById("modal-apply-parallel-checkbox");
const modalReviewBackBtn = document.getElementById("modal-review-back-btn");
const modalReviewNextBtn = document.getElementById("modal-review-next-btn");

const cropPopup = document.getElementById("crop-popup");
const cropPopupStage = document.getElementById("crop-popup-stage");

let cropTool = null;
let croppedBlob = null;
let editingCard = null; // null = adding a new card, otherwise the card being edited

// ---- Uncertain-card review (opened via the ⚠ button) ----
// Steps the "カードを編集" modal through every card flagged infoUncertain,
// one at a time, instead of the usual single-card save-and-close.
//
// A base card whose parallel(s) are ALSO in the queue gets a "変更をパラレル
// にも適用する" checkbox, on by default. Saving with it checked applies this
// card's type/color/cost to those parallels too (server-side, via
// applyToParallels) AND removes them from the remaining queue -- there's
// nothing left for the user to review on them. Unchecking it leaves them in
// the queue as their own separate step. This is why the queue can't just be
// a fixed array walked by index: which cards still need visiting depends on
// choices made while stepping through it, so `reviewSkip` tracks cards
// that have been resolved this way and every navigation step skips past them.
let reviewQueue = null; // null when not reviewing, otherwise the fixed ordered list of cards to consider
let reviewSkip = null; // Set of card ids resolved via a parallel-apply, no longer needing their own step
let reviewIndex = 0;

// Local mirror of server.js's parseCardNameParts -- see there for the full
// naming-convention rationale. Needed client-side too so the review flow can
// tell which queued cards are parallels of which without a round-trip.
function parseCardNameParts(name) {
  const m = /^([^_]+)_(.+)$/.exec(name || "");
  if (!m) return null;
  const [, set, rest] = m;
  const suffixMatch = /^(.*)_p\d+$/.exec(rest);
  const code = suffixMatch ? suffixMatch[1] : rest;
  const isParallel = set === "UAPR" || Boolean(suffixMatch);
  return { code, isParallel };
}

// Other not-yet-skipped queue members that are parallels of `card` -- only
// meaningful (non-empty) when `card` is itself a non-parallel base, since
// that's the only case "apply to parallels" makes sense for.
function queueParallelMates(card) {
  const parts = parseCardNameParts(card.name);
  if (!parts || parts.isParallel) return [];
  return reviewQueue.filter((c) => {
    if (c.id === card.id || reviewSkip.has(c.id)) return false;
    const p = parseCardNameParts(c.name);
    return p && p.isParallel && p.code === parts.code;
  });
}

function startUncertainReview() {
  const uncertain = latestCards.filter((c) => c.infoUncertain);
  if (uncertain.length === 0) return;
  // Bases before parallels, so a base is always reached (and its
  // apply-to-parallels choice made) before any of its own parallels would
  // otherwise come up for their own individual step.
  const bases = uncertain.filter((c) => {
    const p = parseCardNameParts(c.name);
    return !p || !p.isParallel;
  });
  const parallels = uncertain.filter((c) => !bases.includes(c));
  reviewQueue = [...bases, ...parallels];
  reviewSkip = new Set();
  reviewIndex = 0;
  openEditCardModal(reviewQueue[0], { review: true });
}

uncertainReviewBtn.addEventListener("click", startUncertainReview);

// Whether there's a not-yet-skipped queue entry after/before reviewIndex,
// given a hypothetical extra set of ids about to be skipped (the current
// card's queue-mate parallels, if the checkbox is checked) -- used to decide
// the nav buttons' state before the user has actually saved anything yet.
function hasQueueEntry(direction, extraSkip) {
  const step = direction === "next" ? 1 : -1;
  for (let i = reviewIndex + step; i >= 0 && i < reviewQueue.length; i += step) {
    const id = reviewQueue[i].id;
    if (!reviewSkip.has(id) && !extraSkip.has(id)) return true;
  }
  return false;
}

// "Which step am I on, out of how many total" -- both counts only ever
// consider entries NOT in reviewSkip (already resolved via an earlier
// parallel-apply) and, hypothetically, not in extraSkip (this card's own
// mates, if the checkbox is currently checked) -- so checking the box
// immediately shrinks the total, e.g. a 2-card base+parallel queue reads
// "1/2" unchecked and "1/1" checked.
function reviewProgress(extraSkip) {
  let position = 0;
  let total = 0;
  for (let i = 0; i < reviewQueue.length; i++) {
    const id = reviewQueue[i].id;
    if (reviewSkip.has(id) || extraSkip.has(id)) continue;
    total++;
    if (i <= reviewIndex) position++;
  }
  return { position, total };
}

function updateReviewNavUI() {
  const mates = queueParallelMates(editingCard);
  modalApplyParallelWrap.hidden = mates.length === 0;
  const extraSkip = new Set(
    mates.length > 0 && modalApplyParallelCheckbox.checked ? mates.map((c) => c.id) : []
  );
  modalReviewBackBtn.disabled = !hasQueueEntry("back", extraSkip);
  modalReviewNextBtn.textContent = hasQueueEntry("next", extraSkip) ? "保存して次へ" : "保存して完了する";
  const { position, total } = reviewProgress(extraSkip);
  modalTitle.textContent = `カードを編集 (${position}/${total})`;
}

modalApplyParallelCheckbox.addEventListener("change", updateReviewNavUI);

function setModalReviewMode(active) {
  modalActionsNormal.hidden = active;
  modalActionsReview.hidden = !active;
  if (active) {
    modalApplyParallelCheckbox.checked = true; // default on, per card
    updateReviewNavUI();
  }
}

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

  const zoomBtn = document.createElement("button");
  zoomBtn.type = "button";
  zoomBtn.className = "grid-zoom-btn";
  zoomBtn.title = "拡大表示";
  zoomBtn.textContent = "⤢";
  zoomBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openImageZoom(src, modalNameInput.value || "");
  });
  preview.appendChild(zoomBtn);

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
  reviewQueue = null; // an entirely separate flow from card-info review
  reviewSkip = null;
  editingCard = null;
  croppedBlob = null;
  cropTool = null;
  modalNameInput.value = "";
  modalNameInput.placeholder = formatCardName(computeNextCardNumber(latestCards));
  modalCardNameInput.value = "";
  modalTypeInput.value = "";
  modalCostInput.value = "";
  modalColorInput.value = "";
  modalTriggerInput.value = "";
  modalParallelInput.checked = false;
  modalRarityInput.value = "";
  modalApInput.value = "";
  modalBpInput.value = "";
  modalAttributeInput.value = "";
  modalGeneratedEnergyInput.value = "";
  modalEffectInput.value = "";
  setModalStatus("", "");
  modalTitle.textContent = "カードを追加";
  setModalReviewMode(false);
  showImagePlaceholder();
  modal.hidden = false;
}

function openEditCardModal(card, options) {
  const review = Boolean(options && options.review);
  if (!review) {
    // Opening a card the normal way always exits any review flow.
    reviewQueue = null;
    reviewSkip = null;
  }
  editingCard = card;
  croppedBlob = null;
  cropTool = null;
  modalNameInput.value = card.name || "";
  modalNameInput.placeholder = formatCardName(computeNextCardNumber(latestCards));
  modalCardNameInput.value = card.cardName || "";
  modalTypeInput.value = card.type || "";
  modalCostInput.value = card.cost !== null && card.cost !== undefined ? card.cost : "";
  modalColorInput.value = card.color || "";
  modalTriggerInput.value = card.trigger || "";
  modalParallelInput.checked = Boolean(card.parallel);
  modalRarityInput.value = card.rarity || "";
  modalApInput.value = card.ap !== null && card.ap !== undefined ? card.ap : "";
  modalBpInput.value = card.bp || "";
  modalAttributeInput.value = (card.attribute || []).join(", ");
  modalGeneratedEnergyInput.value = card.generatedEnergy || "";
  modalEffectInput.value = card.effect || "";
  setModalStatus("", "");
  modalTitle.textContent = "カードを編集";
  setModalReviewMode(review);
  showImagePreview(Api.cardImageUrl(card));
  modal.hidden = false;
}

function closeAddCardModal() {
  modal.hidden = true;
  modalFileInput.value = "";
  reviewQueue = null;
  reviewSkip = null;
}

document.getElementById("open-add-card-btn").addEventListener("click", openAddCardModal);
document.getElementById("close-modal-btn").addEventListener("click", closeAddCardModal);

// Bind add-card-modal before crop-popup so crop-popup (opened on top of it) is
// treated as the topmost modal — Enter/Escape act on whichever is actually on top.
bindModalDismissal(modal, {
  onCancel: closeAddCardModal,
  onConfirm: () => (reviewQueue ? modalReviewNextBtn.click() : modalSaveBtn.click()),
});
bindModalDismissal(cropPopup, {
  onCancel: closeCropPopup,
  onConfirm: () => document.getElementById("crop-popup-ok").click(),
});

// Shared by the normal save button and both review-mode nav buttons: PATCHes
// the currently-editing card (plus an image replace, if one was cropped).
// Returns whether it succeeded, leaving the modal open with an error message
// on failure either way.
async function saveEditingCard(applyToParallels) {
  const name = modalNameInput.value.trim() || modalNameInput.placeholder;
  const cardName = modalCardNameInput.value.trim();
  const type = modalTypeInput.value;
  const cost = modalCostInput.value;
  const color = modalColorInput.value.trim();
  const trigger = modalTriggerInput.value;
  const parallel = modalParallelInput.checked;
  const rarity = modalRarityInput.value.trim();
  const ap = modalApInput.value;
  const bp = modalBpInput.value.trim();
  const attribute = parseAttributeInput(modalAttributeInput.value);
  const generatedEnergy = modalGeneratedEnergyInput.value.trim();
  const effect = modalEffectInput.value.trim();

  setModalStatus("保存中...", "");
  try {
    if (croppedBlob) {
      await Api.replaceCardImage(editingCard.id, croppedBlob);
    }
    await Api.updateCard(editingCard.id, {
      name,
      cardName,
      type,
      cost,
      color,
      trigger,
      parallel,
      rarity,
      ap,
      bp,
      attribute,
      generatedEnergy,
      effect,
      applyToParallels: Boolean(applyToParallels),
    });
    return true;
  } catch (err) {
    setModalStatus(err.message, "error");
    return false;
  }
}

// Saves the current review step, applying to queue-mate parallels (and
// skipping them from here on) if the checkbox was checked, then moves the
// modal to the next/previous not-yet-skipped queue entry -- or, moving
// forward off the end of the queue, finishes the review entirely.
async function commitReviewStep(direction) {
  const mates = queueParallelMates(editingCard);
  const applyToParallels = mates.length > 0 && modalApplyParallelCheckbox.checked;
  if (!(await saveEditingCard(applyToParallels))) return;
  if (applyToParallels) {
    for (const mate of mates) reviewSkip.add(mate.id);
  }

  const step = direction === "next" ? 1 : -1;
  let i = reviewIndex + step;
  while (i >= 0 && i < reviewQueue.length && reviewSkip.has(reviewQueue[i].id)) i += step;

  if (i >= 0 && i < reviewQueue.length) {
    reviewIndex = i;
    openEditCardModal(reviewQueue[reviewIndex], { review: true });
  } else if (direction === "next") {
    const finishedPoolId = poolId;
    reviewQueue = null;
    reviewSkip = null;
    closeAddCardModal();
    await renderCards();
    // Reviewing every uncertain card counts as having confirmed the
    // auto-fill result too -- dismisses the bottom-right notice (if it's
    // still up) and turns the trigger button off its green "unseen" state.
    confirmAutoFillJob(finishedPoolId);
  }
  // direction === "back" with nothing before it: modalReviewBackBtn is
  // disabled in that state, so this shouldn't be reachable -- no-op either way.
}

modalReviewNextBtn.addEventListener("click", () => commitReviewStep("next"));
modalReviewBackBtn.addEventListener("click", () => commitReviewStep("back"));

modalSaveBtn.addEventListener("click", async () => {
  const name = modalNameInput.value.trim() || modalNameInput.placeholder;
  const cardName = modalCardNameInput.value.trim();
  const type = modalTypeInput.value;
  const cost = modalCostInput.value;
  const color = modalColorInput.value.trim();
  const trigger = modalTriggerInput.value;
  const parallel = modalParallelInput.checked;
  const rarity = modalRarityInput.value.trim();
  const ap = modalApInput.value;
  const bp = modalBpInput.value.trim();
  const attribute = parseAttributeInput(modalAttributeInput.value);
  const generatedEnergy = modalGeneratedEnergyInput.value.trim();
  const effect = modalEffectInput.value.trim();

  if (editingCard) {
    if (await saveEditingCard()) {
      closeAddCardModal();
      await renderCards();
    }
    return;
  }

  if (!croppedBlob) {
    setModalStatus("画像を選択してください", "error");
    return;
  }

  setModalStatus("保存中...", "");
  try {
    const card = await Api.addCard({
      name,
      cardName,
      cost,
      color,
      trigger,
      parallel,
      type,
      rarity,
      ap,
      bp,
      attribute,
      generatedEnergy,
      effect,
      poolId,
      imageBlob: croppedBlob,
    });
    setModalStatus(`「${displayName(card)}」を登録しました。続けて追加できます。`, "success");
    croppedBlob = null;
    cropTool = null;
    modalNameInput.value = "";
    modalCardNameInput.value = "";
    modalTypeInput.value = "";
    modalCostInput.value = "";
    modalColorInput.value = "";
    modalTriggerInput.value = "";
    modalParallelInput.checked = false;
    modalRarityInput.value = "";
    modalApInput.value = "";
    modalBpInput.value = "";
    modalAttributeInput.value = "";
    modalGeneratedEnergyInput.value = "";
    modalEffectInput.value = "";
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

  // Landed here via the auto-fill completion notice's 修正する button --
  // same entry point as clicking the ⚠ button directly.
  if (params.get("review") === "1") {
    startUncertainReview();
  }
}

init();
