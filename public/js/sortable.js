// Pointer-based drag reorder. Attach a `.drag-handle` inside each item; dragging
// swaps DOM order live and reports the final id order (via item.dataset.id) on drop.
function makeSortable(container, { itemSelector, handleSelector = ".drag-handle", onReorder }) {
  container.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle || !container.contains(handle)) return;
    const dragEl = handle.closest(itemSelector);
    if (!dragEl) return;

    e.preventDefault();
    let items = [...container.querySelectorAll(itemSelector)];
    let startClientY = e.clientY;

    dragEl.classList.add("dragging");
    dragEl.style.position = "relative";
    dragEl.style.zIndex = "50";
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const deltaY = ev.clientY - startClientY;
      dragEl.style.transform = `translateY(${deltaY}px)`;

      const dragRect = dragEl.getBoundingClientRect();
      const dragMid = dragRect.top + dragRect.height / 2;
      const dragIndex = items.indexOf(dragEl);

      for (let i = 0; i < items.length; i++) {
        const sibling = items[i];
        if (sibling === dragEl) continue;
        const rect = sibling.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;

        if (i < dragIndex && dragMid < mid) {
          container.insertBefore(dragEl, sibling);
          items = [...container.querySelectorAll(itemSelector)];
          startClientY = ev.clientY;
          dragEl.style.transform = "translateY(0px)";
          break;
        } else if (i > dragIndex && dragMid > mid) {
          container.insertBefore(dragEl, sibling.nextSibling);
          items = [...container.querySelectorAll(itemSelector)];
          startClientY = ev.clientY;
          dragEl.style.transform = "translateY(0px)";
          break;
        }
      }
    };

    const onUp = (ev) => {
      handle.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragEl.classList.remove("dragging");
      dragEl.style.transform = "";
      dragEl.style.position = "";
      dragEl.style.zIndex = "";
      const order = [...container.querySelectorAll(itemSelector)].map((el) => el.dataset.id);
      onReorder(order);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}
