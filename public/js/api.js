const Api = {
  async getVersion() {
    const res = await fetch("/api/version");
    return res.json();
  },

  async getLatestRelease() {
    const res = await fetch("/api/latest-release");
    if (!res.ok) throw new Error("最新バージョンの確認に失敗しました");
    return res.json();
  },

  async getCards(poolId) {
    const qs = poolId ? `?poolId=${encodeURIComponent(poolId)}` : "";
    const res = await fetch(`/api/cards${qs}`);
    return res.json();
  },

  async addCard({
    name,
    cardName,
    cost,
    color,
    parallel,
    type,
    trigger,
    rarity,
    ap,
    bp,
    attribute,
    generatedEnergy,
    effect,
    unedited,
    poolId,
    imageBlob,
  }) {
    const form = new FormData();
    if (name) form.append("name", name);
    if (cardName) form.append("cardName", cardName);
    if (cost !== null && cost !== undefined && cost !== "") form.append("cost", cost);
    if (color) form.append("color", color);
    if (parallel) form.append("parallel", "true");
    if (type) form.append("type", type);
    if (trigger) form.append("trigger", trigger);
    if (rarity) form.append("rarity", rarity);
    if (ap !== null && ap !== undefined && ap !== "") form.append("ap", ap);
    if (bp) form.append("bp", bp);
    if (attribute && attribute.length > 0) form.append("attribute", JSON.stringify(attribute));
    if (generatedEnergy) form.append("generatedEnergy", generatedEnergy);
    if (effect) form.append("effect", effect);
    if (unedited) form.append("unedited", "true");
    form.append("poolId", poolId);
    form.append("image", imageBlob, "card.jpg");
    const res = await fetch("/api/cards", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "登録に失敗しました");
    return data;
  },

  async replaceCardImage(id, imageBlob) {
    const form = new FormData();
    form.append("image", imageBlob, "card.jpg");
    const res = await fetch(`/api/cards/${encodeURIComponent(id)}/image`, {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "画像の更新に失敗しました");
    return data;
  },

  // オリカメーカーで作ったカードの「作成時の設定」。カードプールのスタイルを
  // 変えたときに、この設定を読み直して描き直すのに使う。
  async saveOricardState(id, state) {
    const res = await fetch(`/api/cards/${encodeURIComponent(id)}/oricard-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!res.ok) throw new Error("作成時の設定の保存に失敗しました");
  },

  async getOricardState(id) {
    const res = await fetch(`/api/cards/${encodeURIComponent(id)}/oricard-state`);
    if (!res.ok) return null; // 保存されていない(この機能より前に作られたカード)
    return res.json();
  },

  async updateCard(id, patch) {
    const res = await fetch(`/api/cards/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "カードの更新に失敗しました");
    return data;
  },

  async deleteCard(id) {
    await fetch(`/api/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async reorderCards(order) {
    await fetch("/api/cards/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
  },

  async getPools() {
    const res = await fetch("/api/pools");
    return res.json();
  },

  async createPool(name) {
    const res = await fetch("/api/pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "カードプールの作成に失敗しました");
    return data;
  },

  async updatePool(id, patch) {
    const res = await fetch(`/api/pools/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "カードプールの更新に失敗しました");
    return data;
  },

  async renamePool(id, name) {
    return Api.updatePool(id, { name });
  },

  async deletePool(id) {
    await fetch(`/api/pools/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async reorderPools(order) {
    await fetch("/api/pools/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
  },

  async startAutoFillInfo(poolId, overwrite) {
    const res = await fetch(`/api/pools/${encodeURIComponent(poolId)}/auto-fill-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overwrite }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "実行に失敗しました");
    return data;
  },

  async getGithubPools() {
    const res = await fetch("/api/github-pools");
    return res.json();
  },

  async importGithubPool(fileName, name) {
    const res = await fetch("/api/github-pools/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "インポートに失敗しました");
    return data;
  },

  exportPoolZipUrl(poolId) {
    return `/api/pools/${encodeURIComponent(poolId)}/export-zip`;
  },

  async importPoolZip(file) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/pools/import-zip", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "インポートに失敗しました");
    return data;
  },

  async getDecks() {
    const res = await fetch("/api/decks");
    return res.json();
  },

  async getDeck(id) {
    const res = await fetch(`/api/decks/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return res.json();
  },

  async saveDeck(deck) {
    const res = await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deck),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "保存に失敗しました");
    return data;
  },

  async updateDeck(id, patch) {
    const res = await fetch(`/api/decks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "デッキの更新に失敗しました");
    return data;
  },

  async deleteDeck(id) {
    await fetch(`/api/decks/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async reorderDecks(order) {
    await fetch("/api/decks/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
  },

  exportDeckZipUrl(deckId) {
    return `/api/decks/${encodeURIComponent(deckId)}/export-zip`;
  },

  async importDeckZip(file, name) {
    const form = new FormData();
    form.append("file", file);
    if (name) form.append("name", name);
    const res = await fetch("/api/decks/import-zip", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "インポートに失敗しました");
    return data;
  },

  cardImageUrl(card) {
    return `/images/${card.id}.${card.imageExt}`;
  },
};
