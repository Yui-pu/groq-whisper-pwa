const CACHE_NAME = 'groq-whisper-v3';
const ASSETS = ['./', 'styles.css', 'app.js', 'manifest.json'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // GET 以外（POSTなど）や外部URL（Groq API等）は絶対にインターセプトしない
    if (e.request.method !== 'GET') return;
    if (!e.request.url.startsWith(self.location.origin)) return;

    e.respondWith(
        caches.match(e.request).then(r => r || fetch(e.request))
    );
});
