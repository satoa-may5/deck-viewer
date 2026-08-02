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
    img.alt = card.cardName || card.name;
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
    // The flush border lives on the frame (tight fit around the card
    // image); the small protruding banner lives on the item instead, since
    // the frame clips to its own rounded corners for the card image, which
    // would also clip the banner where it's meant to peek out above the
    // card's own top edge.
    frame.classList.add("is-thumbnail");
    item.classList.add("is-thumbnail");
    item.title = "デッキのサムネイル";
  }

  const caption = document.createElement("div");
  caption.className = "card-caption";
  caption.textContent = card ? card.cardName || card.name || "(名称未設定)" : id;

  item.appendChild(frame);
  item.appendChild(caption);
  return item;
}
