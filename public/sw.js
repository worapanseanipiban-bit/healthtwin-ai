// HealthTwin AI service worker: app shell works offline; fonts are cached the first time they load.
const CACHE = 'healthtwin-v13';
const SHELL = ['./', './index.html', './manifest.webmanifest', './lib/tailwind.js', './lib/chart.umd.js', './lib/fontawesome.js',
  './firebase-config.js', './lib/firebase-app-compat.js', './lib/firebase-auth-compat.js', './lib/firebase-firestore-compat.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).pathname.endsWith('/firebase-config.js')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    const url = new URL(e.request.url);
    if (res.ok && (url.origin === location.origin || url.hostname.endsWith('gstatic.com') || (url.hostname === 'fonts.googleapis.com'))) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match('./index.html'))));
});
