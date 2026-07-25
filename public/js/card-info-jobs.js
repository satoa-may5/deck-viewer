// Shared, site-wide auto-fill-info job tracking + floating panel UI. Loaded
// on every page (not just pool-detail.html, which is the only page with the
// trigger button) because a running or awaiting-confirmation job has to stay
// visible in the corner no matter what screen the user navigates to, and
// only one pool's job can be "in flight" from the user's perspective at a
// time -- trying to start a different pool's job while one is running or
// unconfirmed surfaces a message instead of silently doing nothing.

const CARD_INFO_POLL_INTERVAL = 4000;
const AUTO_FILL_SEEN_KEY_PREFIX = "deck-viewer-seen-card-info-job:";

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
  let jobs;
  try {
    const res = await fetch("/api/card-info-jobs");
    if (!res.ok) return;
    jobs = await res.json();
  } catch (err) {
    return; // network hiccup; try again next tick
  }
  cardInfoJobsCache = jobs;
  syncAutoFillPanelWithServerState();
  document.dispatchEvent(new CustomEvent("card-info-jobs-updated", { detail: jobs }));
}

pollCardInfoJobs();
setInterval(pollCardInfoJobs, CARD_INFO_POLL_INTERVAL);

// ---- Global floating panel ----

const AUTO_FILL_PANEL_HTML = `
  <div class="auto-fill-panel" id="auto-fill-panel" hidden>
    <div class="auto-fill-panel-header" id="auto-fill-panel-header">
      <h3 id="auto-fill-panel-title">カードの情報を自動取得する</h3>
      <div class="auto-fill-panel-header-actions">
        <button type="button" class="icon-btn" id="auto-fill-fold-btn" title="折りたたむ" hidden>▾</button>
        <button type="button" class="icon-btn" id="auto-fill-close-btn">✕</button>
      </div>
    </div>
    <div class="auto-fill-panel-body" id="auto-fill-form-view">
      <p class="crop-hint">
        カードプール内の全カードの画像からタイプ・色・必要エナジーを自動で読み取ります。閉じたり他の画面に移動しても処理は続きます。
      </p>
      <label class="filter-checkbox">
        <input type="checkbox" id="auto-fill-overwrite-checkbox" /> 既にある情報を上書きする
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
      </div>
    </div>
    <div class="auto-fill-panel-body" id="auto-fill-complete-view" hidden>
      <p id="auto-fill-complete-summary" class="status-message"></p>
      <p class="crop-hint" id="auto-fill-uncertain-hint" hidden>以下のカードは自動取得に問題がある可能性があります:</p>
      <div id="auto-fill-uncertain-list" class="auto-fill-uncertain-list"></div>
      <div class="auto-fill-actions">
        <button type="button" class="btn" id="auto-fill-rerun-btn">再度実行する</button>
        <button type="button" class="btn primary" id="auto-fill-done-btn">完了</button>
      </div>
    </div>
  </div>
`;

let autoFillPanelEl = null;
let autoFillHeaderEl, autoFillTitleEl, autoFillFoldBtn, autoFillCloseBtn;
let autoFillFormView, autoFillRunningView, autoFillCompleteView;
let autoFillOverwriteCheckbox, autoFillRunBtn, autoFillStatus;
let autoFillProgress, autoFillProgressFill, autoFillProgressLabel;
let autoFillCompleteSummary, autoFillUncertainHint, autoFillUncertainList, autoFillRerunBtn, autoFillDoneBtn;

let autoFillCurrentPoolId = null;
let autoFillCurrentPoolName = "";
let autoFillMode = "hidden"; // "hidden" | "form" | "running" | "complete"
let autoFillCollapsed = false;
let autoFillKnownJobId = null; // last job id we've already reacted to, to tell "still the same job" from "newly discovered via poll on a different page"

function setAutoFillStatus(message, kind) {
  autoFillStatus.textContent = message;
  autoFillStatus.className = `status-message ${kind || ""}`;
}

function setAutoFillCollapsed(collapsed) {
  autoFillCollapsed = collapsed;
  autoFillPanelEl.classList.toggle("collapsed", collapsed);
  autoFillFoldBtn.textContent = collapsed ? "▸" : "▾";
}

function updateAutoFillTitle() {
  if (autoFillMode === "running") {
    autoFillTitleEl.textContent = `${autoFillCurrentPoolName}: 実行中...`;
  } else if (autoFillMode === "complete") {
    autoFillTitleEl.textContent = `${autoFillCurrentPoolName}: 完了しました`;
  } else {
    autoFillTitleEl.textContent = "カードの情報を自動取得する";
  }
}

function showAutoFillMode(mode) {
  autoFillMode = mode;
  autoFillFormView.hidden = mode !== "form";
  autoFillRunningView.hidden = mode !== "running";
  autoFillCompleteView.hidden = mode !== "complete";
  // No way to dismiss mid-run -- it always finishes; foldable instead so it's
  // less intrusive while staying visible. The form is a one-off dialog (✕
  // closes it outright), and the complete view can still be closed without
  // confirming via ✕ (button state stays "unconfirmed" until 完了 is clicked).
  autoFillCloseBtn.hidden = mode === "running";
  autoFillFoldBtn.hidden = mode === "form";
  autoFillPanelEl.hidden = mode === "hidden";
  updateAutoFillTitle();
}

function updateAutoFillProgress(job) {
  if (!job || !job.progress) return;
  const pct = job.progress.total > 0 ? (job.progress.current / job.progress.total) * 100 : 0;
  autoFillProgressFill.style.width = `${pct}%`;
  autoFillProgressLabel.textContent = `${job.progress.current}/${job.progress.total}`;
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

function closeAutoFillPanel() {
  // Escape/backdrop-click both route through here too (bindModalDismissal),
  // which would otherwise bypass the close button being hidden while
  // running -- there's deliberately no way to dismiss mid-run.
  if (autoFillMode === "running") return;
  autoFillPanelEl.hidden = true;
  autoFillMode = "hidden";
}

function ensureAutoFillPanel() {
  if (autoFillPanelEl) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = AUTO_FILL_PANEL_HTML.trim();
  document.body.appendChild(wrapper.firstElementChild);

  autoFillPanelEl = document.getElementById("auto-fill-panel");
  autoFillHeaderEl = document.getElementById("auto-fill-panel-header");
  autoFillTitleEl = document.getElementById("auto-fill-panel-title");
  autoFillFoldBtn = document.getElementById("auto-fill-fold-btn");
  autoFillCloseBtn = document.getElementById("auto-fill-close-btn");
  autoFillFormView = document.getElementById("auto-fill-form-view");
  autoFillRunningView = document.getElementById("auto-fill-running-view");
  autoFillCompleteView = document.getElementById("auto-fill-complete-view");
  autoFillOverwriteCheckbox = document.getElementById("auto-fill-overwrite-checkbox");
  autoFillRunBtn = document.getElementById("auto-fill-run-btn");
  autoFillStatus = document.getElementById("auto-fill-status");
  autoFillProgress = document.getElementById("auto-fill-progress");
  autoFillProgressFill = document.getElementById("auto-fill-progress-fill");
  autoFillProgressLabel = document.getElementById("auto-fill-progress-label");
  autoFillCompleteSummary = document.getElementById("auto-fill-complete-summary");
  autoFillUncertainHint = document.getElementById("auto-fill-uncertain-hint");
  autoFillUncertainList = document.getElementById("auto-fill-uncertain-list");
  autoFillRerunBtn = document.getElementById("auto-fill-rerun-btn");
  autoFillDoneBtn = document.getElementById("auto-fill-done-btn");

  autoFillFoldBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setAutoFillCollapsed(!autoFillCollapsed);
  });
  autoFillHeaderEl.addEventListener("click", (e) => {
    if (e.target === autoFillFoldBtn || e.target === autoFillCloseBtn) return;
    if (autoFillCollapsed) setAutoFillCollapsed(false);
  });
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

  autoFillRerunBtn.addEventListener("click", () => {
    autoFillOverwriteCheckbox.checked = false;
    setAutoFillStatus("", "");
    showAutoFillMode("form");
  });

  autoFillDoneBtn.addEventListener("click", () => {
    markJobConfirmed(getCardInfoJob(autoFillCurrentPoolId));
    closeAutoFillPanel();
    document.dispatchEvent(new CustomEvent("card-info-jobs-updated", { detail: cardInfoJobsCache }));
  });
}

function openAutoFillFor(poolId, poolName) {
  ensureAutoFillPanel();
  autoFillCurrentPoolId = poolId;
  autoFillCurrentPoolName = poolName;
  setAutoFillCollapsed(false);

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
    if (isNewlyDiscovered) setAutoFillCollapsed(true); // don't barge in expanded on an unrelated page
    updateAutoFillProgress(relevantJob);
  } else {
    if (autoFillMode !== "complete" || isNewlyDiscovered) {
      populateAutoFillCompleteView();
      showAutoFillMode("complete");
      if (isNewlyDiscovered) setAutoFillCollapsed(true);
    }
  }
  updateAutoFillTitle();
}
