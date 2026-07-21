// DECK は decks/*.js 側で定義されたグローバル変数(script タグの読み込み順に依存)
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

function buildCardElement(card) {
  const item = document.createElement("div");
  item.className = "card-item";

  const frame = document.createElement("div");
  frame.className = "card-frame";

  const img = document.createElement("img");
  img.alt = card.id;
  let extIndex = 0;

  const tryNextExtension = () => {
    if (extIndex >= IMAGE_EXTENSIONS.length) {
      frame.classList.add("missing");
      img.remove();
      const placeholderLabel = document.createElement("span");
      placeholderLabel.textContent = card.id;
      frame.appendChild(placeholderLabel);
      return;
    }
    img.src = `images/${card.id}.${IMAGE_EXTENSIONS[extIndex]}`;
    extIndex += 1;
  };

  img.addEventListener("error", tryNextExtension);
  tryNextExtension();
  frame.appendChild(img);

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = card.count;
  frame.appendChild(badge);

  const idLabel = document.createElement("div");
  idLabel.className = "card-id";
  idLabel.textContent = card.id;

  item.appendChild(frame);
  item.appendChild(idLabel);
  return item;
}

function render() {
  const grid = document.getElementById("grid");
  const meta = document.getElementById("deck-meta");

  if (typeof DECK === "undefined") {
    meta.textContent = "デッキデータが読み込まれていません(index.html の <script> を確認してください)";
    return;
  }

  document.getElementById("deck-name").textContent = DECK.name || "デッキ一覧";
  const totalCards = DECK.cards.reduce((sum, c) => sum + c.count, 0);
  meta.textContent = `${DECK.cards.length}種類 / 合計${totalCards}枚`;

  grid.innerHTML = "";
  for (const card of DECK.cards) {
    grid.appendChild(buildCardElement(card));
  }
}

render();
