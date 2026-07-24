// card: { id, name, cost, imageExt } | null (null = referenced but not found in collection)
// count: number | null (null = no badge shown, used in the collection picker)
// thumbnail: optional { active, onToggle } — when given, renders a small star
// button on the card for marking it as the deck's thumbnail (used only in the
// builder's deck pane, not the collection picker)
function createCardElement(card, id, count, thumbnail) {
  const item = document.createElement("div");
  item.className = "card-item";
  item.dataset.cardId = id;

  const frame = document.createElement("div");
  frame.className = "card-frame";

  if (card && card.imageExt) {
    const img = document.createElement("img");
    img.src = Api.cardImageUrl(card);
    img.alt = card.name;
    img.draggable = false;
    img.addEventListener("error", () => {
      img.remove();
      frame.classList.add("missing");
      frame.appendChild(document.createTextNode(id));
    });
    frame.appendChild(img);
  } else {
    frame.classList.add("missing");
    frame.textContent = id;
  }

  if (count !== null && count !== undefined) {
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = count;
    frame.appendChild(badge);
  }

  if (thumbnail) {
    const thumbnailBtn = document.createElement("button");
    thumbnailBtn.type = "button";
    thumbnailBtn.className = "grid-thumbnail-btn";
    thumbnailBtn.classList.toggle("active", !!thumbnail.active);
    thumbnailBtn.title = "デッキのサムネイルに設定";
    thumbnailBtn.textContent = "★";
    thumbnailBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    thumbnailBtn.addEventListener("pointerup", (e) => e.stopPropagation());
    thumbnailBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      thumbnail.onToggle();
    });
    frame.appendChild(thumbnailBtn);
  }

  const caption = document.createElement("div");
  caption.className = "card-caption";
  const label = card ? card.name || "(名称未設定)" : id;
  const cost = card && card.cost !== null && card.cost !== undefined ? ` (${card.cost})` : "";
  caption.textContent = label + cost;

  item.appendChild(frame);
  item.appendChild(caption);
  return item;
}
