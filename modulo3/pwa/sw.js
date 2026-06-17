const CACHE_NAME = 'prestai-campo-v1';
const ASSETS = [
    '/modulo3/pwa/index.html',
    '/modulo3/pwa/idb.js',
    '/modulo3/pwa/manifest.json',
    '/modulo3/m3-shared.css',
    '/config.js',
];

// ── Install: cachear assets estáticos ────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// ── Activate: limpar caches antigos ──────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// ── Fetch: Network First para API, Cache First para assets ───
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // API Supabase e /api/ → Network First
    if (url.hostname.includes('supabase') || url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response(
                    JSON.stringify({ offline: true }),
                    { headers: { 'Content-Type': 'application/json' } }
                )
            )
        );
        return;
    }

    // Assets estáticos → Cache First
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});

// ── Message: CHECK_ONLINE ─────────────────────────────────────
self.addEventListener('message', event => {
    if (event.data?.type === 'CHECK_ONLINE') {
        event.source.postMessage({ type: 'ONLINE_STATUS', online: true });
    }
});

// ── Background Sync ───────────────────────────────────────────
self.addEventListener('sync', event => {
    if (event.tag === 'sync-checkins') {
        event.waitUntil(
            self.clients.matchAll().then(clients =>
                clients.forEach(c => c.postMessage({ type: 'TRIGGER_SYNC' }))
            )
        );
    }
});
