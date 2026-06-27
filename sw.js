// Incrémente ce numéro à chaque mise à jour de l'app pour forcer le
// nettoyage de l'ancien cache et le téléchargement des nouveaux fichiers.
const CACHE_VERSION = 'v2';
const CACHE_NAME = 'actes-naissance-ocr-' + CACHE_VERSION;

const CORE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Fichiers de l'app elle-même : on veut toujours la version la plus fraîche
// possible, donc on les exclut de la stratégie "cache-first" ci-dessous.
const APP_FILES = ['index.html', 'app.js', 'manifest.json', 'sw.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isAppFile(url){
  return APP_FILES.some((name) => url.endsWith('/' + name) || url.endsWith(name));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Network-first pour l'API Anthropic (doit toujours être en direct)
  if (req.url.includes('api.anthropic.com')) {
    event.respondWith(fetch(req));
    return;
  }

  // Network-first pour les fichiers de l'app (HTML/JS/manifest) : on essaie
  // toujours de récupérer la dernière version en ligne d'abord, et on ne
  // retombe sur le cache qu'en cas d'échec réseau (mode hors-ligne).
  // C'est ce qui permet de voir les mises à jour immédiatement après un
  // déploiement, au lieu de rester bloqué sur une ancienne version mise en cache.
  if (isAppFile(req.url)) {
    event.respondWith(
      fetch(req).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first pour le reste (librairies CDN comme Tesseract/SheetJS,
  // qui changent rarement et peuvent rester en cache sans souci)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (response.ok && req.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
