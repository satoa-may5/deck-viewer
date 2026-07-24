const params = new URLSearchParams(location.search);
const deckId = params.get("id");

const canvas = document.getElementById("export-canvas");
const ctx = canvas.getContext("2d");

const FONT_STACK = '-apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif';

let deck = null;
let cardById = {};
let cardOrder = []; // cardId[], display/output order
let cardCounts = {}; // cardId -> count
const imageCache = {}; // cardId -> HTMLImageElement

let aspectRatio = "4:3";
let orientation = "landscape";
let showName = false;
let showCardName = false;
let showManaCurve = false;

let cardRects = []; // last-computed layout rects, for hit-testing drags
let currentLabelHeight = 0; // last-computed per-card name label height, for drag ghost

const BASE_LONG_EDGE = 1600;
const GAP = 14;
const PADDING = 20;
const NAME_LEFT_PADDING = PADDING + 14;

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
// while fitting all `n` cards (each with an extra `labelHeight` reserved
// below for its name, when shown) into areaW x areaH.
function computeCardLayout(n, areaW, areaH, labelHeight) {
  if (n === 0) return { cols: 0, rows: 0, cardW: 0, cardH: 0, cellH: 0 };
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    let cardW = (areaW - GAP * (cols - 1)) / cols;
    let cardH = (cardW * 88) / 63;
    let cellH = cardH + labelHeight;
    if (rows * cellH + GAP * (rows - 1) > areaH) {
      cellH = (areaH - GAP * (rows - 1)) / rows;
      cardH = Math.max(cellH - labelHeight, 0);
      cardW = (cardH * 63) / 88;
      cellH = cardH + labelHeight;
    }
    if (cardW <= 0 || cardH <= 0) continue;
    const area = cardW * cardH;
    if (!best || area > best.area) best = { cols, rows, cardW, cardH, cellH, area };
  }
  return best || { cols: 1, rows: n, cardW: 0, cardH: 0, cellH: 0 };
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
  const buckets = new Array(9).fill(0); // costs 0..7, 8 = "8+"
  for (const cardId of cardOrder) {
    const card = cardById[cardId];
    if (!card || card.cost === null || card.cost === undefined) continue;
    buckets[Math.min(card.cost, 8)] += cardCounts[cardId] || 0;
  }
  const max = Math.max(1, ...buckets);
  const countLabelSize = Math.max(9, h * 0.14);
  const axisLabelSize = Math.max(9, h * 0.14);
  const barAreaH = h - countLabelSize - axisLabelSize - 6;
  const barGap = 4;
  const barW = (w - barGap * (buckets.length - 1)) / buckets.length;

  context.textAlign = "center";
  context.textBaseline = "top";

  buckets.forEach((count, i) => {
    const barH = Math.max((count / max) * barAreaH, count > 0 ? 2 : 0);
    const bx = x + i * (barW + barGap);
    const by = y + countLabelSize + 2 + (barAreaH - barH);
    const cx = bx + barW / 2;

    context.fillStyle = "#14151a";
    context.font = `bold ${countLabelSize}px ${FONT_STACK}`;
    context.fillText(count > 0 ? String(count) : "", cx, y);

    if (barH > 0) {
      context.fillStyle = "#5b6ef5";
      roundedRectPath(context, bx, by, barW, barH, Math.min(2, barW / 2));
      context.fill();
    }

    context.fillStyle = "#6b7080";
    context.font = `${axisLabelSize}px ${FONT_STACK}`;
    context.fillText(i === 8 ? "8+" : String(i), cx, y + countLabelSize + 2 + barAreaH + 3);
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
    const curveW = showManaCurve ? Math.min(width * 0.42, 460) : 0;

    if (showName && deck) {
      const nameMaxWidth = width - NAME_LEFT_PADDING - PADDING - (showManaCurve ? curveW + PADDING : 0);
      let fontSize = Math.round(headerHeight * 0.4);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#14151a";
      ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
      const textWidth = ctx.measureText(deck.name).width;
      if (nameMaxWidth > 0 && textWidth > nameMaxWidth) {
        fontSize = Math.max(12, Math.floor(fontSize * (nameMaxWidth / textWidth)));
        ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
      }
      ctx.fillText(deck.name, NAME_LEFT_PADDING, headerHeight / 2);
    }
    if (showManaCurve) {
      const curveH = headerHeight - 24;
      drawManaCurve(ctx, width - curveW - PADDING, 12, curveW, curveH);
    }
  }

  const areaX = PADDING;
  const areaY = headerHeight + PADDING;
  const areaW = width - PADDING * 2;
  const areaH = height - headerHeight - PADDING * 2;

  const labelHeight = showCardName ? Math.max(16, areaH * 0.04) : 0;
  currentLabelHeight = labelHeight;

  const layout = computeCardLayout(cardOrder.length, areaW, areaH, labelHeight);
  cardRects = cardOrder.map((cardId, i) => {
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    return {
      cardId,
      x: areaX + col * (layout.cardW + GAP),
      y: areaY + row * (layout.cellH + GAP),
      w: layout.cardW,
      h: layout.cardH,
    };
  });

  for (const rect of cardRects) {
    if (rect.cardId === excludeCardId) continue;
    drawCardTile(rect.cardId, rect.x, rect.y, rect.w, rect.h, 1, labelHeight);
  }
}

function drawCardTile(cardId, x, y, w, h, alpha, labelHeight) {
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
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
  ctx.fillStyle = "#14151a";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(badgeR * 1.1)}px ${FONT_STACK}`;
  ctx.fillText(String(count), bx, by + 1);
  ctx.restore();

  if (labelHeight > 0) {
    const fontSize = Math.max(10, labelHeight * 0.6);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#14151a";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `${fontSize}px ${FONT_STACK}`;
    let text = card ? card.name || "(名称未設定)" : cardId;
    if (ctx.measureText(text).width > w) {
      while (text.length > 1 && ctx.measureText(`${text}…`).width > w) {
        text = text.slice(0, -1);
      }
      text += "…";
    }
    ctx.fillText(text, x + w / 2, y + h + (labelHeight - fontSize) / 2);
    ctx.restore();
  }
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
  if (rect) {
    drawCardTile(dragState.cardId, p.x - rect.w / 2, p.y - rect.h / 2, rect.w, rect.h, 0.85, currentLabelHeight);
  }
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

document.getElementById("show-card-name-checkbox").addEventListener("change", (e) => {
  showCardName = e.target.checked;
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

document.getElementById("back-to-edit-btn").addEventListener("click", () => {
  if (history.length > 1) {
    history.back();
  } else if (deckId) {
    location.href = `builder.html?id=${encodeURIComponent(deckId)}`;
  } else {
    location.href = "index.html";
  }
});

async function init() {
  if (!deckId) return;

  // If we got here from the "画像を出力" button on the edit screen, prefer
  // its stashed in-memory (possibly unsaved) state over whatever's on the
  // server — that's the whole point of exporting from there.
  const draftKey = `deck-export-draft:${deckId}`;
  const draftRaw = sessionStorage.getItem(draftKey);
  let draft = null;
  if (draftRaw) {
    sessionStorage.removeItem(draftKey);
    try {
      draft = JSON.parse(draftRaw);
    } catch (err) {
      draft = null;
    }
  }

  const [savedDeck, cards] = await Promise.all([Api.getDeck(deckId), Api.getCards()]);
  if (!savedDeck && !draft) return;

  deck = draft
    ? {
        id: deckId,
        name: draft.name,
        cards: draft.cards,
        poolIds: draft.poolIds,
        thumbnailCardId: draft.thumbnailCardId,
      }
    : savedDeck;

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
