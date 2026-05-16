// Minimal offline service worker for FIRE Path Tracker.
//
// Strategy:
// • Pre-cache the document root on install so the app shell is reachable
//   without a network round-trip.
// • Runtime cache: cache-first for Next.js static assets (immutable hashed
//   URLs under /_next/static), network-first for everything else with a
//   cache fallback when offline.
// • /api/* is network-only — we never want to serve stale auth or quotes.
// • Bump CACHE_VERSION on each release to retire the old cache.

// Bump on each release that ships behavioral fixes the user must
// pick up immediately (e.g. session-enforcement changes). Stale
// pre-cache entries are evicted on activate.
const CACHE_VERSION = "firepath-v38";
const APP_SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // network-only

  // Cache-first for hashed Next.js bundles.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            if (res.ok) {
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Network-first with cache fallback for HTML / manifest / fonts / icons.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
  );
});
