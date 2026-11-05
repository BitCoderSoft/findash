// FinDash Service Worker
// Estratégia: cache-first para assets estáticos.
// APIs externas (Supabase, brapi, Binance, BCB) vão direto à rede —
// o app já tem cache próprio via localStorage/armazem.

var CACHE = 'findash-v1.7.0';

var ASSETS_ESTATICOS = [
    './',
    './index.html',
    './manifest.json',
    './js/constantes.js',
    './js/armazem.js',
    './js/data.js',
    './js/utils.js',
    './js/graficos.js',
    './js/market.js',
    './js/engine.js',
    './js/supabase.js',
    './icons/icon-192.png',
    './icons/icon-512.png',
];

// Domínios que nunca passam pelo cache do SW
var REDE_DIRETA = [
    'supabase.co',
    'brapi.dev',
    'binance.vision',
    'binance.com',
    'bcb.gov.br',
    'bolsai.com.br',
    'cdn.jsdelivr.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
];

self.addEventListener('install', function (ev) {
    ev.waitUntil(
        caches.open(CACHE).then(function (cache) {
            return cache.addAll(ASSETS_ESTATICOS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', function (ev) {
    ev.waitUntil(
        caches.keys().then(function (chaves) {
            return Promise.all(
                chaves
                    .filter(function (k) { return k !== CACHE; })
                    .map(function (k) { return caches.delete(k); })
            );
        }).then(function () {
            // Avisa todas as abas abertas que há uma nova versão
            return self.clients.matchAll({ type: 'window' }).then(function (clients) {
                clients.forEach(function (client) {
                    client.postMessage({ type: 'SW_ATUALIZADO', versao: CACHE });
                });
                return self.clients.claim();
            });
        })
    );
});

self.addEventListener('fetch', function (ev) {
    var url = new URL(ev.request.url);

    // Rede direta para APIs externas
    var ehExterno = REDE_DIRETA.some(function (dom) {
        return url.hostname.includes(dom);
    });
    if (ehExterno) return;

    // Cache-first: serve do cache; cai na rede se não achar
    ev.respondWith(
        caches.match(ev.request).then(function (cached) {
            if (cached) return cached;
            return fetch(ev.request).then(function (response) {
                if (
                    response.ok &&
                    url.origin === self.location.origin &&
                    ev.request.method === 'GET'
                ) {
                    var clone = response.clone();
                    caches.open(CACHE).then(function (cache) {
                        cache.put(ev.request, clone);
                    });
                }
                return response;
            });
        })
    );
});
