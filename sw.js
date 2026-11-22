// Fintry Weather Station service worker.
// App shell: cached for instant start-up. Weather data: always network first.
const CACHE = "fintry-shell-v4";
const SHELL = ["./", "index.html", "snow.html", "storms.html", "history.html", "style.css", "common.js", "app.js", "snow.js", "storms.js", "history.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Live data (forecast API, radar, map tiles): straight to the network.
  if (url.origin !== location.origin && !url.hostname.endsWith("unpkg.com")) return;
  // Station readings and history: network first, last known copy if offline.
  if (url.pathname.endsWith("station.json") || url.pathname.endsWith("history.json")) {
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return r; })
      .catch(() => caches.match(req)));
    return;
  }
  // Everything else: show the cached copy now, refresh it in the background.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
