const CACHE_NAME = 'helal-tarayici-v6';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/analyzer.js',
  './data/ingredients.json',
  './data/products.json',
  './data/phrases.json',
  './data/translations.json',
  './js/translator.js',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-simd.wasm.js',
  './vendor/tesseract/tesseract-core-simd.wasm',
  './vendor/tessdata/chi_sim.traineddata.gz'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // CDN isteklerini (Tesseract, html5-qrcode) network-first yaklaşımıyla cache'le
  const url = new URL(e.request.url);
  const isCDN = url.hostname !== self.location.hostname;

  if (isCDN) {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        fetch(e.request)
          .then(res => { cache.put(e.request, res.clone()); return res; })
          .catch(() => caches.match(e.request))
      )
    );
    return;
  }

  // Yerel dosyalar: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
