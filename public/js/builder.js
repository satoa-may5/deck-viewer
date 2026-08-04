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

// 左クリック(タップ)で追加、右クリック(長押しの場合も含むcontextmenu)で
// 削除、という共通挙動をデッキ側・カードプール側の両ペインで共有する。
function attachCardClicks(el, { onAdd, onRemove }) {
  let downX = 0;
  let downY = 0;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // 右ボタンの押下はここでは追跡しない(削除はcontextmenu側で扱う)
    downX = e.clientX;
    downY = e.clientY;
  });
  el.addEventListener("pointerup", (e) => {
    if (e.button !== 0) return;
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
    // Only a real tap/click triggers add — anything that moved more than
    // this is a scroll/swipe/drag gesture and should just scroll/reorder normally.
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) onAdd();
  });
  // contextmenu(右クリック、モバイルの長押しでも発火する)を削除に割り当て、
  // ブラウザ標準の右クリックメニューは出さない。
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    onRemove();
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

// prepareCardExit()の逆再生: 「デッキ側を左クリックしてもう1枚追加」
// 「カードプール側を右クリックして削除」のように、タップされた要素自体は
// その場に残ったまま中身(枚数)だけ変わるケース向けの、うっすら入ってくる
// ような控えめな入場フラッシュ。renderPanes()で再描画された「後」の要素を
// 対象に呼ぶ必要がある(枚数バッジ等も含めた最終的な見た目の位置に向かって
// 入ってくるように見せるため)。
function prepareCardEnter(sourceEl, direction) {
  const frame = sourceEl && sourceEl.querySelector(".card-frame");
  if (!frame) return;
  const frameRect = frame.getBoundingClientRect();
  const ghost = frame.cloneNode(true);
  ghost.style.position = "fixed";
  ghost.style.left = `${frameRect.left}px`;
  ghost.style.top = `${frameRect.top}px`;
  ghost.style.width = `${frameRect.width}px`;
  ghost.style.height = `${frameRect.height}px`;
  ghost.style.margin = "0";
  ghost.style.zIndex = "999";
  ghost.style.pointerEvents = "none";
  ghost.style.transition = "none";
  ghost.style.opacity = "0";
  const dx = direction === "left" ? -60 : 60;
  ghost.style.transform = `translateX(${dx}px)`;
  document.body.appendChild(ghost);

  // animateGrowと同じ理由でrAFではなくsetTimeoutを使う(初期状態を確実に
  // 1フレーム描画させてから遷移させないと、transitionが発火せず一瞬で
  // 完成形にスナップしてしまう)。
  setTimeout(() => {
    ghost.style.transition = "transform 0.1s ease-out, opacity 0.1s ease-out";
    ghost.style.transform = "translateX(0)";
    ghost.style.opacity = "1";
  }, 20);
  setTimeout(() => ghost.remove(), 130);
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

// afterRender: 再描画された直後(=最終的なDOMが確定した後)に呼びたい処理
// (入場アニメーションの起点となる要素の位置測定など)を渡せる。
function addToDeck(cardId, afterRender) {
  deckCounts.set(cardId, (deckCounts.get(cardId) || 0) + 1);
  renderPanes();
  if (afterRender) afterRender();
  pushHistory();
}

function removeFromDeck(cardId, afterRender) {
  const current = deckCounts.get(cardId) || 0;
  if (current <= 1) {
    deckCounts.delete(cardId);
    if (deckThumbnailCardId === cardId) deckThumbnailCardId = null;
  } else {
    deckCounts.set(cardId, current - 1);
  }
  renderPanes();
  if (afterRender) afterRender();
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

// "軽減2エナ": 必要エナジー2のカードで、盤面に自分のカードが1枚もなければ
// 手札にある間だけ必要エナジー-2(=実質0)になる効果を持つもの。データ上に
// 専用フラグは無いため、効果テキストの特徴的な一文で判定する。
function isCostReducerCard(card) {
  return card.cost === 2 && typeof card.effect === "string" && card.effect.includes("必要エナジーを2減らす");
}

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
  let reducedCount = 0; // "軽減2エナ" cards: cost 2, but effectively 0 with an empty board
  const triggerCounts = { "": 0, ...Object.fromEntries(Object.keys(TRIGGER_LABELS).map((k) => [k, 0])) };
  for (const [cardId, count] of deckCounts) {
    const card = cardById[cardId];
    if (!card) continue;
    if (card.cost !== null && card.cost !== undefined) {
      buckets[Math.min(card.cost, 8)] += count;
    }
    if (isCostReducerCard(card)) reducedCount += count;
    const trigger = card.trigger || "";
    triggerCounts[trigger] = (triggerCounts[trigger] || 0) + count;
  }

  // 必要エナジー0の棒は「軽減2エナ」の枚数分だけ余分に高くなる(その分が
  // 上に斜線で乗る)ため、スケールの基準もそれを込みで見る。
  const scaleHeights = buckets.map((count, cost) => (cost === 0 ? count + reducedCount : count));
  const maxBucket = Math.max(1, ...scaleHeights);
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
    if (reducedCount > 0 && cost === 0) {
      countEl.textContent = `${count} +${reducedCount}`;
    } else if (reducedCount > 0 && cost === 2) {
      countEl.textContent = `${count} -${reducedCount}`;
    } else {
      countEl.textContent = count > 0 ? String(count) : "";
    }
    countsRow.appendChild(countEl);

    const barCol = document.createElement("div");
    barCol.className = "stats-mana-bar-col";

    if (reducedCount > 0 && (cost === 0 || cost === 2)) {
      // 積み上げ棒: 必要エナジー0は下=通常の0エナカード、上=軽減2エナの分。
      // 必要エナジー2は元々軽減2エナも含んだ数なので、高さ自体は変えず
      // 上側のreducedCount分だけ斜線に置き換える。
      const stack = document.createElement("div");
      stack.className = "stats-mana-bar-stack";
      const hatched = document.createElement("div");
      hatched.className = "stats-mana-bar-segment stats-mana-bar-hatched";
      const solid = document.createElement("div");
      solid.className = "stats-mana-bar-segment stats-mana-bar-solid";
      const solidCount = cost === 0 ? count : Math.max(count - reducedCount, 0);
      hatched.style.flexGrow = String(reducedCount);
      solid.style.flexGrow = String(solidCount);
      // 積み上げ順は上から書いた順(flex-direction:columnのデフォルト)なので、
      // 斜線を先に置けばそのまま上側に来る。
      stack.appendChild(hatched);
      stack.appendChild(solid);
      barCol.appendChild(stack);
      const total = cost === 0 ? count + reducedCount : count;
      bars.push([stack, Math.max((total / maxBucket) * 100, total > 0 ? 3 : 0)]);
    } else {
      const bar = document.createElement("div");
      bar.className = "stats-mana-bar";
      barCol.appendChild(bar);
      bars.push([bar, Math.max((count / maxBucket) * 100, count > 0 ? 3 : 0)]);
    }
    barsRow.appendChild(barCol);

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
  updateMulliganUI();
  updateMulliganRates();
  // "reset"モードは現在のmulliganBoardIds(前回開いた時に引いたままなら
  // それ、まだ何も引いていなければ空)をアニメーションなしでそのまま
  // 反映するだけ -- 空の場合は青い破線のプレースホルダーだけが表示される。
  renderMulliganBoard("reset");
  deckStatsModal.hidden = false;
}

function closeDeckStats() {
  deckStatsModal.hidden = true;
}

deckStatsBtn.addEventListener("click", openDeckStats);
document.getElementById("deck-stats-close-btn").addEventListener("click", closeDeckStats);
bindModalDismissal(deckStatsModal, { onCancel: closeDeckStats });

// ---- Mulligan help popup (ホバーではなくクリックで開閉) ----

const mulliganHelpBtn = document.getElementById("mulligan-help-btn");
const mulliganHelpPopup = document.getElementById("mulligan-help-popup");

mulliganHelpBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  mulliganHelpPopup.hidden = !mulliganHelpPopup.hidden;
});

document.addEventListener("click", (e) => {
  if (!mulliganHelpPopup.hidden && !e.target.closest(".mulligan-help-wrap")) {
    mulliganHelpPopup.hidden = true;
  }
});

// ---- Mulligan simulator ----

const mulliganBoardEl = document.getElementById("mulligan-board");
const mulliganBoardExtraEl = document.getElementById("mulligan-board-extra");
const mulliganDraw7Btn = document.getElementById("mulligan-draw7-btn");
const mulliganDraw1Btn = document.getElementById("mulligan-draw1-btn");
const mulliganResetBtn = document.getElementById("mulligan-reset-btn");
const mulliganSuccessRateEl = document.getElementById("mulligan-success-rate");
const mulliganTama2RateEl = document.getElementById("mulligan-tama2-rate");

const MULLIGAN_MIN_DECK_SIZE = 20;
const MULLIGAN_SINGLE_DRAW_LIMIT = 3;
// 盤面のグリッド(.mulligan-board、style.css側)は7枚引き+1枚引く最大3回ぶん
// である10列を常に確保しており、ここではJS側で特に列数を意識する必要はない。

// マリガンシミュレーターは「今デッキから引いたら二度と山に戻らない」実際の
// 対戦のドローとは違い、都度「山札全体(mulliganFullPool) - 今盤面にあるカード」
// を対象に引き直す(以前の実装は引いた分を永久に除外していたため、マリガンを
// 繰り返すたびに対象がどんどん減っていく不具合があった)。
let mulliganFullPool = []; // 「新しく7枚引く」を押した時点のデッキ全体(cardIdを枚数分展開)
let mulliganBoardIds = []; // 現在盤面に並んでいるカード(表示順)
let mulliganSingleDrawsUsed = 0;
let mulliganActive = false; // 「新しく7枚引く」を押した後、リセットするまでtrue

function totalDeckCount() {
  let total = 0;
  for (const count of deckCounts.values()) total += count;
  return total;
}

function mulliganEnabled() {
  return totalDeckCount() >= MULLIGAN_MIN_DECK_SIZE;
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildFullDeckPool() {
  const pool = [];
  for (const [cardId, count] of deckCounts) {
    for (let i = 0; i < count; i++) pool.push(cardId);
  }
  return pool;
}

// 山札全体から「現在盤面にあるカード」を多重集合として差し引いた、今引ける
// 対象一覧を返す(それ以前に引いて盤面から入れ替わったカードは対象に戻る)。
function mulliganAvailablePool() {
  const counts = new Map();
  for (const id of mulliganFullPool) counts.set(id, (counts.get(id) || 0) + 1);
  for (const id of mulliganBoardIds) counts.set(id, (counts.get(id) || 0) - 1);
  const avail = [];
  for (const [id, c] of counts) {
    for (let i = 0; i < c; i++) avail.push(id);
  }
  return avail;
}

function isMulliganHighlightCard(card) {
  return Boolean(card) && (card.cost === 0 || card.cost === 1 || isCostReducerCard(card));
}

// 「新しく7枚引く」/「マリガン」で表示する7枚は、表示前にキャラ→イベント→
// フィールドの順、同種別内は必要エナジー昇順、同エナジーはカードプール内の
// 並び順(card.order)でソートしてから盤面に出す。「1枚引く」で追加される分は
// この対象外(引いた順にそのまま追加、ソートし直さない)。
const MULLIGAN_TYPE_ORDER = { character: 0, event: 1, field: 2 };
function sortMulliganHand(cardIds, cardById) {
  return cardIds.slice().sort((idA, idB) => {
    const a = cardById[idA];
    const b = cardById[idB];
    const typeA = a && a.type in MULLIGAN_TYPE_ORDER ? MULLIGAN_TYPE_ORDER[a.type] : 3;
    const typeB = b && b.type in MULLIGAN_TYPE_ORDER ? MULLIGAN_TYPE_ORDER[b.type] : 3;
    if (typeA !== typeB) return typeA - typeB;
    const costA = a && a.cost !== null && a.cost !== undefined ? a.cost : Infinity;
    const costB = b && b.cost !== null && b.cost !== undefined ? b.cost : Infinity;
    if (costA !== costB) return costA - costB;
    const orderA = a && a.order !== undefined ? a.order : 0;
    const orderB = b && b.order !== undefined ? b.order : 0;
    return orderA - orderB;
  });
}

const MULLIGAN_MAIN_SLOTS = 7;
const MULLIGAN_EXTRA_SLOTS = MULLIGAN_SINGLE_DRAW_LIMIT;

// 「まだ引かれていない枠」を表す、常時表示される青い破線のプレースホルダー。
// slotIndexで明示的にgrid位置を指定し、同じセルに(あれば)カード本体の要素も
// 重ねて置く。カード本体はこのプレースホルダーの後にDOM挿入されるので常に
// 上に描画される -- アニメーション中(半透明・スライド中)は下の破線が透けて
// 見え、めくり終わって不透明になれば自然と破線が完全に隠れる。
function buildMulliganPlaceholder(slotIndex) {
  const el = document.createElement("div");
  el.className = "mulligan-card-frame is-empty";
  el.style.gridColumn = String(slotIndex + 1);
  el.style.gridRow = "1";
  return el;
}

function buildMulliganFrame(cardId, cardById, slotIndex) {
  const card = cardById[cardId];
  const frame = document.createElement("div");
  frame.className = "mulligan-card-frame";
  frame.style.gridColumn = String(slotIndex + 1);
  frame.style.gridRow = "1";
  if (isMulliganHighlightCard(card)) frame.classList.add("is-cheap");
  if (card && card.imageExt) {
    const img = document.createElement("img");
    img.src = Api.cardImageUrl(card);
    img.alt = "";
    img.draggable = false;
    frame.appendChild(img);
  }
  return frame;
}

// container内をslotCount個ぶんの「プレースホルダー + (あれば)カード」の
// ペアで作り直す。ids[i]が無いスロットはプレースホルダーだけになる。
function buildMulliganRow(container, ids, slotCount, cardById) {
  container.innerHTML = "";
  for (let i = 0; i < slotCount; i++) {
    container.appendChild(buildMulliganPlaceholder(i));
    if (ids[i]) container.appendChild(buildMulliganFrame(ids[i], cardById, i));
  }
}

// 1行目(最大7枚、mulliganBoardEl)= 「新しく7枚引く」/「マリガン」で並ぶ手札、
// 2行目(最大3枚、mulliganBoardExtraEl)=「1枚引く」で追加された分、と行を分けて
// 表示する(カード自体を大きく見せるため、両方とも同じ列幅=同じカードサイズに
// なるようCSS側で列数を揃えている)。空いている枠は常に青い破線のプレース
// ホルダーとして描画されるので、行の数・高さ自体は常に一定。
//
// mode: "full" = 1行目を丸ごと新規表示(右からスライドイン)、2行目は空にする。
// "single" = 2行目の末尾に1枚追加(その1枚だけスライドイン、他は変化なし)。
// "reset" = 現在の状態(空なら空のまま)をアニメーションなしで反映する。
function renderMulliganBoard(mode) {
  const cardById = Object.fromEntries(allCards.map((c) => [c.id, c]));
  const mainIds = mulliganBoardIds.slice(0, MULLIGAN_MAIN_SLOTS);
  const extraIds = mulliganBoardIds.slice(MULLIGAN_MAIN_SLOTS);

  if (mode === "single") {
    // 1行目は既存のまま、2行目だけ作り直す(末尾の1枚だけアニメーション対象)。
    buildMulliganRow(mulliganBoardExtraEl, extraIds, MULLIGAN_EXTRA_SLOTS, cardById);
    const extraFrames = mulliganBoardExtraEl.querySelectorAll(".mulligan-card-frame:not(.is-empty)");
    extraFrames.forEach((frame, index) => {
      if (index < extraIds.length - 1) frame.classList.add("is-dealt");
    });
    setTimeout(() => {
      const last = extraFrames[extraIds.length - 1];
      if (last) last.classList.add("is-dealt");
    }, 20);
    return;
  }

  buildMulliganRow(mulliganBoardEl, mainIds, MULLIGAN_MAIN_SLOTS, cardById);
  buildMulliganRow(mulliganBoardExtraEl, extraIds, MULLIGAN_EXTRA_SLOTS, cardById);
  if (mode === "reset") {
    // 現在の内容(リセット直後なら空)をそのまま静的に確定させるだけ。
    mulliganBoardEl.querySelectorAll(".mulligan-card-frame:not(.is-empty)").forEach((f) => f.classList.add("is-dealt"));
    return;
  }

  // mode === "full": 1行目を右から一斉に(スタガーで)スライドイン。
  const frames = mulliganBoardEl.querySelectorAll(".mulligan-card-frame:not(.is-empty)");
  // animateGrowと同じ理由でrAFではなくsetTimeoutを使う(先に0%相当の初期状態を
  // 確実に1フレーム描画させてからis-dealtへ遷移させないと、transitionが
  // 発火せず一瞬で完成形にスナップしてしまう)。
  setTimeout(() => {
    frames.forEach((frame, index) => {
      setTimeout(() => frame.classList.add("is-dealt"), index * 90);
    });
  }, 20);
}

function updateMulliganUI() {
  const enabled = mulliganEnabled();
  mulliganDraw7Btn.textContent = mulliganActive ? "マリガン" : "新しく7枚引く";
  mulliganDraw7Btn.disabled = !enabled;
  mulliganDraw7Btn.title = enabled ? "" : `デッキが${MULLIGAN_MIN_DECK_SIZE}枚未満のため利用できません`;
  // hidden属性(display:none)ではなくvisibility:hiddenにして、リセットボタンの
  // 出現/消失で「新しく7枚引く」/「マリガン」ボタンの位置がズレないようにする。
  mulliganResetBtn.classList.toggle("mulligan-btn-invisible", !mulliganActive);
  mulliganResetBtn.disabled = !mulliganActive;
  const drawsLeft = MULLIGAN_SINGLE_DRAW_LIMIT - mulliganSingleDrawsUsed;
  mulliganDraw1Btn.textContent = `1枚引く (${drawsLeft}/${MULLIGAN_SINGLE_DRAW_LIMIT})`;
  mulliganDraw1Btn.disabled = !enabled || !mulliganActive || drawsLeft <= 0 || mulliganAvailablePool().length === 0;
}

mulliganDraw7Btn.addEventListener("click", () => {
  if (!mulliganEnabled()) return;
  const cardById = Object.fromEntries(allCards.map((c) => [c.id, c]));
  if (mulliganActive) {
    // マリガン: 「今盤面にあるカード以外」から新たに7枚(足りなければ残り全部)
    // 引いて盤面を丸ごと入れ替える。以前の盤面や「1枚引く」で既に入れ替わって
    // 消えたカードは、再び対象に戻る。
    const avail = shuffled(mulliganAvailablePool());
    mulliganBoardIds = avail.slice(0, Math.min(7, avail.length));
  } else {
    mulliganFullPool = buildFullDeckPool();
    const avail = shuffled(mulliganFullPool);
    mulliganBoardIds = avail.slice(0, Math.min(7, avail.length));
    mulliganActive = true;
  }
  mulliganBoardIds = sortMulliganHand(mulliganBoardIds, cardById);
  mulliganSingleDrawsUsed = 0;
  updateMulliganUI();
  renderMulliganBoard("full");
});

mulliganDraw1Btn.addEventListener("click", () => {
  const avail = mulliganAvailablePool();
  if (avail.length === 0) return;
  const cardId = avail[Math.floor(Math.random() * avail.length)];
  mulliganBoardIds.push(cardId);
  mulliganSingleDrawsUsed++;
  updateMulliganUI();
  renderMulliganBoard("single");
});

mulliganResetBtn.addEventListener("click", () => {
  mulliganActive = false;
  mulliganBoardIds = [];
  mulliganFullPool = [];
  mulliganSingleDrawsUsed = 0;
  updateMulliganUI();
  renderMulliganBoard("reset");
});

// ---- Mulligan success rate (完全枚挙による厳密計算) ----
//
// ルール:「7枚引いて確認する。条件を満たさなければ、その7枚以外の残りデッキ
// からさらに7枚引いて確認する。この2回のうち1回でも条件を満たせばOK」。
// 2回目の手札は1回目とは独立ではない(1回目の7枚を除いた残りから引く)ため、
// P(1回目 or 2回目が成功) = Σ_{1回目の組み合わせh1} P(h1) × [ h1が成功なら1、
// でなければ P(残りのデッキから引く2回目h2が成功) ] という形で、1回目の
// 組み合わせひとつひとつについて、残りデッキを対象にした2回目の分布を
// 数え上げれば厳密に計算できる(モンテカルロは使わない)。
//
// カテゴリ(7分類)ごとの多変量超幾何分布として1回目・2回目それぞれを数え
// 上げる。1回目の分配パターンは高々13C6=1716通り、2回目も同様に高々1716通り
// なので、最悪でも1716×1716≈294万通りの評価で済む(nChooseKは同じ(n,k)の
// 組み合わせが大量に再利用されるため、事前にPascalの三角形をテーブル化して
// O(1)参照にすることで実用的な速度に収めている)。
// さらに、1回目の手札だけで成功+2玉条件まで両方満たしている場合は、2回目の
// 結果に関わらずこの1回目のパターンは丸ごと成功+2玉の側に数えられるため、
// 2回目の列挙をまるごと省略できる(実デッキではこのショートカットがよく
// 効き、体感の計算時間はかなり短くなる)。

const MULLIGAN_CATEGORY_KEYS = ["r", "z", "o", "t2e", "t2x", "t3e", "other"];

function evaluateMulliganHand(counts) {
  const [r, z, o, t2e, t2x, t3e] = counts;
  const base = z >= 2 || (z >= 1 && r >= 1) || (z >= 1 && o >= 1) || (r >= 1 && o >= 1);
  if (!base) return { success: false, tama2: false };
  const cond1 = r + t2e + t2x >= 1 && t3e >= 1;
  const cond2 = t2e >= 1;
  return { success: true, tama2: cond1 || cond2 };
}

// binom[n][k] (0<=k<=7) をPascalの三角形で前計算し、nChooseKをO(1)参照にする
// (このシミュレーターではkが常に0〜7の範囲でしか使われないため、その列だけ
// 用意すれば十分)。
function buildBinomTable(maxN) {
  const table = [];
  for (let n = 0; n <= maxN; n++) {
    const row = new Array(8).fill(0);
    row[0] = 1;
    for (let k = 1; k <= Math.min(7, n); k++) {
      const prev = table[n - 1];
      row[k] = (prev ? prev[k - 1] : 0) + (prev && k <= n - 1 ? prev[k] : 0);
    }
    table.push(row);
  }
  return table;
}

// 残りデッキ(sizes)から7枚引く分配を全列挙し、各分配について成功/成功+2玉に
// 数えられる「組み合わせ数」の合計を返す(caller側でOR判定に使う)。
function enumerateHandWays(sizes, binom) {
  const counts = new Array(7).fill(0);
  let successWays = 0;
  let tama2Ways = 0;

  function recurse(idx, remaining) {
    if (idx === 6) {
      const last = remaining;
      if (last > sizes[6]) return;
      counts[6] = last;
      let ways = 1;
      for (let i = 0; i < 7; i++) {
        ways *= binom[sizes[i]][counts[i]];
        if (ways === 0) return;
      }
      const result = evaluateMulliganHand(counts);
      if (result.success) successWays += ways;
      if (result.tama2) tama2Ways += ways;
      return;
    }
    const maxC = Math.min(sizes[idx], remaining);
    for (let c = 0; c <= maxC; c++) {
      counts[idx] = c;
      recurse(idx + 1, remaining - c);
    }
  }
  recurse(0, 7);
  return { successWays, tama2Ways };
}

function updateMulliganRates() {
  const cardById = Object.fromEntries(allCards.map((c) => [c.id, c]));
  // カテゴリ: r=軽減2エナ, z=必要エナジー0, o=必要エナジー1,
  // t2e=必要エナジー2かつ発生エナジー1+(軽減2エナは除く), t2x=必要エナジー2の残り,
  // t3e=必要エナジー3かつ発生エナジー1+または2, other=それ以外。
  const sizes = new Array(7).fill(0);
  let total = 0;
  for (const [cardId, count] of deckCounts) {
    const card = cardById[cardId];
    if (!card) continue;
    total += count;
    let key;
    if (isCostReducerCard(card)) key = "r";
    else if (card.cost === 0) key = "z";
    else if (card.cost === 1) key = "o";
    else if (card.cost === 2 && card.generatedEnergy === "1+") key = "t2e";
    else if (card.cost === 2) key = "t2x";
    else if (card.cost === 3 && (card.generatedEnergy === "1+" || card.generatedEnergy === "2")) key = "t3e";
    else key = "other";
    sizes[MULLIGAN_CATEGORY_KEYS.indexOf(key)] += count;
  }

  if (total < 7) {
    mulliganSuccessRateEl.textContent = "--%";
    mulliganTama2RateEl.textContent = "--%";
    return;
  }

  const binom = buildBinomTable(total);
  const canDrawSecondHand = total >= 14;
  const totalHand1Ways = binom[total][7];
  // binomはnについて0..totalまで作ってあるので、total-7の行もこの同じ
  // テーブルからそのまま参照できる(作り直す必要はない)。
  const totalHand2Ways = canDrawSecondHand ? binom[total - 7][7] : 1;
  const denom = totalHand1Ways * totalHand2Ways;

  let successWays = 0;
  let tama2Ways = 0;
  const hand1Counts = new Array(7).fill(0);

  function recurseHand1(idx, remaining) {
    if (idx === 6) {
      const last = remaining;
      if (last > sizes[6]) return;
      hand1Counts[6] = last;
      let ways1 = 1;
      for (let i = 0; i < 7; i++) {
        ways1 *= binom[sizes[i]][hand1Counts[i]];
        if (ways1 === 0) return;
      }
      const r1 = evaluateMulliganHand(hand1Counts);
      if (!canDrawSecondHand) {
        if (r1.success) successWays += ways1;
        if (r1.tama2) tama2Ways += ways1;
        return;
      }
      if (r1.success && r1.tama2) {
        // 1回目だけで両方確定するので、2回目の中身に関わらずways1×(2回目の
        // 全パターン数)をまるごと両方に加算できる(2回目の列挙を省略)。
        successWays += ways1 * totalHand2Ways;
        tama2Ways += ways1 * totalHand2Ways;
        return;
      }
      const remainingSizes = sizes.map((s, i) => s - hand1Counts[i]);
      const { successWays: sw2, tama2Ways: tw2 } = enumerateHandWays(remainingSizes, binom);
      // successは「1回目 or 2回目」、tama2も同様に「1回目 or 2回目」のOR。
      successWays += r1.success ? ways1 * totalHand2Ways : ways1 * sw2;
      tama2Ways += r1.tama2 ? ways1 * totalHand2Ways : ways1 * tw2;
      return;
    }
    const maxC = Math.min(sizes[idx], remaining);
    for (let c = 0; c <= maxC; c++) {
      hand1Counts[idx] = c;
      recurseHand1(idx + 1, remaining - c);
    }
  }
  recurseHand1(0, 7);

  const successRate = denom > 0 ? (successWays / denom) * 100 : 0;
  const tama2Rate = denom > 0 ? (tama2Ways / denom) * 100 : 0;
  mulliganSuccessRateEl.textContent = `${successRate.toFixed(2)}%`;
  mulliganTama2RateEl.textContent = `${tama2Rate.toFixed(2)}%`;
}

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
  const confirmed = await showConfirm("現在の変更は破棄されますがよろしいですか？", { confirmText: "インポート" });
  if (!confirmed) return;
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
const BP_RANGE_MIN = 0;
// 必要エナジー/BPの上限は固定値ではなく、選択中カードプールの実データにある
// 最大値まで(BPは500刻み、必要エナジーは1刻み)。filterState.costRangeMax/
// bpRangeMaxに都度計算して入れる -- 詳細はrefreshRangeBounds()参照。
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
  onChange: renderPanes,
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
  onChange: renderPanes,
  step: BP_STEP,
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

  // レアリティはプールに実在するものだけ(★の有無は統合済み)を表示する。
  filterRarityGroup.innerHTML = "";
  for (const rarity of presentRarities(poolCardsForFilter)) {
    filterRarityGroup.appendChild(
      createFilterPill(rarity, filterState.rarities.has(rarity), () => {
        toggleInSet(filterState.rarities, rarity);
        renderPanes();
      })
    );
  }
  shrinkPillTextToFit(filterRarityGroup);

  // 消費APは1/2/3固定、プールに存在しない値はボタンをdisabledにする。
  const presentAps = new Set(poolCardsForFilter.map((c) => c.ap).filter((v) => v !== null && v !== undefined));
  filterApGroup.innerHTML = "";
  for (const ap of AP_VALUES) {
    const pill = createFilterPill(String(ap), filterState.aps.has(ap), () => {
      toggleInSet(filterState.aps, ap);
      renderPanes();
    });
    if (!presentAps.has(ap)) pill.disabled = true;
    filterApGroup.appendChild(pill);
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
  shrinkPillTextToFit(filterAttributeGroup);

  // 発生エナジーは1/1+/2/2+/3固定、プールに存在しない値はボタンをdisabledにする。
  const presentGeneratedEnergies = new Set(poolCardsForFilter.map((c) => c.generatedEnergy).filter(Boolean));
  filterGeneratedEnergyGroup.innerHTML = "";
  for (const ge of GENERATED_ENERGY_VALUES) {
    const pill = createFilterPill(ge, filterState.generatedEnergies.has(ge), () => {
      toggleInSet(filterState.generatedEnergies, ge);
      renderPanes();
    });
    if (!presentGeneratedEnergies.has(ge)) pill.disabled = true;
    filterGeneratedEnergyGroup.appendChild(pill);
  }

  refreshRangeBounds(poolCardsForFilter, (c) => c.cost, 1, filterState, "costMin", "costMax", "costRangeMax");
  refreshRangeBounds(poolCardsForFilter, (c) => parseBpValue(c.bp), BP_STEP, filterState, "bpMin", "bpMax", "bpRangeMax");
  costSlider.updateUI();
  bpSlider.updateUI();
  filterParallelCheckbox.checked = filterState.excludeParallel;
  // Only shown once there's actually something for it to filter out, same as
  // pool-detail.js -- scoped to the currently-selected pools' cards, not
  // every card in the collection.
  filterAllColorWrap.hidden = !poolCardsForFilter.some((c) => c.color === "全て");
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
  filterState.costMax = filterState.costRangeMax;
  filterState.bpMin = BP_RANGE_MIN;
  filterState.bpMax = filterState.bpRangeMax;
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
  if (filterState.rarities.size > 0 && !filterState.rarities.has(baseRarity(card.rarity))) return false;
  if (filterState.aps.size > 0 && !filterState.aps.has(card.ap ?? null)) return false;
  if (filterState.generatedEnergies.size > 0 && !filterState.generatedEnergies.has(card.generatedEnergy || "")) {
    return false;
  }
  if (filterState.attributes.size > 0) {
    const cardAttributes = card.attribute || [];
    if (![...filterState.attributes].some((a) => cardAttributes.includes(a))) return false;
  }
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

// 拡大表示(⤢)ボタンをカードのフレームに追加する(デッキ側・カードプール側の
// 両方の一覧で共有)。attachCardClicks()はel自身が受けるpointerdown/pointerupの
// 座標差分でタップ判定しているため、click単体のstopPropagationだけでは間に合わない
// (pointerup自体が先にelまでバブリングしてタップ扱いされてしまう) --
// ポインター段階で止める。
function addZoomButton(frame, card) {
  const zoomBtn = document.createElement("button");
  zoomBtn.type = "button";
  zoomBtn.className = "grid-zoom-btn";
  zoomBtn.title = "拡大表示";
  zoomBtn.textContent = "⤢";
  zoomBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  zoomBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  // 右クリックがそのままバブリングすると、カード側のcontextmenuハンドラ
  // (デッキから1枚削除)まで届いてしまうため、ここで止める。
  zoomBtn.addEventListener("contextmenu", (e) => e.stopPropagation());
  zoomBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openCardZoom(card);
  });
  frame.appendChild(zoomBtn);
}

// renderPanes()は毎回グリッドの中身を丸ごと作り直すため、再描画後に同じ
// カードのタイルを指し直すにはIDで探し直す必要がある(古い要素の参照は
// renderPanes()の時点でDOMから外れてしまっている)。
function findCardTile(container, cardId) {
  return container.querySelector(`[data-id="${cardId}"]`);
}

function renderPanes() {
  const cardById = Object.fromEntries(allCards.map((c) => [c.id, c]));

  const totalCount = [...deckCounts.values()].reduce((sum, count) => sum + count, 0);
  document.getElementById("deck-total-count").textContent = `${totalCount}枚`;
  updateDeckMenuIndicator();

  deckGrid.innerHTML = "";
  for (const [cardId, count] of deckCounts) {
    const card = cardById[cardId] || null;
    const el = createCardElement(card, cardId, count, {
      isThumbnail: deckThumbnailCardId === cardId,
    });
    if (deckThumbnailMode) {
      el.addEventListener("click", () => setDeckThumbnail(cardId));
    } else {
      attachCardClicks(el, {
        onAdd: () => addToDeck(cardId, () => prepareCardEnter(findCardTile(deckGrid, cardId), "right")),
        onRemove: () => {
          const spawnGhost = prepareCardExit(el, "right");
          removeFromDeck(cardId);
          if (spawnGhost) spawnGhost();
        },
      });
    }
    if (card) {
      const frame = el.querySelector(".card-frame");
      if (frame) addZoomButton(frame, card);
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
      attachCardClicks(el, {
        onAdd: () => {
          const spawnGhost = prepareCardExit(el, "left");
          addToDeck(card.id);
          if (spawnGhost) spawnGhost();
        },
        onRemove: () =>
          removeFromDeck(card.id, () => prepareCardEnter(findCardTile(collectionGrid, card.id), "left")),
      });
      const frame = el.querySelector(".card-frame");
      if (frame) addZoomButton(frame, card);
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

// ---- Card zoom lightbox (collection pane only, see pool-detail.js for the
// original of this pattern) ----

const cardZoomOverlay = document.getElementById("card-zoom-overlay");
const cardZoomImg = document.getElementById("card-zoom-img");

function openImageZoom(src, alt) {
  cardZoomImg.src = src;
  cardZoomImg.alt = alt || "";
  cardZoomOverlay.hidden = false;
}

function openCardZoom(card) {
  openImageZoom(Api.cardImageUrl(card), card.name || "");
}

function closeCardZoom() {
  cardZoomOverlay.hidden = true;
}

document.getElementById("card-zoom-close").addEventListener("click", closeCardZoom);
bindModalDismissal(cardZoomOverlay, { onCancel: closeCardZoom });

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

  // Baseline for the "保存せずに戻る" warning -- compared against on click so
  // the warning is skipped only when nothing has actually changed since the
  // last save (or since opening the page, for a not-yet-saved deck).
  savedSnapshotJSON = currentDeckSnapshotJSON();
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
    savedSnapshotJSON = currentDeckSnapshotJSON();
    return true;
  } catch (err) {
    saveStatus.textContent = err.message;
    saveStatus.className = "status-message error";
    return false;
  }
}

// "保存せずに戻る" の警告は、前回保存時点(または新規デッキならページを開いた
// 時点)から実際に何か変わっている場合は常に表示する(以前あった「次回以降
// 表示しない」の恒久スキップは廃止)。差分が無い場合のみ警告なしで戻る。
let savedSnapshotJSON = "";

function currentDeckSnapshotJSON() {
  return JSON.stringify({
    name: nameInput.value.trim(),
    cards: [...deckCounts.entries()],
    poolIds: [...selectedPoolIds].sort(),
    thumbnailCardId: deckThumbnailCardId,
  });
}

document.getElementById("save-back-btn").addEventListener("click", async () => {
  if (await saveDeck()) location.href = "index.html";
});

document.getElementById("discard-back-btn").addEventListener("click", async () => {
  if (currentDeckSnapshotJSON() === savedSnapshotJSON) {
    location.href = "index.html";
    return;
  }
  const confirmed = await showConfirm("作業内容が失われますが大丈夫ですか?", { confirmText: "戻る" });
  if (!confirmed) return;
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

// ---- Dismissible hint bar (左クリックで追加、右クリックで削除できます) ----
// 一度✕で閉じたら、別のデッキを開いた時も含めて二度と出さない
// (デッキ単位ではなくアプリ全体で1回だけの案内という位置づけ)。

const BUILDER_HINT_DISMISSED_KEY = "deck-viewer-builder-hint-dismissed";
const builderHintBar = document.getElementById("builder-hint-bar");

if (localStorage.getItem(BUILDER_HINT_DISMISSED_KEY) !== "true") {
  builderHintBar.hidden = false;
}

document.getElementById("builder-hint-close-btn").addEventListener("click", () => {
  localStorage.setItem(BUILDER_HINT_DISMISSED_KEY, "true");
  builderHintBar.hidden = true;
});

init();
