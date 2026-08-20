const params = new URLSearchParams(location.search);
const deckId = params.get("id");

const canvas = document.getElementById("export-canvas");
const ctx = canvas.getContext("2d");

const FONT_STACK = '-apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif';
const ACCENT_1 = "#5b6ef5";
const ACCENT_2 = "#8b5cf6";
const TEXT_COLOR = "#14151a";
const MUTED_COLOR = "#6b7080";
const CARD_PLACEHOLDER_BG = "#f5f6fb";

let deck = null;
let cardById = {};
let cardOrder = []; // cardId[], display/output order
let cardCounts = {}; // cardId -> count
const imageCache = {}; // cardId -> HTMLImageElement

// Aspect ratio/orientation are fixed (16:9 landscape) — no longer user-facing controls.
const ASPECT_W = 16;
const ASPECT_H = 9;

let showName = true;
let showCardName = true;
let showManaCurve = true;
let rowAlign = "center"; // "center" | "left" — only affects an incomplete last row

// Remember the user's display/output preferences across visits.
const EXPORT_SETTINGS_KEY = "deck-viewer-export-settings";

function loadExportSettings() {
  try {
    const raw = localStorage.getItem(EXPORT_SETTINGS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed.showName === "boolean") showName = parsed.showName;
    if (typeof parsed.showCardName === "boolean") showCardName = parsed.showCardName;
    if (typeof parsed.showManaCurve === "boolean") showManaCurve = parsed.showManaCurve;
    if (parsed.rowAlign === "center" || parsed.rowAlign === "left") rowAlign = parsed.rowAlign;
  } catch (err) {
    // ignore malformed value, keep defaults
  }
}

function saveExportSettings() {
  localStorage.setItem(
    EXPORT_SETTINGS_KEY,
    JSON.stringify({ showName, showCardName, showManaCurve, rowAlign })
  );
}

loadExportSettings();

let targetRects = []; // authoritative layout (hit-testing, hand-off to display positions)
let displayPos = {}; // cardId -> {x, y} — current on-screen position, eased toward targetRects
let labelHeightForLayout = 0;
let headerHeightCache = 0;
let rafId = null;

const BASE_LONG_EDGE = 1600;
const GAP = 14;
const PADDING = 20;
const NAME_LEFT_PADDING = PADDING + 14;
const HEADER_HEIGHT = 185; // fixed height of the blank area above the card grid
const HEADER_SPLIT_GAP = 24; // gap between the deck-name half and the mana-curve half
const PANEL_MARGIN_Y = 12; // top/bottom margin for the name/mana-curve content
const NAME_FONT_SCALE = 0.23; // fraction of headerHeight used for the deck name's font size
const CURVE_MARGIN_X = 90; // horizontal inset of the mana curve within its half (narrower chart)
const CURVE_TOP_INSET = 34; // pushes the chart down from the top of its area
const CURVE_BOTTOM_INSET = 10; // small bottom margin so the chart uses most of the available height

function computeCanvasSize() {
  const scale = BASE_LONG_EDGE / ASPECT_W;
  return { width: Math.round(ASPECT_W * scale), height: Math.round(ASPECT_H * scale) };
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

// Lays cards out row-major within areaX/Y/W/H: centered horizontally as a
// block (and any incomplete last row centered under the full grid width),
// but top-aligned vertically (not centered) — cards start right at areaY.
function buildTargetRects(areaX, areaY, areaW, areaH, labelHeight) {
  const n = cardOrder.length;
  const layout = computeCardLayout(n, areaW, areaH, labelHeight);
  if (layout.cols === 0) return [];

  const gridW = layout.cols * layout.cardW + GAP * (layout.cols - 1);
  const offsetX = areaX + (areaW - gridW) / 2;
  const offsetY = areaY;

  const rects = [];
  for (let row = 0; row * layout.cols < n; row++) {
    const startIdx = row * layout.cols;
    const endIdx = Math.min(startIdx + layout.cols, n);
    const itemsInRow = endIdx - startIdx;
    const rowW = itemsInRow * layout.cardW + GAP * (itemsInRow - 1);
    // Full rows already span gridW exactly, so this only ever visibly moves
    // an incomplete last row — center it under the grid, or flush it left.
    const rowOffsetX = rowAlign === "left" ? offsetX : offsetX + (gridW - rowW) / 2;
    for (let col = 0; col < itemsInRow; col++) {
      const idx = startIdx + col;
      rects.push({
        cardId: cardOrder[idx],
        x: rowOffsetX + col * (layout.cardW + GAP),
        y: offsetY + row * (layout.cellH + GAP),
        w: layout.cardW,
        h: layout.cardH,
      });
    }
  }
  return rects;
}

function loadImage(card) {
  if (imageCache[card.id]) return imageCache[card.id];
  const img = new Image();
  img.onload = () => renderFrame();
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

  const barGrad = context.createLinearGradient(0, y, 0, y + h);
  barGrad.addColorStop(0, ACCENT_2);
  barGrad.addColorStop(1, ACCENT_1);

  context.textAlign = "center";
  context.textBaseline = "top";

  buckets.forEach((count, i) => {
    const barH = Math.max((count / max) * barAreaH, count > 0 ? 2 : 0);
    const bx = x + i * (barW + barGap);
    const by = y + countLabelSize + 2 + (barAreaH - barH);
    const cx = bx + barW / 2;

    context.fillStyle = TEXT_COLOR;
    context.font = `bold ${countLabelSize}px ${FONT_STACK}`;
    context.fillText(count > 0 ? String(count) : "", cx, y);

    if (barH > 0) {
      context.fillStyle = barGrad;
      roundedRectPath(context, bx, by, barW, barH, Math.min(3, barW / 2));
      context.fill();
    }

    context.fillStyle = MUTED_COLOR;
    context.font = `600 ${axisLabelSize}px ${FONT_STACK}`;
    context.fillText(i === 8 ? "8+" : String(i), cx, y + countLabelSize + 2 + barAreaH + 3);
  });
}

// Recomputes canvas size + target card positions from current state. Cards
// seen for the first time snap straight to their target (no fly-in); cards
// already on screen keep their current displayPos so ensureAnimating() eases
// them to the new target instead of teleporting.
function updateLayout() {
  const { width, height } = computeCanvasSize();
  canvas.width = width;
  canvas.height = height;

  let headerHeight = 0;
  if (showName || showManaCurve) headerHeight = HEADER_HEIGHT;
  headerHeightCache = headerHeight;

  const areaX = PADDING;
  const areaY = headerHeight + PADDING;
  const areaW = width - PADDING * 2;
  const areaH = height - headerHeight - PADDING * 2;

  const labelHeight = showCardName ? Math.max(16, areaH * 0.04) : 0;
  labelHeightForLayout = labelHeight;

  targetRects = buildTargetRects(areaX, areaY, areaW, areaH, labelHeight);

  for (const rect of targetRects) {
    if (!displayPos[rect.cardId]) {
      displayPos[rect.cardId] = { x: rect.x, y: rect.y };
    }
  }

  ensureAnimating();
}

function ensureAnimating() {
  if (rafId) return;
  const step = () => {
    let moving = false;
    for (const rect of targetRects) {
      if (dragState && dragState.dragging && rect.cardId === dragState.cardId) continue;
      const pos = displayPos[rect.cardId] || (displayPos[rect.cardId] = { x: rect.x, y: rect.y });
      const dx = rect.x - pos.x;
      const dy = rect.y - pos.y;
      if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
        pos.x += dx * 0.3;
        pos.y += dy * 0.3;
        moving = true;
      } else {
        pos.x = rect.x;
        pos.y = rect.y;
      }
    }
    renderFrame();
    rafId = moving ? requestAnimationFrame(step) : null;
  };
  rafId = requestAnimationFrame(step);
}

function renderFrame() {
  const width = canvas.width;
  const height = canvas.height;
  const headerHeight = headerHeightCache;

  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, "#fbfbfe");
  bgGrad.addColorStop(1, "#eef0f7");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  const stripeGrad = ctx.createLinearGradient(0, 0, width, 0);
  stripeGrad.addColorStop(0, ACCENT_1);
  stripeGrad.addColorStop(1, ACCENT_2);
  ctx.fillStyle = stripeGrad;
  ctx.fillRect(0, 0, width, 6);

  if (showName || showManaCurve) {
    // Split the blank area above the cards into a left half (deck name) and
    // a right half (mana curve).
    const headerContentW = width - PADDING * 2;
    const halfW = (headerContentW - HEADER_SPLIT_GAP) / 2;
    const nameAreaX = PADDING;
    const nameAreaW = halfW;
    const curveAreaX = PADDING + halfW + HEADER_SPLIT_GAP;
    const curveAreaW = halfW;

    const panelY = PANEL_MARGIN_Y;
    const panelH = headerHeight - PANEL_MARGIN_Y * 2;

    if (showName && deck) {
      const nameX = nameAreaX + (NAME_LEFT_PADDING - PADDING);
      const nameMaxWidth = nameAreaW - (NAME_LEFT_PADDING - PADDING) - 16;
      let fontSize = Math.round(headerHeight * NAME_FONT_SCALE);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
      const textWidth = ctx.measureText(deck.name).width;
      if (nameMaxWidth > 0 && textWidth > nameMaxWidth) {
        fontSize = Math.max(12, Math.floor(fontSize * (nameMaxWidth / textWidth)));
        ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
      }
      ctx.fillText(deck.name, nameX, panelY + panelH / 2 + 3);
    }
    if (showManaCurve) {
      const curveX = curveAreaX + CURVE_MARGIN_X;
      const curveY = panelY + CURVE_TOP_INSET;
      const curveW = curveAreaW - CURVE_MARGIN_X * 2;
      const curveH = panelH - CURVE_TOP_INSET - CURVE_BOTTOM_INSET;
      drawManaCurve(ctx, curveX, curveY, curveW, curveH);
    }
  }

  for (const rect of targetRects) {
    if (dragState && dragState.dragging && rect.cardId === dragState.cardId) continue;
    const pos = displayPos[rect.cardId] || rect;
    drawCardTile(rect.cardId, pos.x, pos.y, rect.w, rect.h, 1, labelHeightForLayout);
  }

  if (dragState && dragState.dragging) {
    const rect = targetRects.find((r) => r.cardId === dragState.cardId);
    if (rect) {
      drawCardTile(
        dragState.cardId,
        dragState.lastX - rect.w / 2,
        dragState.lastY - rect.h / 2,
        rect.w,
        rect.h,
        0.85,
        labelHeightForLayout
      );
    }
  }
}

function drawCardTile(cardId, x, y, w, h, alpha, labelHeight) {
  const card = cardById[cardId];
  const radius = Math.min(10, w * 0.06);

  // Shadow-casting backing, drawn separately from the clipped image so the
  // shadow isn't clipped away with it.
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(20, 21, 26, 0.25)";
  ctx.shadowBlur = Math.max(10, w * 0.07);
  ctx.shadowOffsetY = Math.max(4, w * 0.03);
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.fillStyle = CARD_PLACEHOLDER_BG;
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
  ctx.shadowColor = "rgba(20, 21, 26, 0.35)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20, 21, 26, 0.75)";
  ctx.fill();
  ctx.shadowColor = "transparent";
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
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `600 ${fontSize}px ${FONT_STACK}`;
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
  for (const r of targetRects) {
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
    lastX: p.x,
    lastY: p.y,
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
  dragState.lastX = p.x;
  dragState.lastY = p.y;

  const draggedIndex = cardOrder.indexOf(dragState.cardId);
  const draggedRect = targetRects[draggedIndex];
  if (!draggedRect) return;

  const naturalCx = draggedRect.x + draggedRect.w / 2;
  const naturalCy = draggedRect.y + draggedRect.h / 2;
  let closestIdx = -1;
  let closestDist = Math.hypot(naturalCx - p.x, naturalCy - p.y);
  targetRects.forEach((r, i) => {
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
    updateLayout();
  } else {
    renderFrame();
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
  const droppedCardId = dragState.cardId;
  const dropX = dragState.lastX;
  const dropY = dragState.lastY;
  dragState = null;
  canvas.style.cursor = "grab";

  if (wasDragging) {
    // Let the dropped card ease from where it was released into its final
    // slot too, instead of snapping there instantly.
    const rect = targetRects.find((r) => r.cardId === droppedCardId);
    if (rect) displayPos[droppedCardId] = { x: dropX - rect.w / 2, y: dropY - rect.h / 2 };
    ensureAnimating();
    await persistOrder();
  } else {
    renderFrame();
  }
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

// ---- Print (multi-page TIFF sheets for physically cutting out proxies) ----

// 350 DPI(日本の商業印刷の入稿標準)で A4 = 210x297mm ≒ 2894x4093px、
// 63x88mm のカードは 868x1213px。以前は 250 DPI だったが、オリカメーカーが
// 2倍解像度(1200x1674px ≒ 484 DPI相当)で書き出すようになり、250 DPI では
// せっかくの情報を捨ててしまうため引き上げた。
// これ以上(400 DPI超)にしても通常の視距離では差が分からない一方、TIFFは
// 無圧縮なのでファイルサイズだけが増える(1ページあたり約35MB)。
const PRINT_PAGE_W = 2894;
const PRINT_PAGE_H = 4093;
const PRINT_DPI = 350;
const PRINT_CARD_W = 868;
const PRINT_CARD_H = 1213;
const PRINT_COLS = 3;
const PRINT_ROWS = 3;
const PRINT_PER_PAGE = PRINT_COLS * PRINT_ROWS;

// Expands the deck into one entry per physical copy (a card with count 3
// appears 3 times) — the point of printing is to cut out enough proxies to
// actually build the deck, not just one of each card.
function buildPrintList() {
  const list = [];
  for (const cardId of cardOrder) {
    const count = cardCounts[cardId] || 0;
    for (let i = 0; i < count; i++) list.push(cardId);
  }
  return list;
}

function waitForImage(img) {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener("load", resolve, { once: true });
    img.addEventListener("error", resolve, { once: true });
  });
}

async function ensureImagesLoaded(cardIds) {
  const unique = [...new Set(cardIds)];
  await Promise.all(
    unique.map((id) => {
      const card = cardById[id];
      if (!card || !card.imageExt) return Promise.resolve();
      return waitForImage(loadImage(card));
    })
  );
}

function renderPrintPage(pageCardIds, cardW, cardH) {
  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = PRINT_PAGE_W;
  pageCanvas.height = PRINT_PAGE_H;
  const pctx = pageCanvas.getContext("2d");
  pctx.fillStyle = "#ffffff";
  pctx.fillRect(0, 0, PRINT_PAGE_W, PRINT_PAGE_H);

  const gridW = PRINT_COLS * cardW;
  const gridH = PRINT_ROWS * cardH;
  const startX = (PRINT_PAGE_W - gridW) / 2;
  const startY = (PRINT_PAGE_H - gridH) / 2;

  pageCardIds.forEach((cardId, i) => {
    const card = cardById[cardId];
    if (!card || !card.imageExt) return;
    const img = imageCache[cardId];
    if (!img || !img.complete || !img.naturalWidth) return;
    const row = Math.floor(i / PRINT_COLS);
    const col = i % PRINT_COLS;
    const x = startX + col * cardW;
    const y = startY + row * cardH;
    drawImageCover(pctx, img, x, y, cardW, cardH);
  });

  return pageCanvas;
}

// ---- Print size calibration ----
// A printer's actual output size can drift from the theoretical 250 DPI
// (driver scaling, "fit to page", margins, etc.), so instead of trusting
// pixel math alone, the user can print a reference rectangle of a known
// nominal size, measure the real printed result with a ruler, and save the
// resulting scale factors — applied to shrink/grow the card size so future
// prints come out at the true 63x88mm on their specific setup.
const CALIBRATION_KEY = "deck-viewer-print-calibration";
// 定規で測りやすいよう、150mmを超えない正方形(一辺100mm)にしている。
const NOMINAL_CAL_SIZE_MM = 100;
// 横線・縦線を角でくっつけず離して見せるための隙間(px)。線自体の長さには影響しない。
const CAL_LINE_GAP = 60;

function getCalibration() {
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY);
    if (!raw) return { scaleX: 1, scaleY: 1 };
    const parsed = JSON.parse(raw);
    if (typeof parsed.scaleX === "number" && typeof parsed.scaleY === "number") return parsed;
  } catch (err) {
    // ignore malformed value, fall through to default
  }
  return { scaleX: 1, scaleY: 1 };
}

function getCorrectedCardSize() {
  const { scaleX, scaleY } = getCalibration();
  return {
    w: PRINT_CARD_W / scaleX,
    h: PRINT_CARD_H / scaleY,
  };
}

function printCalibrationSheet() {
  const calSize = Math.round((NOMINAL_CAL_SIZE_MM * PRINT_DPI) / 25.4);

  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = PRINT_PAGE_W;
  pageCanvas.height = PRINT_PAGE_H;
  const pctx = pageCanvas.getContext("2d");
  pctx.fillStyle = "#ffffff";
  pctx.fillRect(0, 0, PRINT_PAGE_W, PRINT_PAGE_H);

  // Two independent line segments (not a joined rectangle corner): a
  // horizontal one along the top and a vertical one along the left, each
  // exactly calSize px long but offset by CAL_LINE_GAP so their near ends
  // don't touch. The gap only shifts each line's position, not its length,
  // so the printed line length still reflects the true 100mm nominal size.
  const totalW = calSize + CAL_LINE_GAP;
  const totalH = calSize + CAL_LINE_GAP;
  const x0 = (PRINT_PAGE_W - totalW) / 2;
  const y0 = (PRINT_PAGE_H - totalH) / 2;

  const hLineY = y0;
  const hLineX1 = x0 + CAL_LINE_GAP;
  const hLineX2 = hLineX1 + calSize;

  const vLineX = x0;
  const vLineY1 = y0 + CAL_LINE_GAP;
  const vLineY2 = vLineY1 + calSize;

  pctx.strokeStyle = "#000000";
  pctx.lineWidth = 3;
  pctx.beginPath();
  pctx.moveTo(hLineX1, hLineY);
  pctx.lineTo(hLineX2, hLineY);
  pctx.stroke();
  pctx.beginPath();
  pctx.moveTo(vLineX, vLineY1);
  pctx.lineTo(vLineX, vLineY2);
  pctx.stroke();

  pctx.fillStyle = "#000000";
  pctx.textAlign = "center";
  pctx.font = "36px sans-serif";
  pctx.textBaseline = "bottom";
  pctx.fillText(`横 ${NOMINAL_CAL_SIZE_MM}mm`, (hLineX1 + hLineX2) / 2, hLineY - 12);
  pctx.save();
  pctx.translate(vLineX - 12, (vLineY1 + vLineY2) / 2);
  pctx.rotate(-Math.PI / 2);
  pctx.textBaseline = "bottom";
  pctx.fillText(`縦 ${NOMINAL_CAL_SIZE_MM}mm`, 0, 0);
  pctx.restore();

  pctx.textAlign = "center";
  pctx.textBaseline = "top";
  pctx.font = "28px sans-serif";
  pctx.fillText(
    "上の横線・左の縦線それぞれの長さを定規で測り、「印刷サイズを調整」画面に入力してください",
    PRINT_PAGE_W / 2,
    y0 + totalH + 30
  );

  const imageData = pctx.getImageData(0, 0, PRINT_PAGE_W, PRINT_PAGE_H);
  const blob = encodeTiff(PRINT_PAGE_W, PRINT_PAGE_H, imageData.data, PRINT_DPI);
  downloadBlob(blob, "print-calibration.tif");
}

// Browsers can only canvas.toBlob() to PNG/JPEG/WebP, never TIFF, so this
// hand-writes a minimal uncompressed 8-bit RGB TIFF (single strip, no
// compression) directly from a canvas's ImageData.
function encodeTiff(width, height, rgbaData, dpi) {
  const rgbByteCount = width * height * 3;
  const headerSize = 8;
  const entryCount = 12;
  const ifdSize = 2 + entryCount * 12 + 4;
  const bitsPerSampleOffset = headerSize + ifdSize;
  const bitsPerSampleSize = 6; // 3 x SHORT
  const xResOffset = bitsPerSampleOffset + bitsPerSampleSize;
  const yResOffset = xResOffset + 8;
  const stripOffset = yResOffset + 8;
  const totalSize = stripOffset + rgbByteCount;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const LE = true;

  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49); // "II" little-endian byte order
  view.setUint16(2, 42, LE);
  view.setUint32(4, headerSize, LE); // offset to first IFD

  let p = headerSize;
  view.setUint16(p, entryCount, LE);
  p += 2;

  function writeEntry(tag, type, count, valueOrOffset) {
    view.setUint16(p, tag, LE);
    p += 2;
    view.setUint16(p, type, LE);
    p += 2;
    view.setUint32(p, count, LE);
    p += 4;
    view.setUint32(p, valueOrOffset, LE);
    p += 4;
  }

  writeEntry(256, 4, 1, width); // ImageWidth (LONG)
  writeEntry(257, 4, 1, height); // ImageLength (LONG)
  writeEntry(258, 3, 3, bitsPerSampleOffset); // BitsPerSample (3x SHORT, external)
  writeEntry(259, 3, 1, 1); // Compression = none
  writeEntry(262, 3, 1, 2); // PhotometricInterpretation = RGB
  writeEntry(273, 4, 1, stripOffset); // StripOffsets
  writeEntry(277, 3, 1, 3); // SamplesPerPixel
  writeEntry(278, 4, 1, height); // RowsPerStrip (single strip)
  writeEntry(279, 4, 1, rgbByteCount); // StripByteCounts
  writeEntry(282, 5, 1, xResOffset); // XResolution (RATIONAL, external)
  writeEntry(283, 5, 1, yResOffset); // YResolution (RATIONAL, external)
  writeEntry(296, 3, 1, 2); // ResolutionUnit = inches

  view.setUint32(p, 0, LE); // next IFD offset (none)

  view.setUint16(bitsPerSampleOffset, 8, LE);
  view.setUint16(bitsPerSampleOffset + 2, 8, LE);
  view.setUint16(bitsPerSampleOffset + 4, 8, LE);

  view.setUint32(xResOffset, dpi, LE);
  view.setUint32(xResOffset + 4, 1, LE);
  view.setUint32(yResOffset, dpi, LE);
  view.setUint32(yResOffset + 4, 1, LE);

  let dst = stripOffset;
  for (let i = 0; i < rgbaData.length; i += 4) {
    bytes[dst++] = rgbaData[i];
    bytes[dst++] = rgbaData[i + 1];
    bytes[dst++] = rgbaData[i + 2];
  }

  return new Blob([buffer], { type: "image/tiff" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Print output is only ever exactly right if the user has calibrated for
// their specific printer/driver; warn once (skippable) before the first
// uncalibrated print of a session, rather than silently using the
// uncorrected 620x866 fallback.
const SKIP_CALIBRATION_WARNING_KEY = "deck-viewer-skip-calibration-warning";

async function maybeWarnAboutMissingCalibration() {
  const { scaleX, scaleY } = getCalibration();
  if (scaleX !== 1 || scaleY !== 1) return true;
  if (localStorage.getItem(SKIP_CALIBRATION_WARNING_KEY) === "true") return true;

  const { confirmed, checked } = await showConfirm(
    "印刷サイズの調整がまだ行われていません。プリンターや設定によっては、実際の印刷結果が" +
      "63mm×88mmからずれることがあります。先に「印刷サイズを調整」で調整しておくことを" +
      "おすすめします。\nこのまま印刷しますか?",
    { confirmText: "このまま印刷する", cancelText: "キャンセル", danger: false, checkboxLabel: "次から表示しない" }
  );
  if (checked) localStorage.setItem(SKIP_CALIBRATION_WARNING_KEY, "true");
  return confirmed;
}

async function printDeck() {
  const printBtn = document.getElementById("print-btn");
  const printStatus = document.getElementById("print-status");
  if (!deck) return;

  const fullList = buildPrintList();
  if (fullList.length === 0) {
    printStatus.textContent = "デッキにカードがありません";
    printStatus.className = "status-message error";
    return;
  }

  if (!(await maybeWarnAboutMissingCalibration())) return;

  printBtn.disabled = true;
  printStatus.className = "status-message";
  printStatus.textContent = "画像を準備中...";
  await ensureImagesLoaded(fullList);

  const pages = [];
  for (let i = 0; i < fullList.length; i += PRINT_PER_PAGE) {
    pages.push(fullList.slice(i, i + PRINT_PER_PAGE));
  }

  const { w: cardW, h: cardH } = getCorrectedCardSize();

  for (let p = 0; p < pages.length; p++) {
    const pageCanvas = renderPrintPage(pages[p], cardW, cardH);
    const pctx = pageCanvas.getContext("2d");
    const imageData = pctx.getImageData(0, 0, PRINT_PAGE_W, PRINT_PAGE_H);
    const blob = encodeTiff(PRINT_PAGE_W, PRINT_PAGE_H, imageData.data, PRINT_DPI);
    const pageNum = String(p + 1).padStart(2, "0");
    downloadBlob(blob, `${deck.name}-${pageNum}.tif`);
    // Small pause between triggered downloads so the browser doesn't treat
    // them as a rapid-fire multi-download popup and block the later ones.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  printStatus.className = "status-message";
  printStatus.textContent = "";
  printBtn.disabled = false;
}

document.getElementById("print-btn").addEventListener("click", printDeck);

// ---- Calibration modal ----

const calibrationModal = document.getElementById("calibration-modal");
const calMeasuredWInput = document.getElementById("cal-measured-w");
const calMeasuredHInput = document.getElementById("cal-measured-h");
const calibrationStatus = document.getElementById("calibration-status");

function setCalibrationStatus(message, kind) {
  calibrationStatus.textContent = message;
  calibrationStatus.className = `status-message ${kind || ""}`;
}

// 103mm -> "10cm3mm" のように読みやすい単位で表示するためのフォーマッタ。
function formatCmMm(mm) {
  const rounded = Math.round(mm * 10) / 10;
  const cm = Math.floor(rounded / 10);
  const remMm = Math.round((rounded - cm * 10) * 10) / 10;
  const remStr = Number.isInteger(remMm) ? String(remMm) : remMm.toFixed(1);
  return `${cm}cm${remStr}mm`;
}

function refreshCalibrationDisplay() {
  const { scaleX, scaleY } = getCalibration();
  if (scaleX === 1 && scaleY === 1) {
    setCalibrationStatus("現在、補正はかかっていません(等倍)。", "");
  } else {
    const measuredW = scaleX * NOMINAL_CAL_SIZE_MM;
    const measuredH = scaleY * NOMINAL_CAL_SIZE_MM;
    setCalibrationStatus(
      `現在の補正: 横${(scaleX * 100).toFixed(1)}%(${formatCmMm(measuredW)}) / ` +
        `縦${(scaleY * 100).toFixed(1)}%(${formatCmMm(measuredH)})`,
      "success"
    );
  }
  calMeasuredWInput.value = "";
  calMeasuredHInput.value = "";
}

function openCalibrationModal() {
  refreshCalibrationDisplay();
  calibrationModal.hidden = false;
}

function closeCalibrationModal() {
  calibrationModal.hidden = true;
}

document.getElementById("open-calibration-btn").addEventListener("click", openCalibrationModal);
document.getElementById("calibration-close-btn").addEventListener("click", closeCalibrationModal);
bindModalDismissal(calibrationModal, { onCancel: closeCalibrationModal });

document.getElementById("print-calibration-sheet-btn").addEventListener("click", printCalibrationSheet);

document.getElementById("calibration-save-btn").addEventListener("click", () => {
  const measuredW = Number(calMeasuredWInput.value);
  const measuredH = Number(calMeasuredHInput.value);
  if (!measuredW || !measuredH || measuredW <= 0 || measuredH <= 0) {
    setCalibrationStatus("実測した横幅・縦幅を入力してください", "error");
    return;
  }
  const scaleX = measuredW / NOMINAL_CAL_SIZE_MM;
  const scaleY = measuredH / NOMINAL_CAL_SIZE_MM;
  localStorage.setItem(CALIBRATION_KEY, JSON.stringify({ scaleX, scaleY }));
  refreshCalibrationDisplay();
});

document.getElementById("calibration-reset-btn").addEventListener("click", () => {
  localStorage.removeItem(CALIBRATION_KEY);
  refreshCalibrationDisplay();
});

// ---- Controls ----

const alignCenterBtn = document.getElementById("align-center-btn");
const alignLeftBtn = document.getElementById("align-left-btn");
const showNameCheckbox = document.getElementById("show-name-checkbox");
const showCardNameCheckbox = document.getElementById("show-card-name-checkbox");
const showManaCheckbox = document.getElementById("show-mana-checkbox");

function updateAlignButtons() {
  alignCenterBtn.setAttribute("aria-pressed", String(rowAlign === "center"));
  alignLeftBtn.setAttribute("aria-pressed", String(rowAlign === "left"));
}

// Reflect whatever was loaded from localStorage (or the defaults) in the UI
// before the first render, so the controls match what's about to be drawn.
updateAlignButtons();
showNameCheckbox.checked = showName;
showCardNameCheckbox.checked = showCardName;
showManaCheckbox.checked = showManaCurve;

alignCenterBtn.addEventListener("click", () => {
  rowAlign = "center";
  updateAlignButtons();
  saveExportSettings();
  updateLayout();
});

alignLeftBtn.addEventListener("click", () => {
  rowAlign = "left";
  updateAlignButtons();
  saveExportSettings();
  updateLayout();
});

showNameCheckbox.addEventListener("change", (e) => {
  showName = e.target.checked;
  saveExportSettings();
  updateLayout();
});

showCardNameCheckbox.addEventListener("change", (e) => {
  showCardName = e.target.checked;
  saveExportSettings();
  updateLayout();
});

showManaCheckbox.addEventListener("change", (e) => {
  showManaCurve = e.target.checked;
  saveExportSettings();
  updateLayout();
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

  updateLayout();
}

init();
