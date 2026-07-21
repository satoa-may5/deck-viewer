const OUTPUT_W = 630;
const OUTPUT_H = 880;

const stepPool = document.getElementById("step-pool");
const poolChip = document.getElementById("pool-chip");
const poolChipName = document.getElementById("pool-chip-name");
const poolSelect = document.getElementById("pool-select");
const stepSelect = document.getElementById("step-select");
const stepCrop = document.getElementById("step-crop");
const metaForm = document.getElementById("meta-form");
const fileInput = document.getElementById("file-input");
const statusEl = document.getElementById("status");

let cropTool = null;
let croppedBlob = null;
let pools = [];
let selectedPoolId = null;

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status-message ${kind || ""}`;
}

function showStep(step) {
  stepPool.hidden = step !== "pool";
  poolChip.hidden = step === "pool";
  stepSelect.hidden = step !== "select";
  stepCrop.hidden = step !== "crop";
  metaForm.hidden = step !== "meta";
}

function renderPoolOptions() {
  poolSelect.innerHTML = "";
  if (pools.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(カードプールがありません。下で作成してください)";
    poolSelect.appendChild(opt);
    return;
  }
  for (const pool of pools) {
    const opt = document.createElement("option");
    opt.value = pool.id;
    opt.textContent = `${pool.name} (${pool.cardCount}枚)`;
    poolSelect.appendChild(opt);
  }
}

async function loadPools(preferId) {
  pools = await Api.getPools();
  renderPoolOptions();
  if (pools.length > 0) {
    poolSelect.value = preferId && pools.some((p) => p.id === preferId) ? preferId : pools[0].id;
  }
}

document.getElementById("create-pool-btn").addEventListener("click", async () => {
  const nameInput = document.getElementById("new-pool-name");
  const name = nameInput.value.trim();
  if (!name) return;
  try {
    const pool = await Api.createPool(name);
    nameInput.value = "";
    await loadPools(pool.id);
  } catch (err) {
    setStatus(err.message, "error");
  }
});

poolSelect.addEventListener("change", () => {
  selectedPoolId = poolSelect.value || null;
});

document.getElementById("change-pool-btn").addEventListener("click", () => {
  showStep("pool");
});

function confirmPoolSelection() {
  selectedPoolId = poolSelect.value || null;
  if (!selectedPoolId) {
    setStatus("カードプールを選択または作成してください", "error");
    return;
  }
  const pool = pools.find((p) => p.id === selectedPoolId);
  poolChipName.textContent = pool ? pool.name : selectedPoolId;
  setStatus("", "");
  showStep("select");
}

document.getElementById("confirm-pool-btn").addEventListener("click", confirmPoolSelection);

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  showStep("crop");
  cropTool = new CropTool(document.getElementById("crop-stage"));
  await cropTool.loadFile(file);
});

document.getElementById("retry-crop-btn").addEventListener("click", () => {
  fileInput.value = "";
  showStep("select");
});

document.getElementById("confirm-crop-btn").addEventListener("click", async () => {
  croppedBlob = await cropTool.toBlob(OUTPUT_W, OUTPUT_H);
  const preview = document.getElementById("crop-preview");
  preview.innerHTML = "";
  const img = document.createElement("img");
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "cover";
  img.src = URL.createObjectURL(croppedBlob);
  preview.appendChild(img);
  showStep("meta");
});

metaForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("card-id").value.trim();
  const name = document.getElementById("card-name").value.trim();
  const cost = document.getElementById("card-cost").value;

  setStatus("保存中...", "");
  try {
    await Api.addCard({ id, name, cost, poolId: selectedPoolId, imageBlob: croppedBlob });
    await loadPools(selectedPoolId);
    const pool = pools.find((p) => p.id === selectedPoolId);
    if (pool) poolChipName.textContent = pool.name;
    setStatus(`「${name}」を登録しました。続けて追加できます。`, "success");
    metaForm.reset();
    croppedBlob = null;
    fileInput.value = "";
    showStep("select");
  } catch (err) {
    setStatus(err.message, "error");
  }
});

async function init() {
  await loadPools();
  showStep("pool");
}

init();
