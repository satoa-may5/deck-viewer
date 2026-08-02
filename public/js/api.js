const Api = {
  async getCards(poolId) {
    const qs = poolId ? `?poolId=${encodeURIComponent(poolId)}` : "";
    const res = await fetch(`/api/cards${qs}`);
    return res.json();
  },

  async addCard({ name, cost, color, parallel, type, trigger, poolId, imageBlob }) {
    const form = new FormData();
    if (name) form.append("name", name);
    if (cost !== null && cost !== undefined && cost !== "") form.append("cost", cost);
    if (color) form.append("color", color);
    if (parallel) form.append("parallel", "true");
    if (type) form.append("type", type);
    if (trigger) form.append("trigger", trigger);
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
