// ForeclosureData service worker — MVP scope: installability + an
// offline fallback page. Deliberately does NOT cache foreclosure data;
// full offline data browsing is a post-MVP feature (see docs/BACKLOG.md).
// Also the registration point for future Web Push (see docs/ARCHITECTURE.md §10).

const CACHE_NAME = "fti-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL)),
  );
});

// Placeholder for future Web Push wiring (see NotificationDelivery in
// @foreclosuredata/types and docs/ARCHITECTURE.md §10) — no-op until a real payload
// format and VAPID keys are configured.
self.addEventListener("push", () => {});
