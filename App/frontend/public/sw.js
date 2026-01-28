/* Minimal service worker for installability (no offline caching). */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Avoid interfering with writes/streams.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Work around Chrome's "only-if-cached" + cross-origin restriction.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  event.respondWith(fetch(request));
});
