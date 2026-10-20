/**
 * EduFlex service worker — offline-friendly study plan.
 * Caches the app shell so the app opens without internet; live data comes
 * from localStorage snapshots the app saves while online.
 */
const CACHE = 'eduflex-shell-v5';
const SHELL = [
  '/app.html', '/login.html', '/register.html', '/index.html', '/forgot.html', '/reset.html',
  '/js/api.js', '/js/app.js', '/js/password-toggle.js',
  '/js/views/create.js', '/js/views/more.js', '/js/views/premium.js',
  '/js/views/dashboard.js', '/js/views/courses.js', '/js/views/deadlines.js',
  '/js/views/availability.js', '/js/views/schedule.js', '/js/views/calendar.js',
  '/js/views/focus.js', '/js/views/resources.js', '/js/views/progress.js',
  '/js/views/profile.js', '/js/views/insights.js', '/js/views/peers.js',
  '/js/views/setup.js', '/js/views/roadmaps.js', '/js/views/admin.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache API data

  // Network first (so updates land), cache fallback (so offline works)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then(hit => hit || caches.match('/app.html')))
  );
});
