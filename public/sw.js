const CACHE_NAME = "deck-viewer-shell-v220";
const SHELL_FILES = [
  "index.html",
  "deck-view.html",
  "builder.html",
  "pool-detail.html",
  "css/style.css",
  "js/api.js",
  "js/dialog.js",
  "js/card-render.js",
  "js/crop.js",
  "js/sortable.js",
  "js/home.js",
  "js/deck-view.js",
  "js/builder.js",
  "js/pool-detail.js",
  "js/register-sw.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // カード情報・画像は常に最新をサーバーから取得する(オフラインキャッシュ対象外)
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/images/")) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
