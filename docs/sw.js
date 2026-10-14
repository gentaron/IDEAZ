// IDEAZ の Service Worker
//
// 殻（HTML/CSS/JS/アイコン）と中身（data/*.json）でキャッシュを分けてある。
// 殻を作り直しても、前に取った5枠は消えない。オフラインでも開けるのはそのため。
//
// 起動は殻をキャッシュから即座に出す（ネットを待たない）。
// 前は HTML/CSS/JS を毎回ネットから先に取っていたので、電波が細いと
// 真っ白 → 崩れた画面 → 骨組みのまま数秒、という起動になっていた。
//
// 版ずれは「殻を1組として扱う」ことで防ぐ。
//   - install で HTML/CSS/JS をまとめて入れる（1つでも欠けたら入れない）
//   - 起動のたびに裏で3つまとめて取り直し、全部取れたときだけまとめて差し替える
//   - 差し替えたら表に知らせて、次に開いたとき（か「更新」を押したとき）に新しい組で立ち上がる
// HTML だけ新しく CSS/JS が古い、という組み合わせは、どの経路でも起きない。

const SHELL_CACHE = 'ideaz-shell-v4'
const DATA_CACHE = 'ideaz-data-v1'
const KEEP = [SHELL_CACHE, DATA_CACHE]

// 版を揃えないといけない組。HTML はナビゲーションでも index.html の名前で引く
const CORE = ['index.html', 'styles.css', 'app.js', 'manifest.webmanifest']
const ICONS = ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png']

// データは待ちすぎない。これを過ぎたら前回分を出す
const DATA_TIMEOUT = 3500

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(SHELL_CACHE)
      // 殻の組は全部そろって初めて入れる。欠けたら install ごと失敗させ、前の版で動き続ける
      await c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })))
      // アイコンは欠けても困らない
      await Promise.allSettled(ICONS.map((u) => c.add(new Request(u, { cache: 'reload' }))))
    })()
  )
  // ここで skipWaiting はしない。表に「新しいのが来ている」と出して、
  // 押してもらってから入れ替える（読んでいる最中にすり替わらないように）
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))
      // ナビゲーションはキャッシュから出すので、先読みは要らない（使わない先読みは警告と無駄な通信になる）
      if (self.registration.navigationPreload) await self.registration.navigationPreload.disable()
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
  // 複製は先に取る。待っている間に本体が読まれ始めると clone できなくなる
  const copy = res.clone()
  try {
    const c = await caches.open(cacheName)
    await c.put(req, copy)
  } catch {
    /* 容量いっぱいなど。表には響かせない */
  }
}

/** 待ちすぎない fetch。電波が細いときは諦めてキャッシュに回す */
function fetchWithin(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    fetch(req).then(
      (res) => {
        clearTimeout(t)
        resolve(res)
      },
      (err) => {
        clearTimeout(t)
        reject(err)
      }
    )
  })
}

/**
 * 殻の組を裏で取り直す。3つとも取れたときだけまとめて差し替え、
 * 中身が変わっていたら表に知らせる。1回の起動で何度も走らないようにしてある。
 */
let revalidating = null
function revalidateShell() {
  if (revalidating) return revalidating
  revalidating = (async () => {
    try {
      const fresh = await Promise.all(
        CORE.map((u) => fetch(new Request(u, { cache: 'no-cache' })).then((r) => (r.ok ? r : Promise.reject())))
      )
      const c = await caches.open(SHELL_CACHE)
      let changed = false
      let missing = false
      for (let i = 0; i < CORE.length; i++) {
        const old = await c.match(CORE[i])
        if (!old) {
          missing = true
          continue
        }
        if ((await old.text()) !== (await fresh[i].clone().text())) changed = true
      }
      if (!changed && !missing) return
      await Promise.all(CORE.map((u, i) => c.put(u, fresh[i])))
      // 欠けを埋めただけなら知らせない（開いたそばから帯を出さない）
      if (!changed) return
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) client.postMessage('shell-updated')
    } catch {
      /* 繋がらない・途中で欠けた。今の組のまま使い続ける */
    } finally {
      revalidating = null
    }
  })()
  return revalidating
}

/** ページそのもの。キャッシュの殻を即座に出す（新しい組は fetch の側で裏から取りにいく） */
async function handleNavigation(req) {
  const cache = await caches.open(SHELL_CACHE)
  // start_url に ?src=pwa や ?view=... が付くので、問い合わせ部分は見ないで探す
  const hit = (await cache.match('index.html')) || (await cache.match(req, { ignoreSearch: true }))
  if (hit) return hit
  // 殻がまだ入っていないときだけネットを待つ
  try {
    return await fetch(req)
  } catch {
    return new Response('<!doctype html><meta charset="utf-8"><p>オフラインです。一度オンラインで開くと、そのあとはオフラインでも開けます。', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}

/** 殻（CSS/JS/manifest）。ナビゲーションと同じ組から出す */
async function handleShell(req) {
  const hit = await caches.match(req, { cacheName: SHELL_CACHE, ignoreSearch: true })
  if (hit) return hit
  try {
    const res = await fetchWithin(req, 6000)
    await put(SHELL_CACHE, req, res)
    return res
  } catch {
    return Response.error()
  }
}

/**
 * 5枠のデータ。新しいものを取りにいき、待ちすぎたら・取れなければ前回のものを出す。
 * 間に合わなかった分も裏で取り終えたらキャッシュに入れるので、done を waitUntil に渡す
 */
function handleData(req) {
  const network = fetch(req).then(async (res) => {
    await put(DATA_CACHE, req, res)
    return res
  })
  return { response: respondData(req, network), done: network.catch(() => {}) }
}

async function respondData(req, network) {
  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), DATA_TIMEOUT)),
    ])
  } catch {
    const hit = await caches.match(req, { cacheName: DATA_CACHE, ignoreSearch: true })
    if (hit) return hit
    // 前回分も無いなら、遅くてもネットの返事を待つ
    try {
      return await network
    } catch {
      return new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }
  }
}

/** アイコン。変わらないので、前回のものをそのまま出す */
async function handleIcon(req) {
  const hit = await caches.match(req, { cacheName: SHELL_CACHE })
  if (hit) return hit
  const res = await fetch(req)
  await put(SHELL_CACHE, req, res)
  return res
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

  // waitUntil は非同期の途中ではなく、ここで同期的に呼ぶ（Safari はそうでないと落とす）
  if (req.mode === 'navigate') {
    e.respondWith(handleNavigation(req))
    e.waitUntil(revalidateShell())
    return
  }
  if (url.pathname.includes('/data/')) {
    const { response, done } = handleData(req)
    e.respondWith(response)
    e.waitUntil(done)
    return
  }
  if (url.pathname.includes('/icons/')) {
    e.respondWith(handleIcon(req))
    return
  }
  e.respondWith(handleShell(req))
})
