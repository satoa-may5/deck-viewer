// card: { id, name, cost, imageExt } | null (null = referenced but not found in collection)
// count: number | null (null = no badge shown, used in the collection picker)
// opts: optional { isThumbnail } — when true, renders a small non-interactive
// marker showing this card is the deck's current thumbnail (set via the
// "サムネイルを設定" selection mode, not by clicking the marker itself)
function createCardElement(card, id, count, opts) {
  const item = document.createElement("div");
  item.className = "card-item";
  item.dataset.id = id;

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

  if (opts && opts.isThumbnail) {
    frame.classList.add("is-thumbnail");
    frame.title = "デッキのサムネイル";
  }

  const caption = document.createElement("div");
  caption.className = "card-caption";
  caption.textContent = card ? card.name || "(名称未設定)" : id;

  item.appendChild(frame);
  item.appendChild(caption);
  return item;
}
