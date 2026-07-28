// Shared, site-wide auto-fill-info job tracking + floating panel UI. Loaded
// on every page (not just pool-detail.html, which is the only page with the
// trigger button) because a running or awaiting-confirmation job has to stay
// visible in the corner no matter what screen the user navigates to, and
// only one pool's job can be "in flight" from the user's perspective at a
// time -- trying to start a different pool's job while one is running or
// unconfirmed surfaces a message instead of silently doing nothing.

// Polled faster while a job is actually running so the progress bar advances
// smoothly instead of jumping in chunks of however many cards got classified
// between polls -- falls back to the slower idle interval otherwise so an
// open tab with nothing happening isn't hammering the server for no reason.
const CARD_INFO_POLL_INTERVAL_RUNNING = 700;
const CARD_INFO_POLL_INTERVAL_IDLE = 4000;
const AUTO_FILL_SEEN_KEY_PREFIX = "deck-viewer-seen-card-info-job:";
// Whether the panel is docked (off-screen) -- persisted so navigating to a
// different page keeps whatever state the user left it in, instead of every
// fresh page load defaulting back to docked.
const AUTO_FILL_DOCKED_KEY = "deck-viewer-auto-fill-docked";

let cardInfoJobsCache = [];

function getCardInfoJob(poolId) {
  return cardInfoJobsCache.find((j) => j.poolId === poolId) || null;
}

function isJobConfirmed(job) {
  if (!job) return true;
  return localStorage.getItem(AUTO_FILL_SEEN_KEY_PREFIX + job.poolId) === job.id;
}

function markJobConfirmed(job) {
  if (job) localStorage.setItem(AUTO_FILL_SEEN_KEY_PREFIX + job.poolId, job.id);
}

function getRunningJob() {
  return cardInfoJobsCache.find((j) => j.status === "running") || null;
}

function getUnconfirmedJob() {
  return (
    cardInfoJobsCache.find((j) => (j.status === "done" || j.status === "error") && !isJobConfirmed(j)) || null
  );
}

function getToastContainer() {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

// A lightweight, auto-dismissing notice (reusing the toast styling) for when
// requestAutoFillPanel() is blocked by another pool's job -- optionally with
// a button that jumps straight to that job's panel.
function showAutoFillBlockedNotice(message, actionLabel, onAction) {
  const container = getToastContainer();
  const toast = document.createElement("div");
  toast.className = "toast";
  const text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(text);
  if (onAction) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action-btn";
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      onAction();
      dismiss();
    });
    toast.appendChild(btn);
  }
  function dismiss() {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(dismiss, 6000);
}

async function pollCardInfoJobs() {
  try {
    const res = await fetch("/api/card-info-jobs");
    if (res.ok) {
      const jobs = await res.json();
      cardInfoJobsCache = jobs;
      syncAutoFillPanelWithServerState();
      document.dispatchEvent(new CustomEvent("card-info-jobs-updated", { detail: jobs }));
    }
  } catch (err) {
    // network hiccup; try again next tick
  }
  // Self-rescheduling rather than a fixed setInterval so the interval itself
  // can change (fast while running, slow otherwise) based on what this poll
  // just observed.
  const delay = getRunningJob() ? CARD_INFO_POLL_INTERVAL_RUNNING : CARD_INFO_POLL_INTERVAL_IDLE;
  setTimeout(pollCardInfoJobs, delay);
}

pollCardInfoJobs();

// ---- Global floating panel ----

const AUTO_FILL_PANEL_HTML = `
  <div class="auto-fill-panel" id="auto-fill-panel" hidden>
    <div class="auto-fill-panel-header" id="auto-fill-panel-header">
      <div class="auto-fill-panel-header-title">
        <span class="auto-fill-status-icon" id="auto-fill-status-icon" hidden></span>
        <h3 id="auto-fill-panel-title">カードの情報を自動取得する</h3>
      </div>
      <div class="auto-fill-panel-header-actions">
        <button type="button" class="icon-btn" id="auto-fill-dock-btn" title="右端に格納" hidden>▸</button>
        <button type="button" class="icon-btn" id="auto-fill-close-btn">✕</button>
      </div>
    </div>
    <div class="auto-fill-panel-body" id="auto-fill-form-view">
      <p class="crop-hint">
        カードプール内の全カードの画像からタイプ・色・必要エナジーを自動で読み取ります。閉じたり他の画面に移動しても処理は続きます。
      </p>
      <p class="crop-hint auto-fill-warning">
        公式の画像を流用していないオリジナルカードの場合、精度が低下する恐れがあります。
      </p>
      <label class="filter-checkbox">
        <input type="checkbox" id="auto-fill-overwrite-checkbox" checked /> 既にある情報を上書きする
      </label>
      <div id="auto-fill-status" class="status-message"></div>
      <div class="auto-fill-actions">
        <button type="button" class="btn primary" id="auto-fill-run-btn">実行</button>
      </div>
    </div>
    <div class="auto-fill-panel-body" id="auto-fill-running-view" hidden>
      <div class="auto-fill-progress" id="auto-fill-progress">
        <div class="auto-fill-progress-track">
          <div class="auto-fill-progress-fill" id="auto-fill-progress-fill"></div>
        </div>
        <span id="auto-fill-progress-label"></span>
        <span id="auto-fill-progress-eta"></span>
      </div>
    </div>
    <div class="auto-fill-panel-body" id="auto-fill-complete-view" hidden>
      <p id="auto-fill-complete-summary" class="status-message"></p>
      <p class="crop-hint" id="auto-fill-uncertain-hint" hidden>以下のカードは自動取得に問題がある可能性があります:</p>
      <div id="auto-fill-uncertain-list" class="auto-fill-uncertain-list"></div>
      <div class="auto-fill-actions">
        <button type="button" class="btn" id="auto-fill-fix-btn">修正する</button>
        <button type="button" class="btn primary" id="auto-fill-done-btn">完了</button>
      </div>
    </div>
  </div>
  <button type="button" class="auto-fill-dock-tab" id="auto-fill-dock-tab" title="カードの情報を自動取得する" hidden>
    <span class="auto-fill-status-icon" id="auto-fill-dock-status-icon" hidden></span>
  </button>
`;

let autoFillPanelEl = null;
let autoFillHeaderEl, autoFillTitleEl, autoFillDockBtn, autoFillCloseBtn, autoFillDockTab;
let autoFillStatusIcon, autoFillDockStatusIcon;
let autoFillFormView, autoFillRunningView, autoFillCompleteView;
let autoFillOverwriteCheckbox, autoFillRunBtn, autoFillStatus;
let autoFillProgress, autoFillProgressFill, autoFillProgressLabel, autoFillProgressEta;
let autoFillCompleteSummary, autoFillUncertainHint, autoFillUncertainList, autoFillFixBtn, autoFillDoneBtn;

let autoFillCurrentPoolId = null;
let autoFillCurrentPoolName = "";
let autoFillMode = "hidden"; // "hidden" | "form" | "running" | "complete"
let autoFillDocked = false;
let autoFillKnownJobId = null; // last job id we've already reacted to, to tell "still the same job" from "newly discovered via poll on a different page"

function setAutoFillStatus(message, kind) {
  autoFillStatus.textContent = message;
  autoFillStatus.className = `status-message ${kind || ""}`;
}

// "Docked" slides the whole panel out past the right edge of the screen
// (rather than collapsing it in place), leaving only a small tab visible at
// the edge to bring it back. Persisted so a page navigation carries over
// whatever dock state the user left it in, rather than every fresh page load
// (which has no in-memory history of its own) defaulting back to docked.
function setAutoFillDocked(docked, persist = true) {
  autoFillDocked = docked;
  autoFillPanelEl.classList.toggle("docked", docked);
  autoFillDockTab.hidden = !docked;
  if (persist) localStorage.setItem(AUTO_FILL_DOCKED_KEY, docked ? "1" : "0");
}

function updateAutoFillTitle() {
  autoFillTitleEl.textContent = autoFillCurrentPoolName || "カードの情報を自動取得する";
}

// Shown next to the pool name (and inside the dock tab, so it stays visible
// while docked too): a spinning ring while a job runs, a checkmark once it's
// done and awaiting confirmation, nothing otherwise.
function setAutoFillStatusIcon(state) {
  for (const el of [autoFillStatusIcon, autoFillDockStatusIcon]) {
    el.hidden = !state;
    el.classList.toggle("spinning", state === "running");
    el.classList.toggle("done", state === "done");
  }
}

function showAutoFillMode(mode) {
  autoFillMode = mode;
  autoFillFormView.hidden = mode !== "form";
  autoFillRunningView.hidden = mode !== "running";
  autoFillCompleteView.hidden = mode !== "complete";
  // No way to dismiss mid-run -- it always finishes; dockable instead so it's
  // less intrusive while staying reachable. The complete view can only be
  // dismissed via the 完了 button (no ✕, no Escape/backdrop-click) so an
  // unconfirmed result can't be lost by an accidental click outside it.
  autoFillCloseBtn.hidden = mode === "running" || mode === "complete";
  autoFillDockBtn.hidden = mode === "form";
  autoFillPanelEl.hidden = mode === "hidden";
  setAutoFillStatusIcon(mode === "running" ? "running" : mode === "complete" ? "done" : null);
  updateAutoFillTitle();
}

function formatAutoFillEta(seconds) {
  if (seconds === null || seconds === undefined) return "";
  if (seconds < 60) return `残り${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `残り${m}分${s}秒`;
}

function updateAutoFillProgress(job) {
  if (!job || !job.progress) return;
  const pct = job.progress.total > 0 ? (job.progress.current / job.progress.total) * 100 : 0;
  autoFillProgressFill.style.width = `${pct}%`;
  autoFillProgressLabel.textContent = `${job.progress.current}/${job.progress.total}`;
  autoFillProgressEta.textContent = formatAutoFillEta(job.etaSeconds);
}

async function populateAutoFillCompleteView() {
  const job = getCardInfoJob(autoFillCurrentPoolId);
  if (job && job.status === "done" && job.summary) {
    autoFillCompleteSummary.textContent = `完了しました(${job.summary.updated}件更新)`;
    autoFillCompleteSummary.className = "status-message success";
  } else if (job && job.status === "error") {
    autoFillCompleteSummary.textContent = `処理に失敗しました: ${job.error || ""}`;
    autoFillCompleteSummary.className = "status-message error";
  } else {
    autoFillCompleteSummary.textContent = "";
    autoFillCompleteSummary.className = "status-message";
  }

  const cards = autoFillCurrentPoolId ? await Api.getCards(autoFillCurrentPoolId) : [];
  const uncertainCards = cards.filter((c) => c.infoUncertain);
  autoFillUncertainHint.hidden = uncertainCards.length === 0;
  autoFillFixBtn.hidden = uncertainCards.length === 0;
  autoFillUncertainList.innerHTML = "";
  for (const card of uncertainCards) {
    const item = document.createElement("div");
    item.className = "auto-fill-uncertain-item";
    const img = document.createElement("img");
    img.src = Api.cardImageUrl(card);
    img.alt = card.name || "";
    img.draggable = false;
    const name = document.createElement("span");
    name.textContent = card.name || "(名称未設定)";
    item.appendChild(img);
    item.appendChild(name);
    autoFillUncertainList.appendChild(item);
  }
}

// Guarded dismissal: Escape/backdrop-click both route through here
// (bindModalDismissal), which would otherwise bypass the ✕ being hidden
// while running/complete -- there's deliberately no way to dismiss either
// except via the 完了 button, which calls forceCloseAutoFillPanel() directly
// instead (an explicit confirm action, not a dismissal attempt to guard against).
function closeAutoFillPanel() {
  if (autoFillMode === "running" || autoFillMode === "complete") return;
  forceCloseAutoFillPanel();
}

function forceCloseAutoFillPanel() {
  autoFillPanelEl.hidden = true;
  // While docked, the panel itself is already off-screen (via CSS
  // transform) and the dock tab is the only thing actually visible to the
  // user -- hiding just the panel left that tab (the real "notice") stuck
  // on screen even after the job was confirmed.
  autoFillPanelEl.classList.remove("docked");
  autoFillDockTab.hidden = true;
  autoFillDocked = false;
  autoFillMode = "hidden";
  setAutoFillStatusIcon(null);
}

// Marks the given pool's job confirmed and, if that job is the one currently
// shown, closes the panel -- shared by the panel's own 完了 button and by
// pool-detail.js finishing the uncertain-card review flow (which counts as
// having reviewed the result too, per the user).
function confirmAutoFillJob(poolId) {
  const job = getCardInfoJob(poolId);
  if (!job) return;
  markJobConfirmed(job);
  if (autoFillPanelEl && autoFillCurrentPoolId === poolId) {
    forceCloseAutoFillPanel();
  }
  document.dispatchEvent(new CustomEvent("card-info-jobs-updated", { detail: cardInfoJobsCache }));
}

function ensureAutoFillPanel() {
  if (autoFillPanelEl) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = AUTO_FILL_PANEL_HTML.trim();
  while (wrapper.firstElementChild) document.body.appendChild(wrapper.firstElementChild);

  autoFillPanelEl = document.getElementById("auto-fill-panel");
  autoFillHeaderEl = document.getElementById("auto-fill-panel-header");
  autoFillTitleEl = document.getElementById("auto-fill-panel-title");
  autoFillDockBtn = document.getElementById("auto-fill-dock-btn");
  autoFillCloseBtn = document.getElementById("auto-fill-close-btn");
  autoFillDockTab = document.getElementById("auto-fill-dock-tab");
  autoFillStatusIcon = document.getElementById("auto-fill-status-icon");
  autoFillDockStatusIcon = document.getElementById("auto-fill-dock-status-icon");
  autoFillFormView = document.getElementById("auto-fill-form-view");
  autoFillRunningView = document.getElementById("auto-fill-running-view");
  autoFillCompleteView = document.getElementById("auto-fill-complete-view");
  autoFillOverwriteCheckbox = document.getElementById("auto-fill-overwrite-checkbox");
  autoFillRunBtn = document.getElementById("auto-fill-run-btn");
  autoFillStatus = document.getElementById("auto-fill-status");
  autoFillProgress = document.getElementById("auto-fill-progress");
  autoFillProgressFill = document.getElementById("auto-fill-progress-fill");
  autoFillProgressLabel = document.getElementById("auto-fill-progress-label");
  autoFillProgressEta = document.getElementById("auto-fill-progress-eta");
  autoFillCompleteSummary = document.getElementById("auto-fill-complete-summary");
  autoFillUncertainHint = document.getElementById("auto-fill-uncertain-hint");
  autoFillUncertainList = document.getElementById("auto-fill-uncertain-list");
  autoFillFixBtn = document.getElementById("auto-fill-fix-btn");
  autoFillDoneBtn = document.getElementById("auto-fill-done-btn");

  autoFillDockBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setAutoFillDocked(true);
  });
  autoFillDockTab.addEventListener("click", () => setAutoFillDocked(false));
  autoFillCloseBtn.addEventListener("click", closeAutoFillPanel);
  bindModalDismissal(autoFillPanelEl, { onCancel: closeAutoFillPanel });

  autoFillRunBtn.addEventListener("click", async () => {
    if (!autoFillCurrentPoolId) return;
    autoFillRunBtn.disabled = true;
    setAutoFillStatus("開始しています...", "");
    try {
      const job = await Api.startAutoFillInfo(autoFillCurrentPoolId, autoFillOverwriteCheckbox.checked);
      autoFillKnownJobId = job.id;
      showAutoFillMode("running");
      updateAutoFillProgress(job);
    } catch (err) {
      setAutoFillStatus(err.message, "error");
    } finally {
      autoFillRunBtn.disabled = false;
    }
  });

  // Full page navigation (rather than calling pool-detail.js's
  // startUncertainReview() directly) because this panel is shared across
  // every page -- if 修正する is clicked from somewhere other than that
  // pool's own detail page, pool-detail.js isn't even loaded. ?review=1
  // tells pool-detail.js to open the same review flow as the ⚠ button once
  // the page (and its card list) has loaded.
  autoFillFixBtn.addEventListener("click", () => {
    if (!autoFillCurrentPoolId) return;
    location.href = `pool-detail.html?id=${encodeURIComponent(autoFillCurrentPoolId)}&review=1`;
  });

  autoFillDoneBtn.addEventListener("click", () => {
    confirmAutoFillJob(autoFillCurrentPoolId);
  });
}

function openAutoFillFor(poolId, poolName) {
  ensureAutoFillPanel();
  autoFillCurrentPoolId = poolId;
  autoFillCurrentPoolName = poolName;
  // Explicitly opening the panel always expands it, regardless of whatever
  // dock state was last persisted.
  setAutoFillDocked(false);

  const job = getCardInfoJob(poolId);
  if (job) autoFillKnownJobId = job.id;

  if (job && job.status === "running") {
    showAutoFillMode("running");
    updateAutoFillProgress(job);
  } else if (job && (job.status === "done" || job.status === "error") && !isJobConfirmed(job)) {
    populateAutoFillCompleteView();
    showAutoFillMode("complete");
  } else {
    autoFillOverwriteCheckbox.checked = false;
    setAutoFillStatus("", "");
    showAutoFillMode("form");
  }
}

// Entry point for pool-detail.js's trigger button. Blocks with a message
// (rather than silently switching pools) if a *different* pool's job is
// running or awaiting confirmation, since only one pool's auto-fill can be
// "in flight" from the user's perspective at a time.
function requestAutoFillPanel(poolId, poolName) {
  const runningJob = getRunningJob();
  if (runningJob && runningJob.poolId !== poolId) {
    showAutoFillBlockedNotice(`他のカードプール(${runningJob.poolName})の処理が進行中です`, null, null);
    return;
  }
  const unconfirmedJob = getUnconfirmedJob();
  if (unconfirmedJob && unconfirmedJob.poolId !== poolId) {
    showAutoFillBlockedNotice(`先に「${unconfirmedJob.poolName}」の結果を確認してください`, "結果を確認する", () => {
      openAutoFillFor(unconfirmedJob.poolId, unconfirmedJob.poolName);
    });
    return;
  }
  openAutoFillFor(poolId, poolName);
}

// Keeps the panel in sync with the server on every poll, so a job started on
// one page (or one browser tab) stays visible while running/awaiting
// confirmation no matter which page is loaded next -- a fresh page load has
// no memory of what was happening before, so this has to be rebuilt purely
// from server state, not client-side continuity.
function syncAutoFillPanelWithServerState() {
  const relevantJob = getRunningJob() || getUnconfirmedJob();

  if (!relevantJob) {
    if (autoFillPanelEl && !autoFillPanelEl.hidden && autoFillMode !== "form") {
      closeAutoFillPanel();
    }
    return;
  }

  ensureAutoFillPanel();
  const isNewlyDiscovered = relevantJob.id !== autoFillKnownJobId;
  autoFillKnownJobId = relevantJob.id;
  autoFillCurrentPoolId = relevantJob.poolId;
  autoFillCurrentPoolName = relevantJob.poolName;
  autoFillPanelEl.hidden = false;

  if (relevantJob.status === "running") {
    if (autoFillMode !== "running") showAutoFillMode("running");
    // A brand-new page load has no memory of whether the panel was left
    // docked or expanded on whatever page started/last touched this job --
    // fall back to the persisted dock state (defaulting to docked, so a job
    // discovered for the first time doesn't barge in expanded on an
    // unrelated page) instead of always forcing docked.
    if (isNewlyDiscovered) setAutoFillDocked(localStorage.getItem(AUTO_FILL_DOCKED_KEY) !== "0", false);
    updateAutoFillProgress(relevantJob);
  } else {
    // The job just finished while this page was actively watching it run
    // (as opposed to a fresh page load landing directly on an
    // already-finished job) -- always surface the result even if it had
    // been docked, since docking while running is routine but staying
    // docked through the actual finish would mean the result silently
    // waits behind the tab until clicked.
    const justFinished = autoFillMode === "running";
    if (autoFillMode !== "complete" || isNewlyDiscovered) {
      populateAutoFillCompleteView();
      showAutoFillMode("complete");
      if (isNewlyDiscovered) setAutoFillDocked(localStorage.getItem(AUTO_FILL_DOCKED_KEY) !== "0", false);
    }
    if (justFinished) setAutoFillDocked(false);
  }
  updateAutoFillTitle();
}
