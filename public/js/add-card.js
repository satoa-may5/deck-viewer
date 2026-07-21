const OUTPUT_W = 630;
const OUTPUT_H = 880;

const stepSelect = document.getElementById("step-select");
const stepCrop = document.getElementById("step-crop");
const metaForm = document.getElementById("meta-form");
const fileInput = document.getElementById("file-input");
const statusEl = document.getElementById("status");

let cropTool = null;
let croppedBlob = null;

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status-message ${kind || ""}`;
}

function showStep(step) {
  stepSelect.hidden = step !== "select";
  stepCrop.hidden = step !== "crop";
  metaForm.hidden = step !== "meta";
}

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
    await Api.addCard({ id, name, cost, imageBlob: croppedBlob });
    setStatus(`「${name}」を登録しました。続けて追加できます。`, "success");
    metaForm.reset();
    croppedBlob = null;
    fileInput.value = "";
    showStep("select");
  } catch (err) {
    setStatus(err.message, "error");
  }
});
