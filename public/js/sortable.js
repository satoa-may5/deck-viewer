// Pointer-based drag reorder. Attach a handle element inside each item (defaults to
// `.drag-handle`, but any selector works — e.g. the card image itself in grid view);
// dragging swaps DOM order live and reports the final id order (via item.dataset.id)
// on drop.
//
// A small movement threshold gates when a pointerdown actually becomes a drag. This
// matters when the handle is also a normal click target (grid view opens the edit
// modal on click) — without the threshold, every click would be swallowed as a
// zero-distance drag.
//
// axis: "y" (default) clamps the dragged item to stay within the list's vertical
// bounds and locks horizontal position, matching a single-column list.
// axis: "grid" allows free 2D movement (no clamping) and matches the nearest item
// by 2D center distance, for a wrapping multi-column grid.
//
// The dragged item's on-screen position is tracked as a "virtual" position that
// accumulates the pointer's movement continuously from drag start, independent of
// where the item currently sits in the DOM. This matters once a swap has happened:
// re-deriving the target position from the DOM's new (just-swapped) layout instead
// would make continued movement in the same direction spuriously swap back to the
// previous slot, since with few siblings the "other" item is always the nearest one
// regardless of how far the pointer has actually travelled.
//
// Sibling positions are read via offsetLeft/offsetTop/offsetWidth/offsetHeight
// (layout properties) rather than getBoundingClientRect, because
// getBoundingClientRect reflects the CSS transform used for the FLIP animation
// below — reading it while a sibling's displacement animation is still settling
// returns a stale/transitional position and can make the swap threshold flicker
// back and forth.
function animateDisplacement(el, deltaX, deltaY) {
  if (!deltaX && !deltaY) return;
  el.style.transition = "none";
  el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
  el.getBoundingClientRect();
  requestAnimationFrame(() => {
    el.style.transition = "";
    el.style.transform = "";
  });
}

function makeSortable(container, { itemSelector, handleSelector = ".drag-handle", onReorder, axis = "y" }) {
  const DRAG_THRESHOLD = 6;

  container.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle || !container.contains(handle)) return;
    const dragEl = handle.closest(itemSelector);
    if (!dragEl) return;

    const pointerId = e.pointerId;
    const downX = e.clientX;
    const downY = e.clientY;
    let dragging = false;

    let items, dragWidth, dragHeight, virtualLeft, virtualTop, lastX, lastY;

    function beginDrag() {
      dragging = true;
      items = [...container.querySelectorAll(itemSelector)];
      dragWidth = dragEl.offsetWidth;
      dragHeight = dragEl.offsetHeight;
      virtualLeft = dragEl.offsetLeft;
      virtualTop = dragEl.offsetTop;
      lastX = downX;
      lastY = downY;
      dragEl.classList.add("dragging");
      dragEl.style.position = "relative";
      dragEl.style.zIndex = "50";
      try {
        handle.setPointerCapture(pointerId);
      } catch (err) {
        // ignore — capture is best-effort
      }
    }

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;

      if (!dragging) {
        if (Math.hypot(ev.clientX - downX, ev.clientY - downY) < DRAG_THRESHOLD) return;
        beginDrag();
      }

      ev.preventDefault();

      virtualLeft += ev.clientX - lastX;
      virtualTop += ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;

      if (axis === "y") {
        const minTop = items[0].offsetTop;
        const lastItem = items[items.length - 1];
        const maxTop = lastItem.offsetTop + lastItem.offsetHeight - dragHeight;
        virtualTop = Math.min(Math.max(virtualTop, minTop), maxTop);
        virtualLeft = dragEl.offsetLeft;
      }

      const applyTransform = () => {
        dragEl.style.transform = `translate(${virtualLeft - dragEl.offsetLeft}px, ${virtualTop - dragEl.offsetTop}px)`;
      };
      applyTransform();

      const dragCenterX = virtualLeft + dragWidth / 2;
      const dragCenterY = virtualTop + dragHeight / 2;
      const dragIndex = items.indexOf(dragEl);

      // A sibling only qualifies as a swap target once the drag center has moved
      // strictly closer to it than to the dragged item's own current slot — i.e.
      // past the midpoint between the two. Comparing against every other sibling
      // this way (rather than always picking whichever sibling happens to be
      // nearest) is what stops a long drag from swapping back and forth: once
      // swapped, "own slot" becomes the new position, so continuing to move away
      // from the other sibling never looks like progress toward it.
      const dragNaturalCenterX = dragEl.offsetLeft + dragWidth / 2;
      const dragNaturalCenterY = dragEl.offsetTop + dragHeight / 2;
      let closest = null;
      let closestDist = Math.hypot(dragNaturalCenterX - dragCenterX, dragNaturalCenterY - dragCenterY);
      for (const sibling of items) {
        if (sibling === dragEl) continue;
        const cx = sibling.offsetLeft + sibling.offsetWidth / 2;
        const cy = sibling.offsetTop + sibling.offsetHeight / 2;
        const dist = Math.hypot(cx - dragCenterX, cy - dragCenterY);
        if (dist < closestDist) {
          closestDist = dist;
          closest = sibling;
        }
      }

      if (closest) {
        const closestIndex = items.indexOf(closest);
        const beforeLeft = closest.offsetLeft;
        const beforeTop = closest.offsetTop;
        if (closestIndex < dragIndex) {
          container.insertBefore(dragEl, closest);
        } else {
          container.insertBefore(dragEl, closest.nextSibling);
        }
        animateDisplacement(closest, beforeLeft - closest.offsetLeft, beforeTop - closest.offsetTop);
        items = [...container.querySelectorAll(itemSelector)];
        applyTransform();
      }
    };

    const onUp = (ev) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!dragging) return;

      try {
        handle.releasePointerCapture(pointerId);
      } catch (err) {
        // capture may already have been implicitly released by the browser
      }
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
