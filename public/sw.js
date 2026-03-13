const CACHE_NAME = 'ocatech-v1';
const ASSETS = [
  '/listener/',
  '/listener/index.html',
  '/listener/styles.css',
  '/listener/app.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap',
  'https://unpkg.com/lucide@latest'
];

// Install Event - Caching basic assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event - Cleaning up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch Event - Stale-while-revalidate for UI, Network-only for audio/API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Filter out non-http/https requests (e.g., chrome-extension://)
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // Skip audio streams and API calls (always fresh)
  if (url.pathname.includes('/api/') || url.pathname.includes('/stream') || url.pathname.includes('socket.io')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
        }
        return networkResponse;
      }).catch(() => {
          // Silent fail for network fetch
      });

      return response || fetchPromise;
    })
  );
});
