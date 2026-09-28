// Service worker: lets the installed app open without a network connection.
// Network first (so updates arrive straight away), cached copy as fallback.

const CACHE = "ipad-finder-v1";
const NETWORK_TIMEOUT_MS = 3000;
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "js/boot.js",
  "js/main.js",
  "js/platform.js",
  "js/audio.js",
  "js/engine/apple.js",
  "js/engine/bytes.js",
  "js/engine/classify.js",
  "js/engine/signal.js",
  "js/engine/tracker.js",
  "js/engine/vendors.js",
  "js/sources/bridge.js",
  "js/sources/demo.js",
  "js/sources/webbluetooth.js",
  "js/ui/dom.js",
  "js/ui/follow.js",
  "js/ui/list.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Never touch the computer program's API or its live event stream.
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  if ((request.headers.get("accept") || "").includes("text/event-stream")) return;

  // Network first, but don't wait forever on a weak connection (garage, car
  // park, clubhouse …): after a few seconds the cached copy wins, and the
  // network answer still refreshes the cache in the background.
  const network = fetch(request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (!cached) return network;
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
      try {
        const response = await Promise.race([network, timeout]);
        if (response && (response.ok || response.status < 500)) return response;
      } catch {
        /* offline: use the cache */
      }
      return cached;
    })(),
  );
});
