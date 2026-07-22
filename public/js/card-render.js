// card: { id, name, cost, imageExt } | null (null = referenced but not found in collection)
// count: number | null (null = no badge shown, used in the collection picker)
function createCardElement(card, id, count) {
  const item = document.createElement("div");
  item.className = "card-item";
  item.dataset.cardId = id;

  const frame = document.createElement("div");
  frame.className = "card-frame";

  if (card && card.imageExt) {
    const img = document.createElement("img");
    img.src = Api.cardImageUrl(card);
    img.alt = card.name;
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

  const caption = document.createElement("div");
  caption.className = "card-caption";
  const label = card ? card.name || "(名称未設定)" : id;
  const cost = card && card.cost !== null && card.cost !== undefined ? ` (${card.cost})` : "";
  caption.textContent = label + cost;

  item.appendChild(frame);
  item.appendChild(caption);
  return item;
}
