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
const RARITY_ORDER = ["SR", "R", "U", "C", "PcSR", "PcR", "PcC", "UR", "SP", "PR"];
function baseRarity(rarity) {
  return (rarity || "").replace(/★+$/, "");
}

// 選択肢はプールに実際に存在するレアリティだけ(統合済み)。既知の並び順
// (RARITY_ORDER)にあるものはその順で、それ以外(未知のレアリティ)は末尾に
// 五十音順で足す。
function presentRarities(cards) {
  const present = new Set();
  for (const card of cards) {
    const base = baseRarity(card.rarity);
    if (base) present.add(base);
  }
  const known = RARITY_ORDER.filter((r) => present.has(r));
  const unknown = [...present].filter((r) => !RARITY_ORDER.includes(r)).sort((a, b) => a.localeCompare(b, "ja"));
  return [...known, ...unknown];
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
function setupRangeSlider({ minInput, maxInput, fillEl, minLabel, maxLabel, getRangeMin, getRangeMax, getMin, setMin, getMax, setMax, onChange, step = 1 }) {
  const wrap = minInput.closest(".range-slider-wrap");
  let draggingThumb = null; // "min" | "max" | null
  let dragTiedValue = null; // set while a down-on-tied-thumbs drag hasn't picked a direction yet

  function valueFromClientX(clientX) {
    const rangeMin = getRangeMin();
    const rangeMax = getRangeMax();
    const rect = wrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = rangeMin + pct * (rangeMax - rangeMin);
    // BPは500刻みなど、ドラッグで動く値自体をstep単位に丸める(表示ラベルの
    // 数字とスライダーの見た目のステップ幅を一致させるため)。
    return Math.round((raw - rangeMin) / step) * step + rangeMin;
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
  step: BP_STEP,
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

  // レアリティはプールに実在するものだけ(★の有無は統合済み)を表示する。
  filterRarityGroup.innerHTML = "";
  for (const rarity of presentRarities(latestCards)) {
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

  // 高さの固定は、filterAllColorWrapの表示/非表示が確定した後(=このupdateFilterUI
  // が一度実行された後)でないと正しく測れない(先に測ると、後から表示される分の
  // 高さが計算に含まれず「検索条件をリセット」が枠からはみ出てしまう)。
  if (!filterHeightLocked) {
    filterHeightLocked = true;
    lockFilterAccordionHeight();
  }
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
  // 「プロモファイナルを除外」だけは初期値がON(他の絞り込みと違う)。リセットは
  // 「ページを開いた直後の状態に戻す」という意味なので、ここもfalseではなく
  // 初期値のtrueに戻す(falseにすると、リセットしたのに初期状態より表示が
  // 増えるという直感に反する挙動になる)。
  filterState.excludeAllColor = true;
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
// 入っているかに関係なく一定 -- ただし、プロモファイナル除外チェックボックスの
// 表示/非表示のようにupdateFilterUI()が確定させる要素もあるため、初回の
// updateFilterUI()実行後に一度だけ測って固定する(呼び出し箇所はupdateFilterUI内)。
let filterHeightLocked = false;
function lockFilterAccordionHeight() {
  const el = document.getElementById("filter-accordion-scroll");
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

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

// 一覧表示・グリッド表示の両方で共有する、カード右上のステータスバッジ。
// 「複数枚追加」で登録されたまま一度も編集されていないカードに出す。
function appendCardStatusBadge(container, card) {
  if (!card.unedited) return;
  const badge = document.createElement("span");
  badge.className = "unedited-badge";
  badge.title = "画像だけ登録されていて、まだ情報が入力されていません";
  badge.textContent = "未編集";
  container.appendChild(badge);
}

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
  appendCardStatusBadge(thumb, card);

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
  appendCardStatusBadge(frame, card);

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
const modalDeleteBtn = document.getElementById("modal-delete-btn");
const modalStatus = document.getElementById("modal-status");
const modalActionsNormal = document.getElementById("modal-actions-normal");

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

// crop-popupは「1枚追加/編集」フローと「複数枚追加」フローの両方で共有する
// (トリミングのUI自体は同じものを再利用し、OKを押した時にどちらの結果として
// 扱うかをcropContextで振り分ける)。cropContext===null なら従来通りcroppedBlob
// (1枚追加/編集モーダルのプレビュー用)、{type:"bulk", index} ならbulkAddItems
// の該当インデックスのblobを差し替える。
let cropContext = null;

function openCropPopup(file, context) {
  cropContext = context || null;
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
  const blob = await cropTool.toBlob(OUTPUT_W, OUTPUT_H);
  if (cropContext && cropContext.type === "bulk") {
    const item = bulkAddItems[cropContext.index];
    if (item) {
      item.blob = blob;
      item.cropped = true;
    }
    cropContext = null;
    closeCropPopup();
    renderBulkAddGrid();
  } else {
    croppedBlob = blob;
    cropContext = null;
    closeCropPopup();
    refreshImageArea();
  }
});

document.getElementById("crop-popup-cancel").addEventListener("click", () => {
  cropContext = null;
  closeCropPopup();
});
document.getElementById("crop-popup-close").addEventListener("click", () => {
  cropContext = null;
  closeCropPopup();
});

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
  modalDeleteBtn.hidden = true;
  showImagePlaceholder();
  modal.hidden = false;
}

function openEditCardModal(card) {
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
  modalDeleteBtn.hidden = false;
  showImagePreview(Api.cardImageUrl(card));
  modal.hidden = false;
}

modalDeleteBtn.addEventListener("click", async () => {
  if (!editingCard) return;
  if (!(await showConfirm(`「${displayName(editingCard)}」を削除します。よろしいですか?`))) return;
  await Api.deleteCard(editingCard.id);
  closeAddCardModal();
  await renderCards();
});

function closeAddCardModal() {
  modal.hidden = true;
  modalFileInput.value = "";
}

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

// ---- Add-card entry point: choice between 1枚 / 複数枚 ----

const addChoiceModal = document.getElementById("add-choice-modal");

function openAddChoiceModal() {
  addChoiceModal.hidden = false;
}

function closeAddChoiceModal() {
  addChoiceModal.hidden = true;
}

document.getElementById("open-add-card-btn").addEventListener("click", openAddChoiceModal);
document.getElementById("close-add-choice-modal-btn").addEventListener("click", closeAddChoiceModal);
bindModalDismissal(addChoiceModal, { onCancel: closeAddChoiceModal });

document.getElementById("add-choice-single-btn").addEventListener("click", () => {
  closeAddChoiceModal();
  openAddCardModal();
});
document.getElementById("add-choice-bulk-btn").addEventListener("click", () => {
  closeAddChoiceModal();
  openBulkAddModal();
});
document.getElementById("add-choice-oricard-btn").addEventListener("click", () => {
  closeAddChoiceModal();
  openOricardModal();
});

// ---- オリカを追加(UA-makerを別ファイルのiframeとして埋め込む) ----
//
// public/oricard/(index.html + materials.js)はgit管理対象で、配布用exeにも
// 同梱される(pkg.assetsの"public/**/*"配下)。ただし念のため、ファイルが
// 存在しない環境でも壊れないよう、開く前にHEADで存在確認し、無ければ
// 「利用不可」のメッセージだけ出して静かに機能を諦める。

const oricardModal = document.getElementById("oricard-modal");
const oricardFrame = document.getElementById("oricard-frame");
const oricardUnavailable = document.getElementById("oricard-unavailable");
const oricardStatus = document.getElementById("oricard-status");
const oricardAddBtn = document.getElementById("oricard-add-btn");
const oricardPngBtn = document.getElementById("oricard-png-btn");
const oricardJsonSaveBtn = document.getElementById("oricard-json-save-btn");
const oricardJsonLoadBtn = document.getElementById("oricard-json-load-btn");
const oricardJsonFile = document.getElementById("oricard-json-file");
let oricardOpenToken = 0;

async function openOricardModal() {
  oricardStatus.textContent = "";
  oricardStatus.className = "status-message";
  oricardUnavailable.hidden = true;
  oricardFrame.hidden = false;
  oricardAddBtn.disabled = false;
  let available = true;
  try {
    const res = await fetch("oricard/index.html", { method: "HEAD" });
    available = res.ok;
  } catch (err) {
    available = false;
  }
  if (available) {
    // 前回開いた時の入力を残さない、毎回まっさらな状態で開く。
    // closeOricardModal()のsrc="about:blank"でもonloadは発火するので、この回の
    // オープンを表すトークンを持たせ、閉じた後のポーリングが走り続けないようにする。
    const openToken = ++oricardOpenToken;
    oricardFrame.onload = () => {
      const win = oricardFrame.contentWindow;
      if (!win || openToken !== oricardOpenToken) return;
      // oricard/index.html側は素材(200枚超)を非同期で読み込んでおり、iframeの
      // load イベント自体はその完了を待たない。読み込み完了前にスタイルを
      // 適用すると、後から終わる非同期処理(initForm→render)に上書きされて
      // 何も反映されないことがあったため、window.oricardReady が立つまで待つ。
      const applyWhenReady = () => {
        if (openToken !== oricardOpenToken) return; // 閉じられた/開き直された
        if (!win.oricardReady) {
          setTimeout(applyWhenReady, 50);
          return;
        }
        // 同じカードプール内の既存カードの「特徴」を、オリカメーカー側の
        // 特徴欄の入力候補として渡す(setTraitSuggestionsはoricard/index.html側で
        // 公開しているフック)。
        if (typeof win.setTraitSuggestions === "function") {
          const traits = new Set();
          for (const card of latestCards) {
            for (const a of card.attribute || []) traits.add(a);
          }
          win.setTraitSuggestions([...traits].sort());
        }
        // このカードプールに保存済みの「スタイル」(カード名イラスト・枠の色/明度・
        // 背景イラスト・テキストエリアイラスト)があれば自動的に適用する。
        if (
          currentPool &&
          currentPool.oricardStyle &&
          currentPool.oricardStyle.enabled !== false &&
          typeof win.applyOricardStyle === "function"
        ) {
          win.applyOricardStyle(currentPool.oricardStyle);
        }
        // 「カードプールにこのスタイルを保存」ボタン(oricard側のUI)からの
        // 呼び出しを受け取るフック。実際の保存処理はpoolIdを知っているこちら側で行う。
        win.onSaveStyleClick = saveOricardStyleToPool;
        // ここまでの内容(スタイル自動適用込み)を「まだ何も編集していない」基準点として
        // 記録する。X閉じるときの確認要否はここからの差分だけで判定する。
        if (typeof win.exportOricard === "function") {
          oricardBaselineSnapshot = snapshotOricardState(win.exportOricard().state);
        }
      };
      applyWhenReady();
    };
    oricardFrame.src = `oricard/index.html?_=${Date.now()}`;
  } else {
    oricardFrame.hidden = true;
    oricardUnavailable.hidden = false;
    oricardAddBtn.disabled = true;
  }
  oricardModal.hidden = false;
  document.body.style.overflow = "hidden"; // 背後のカード一覧のスクロールを禁止
}

function closeOricardModal() {
  oricardOpenToken++; // 実行中のapplyWhenReadyポーリングを打ち切る
  oricardModal.hidden = true;
  oricardFrame.src = "about:blank"; // 4.5MBのmaterials.jsをメモリに残さない
  document.body.style.overflow = "";
  oricardBaselineSnapshot = null;
}

// モーダルを開いた直後(カードプールのスタイル自動適用が終わった時点)の状態を
// 記録しておき、「編集内容あり」の判定はそこからの差分だけで行う。スタイルが
// 自動適用されただけの状態(name/illustが埋まっている)を「編集済み」と誤判定して
// 毎回確認ダイアログを出してしまう不具合があったための対応。
// state全体(BP・レイド・トリガー・色なども含む)を比較対象にする -- 一部の
// フィールドだけを抜き出していたところ、そこに含まれていないフィールド
// (BP・レイドなど)を変更しても「編集なし」と誤判定される不具合があった。
let oricardBaselineSnapshot = null;
function snapshotOricardState(state) {
  return JSON.stringify(state);
}
function oricardModalHasEdits() {
  const win = oricardFrame.contentWindow;
  const exportFn = win && win.exportOricard;
  if (!exportFn) return false;
  if (oricardBaselineSnapshot === null) return false; // まだ読み込み中(=何も編集できていない)
  return snapshotOricardState(exportFn().state) !== oricardBaselineSnapshot;
}

async function attemptCloseOricardModal() {
  if (oricardModalHasEdits()) {
    const ok = await showConfirm("編集内容が消えますが、閉じてよろしいですか？", {
      confirmText: "閉じる",
      cancelText: "キャンセル",
    });
    if (!ok) return;
  }
  closeOricardModal();
}

document.getElementById("close-oricard-modal-btn").addEventListener("click", attemptCloseOricardModal);
// 枠外クリックでは閉じない(bindModalDismissalを使わない)。誤操作で
// 編集内容を失わないようにするための明示的な仕様。

oricardAddBtn.addEventListener("click", async () => {
  const win = oricardFrame.contentWindow;
  const exportFn = win && win.exportOricard;
  if (!exportFn) {
    oricardStatus.textContent = "オリカメーカーの読み込みが完了していません";
    oricardStatus.className = "status-message error";
    return;
  }
  // state/canvasはUA-maker側のトップレベルconst/letなのでwindowのプロパティ
  // としては見えない(iframe.contentWindow.state は常にundefined) -- 唯一
  // window直下に生やしたexportOricard()経由でだけ読み出せる(oricard/index.html
  // 末尾のコメント参照)。
  const { state, canvas, COLORS } = exportFn();
  // UA-maker側の色キー(B/G/P/R/Y)→このアプリの色表記(赤/青/緑/黄/紫)は、
  // ハードコードせずUA-maker自身のCOLORS定義(jpラベル)から引く。
  const colorEntry = COLORS.find((c) => c.k === state.color);
  const bpSuffix = { plus: "+", minus: "-", plusminus: "±" }[state.bpMod] || "";

  oricardStatus.textContent = "追加中...";
  oricardStatus.className = "status-message";
  oricardAddBtn.disabled = true;
  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像の生成に失敗しました"))), "image/png");
    });
    const card = await Api.addCard({
      name: formatCardName(computeNextCardNumber(latestCards)),
      cardName: state.name || "",
      type: state.type,
      cost: state.req,
      color: colorEntry ? colorEntry.jp : "",
      trigger: state.trigger === "none" ? "" : state.trigger,
      ap: state.ap,
      // BPはUA-maker側もキャラクター以外は非表示・無視しているのに合わせる。
      bp: state.type === "character" && state.bp ? `${state.bp}${bpSuffix}` : "",
      attribute: state.hasTraits && state.traits ? [state.traits] : [],
      generatedEnergy: `${state.gen}${state.addEnergy ? "+" : ""}`,
      // [[トークン]]は他の.dvpoolと同じ表記([登場時]等)に変換して保存する。
      // オリカメーカー側の入力欄は[[ ]]のままで、変換はここ(登録時)だけ。
      effect: oricardEffectToText(state.effect, colorEntry ? colorEntry.jp : ""),
      poolId,
      imageBlob: blob,
    });
    oricardStatus.textContent = `「${displayName(card)}」を登録しました。`;
    oricardStatus.className = "status-message success";
    await renderCards();
    setTimeout(closeOricardModal, 700);
  } catch (err) {
    oricardStatus.textContent = err.message;
    oricardStatus.className = "status-message error";
  } finally {
    oricardAddBtn.disabled = false;
  }
});

// オリカメーカーの効果テキストは、アイコン素材を [[トークン]] という独自記法で
// 埋め込んでいる(オリカメーカー内ではそのまま画像に描画される)。カードプールに
// 登録するときは、他の .dvpool のカードと同じ書き方に揃えたいので、ここで実際の
// 文字列へ置き換える。対応表は pool-exports/*.dvpool の効果テキスト実データ
// (約9000件)から拾った表記に合わせてある(丸括弧は全角、数字と+は半角)。
const ORICARD_EFFECT_TOKEN_TEXT = {
  // 黄色テキスト
  "impact-1": "[インパクト（1）]",
  "damage-2": "[ダメージ（2）]",
  "impact-mukou": "[インパクト無効]",
  "nerai-uchi": "[狙い撃ち]",
  "2-attack": "[2回アタック]",
  "2-block": "[2回ブロック]",
  step: "[ステップ]",
  "impact-plus-1": "[インパクト（+1）]",
  // 青色テキスト
  touzyouzi: "[登場時]",
  taizyouzi: "[退場時]",
  attack: "[アタック時]",
  block: "[ブロック時]",
  "zibunno-turn-tyu": "[自分のターン中]",
  "aiteno-turn-tyu": "[相手のターン中]",
  "kido-main": "[起動メイン]",
  // 白色テキスト
  "rest-ni-suru": "[レストにする]",
  "front-L": "[フロントLにある場合]",
  "energy-L": "[エナジーLにある場合]",
  "kono-cardo-wo-taizyo": "[このカードを退場させる]",
  "AP-1-harau": "[APを1支払う]",
  "tehuda-1": "[手札を1枚場外に置く]",
  "tehuda-2": "[手札を2枚場外に置く]",
  zyougai: "[場外にある場合]",
  // トリガー種別
  trigger: "[トリガー]",
  get: "[ゲット]",
  drow: "[ドロートリガー]",
  active: "[アクティブ]",
  color: "[カラートリガー]",
  special: "[スペシャルトリガー]",
  final: "[ファイナルトリガー]",
  raid_trigger: "[レイドトリガー]",
  // その他
  "turn-1": "[ターン1]",
  raid: "[レイド]",
  "character-2-energy": "2",
};

// [[energy]] は「そのカードの色のエナジー玉」なので、色名に置き換える
// (実データでは [赤×2] のように 色×数 の形で使われている)。
function oricardEffectToText(effect, colorJp) {
  return String(effect || "").replace(/\[\[([^\]]+)\]\]/g, (whole, token) => {
    if (token === "energy") return colorJp || whole;
    const text = ORICARD_EFFECT_TOKEN_TEXT[token];
    return text !== undefined ? text : whole; // 未知のトークンはそのまま残す
  });
}

// カード名イラスト・枠の色/明度・背景イラスト・テキストエリアイラストをこの
// カードプールに保存し、次回オリカメーカーを開いたときに自動適用されるようにする。
// oricard側の「カードプールにこのスタイルを保存」ボタン(window.onSaveStyleClick)
// から呼ばれる。戻り値の文字列がそのままoricard側のステータス表示に使われる。
async function saveOricardStyleToPool(frame = oricardFrame, { confirmOverwrite = true } = {}) {
  const win = frame.contentWindow;
  if (!win || typeof win.getOricardStyle !== "function") {
    throw new Error("読み込みが完了していません");
  }
  let applyGoingForward = true;
  if (confirmOverwrite && currentPool.oricardStyle) {
    const result = await showConfirm("現在保存されているスタイルは消えますが、よろしいですか？", {
      confirmText: "保存する",
      cancelText: "キャンセル",
      danger: false,
      checkboxLabel: "全てのオリカにこのスタイルを適用",
      checkboxDefault: true,
    });
    if (!result.confirmed) return "";
    applyGoingForward = result.checked;
  } else if (currentPool.oricardStyle) {
    // 上書き確認を出さない場合(スタイル編集モーダル)は、既存の適用ON/OFFを引き継ぐ。
    applyGoingForward = currentPool.oricardStyle.enabled !== false;
  }
  const style = win.getOricardStyle();
  style.enabled = applyGoingForward;
  // 一覧に小さく出すためのプレビュー画像を一緒に保存しておく(表示のたびに
  // 4.6MBのオリカメーカーを読み込み直さずに済ませるため)。
  if (typeof win.getStylePreviewDataUrl === "function") {
    // 表示は130px幅なので、高DPI環境でぼやけないよう2倍の解像度で持っておく。
    style.previewImage = win.getStylePreviewDataUrl(260);
  }
  currentPool = await Api.updatePool(poolId, { oricardStyle: style });
  renderCardStyleSummary();
  return "カードプールにスタイルを保存しました";
}

oricardPngBtn.addEventListener("click", () => {
  const win = oricardFrame.contentWindow;
  if (win && typeof win.oricardDownloadPng === "function") win.oricardDownloadPng();
});
oricardJsonSaveBtn.addEventListener("click", () => {
  const win = oricardFrame.contentWindow;
  if (win && typeof win.oricardSaveJson === "function") win.oricardSaveJson();
});
oricardJsonLoadBtn.addEventListener("click", () => oricardJsonFile.click());
oricardJsonFile.addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const win = oricardFrame.contentWindow;
    if (!win || typeof win.oricardLoadJsonText !== "function") return;
    try {
      win.oricardLoadJsonText(ev.target.result);
    } catch (err) {
      oricardStatus.textContent = "JSON読込に失敗しました: " + err.message;
      oricardStatus.className = "status-message error";
    }
  };
  reader.readAsText(file);
});

// ---- カードスタイル(カード一覧の下の行 + 専用の編集モーダル) ----
//
// 「オリカを追加」画面はカード1枚を作る画面なので、スタイルだけを直したいときに
// 使うには余計な入力欄が多い。ここでは同じオリカメーカーをstyleOnlyモードで開き、
// スタイルに含まれる4項目(カード名イラスト・枠の色/明度・背景イラスト・
// テキストエリアイラスト)だけを編集できるようにしている。

const cardStyleSummary = document.getElementById("card-style-summary");
const cardStylePreview = document.getElementById("card-style-preview");
const cardStyleState = document.getElementById("card-style-state");
const cardStyleModal = document.getElementById("card-style-modal");
const cardStyleFrame = document.getElementById("card-style-frame");
const cardStyleUnavailable = document.getElementById("card-style-unavailable");
const cardStyleStatus = document.getElementById("card-style-status");
const cardStyleSaveBtn = document.getElementById("card-style-save-btn");
const cardStyleClearBtn = document.getElementById("card-style-clear-btn");
let cardStyleOpenToken = 0;

function renderCardStyleSummary() {
  const style = currentPool && currentPool.oricardStyle;
  if (!style) {
    cardStylePreview.style.backgroundImage = "";
    cardStyleState.textContent = "未設定";
    return;
  }
  // previewImageはこの機能を入れる前に保存されたスタイルには無いので、
  // その場合は背景イラストで代用する(次に保存し直せば正式なプレビューになる)。
  const src = style.previewImage || (style.bgIllust && style.bgIllust.data);
  cardStylePreview.style.backgroundImage = src ? `url("${src}")` : "";
  cardStyleState.textContent = style.enabled === false ? "設定済み(自動適用オフ)" : "設定済み";
}

async function openCardStyleModal() {
  cardStyleStatus.textContent = "";
  cardStyleStatus.className = "status-message";
  cardStyleUnavailable.hidden = true;
  cardStyleFrame.hidden = false;
  cardStyleSaveBtn.disabled = false;
  cardStyleClearBtn.hidden = !(currentPool && currentPool.oricardStyle);

  let available = true;
  try {
    const res = await fetch("oricard/index.html", { method: "HEAD" });
    available = res.ok;
  } catch (err) {
    available = false;
  }
  if (!available) {
    cardStyleFrame.hidden = true;
    cardStyleUnavailable.hidden = false;
    cardStyleSaveBtn.disabled = true;
    cardStyleModal.hidden = false;
    document.body.style.overflow = "hidden";
    return;
  }

  const openToken = ++cardStyleOpenToken;
  cardStyleFrame.onload = () => {
    const win = cardStyleFrame.contentWindow;
    if (!win || openToken !== cardStyleOpenToken) return;
    const applyWhenReady = () => {
      if (openToken !== cardStyleOpenToken) return;
      if (!win.oricardReady) {
        setTimeout(applyWhenReady, 50);
        return;
      }
      if (typeof win.setStyleOnlyMode === "function") win.setStyleOnlyMode(true);
      if (currentPool && currentPool.oricardStyle && typeof win.applyOricardStyle === "function") {
        win.applyOricardStyle(currentPool.oricardStyle);
      }
    };
    applyWhenReady();
  };
  cardStyleFrame.src = `oricard/index.html?_=${Date.now()}`;
  cardStyleModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeCardStyleModal() {
  cardStyleOpenToken++;
  cardStyleModal.hidden = true;
  cardStyleFrame.src = "about:blank";
  document.body.style.overflow = "";
}

cardStyleSummary.addEventListener("click", openCardStyleModal);
document.getElementById("close-card-style-modal-btn").addEventListener("click", closeCardStyleModal);

cardStyleSaveBtn.addEventListener("click", async () => {
  cardStyleStatus.textContent = "保存中...";
  cardStyleStatus.className = "status-message";
  cardStyleSaveBtn.disabled = true;
  try {
    // このモーダルはスタイルを編集するためだけの画面なので、上書き確認は出さない
    // (「オリカを追加」画面からの保存と違い、上書きこそがこの画面の目的のため)。
    const msg = await saveOricardStyleToPool(cardStyleFrame, { confirmOverwrite: false });
    cardStyleStatus.textContent = msg;
    cardStyleStatus.className = "status-message success";
    setTimeout(closeCardStyleModal, 700);
  } catch (err) {
    cardStyleStatus.textContent = err.message;
    cardStyleStatus.className = "status-message error";
  } finally {
    cardStyleSaveBtn.disabled = false;
  }
});

cardStyleClearBtn.addEventListener("click", async () => {
  if (!(await showConfirm("このカードプールのカードスタイルを解除します。よろしいですか?"))) return;
  currentPool = await Api.updatePool(poolId, { oricardStyle: null });
  renderCardStyleSummary();
  closeCardStyleModal();
});

// ---- Bulk add: stage several images, no per-card metadata up front ----
//
// 各画像は選んだ時点では一切加工されない(そのまま一覧に追加される)。個別に
// トリミングしたい場合だけ、タイル右上のハサミアイコンから既存のcrop-popupを
// 開く。「完了」を押すと、画像だけを持つカード(名前はCARD-XXXの自動採番のみ、
// それ以外の情報は空)をまとめて登録する -- 個別の情報入力は登録後にカード
// 一覧から編集してもらう想定なので、この画面には情報入力欄を一切置いていない。

const bulkAddModal = document.getElementById("bulk-add-modal");
const bulkAddGrid = document.getElementById("bulk-add-grid");
const bulkAddStatus = document.getElementById("bulk-add-status");
const bulkAddFileInput = document.getElementById("bulk-add-file-input");
const bulkAddDoneBtn = document.getElementById("bulk-add-done-btn");

let bulkAddItems = []; // [{ blob, cropped }]

function openBulkAddModal() {
  bulkAddItems = [];
  bulkAddStatus.textContent = "";
  bulkAddStatus.className = "status-message";
  renderBulkAddGrid();
  bulkAddModal.hidden = false;
}

function closeBulkAddModal() {
  bulkAddModal.hidden = true;
  bulkAddFileInput.value = "";
}

function renderBulkAddGrid() {
  bulkAddGrid.innerHTML = "";
  bulkAddItems.forEach((item, index) => {
    const tile = document.createElement("div");
    tile.className = "bulk-add-tile";

    const img = document.createElement("img");
    img.src = URL.createObjectURL(item.blob);
    img.draggable = false;
    tile.appendChild(img);

    const cropBtn = document.createElement("button");
    cropBtn.type = "button";
    cropBtn.className = "grid-zoom-btn bulk-add-crop-btn";
    cropBtn.title = "トリミング";
    cropBtn.textContent = "✂";
    cropBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCropPopup(item.blob, { type: "bulk", index });
    });
    tile.appendChild(cropBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "bulk-add-remove-btn";
    removeBtn.title = "この画像を取り消す";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      bulkAddItems.splice(index, 1);
      renderBulkAddGrid();
    });
    tile.appendChild(removeBtn);

    bulkAddGrid.appendChild(tile);
  });
}

document.getElementById("bulk-add-plus-btn").addEventListener("click", () => bulkAddFileInput.click());

bulkAddFileInput.addEventListener("change", () => {
  for (const file of bulkAddFileInput.files) {
    bulkAddItems.push({ blob: file, cropped: false });
  }
  bulkAddFileInput.value = "";
  renderBulkAddGrid();
});

bulkAddDoneBtn.addEventListener("click", async () => {
  if (bulkAddItems.length === 0) {
    closeBulkAddModal();
    return;
  }
  bulkAddDoneBtn.disabled = true;
  bulkAddStatus.textContent = `登録中... (0/${bulkAddItems.length})`;
  bulkAddStatus.className = "status-message";
  let nextNumber = computeNextCardNumber(latestCards);
  try {
    for (let i = 0; i < bulkAddItems.length; i++) {
      await Api.addCard({
        name: formatCardName(nextNumber),
        poolId,
        imageBlob: bulkAddItems[i].blob,
        unedited: true,
      });
      nextNumber++;
      bulkAddStatus.textContent = `登録中... (${i + 1}/${bulkAddItems.length})`;
    }
    closeBulkAddModal();
    await renderCards();
  } catch (err) {
    bulkAddStatus.textContent = err.message;
    bulkAddStatus.className = "status-message error";
  } finally {
    bulkAddDoneBtn.disabled = false;
  }
});

document.getElementById("close-bulk-add-modal-btn").addEventListener("click", closeBulkAddModal);
bindModalDismissal(bulkAddModal, { onCancel: closeBulkAddModal });

// PATCHes the currently-editing card (plus an image replace, if one was
// cropped). Returns whether it succeeded, leaving the modal open with an
// error message on failure either way.
async function saveEditingCard() {
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
    });
    return true;
  } catch (err) {
    setModalStatus(err.message, "error");
    return false;
  }
}

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
  renderCardStyleSummary();
  await renderCards();
}

init();
