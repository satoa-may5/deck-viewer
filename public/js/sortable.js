// Pointer-based drag reorder. Attach a `.drag-handle` inside each item; dragging
// swaps DOM order live and reports the final id order (via item.dataset.id) on drop.
// The dragged item is clamped so it can't be pulled above the first item or below
// the last item in the list. Displaced siblings slide into their new slot via a
// FLIP-style animation (the dragged item itself is excluded; it's already animating
// under the pointer).
//
// Sibling positions are read via offsetTop/offsetHeight (layout properties) rather
// than getBoundingClientRect, because getBoundingClientRect reflects the CSS
// transform used for the FLIP animation below — reading it while a sibling's
// displacement animation is still settling returns a stale/transitional position
// and can make the swap threshold flicker back and forth.
function animateDisplacement(el, deltaY) {
  if (!deltaY) return;
  el.style.transition = "none";
  el.style.transform = `translateY(${deltaY}px)`;
  el.getBoundingClientRect();
  requestAnimationFrame(() => {
    el.style.transition = "";
    el.style.transform = "";
  });
}

function makeSortable(container, { itemSelector, handleSelector = ".drag-handle", onReorder }) {
  container.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle || !container.contains(handle)) return;
    const dragEl = handle.closest(itemSelector);
    if (!dragEl) return;

    e.preventDefault();
    let items = [...container.querySelectorAll(itemSelector)];
    let startClientY = e.clientY;

    const dragHeight = dragEl.offsetHeight;
    const minTop = items[0].offsetTop;
    const lastItem = items[items.length - 1];
    const maxTop = lastItem.offsetTop + lastItem.offsetHeight - dragHeight;
    let naturalTop = dragEl.offsetTop;

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
        const mid = sibling.offsetTop + sibling.offsetHeight / 2;

        if (i < dragIndex && dragMid <= mid) {
          const beforeTop = sibling.offsetTop;
          container.insertBefore(dragEl, sibling);
          animateDisplacement(sibling, beforeTop - sibling.offsetTop);
          items = [...container.querySelectorAll(itemSelector)];
          dragEl.style.transform = "translateY(0px)";
          naturalTop = dragEl.offsetTop;
          startClientY = ev.clientY;
          break;
        } else if (i > dragIndex && dragMid >= mid) {
          const beforeTop = sibling.offsetTop;
          container.insertBefore(dragEl, sibling.nextSibling);
          animateDisplacement(sibling, beforeTop - sibling.offsetTop);
          items = [...container.querySelectorAll(itemSelector)];
          dragEl.style.transform = "translateY(0px)";
          naturalTop = dragEl.offsetTop;
          startClientY = ev.clientY;
          break;
        }
      }
    };

    const onUp = (ev) => {
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch (err) {
        // capture may already have been implicitly released by the browser
      }
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
