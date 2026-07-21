// Pointer-based drag reorder. Attach a `.drag-handle` inside each item; dragging
// swaps DOM order live and reports the final id order (via item.dataset.id) on drop.
// The dragged item is clamped so it can't be pulled above the first item or below
// the last item in the list.
function makeSortable(container, { itemSelector, handleSelector = ".drag-handle", onReorder }) {
  container.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle || !container.contains(handle)) return;
    const dragEl = handle.closest(itemSelector);
    if (!dragEl) return;

    e.preventDefault();
    let items = [...container.querySelectorAll(itemSelector)];
    let startClientY = e.clientY;

    const containerRect = container.getBoundingClientRect();
    const dragHeight = dragEl.getBoundingClientRect().height;
    const minTop = containerRect.top;
    const maxTop = containerRect.bottom - dragHeight;
    let naturalTop = dragEl.getBoundingClientRect().top;

    dragEl.classList.add("dragging");
    dragEl.style.position = "relative";
    dragEl.style.zIndex = "50";
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const targetTop = naturalTop + (ev.clientY - startClientY);
      const clampedTop = Math.min(Math.max(targetTop, minTop), maxTop);
      const deltaY = clampedTop - naturalTop;
      dragEl.style.transform = `translateY(${deltaY}px)`;

      const dragMid = clampedTop + dragHeight / 2;
      const dragIndex = items.indexOf(dragEl);

      for (let i = 0; i < items.length; i++) {
        const sibling = items[i];
        if (sibling === dragEl) continue;
        const rect = sibling.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;

        if (i < dragIndex && dragMid <= mid) {
          container.insertBefore(dragEl, sibling);
          items = [...container.querySelectorAll(itemSelector)];
          dragEl.style.transform = "translateY(0px)";
          naturalTop = dragEl.getBoundingClientRect().top;
          startClientY = ev.clientY;
          break;
        } else if (i > dragIndex && dragMid >= mid) {
          container.insertBefore(dragEl, sibling.nextSibling);
          items = [...container.querySelectorAll(itemSelector)];
          dragEl.style.transform = "translateY(0px)";
          naturalTop = dragEl.getBoundingClientRect().top;
          startClientY = ev.clientY;
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
