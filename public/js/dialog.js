// Shared popup behavior for the whole app: every modal/dialog follows the same
// interaction contract — Enter triggers the primary action, Escape cancels,
// and clicking the dimmed backdrop outside the card cancels. This file provides
// two things:
//
// 1. showConfirm(message, opts) — a custom replacement for the browser's
//    native confirm(), built from the same .modal-overlay/.modal-card markup
//    used elsewhere so it looks consistent with the rest of the app.
// 2. bindModalDismissal(overlay, { onCancel, onConfirm }) — wires the same
//    Enter/Escape/click-outside contract onto an existing modal overlay
//    element that's already in the page's HTML (add-card modal, crop popup,
//    import modal, etc).
//
// Only the topmost currently-visible bound modal reacts to a given keypress,
// so a nested popup (e.g. the crop popup opened on top of the add-card modal)
// doesn't also close the one underneath it.

function showConfirm(
  message,
  { confirmText = "削除する", cancelText = "キャンセル", danger = true, checkboxLabel, checkboxDefault = false } = {}
) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay confirm-overlay";

    const card = document.createElement("div");
    card.className = "modal-card confirm-card";

    const messageEl = document.createElement("p");
    messageEl.className = "confirm-message";
    messageEl.textContent = message;

    let checkboxInput = null;

    const actions = document.createElement("div");
    actions.className = "nav-links confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = cancelText;

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = danger ? "btn danger" : "btn primary";
    confirmBtn.textContent = confirmText;

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    card.appendChild(messageEl);
    if (checkboxLabel) {
      const checkboxWrap = document.createElement("label");
      checkboxWrap.className = "filter-checkbox confirm-checkbox";
      checkboxInput = document.createElement("input");
      checkboxInput.type = "checkbox";
      checkboxInput.checked = checkboxDefault;
      checkboxWrap.appendChild(checkboxInput);
      checkboxWrap.appendChild(document.createTextNode(checkboxLabel));
      card.appendChild(checkboxWrap);
    }
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function finish(result) {
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      resolve(checkboxLabel ? { confirmed: result, checked: checkboxInput.checked } : result);
    }

    function onKeydown(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
    cancelBtn.addEventListener("click", () => finish(false));
    confirmBtn.addEventListener("click", () => finish(true));

    // capture: true so an in-flight showConfirm() always wins over any
    // page-level bindModalDismissal() listener for the same keypress.
    document.addEventListener("keydown", onKeydown, true);
    confirmBtn.focus();
  });
}

const _modalRegistry = [];

function bindModalDismissal(overlay, { onCancel, onConfirm } = {}) {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && onCancel) onCancel();
  });
  _modalRegistry.push({ overlay, onCancel, onConfirm });
}

document.addEventListener("keydown", (e) => {
  let top = null;
  for (let i = _modalRegistry.length - 1; i >= 0; i--) {
    if (!_modalRegistry[i].overlay.hidden) {
      top = _modalRegistry[i];
      break;
    }
  }
  if (!top) return;

  if (e.key === "Escape" && top.onCancel) {
    e.preventDefault();
    top.onCancel();
  } else if (e.key === "Enter" && top.onConfirm) {
    const tag = e.target.tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
    top.onConfirm();
  }
});
