/*
 * The staff portal's service worker (myphonemybrain.com/portal/, 3 November 2026).
 * It does two things only: shows push notifications, and opens the portal at
 * the right screen when one is tapped. It caches nothing: the portal always
 * loads fresh from the website.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'MyPhone/MyBrain', body: event.data ? event.data.text() : '' };
  }
  const link = typeof data.link === 'string' && data.link.startsWith('#') ? data.link : '#home';
  event.waitUntil(
    self.registration.showNotification(data.title || 'MyPhone/MyBrain', {
      body: data.body || '',
      icon: '/assets/images/logo/icon-192.png',
      badge: '/assets/images/logo/favicon-48.png',
      tag: data.tag || undefined,
      data: { url: `/portal/${link}` },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/portal/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if (w.url.startsWith(new URL('/portal/', self.location.origin).href)) {
          await w.focus();
          if ('navigate' in w) await w.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
