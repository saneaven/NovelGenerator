/* Minimal service worker for installability (no offline caching). */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Fetch handler kept for PWA installability; no respondWith so the
// browser handles all requests natively.
self.addEventListener('fetch', () => {});
