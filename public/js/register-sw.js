if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// This is meant to be used like a native app (installed as a PWA / packaged
// as an exe) — the browser's own right-click menu (back/forward/reload/...)
// doesn't belong there. Loaded on every page.
document.addEventListener("contextmenu", (e) => e.preventDefault());
