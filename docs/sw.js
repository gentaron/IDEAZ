// IDEAZ の Service Worker
//
// 殻（HTML/CSS/JS/アイコン）と中身（data/*.json）でキャッシュを分けてある。
// 殻を作り直しても、前に取った5枠は消えない。オフラインでも開けるのはそのため。

const SHELL_CACHE = 'ideaz-shell-v2'
const DATA_CACHE = 'ideaz-data-v1'
const KEEP = [SHELL_CACHE, DATA_CACHE]

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
      // 1つ欠けても全部が失敗しないように、1件ずつ入れる
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })))))
  )
  // ここで skipWaiting はしない。表に「新しいのが来ている」と出して、
  // 押してもらってから入れ替える（読んでいる最中にすり替わらないように）
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })()
  )
})

// 新しい殻がいるとき、表から「いま入れ替えていい」と言ってもらう
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting()
})

/** 取れたら入れておく。失敗しても表には響かせない */
async function put(cacheName, req, res) {
  if (!res || !res.ok || res.type === 'opaque') return
  const c = await caches.open(cacheName)
  await c.put(req, res.clone())
}

/** ページそのもの。新しいものを優先し、繋がらなければ前の殻を出す */
async function handleNavigation(e) {
  try {
    const preload = await e.preloadResponse
    const res = preload || (await fetch(e.request))
    await put(SHELL_CACHE, new Request('index.html'), res)
    return res
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    // start_url に ?src=pwa が付くので、問い合わせ部分は見ないで探す
    return (
      (await cache.match(e.request, { ignoreSearch: true })) ||
      (await cache.match('index.html')) ||
      (await cache.match('./')) ||
      new Response('<!doctype html><meta charset="utf-8"><p>オフラインです。', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    )
  }
}

/** 5枠のデータ。新しいものを取りにいき、取れなければ前回のものを出す */
async function handleData(req) {
  try {
    const res = await fetch(req)
    await put(DATA_CACHE, req, res)
    return res
  } catch {
    const hit = await caches.match(req, { cacheName: DATA_CACHE, ignoreSearch: true })
    if (hit) return hit
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
}

/** 殻。すぐ前回のものを出しつつ、裏で新しいものに入れ替えておく */
async function handleShell(req) {
  const hit = await caches.match(req, { cacheName: SHELL_CACHE })
  const fresh = fetch(req)
    .then((res) => {
      put(SHELL_CACHE, req, res)
      return res
    })
    .catch(() => null)
  return hit || (await fresh) || Response.error()
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== location.origin) return

  if (req.mode === 'navigate') {
    e.respondWith(handleNavigation(e))
    return
  }
  if (url.pathname.includes('/data/')) {
    e.respondWith(handleData(req))
    return
  }
  e.respondWith(handleShell(req))
})
