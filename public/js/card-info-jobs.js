// Shared, site-wide polling for the card-info auto-detection background jobs
// (see server.js's /api/card-info-jobs). Included on every page so a toast can
// appear no matter what screen the user is looking at when a job finishes,
// independent of whether pool-detail.js (which renders the actual trigger
// button/modal) is loaded on the current page.

const CARD_INFO_POLL_INTERVAL = 4000;
let cardInfoJobsCache = [];

function getCardInfoJob(poolId) {
  return cardInfoJobsCache.find((j) => j.poolId === poolId) || null;
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

function showCardInfoToast(job) {
  const container = getToastContainer();
  const toast = document.createElement("div");
  toast.className = "toast" + (job.status === "error" ? " toast-error" : "");
  toast.textContent =
    job.status === "error"
      ? `カードプール「${job.poolName}」の処理に失敗しました: ${job.error || ""}`
      : `カードプール「${job.poolName}」の処理が完了しました`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 5000);
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
  for (const job of jobs) {
    if ((job.status === "done" || job.status === "error") && !job.notified) {
      showCardInfoToast(job);
      job.notified = true; // avoid a second toast before the ack round-trip lands
      fetch(`/api/card-info-jobs/${encodeURIComponent(job.id)}/ack`, { method: "POST" }).catch(() => {});
    }
  }
  document.dispatchEvent(new CustomEvent("card-info-jobs-updated", { detail: jobs }));
}

pollCardInfoJobs();
setInterval(pollCardInfoJobs, CARD_INFO_POLL_INTERVAL);
