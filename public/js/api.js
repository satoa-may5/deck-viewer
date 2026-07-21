const Api = {
  async getCards(poolId) {
    const qs = poolId ? `?poolId=${encodeURIComponent(poolId)}` : "";
    const res = await fetch(`/api/cards${qs}`);
    return res.json();
  },

  async addCard({ id, name, cost, poolId, imageBlob }) {
    const form = new FormData();
    form.append("id", id);
    form.append("name", name);
    if (cost !== null && cost !== undefined && cost !== "") form.append("cost", cost);
    form.append("poolId", poolId);
    form.append("image", imageBlob, `${id}.jpg`);
    const res = await fetch("/api/cards", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "登録に失敗しました");
    return data;
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

  async renamePool(id, name) {
    const res = await fetch(`/api/pools/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "カードプールの更新に失敗しました");
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

  async deleteDeck(id) {
    await fetch(`/api/decks/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  cardImageUrl(card) {
    return `/images/${card.id}.${card.imageExt}`;
  },
};
