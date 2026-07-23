self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));

// ── Web Push ──────────────────────────────────────────────────────────────────
// A page cannot make a sound once its tab is hidden or the phone is locked — the
// browser suspends it. So the "order ready" alert for a backgrounded waiter arrives
// here instead, as an OS notification the service worker shows even while the app is
// closed. Sent by app/api/notify-ready; subscribed from the seller screen.
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { /* non-JSON payload */ }
  const title = data.title || 'Sifariş hazırdır';
  const options = {
    body: data.body || 'Bir sex sifarişi hazır etdi',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    vibrate: [200, 100, 200],
    // Same order collapses onto one notification instead of stacking; renotify still
    // buzzes so a second sex finishing is not silently swallowed.
    tag: data.tag || 'order-ready',
    renotify: true,
    data: { url: data.url || '/seller' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an already-open waiter tab if there is one, else
// opens a fresh one — never a duplicate.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/seller';
  e.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      if (c.url.includes('/seller') && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
