const params = new URLSearchParams(location.search);
const deckId = params.get("id");

const canvas = document.getElementById("export-canvas");
const ctx = canvas.getContext("2d");

let deck = null;
let cardById = {};
let cardOrder = []; // cardId[], display/output order
let cardCounts = {}; // cardId -> count
const imageCache = {}; // cardId -> HTMLImageElement

let aspectRatio = "4:3";
let orientation = "landscape";
let showName = false;
let showManaCurve = false;

let cardRects = []; // last-computed layout rects, for hit-testing drags

const BASE_LONG_EDGE = 1600;
const GAP = 14;
const PADDING = 20;

function computeCanvasSize() {
  const [rw, rh] = aspectRatio === "16:9" ? [16, 9] : [4, 3];
  let w = rw;
  let h = rh;
  if (orientation === "portrait") {
    [w, h] = [h, w];
  }
  const scale = BASE_LONG_EDGE / Math.max(w, h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

// Finds the column count that lets a 63:88 card render as large as possible
// while fitting all `n` cards into areaW x areaH.
function computeCardLayout(n, areaW, areaH) {
  if (n === 0) return { cols: 0, rows: 0, cardW: 0, cardH: 0 };
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    let cardW = (areaW - GAP * (cols - 1)) / cols;
    let cardH = (cardW * 88) / 63;
    if (rows * cardH + GAP * (rows - 1) > areaH) {
      cardH = (areaH - GAP * (rows - 1)) / rows;
      cardW = (cardH * 63) / 88;
    }
    if (cardW <= 0 || cardH <= 0) continue;
    const area = cardW * cardH;
    if (!best || area > best.area) best = { cols, rows, cardW, cardH, area };
  }
  return best || { cols: 1, rows: n, cardW: 0, cardH: 0 };
}

function loadImage(card) {
  if (imageCache[card.id]) return imageCache[card.id];
  const img = new Image();
  img.onload = () => draw();
  img.src = Api.cardImageUrl(card);
  imageCache[card.id] = img;
  return img;
}

function drawImageCover(context, img, x, y, w, h) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = w / h;
  let sx;
  let sy;
  let sw;
  let sh;
  if (imgRatio > boxRatio) {
    sh = img.naturalHeight;
    sw = sh * boxRatio;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    sw = img.naturalWidth;
    sh = sw / boxRatio;
    sx = 0;
    sy = (img.naturalHeight - sh) / 2;
  }
  context.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function roundedRectPath(context, x, y, w, h, r) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function drawManaCurve(context, x, y, w, h) {
  const buckets = new Array(11).fill(0); // costs 0..9, 10 = "10+"
  for (const cardId of cardOrder) {
    const card = cardById[cardId];
    if (!card || card.cost === null || card.cost === undefined) continue;
    buckets[Math.min(card.cost, 10)] += cardCounts[cardId] || 0;
  }
  const max = Math.max(1, ...buckets);
  const labelSize = Math.max(9, h * 0.16);
  const barAreaH = h - labelSize - 4;
  const barGap = 3;
  const barW = (w - barGap * (buckets.length - 1)) / buckets.length;

  context.textAlign = "center";
  context.textBaseline = "top";
  context.font = `${labelSize}px sans-serif`;

  buckets.forEach((count, i) => {
    const barH = Math.max((count / max) * barAreaH, count > 0 ? 2 : 0);
    const bx = x + i * (barW + barGap);
    const by = y + barAreaH - barH;
    if (barH > 0) {
      context.fillStyle = "#5b6ef5";
      roundedRectPath(context, bx, by, barW, barH, Math.min(2, barW / 2));
      context.fill();
    }
    context.fillStyle = "#6b7080";
    context.fillText(i === 10 ? "10+" : String(i), bx + barW / 2, y + barAreaH + 3);
  });
}

function draw(excludeCardId) {
  const { width, height } = computeCanvasSize();
  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  let headerHeight = 0;
  if (showName || showManaCurve) {
    headerHeight = Math.max(70, height * 0.13);
    if (showName && deck) {
      ctx.fillStyle = "#14151a";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = `bold ${Math.round(headerHeight * 0.4)}px sans-serif`;
      ctx.fillText(deck.name, PADDING, headerHeight / 2);
    }
    if (showManaCurve) {
      const curveW = Math.min(width * 0.42, 460);
      const curveH = headerHeight - 24;
      drawManaCurve(ctx, width - curveW - PADDING, 12, curveW, curveH);
    }
  }

  const areaX = PADDING;
  const areaY = headerHeight + PADDING;
  const areaW = width - PADDING * 2;
  const areaH = height - headerHeight - PADDING * 2;

  const layout = computeCardLayout(cardOrder.length, areaW, areaH);
  cardRects = cardOrder.map((cardId, i) => {
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    return {
      cardId,
      x: areaX + col * (layout.cardW + GAP),
      y: areaY + row * (layout.cardH + GAP),
      w: layout.cardW,
      h: layout.cardH,
    };
  });

  for (const rect of cardRects) {
    if (rect.cardId === excludeCardId) continue;
    drawCardTile(rect.cardId, rect.x, rect.y, rect.w, rect.h, 1);
  }
}

function drawCardTile(cardId, x, y, w, h, alpha) {
  const card = cardById[cardId];
  ctx.save();
  ctx.globalAlpha = alpha;
  roundedRectPath(ctx, x, y, w, h, Math.min(10, w * 0.06));
  ctx.clip();
  ctx.fillStyle = "#f5f6fb";
  ctx.fillRect(x, y, w, h);
  if (card && card.imageExt) {
    const img = loadImage(card);
    if (img.complete && img.naturalWidth) drawImageCover(ctx, img, x, y, w, h);
  }
  ctx.restore();

  const count = cardCounts[cardId];
  const badgeR = Math.max(10, w * 0.14);
  const bx = x + w - badgeR - 4;
  const by = y + badgeR + 4;
  ctx.beginPath();
  ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
  ctx.fillStyle = "#14151a";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(badgeR * 1.1)}px sans-serif`;
  ctx.fillText(String(count), bx, by + 1);
}

// ---- Drag reorder (canvas-native: hit-test rects, swap cardOrder, redraw) ----

let dragState = null;

function canvasPointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function hitTestCard(x, y) {
  for (const r of cardRects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
  }
  return null;
}

canvas.addEventListener("pointerdown", (e) => {
  const p = canvasPointFromEvent(e);
  const hit = hitTestCard(p.x, p.y);
  if (!hit) return;
  dragState = {
    pointerId: e.pointerId,
    cardId: hit.cardId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    dragging: false,
  };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const dist = Math.hypot(e.clientX - dragState.startClientX, e.clientY - dragState.startClientY);
  if (!dragState.dragging) {
    if (dist < 6) return;
    dragState.dragging = true;
    canvas.style.cursor = "grabbing";
  }
  e.preventDefault();

  const p = canvasPointFromEvent(e);
  const draggedIndex = cardOrder.indexOf(dragState.cardId);
  const draggedRect = cardRects[draggedIndex];
  if (!draggedRect) return;

  const naturalCx = draggedRect.x + draggedRect.w / 2;
  const naturalCy = draggedRect.y + draggedRect.h / 2;
  let closestIdx = -1;
  let closestDist = Math.hypot(naturalCx - p.x, naturalCy - p.y);
  cardRects.forEach((r, i) => {
    if (i === draggedIndex) return;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const d = Math.hypot(cx - p.x, cy - p.y);
    if (d < closestDist) {
      closestDist = d;
      closestIdx = i;
    }
  });

  if (closestIdx !== -1) {
    const [moved] = cardOrder.splice(draggedIndex, 1);
    cardOrder.splice(closestIdx, 0, moved);
  }

  draw(dragState.cardId);
  const idx = cardOrder.indexOf(dragState.cardId);
  const rect = cardRects[idx];
  if (rect) drawCardTile(dragState.cardId, p.x - rect.w / 2, p.y - rect.h / 2, rect.w, rect.h, 0.85);
});

canvas.addEventListener("pointerup", async (e) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch (err) {
    // capture may already have been implicitly released by the browser
  }
  const wasDragging = dragState.dragging;
  dragState = null;
  canvas.style.cursor = "grab";
  draw();
  if (wasDragging) await persistOrder();
});

async function persistOrder() {
  const cards = cardOrder.map((cardId) => ({ cardId, count: cardCounts[cardId] }));
  await Api.saveDeck({
    id: deck.id,
    name: deck.name,
    cards,
    poolIds: deck.poolIds || [],
    thumbnailCardId: deck.thumbnailCardId || null,
  });
}

// ---- Controls ----

const ratioButtons = [...document.querySelectorAll("#ratio-toggle .export-toggle-btn")];
function updateRatioButtons() {
  for (const btn of ratioButtons) btn.setAttribute("aria-pressed", String(btn.dataset.ratio === aspectRatio));
}
for (const btn of ratioButtons) {
  btn.addEventListener("click", () => {
    aspectRatio = btn.dataset.ratio;
    updateRatioButtons();
    draw();
  });
}
updateRatioButtons();

const orientationButtons = [...document.querySelectorAll("#orientation-toggle .export-toggle-btn")];
function updateOrientationButtons() {
  for (const btn of orientationButtons) {
    btn.setAttribute("aria-pressed", String(btn.dataset.orientation === orientation));
  }
}
for (const btn of orientationButtons) {
  btn.addEventListener("click", () => {
    orientation = btn.dataset.orientation;
    updateOrientationButtons();
    draw();
  });
}
updateOrientationButtons();

document.getElementById("show-name-checkbox").addEventListener("change", (e) => {
  showName = e.target.checked;
  draw();
});

document.getElementById("show-mana-checkbox").addEventListener("change", (e) => {
  showManaCurve = e.target.checked;
  draw();
});

document.getElementById("download-btn").addEventListener("click", () => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(deck && deck.name) || "deck"}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
});

async function init() {
  if (!deckId) return;
  document.getElementById("edit-link").href = `builder.html?id=${encodeURIComponent(deckId)}`;

  const [d, cards] = await Promise.all([Api.getDeck(deckId), Api.getCards()]);
  if (!d) return;
  deck = d;
  cardById = Object.fromEntries(cards.map((c) => [c.id, c]));
  cardOrder = deck.cards.map((entry) => entry.cardId);
  cardCounts = Object.fromEntries(deck.cards.map((entry) => [entry.cardId, entry.count]));
  document.getElementById("deck-name-label").textContent = deck.name;

  for (const cardId of cardOrder) {
    const card = cardById[cardId];
    if (card && card.imageExt) loadImage(card);
  }

  draw();
}

init();
