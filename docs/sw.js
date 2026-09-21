const VERSION = 'ideaz-v1'
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  // データは新しいものを取りにいき、取れなければ前回のものを出す
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy))
          return res
        })
        .catch(() => caches.match(req))
    )
    return
  }

  // 殻はキャッシュ優先
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy))
          return res
        })
    )
  )
})
