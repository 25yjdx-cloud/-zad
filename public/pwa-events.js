/* Shared handlers imported by the generated Workbox worker. */
const QURAN_PAGE_CACHE = 'zad-quran-pages-v1';
const QURAN_PAGE_COUNT = 604;
const QURAN_PAGE_URL = (page) => `https://quran.ksu.edu.sa/png_big/${page}.png`;
const QURAN_CACHE_CONCURRENCY = 4;

/**
 * Seed the same cache used by Workbox's Quran image route during SW install.
 * Use CORS-readable responses so 604 opaque responses cannot consume multiple
 * gigabytes of browser storage. A failed page rejects install, allowing the
 * browser to retry the worker install instead of activating a partial cache.
 */
async function precacheQuranPages() {
  const cache = await caches.open(QURAN_PAGE_CACHE);
  let nextPage = 1;
  const workers = Array.from({ length: QURAN_CACHE_CONCURRENCY }, async () => {
    while (nextPage <= QURAN_PAGE_COUNT) {
      const page = nextPage++;
      const url = QURAN_PAGE_URL(page);
      if (await cache.match(url)) continue;

      let response;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          response = await fetch(url, { mode: 'cors', credentials: 'omit' });
          if (!response.ok || !/^image\/png(?:;|$)/i.test(response.headers.get('content-type') || '')) {
            throw new Error(`Unexpected Quran page response for page ${page}`);
          }
          break;
        } catch (error) {
          if (attempt === 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      await cache.put(url, response);
    }
  });

  await Promise.all(workers);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheQuranPages());
});

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.type !== 'UNS_SHOW_NOTIFICATION') return;
  event.waitUntil(self.registration.showNotification(message.title || 'أُنْس', {
    body: message.body || '',
    icon: '/assets/icons/icon-192x192.png',
    badge: '/assets/icons/icon-192x192.png',
    tag: message.tag || 'uns-reminder',
    data: { url: message.url || '/' },
  }));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Use a generic notification for plain-text pushes. */ }
  const notification = payload.notification || payload;
  event.waitUntil(self.registration.showNotification(notification.title || 'تذكير من أُنْس', {
    body: notification.body || event.data?.text() || 'حان وقت وردك اليومي.',
    icon: '/assets/icons/icon-192x192.png',
    badge: '/assets/icons/icon-192x192.png',
    data: { url: payload.data?.url || payload.fcmOptions?.link || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.focus().then((client) => client.navigate(destination));
    return self.clients.openWindow(destination);
  }));
});
