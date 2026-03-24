// Service Worker for Bus Tracker PWA
// Handles background push notifications from the Flask server

const CACHE_NAME = 'bustracker-v1';
const OFFLINE_URLS = ['/', '/static/index.html'];

// Install: Cache core assets
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_URLS).catch(() => {}))
    );
});

// Activate: Clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch: Serve cached assets when offline
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});

// Push: Handle incoming web push notifications
self.addEventListener('push', event => {
    let payload = { title: '🚌 Bus Tracker', body: 'Bus update!', url: '/' };
    try {
        payload = { ...payload, ...event.data.json() };
    } catch (e) {
        payload.body = event.data ? event.data.text() : 'Bus update!';
    }

    const options = {
        body: payload.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [200, 100, 200],
        data: { url: payload.url },
        actions: [{ action: 'open', title: 'Open Tracker' }],
        requireInteraction: false,
    };

    event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Notification click: Open the app
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data?.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const client of list) {
                if (client.url.includes(self.location.origin)) {
                    return client.focus();
                }
            }
            return clients.openWindow(url);
        })
    );
});
