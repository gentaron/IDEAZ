const cards = document.getElementById('cards')
const dateLabel = document.getElementById('date-label')
const nextLabel = document.getElementById('next-label')
const toastEl = document.getElementById('toast')
const header = document.querySelector('.top')

const banner = document.getElementById('banner')
const bannerText = document.getElementById('banner-text')
const bannerAction = document.getElementById('banner-action')
const bannerClose = document.getElementById('banner-close')
const installBtn = document.getElementById('install-btn')

const viewer = document.getElementById('viewer')
const viewerTitle = document.getElementById('viewer-title')
const viewerBody = document.getElementById('viewer-body')
const viewerCopy = document.getElementById('viewer-copy')
const viewerShare = document.getElementById('viewer-share')

const archive = document.getElementById('archive')
const archiveList = document.getElementById('archive-list')

let today = null
let openSlot = null
let lastFocus = null
let installEvent = null
let viewingArchive = false
let bannerKind = null
let wantsReload = false

/* ---------- utilities ---------- */

function toast(msg) {
  toastEl.textContent = msg
  toastEl.classList.add('show')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 1700)
}

async function copy(text, okMsg = 'コピーしました') {
  try {
    await navigator.clipboard.writeText(text)
    toast(okMsg)
    return
  } catch {
    /* clipboard API が使えない環境向けのフォールバック */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  toast(ok ? okMsg : 'コピーできませんでした。全文を開いて手で選んでください')
}

/** その日のデータを取りにいく。SW が裏で前回分を出すこともある */
async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

/** 次のMYT 5時までの残り時間 */
function untilNext() {
  const now = Date.now()
  const myt = new Date(now + 8 * 3600 * 1000)
  const next = Date.UTC(
    myt.getUTCFullYear(),
    myt.getUTCMonth(),
    myt.getUTCDate() + (myt.getUTCHours() >= 5 ? 1 : 0),
    5
  ) - 8 * 3600 * 1000
  const mins = Math.max(0, Math.round((next - now) / 60000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `次の入れ替えまで ${h}時間${m}分` : `次の入れ替えまで ${m}分`
}

function tickNext() {
  nextLabel.textContent = untilNext()
}

/* ---------- 知らせの帯 ---------- */

/** 帯を出す。action を渡すとボタンが付く */
function showBanner(kind, text, action) {
  bannerKind = kind
  bannerText.textContent = text
  if (action) {
    bannerAction.textContent = action.label
    bannerAction.onclick = action.run
    bannerAction.hidden = false
  } else {
    bannerAction.hidden = true
    bannerAction.onclick = null
  }
  banner.hidden = false
}

function hideBanner(kind) {
  if (kind && bannerKind !== kind) return
  banner.hidden = true
  bannerAction.onclick = null
  bannerKind = null
}

bannerClose.addEventListener('click', () => hideBanner())

/* ---------- rendering ---------- */

function skeletons(n = 5) {
  cards.innerHTML = ''
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div')
    s.className = 'skeleton'
    cards.append(s)
  }
}

function render(day) {
  today = day
  dateLabel.textContent = `${day.date}（マレーシア時間）`
  cards.innerHTML = ''

  for (const slot of day.slots) {
    const card = document.createElement('article')
    card.className = 'card' + (slot.kind === 'judgement' ? ' judge' : '')

    const head = document.createElement('div')
    head.className = 'card-head'
    const time = document.createElement('span')
    time.className = 'time'
    time.textContent = slot.time
    const tag = document.createElement('span')
    tag.className = 'tag'
    tag.textContent = slot.kind === 'judgement' ? '判断AI' : '題材の縛りなし'
    head.append(time, tag)

    const lens = document.createElement('p')
    lens.className = 'lens'
    const lensLabel = document.createElement('span')
    lensLabel.className = 'lens-label'
    lensLabel.textContent = '今日の角度'
    lens.append(lensLabel, document.createTextNode(slot.lens))

    const actions = document.createElement('div')
    actions.className = 'actions'

    const copyBtn = document.createElement('button')
    copyBtn.className = 'primary'
    copyBtn.type = 'button'
    copyBtn.textContent = 'コピー'
    copyBtn.addEventListener('click', () => copy(slot.prompt, `${slot.time} の型をコピーしました`))

    const openBtn = document.createElement('button')
    openBtn.className = 'ghost'
    openBtn.type = 'button'
    openBtn.textContent = '全文'
    openBtn.addEventListener('click', () => openViewer(slot))

    actions.append(copyBtn, openBtn)
    card.append(head, lens, actions)
    cards.append(card)
  }

  cards.setAttribute('aria-busy', 'false')
}

function openViewer(slot) {
  openSlot = slot
  lastFocus = document.activeElement
  viewerTitle.textContent = `${slot.time} ${slot.label}`
  viewerBody.textContent = slot.prompt
  viewerCopy.onclick = () => copy(slot.prompt, 'コピーしました')
  viewerShare.hidden = typeof navigator.share !== 'function'
  viewer.showModal()
  viewerBody.scrollTop = 0
}

viewerShare.addEventListener('click', async () => {
  if (!openSlot) return
  try {
    await navigator.share({ title: `IDEAZ ${openSlot.time}`, text: openSlot.prompt })
  } catch {
    /* 取り消しただけ。何も言わない */
  }
})

/* ---------- archive ---------- */

async function openArchive() {
  if (archive.open) return
  lastFocus = document.activeElement
  archive.showModal()
  archiveList.innerHTML = '<p class="archive-lenses">読み込み中…</p>'
  try {
    const index = await getJSON('data/index.json')
    archiveList.innerHTML = ''
    for (const day of index.days) {
      const wrap = document.createElement('div')
      wrap.className = 'archive-day'

      const d = document.createElement('span')
      d.className = 'archive-date'
      d.textContent = day.date + (day.date === index.latest ? '（いま表示中）' : '')

      const l = document.createElement('p')
      l.className = 'archive-lenses'
      l.textContent = day.lenses.map((x) => `${x.time} ${x.lens}`).join(' / ')

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = 'この日の5個を開く'
      btn.addEventListener('click', async () => {
        btn.disabled = true
        try {
          const doc = await getJSON(`data/archive/${day.date}.json`)
          archive.close()
          render(doc)
          window.scrollTo({ top: 0, behavior: 'smooth' })
          viewingArchive = doc.date !== index.latest
          if (viewingArchive) {
            toast(`${doc.date} の分を表示しています`)
            showBanner('past', `${doc.date} の分です。`, { label: '今日に戻る', run: backToToday })
          } else {
            hideBanner('past')
          }
        } catch {
          toast('この日の分を読めませんでした')
        } finally {
          btn.disabled = false
        }
      })

      wrap.append(d, l, btn)
      archiveList.append(wrap)
    }
    if (!index.days.length) archiveList.innerHTML = '<p class="archive-lenses">まだ何もありません。</p>'
  } catch {
    archiveList.innerHTML = '<p class="archive-lenses">アーカイブを読めませんでした。オフラインかもしれません。</p>'
  }
}

/* ---------- インストール ---------- */

// 入れられる状態になったらボタンを出す。押すまで邪魔はしない
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installEvent = e
  installBtn.hidden = false
})

installBtn.addEventListener('click', async () => {
  if (!installEvent) return
  installBtn.disabled = true
  installEvent.prompt()
  await installEvent.userChoice.catch(() => {})
  installEvent = null
  installBtn.hidden = true
  installBtn.disabled = false
})

window.addEventListener('appinstalled', () => {
  installEvent = null
  installBtn.hidden = true
  toast('ホーム画面に入れました')
})

/** iOS は beforeinstallprompt が来ないので、一度だけ置き方を書いておく */
function iosHint() {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  if (!isIOS || standalone) return
  try {
    if (localStorage.getItem('ideaz-ios-hint') === 'done') return
    localStorage.setItem('ideaz-ios-hint', 'done')
  } catch {
    return
  }
  showBanner('ios', '共有ボタンから「ホーム画面に追加」すると、アプリとして開けます。')
}

/* ---------- 更新 ---------- */

function watchForUpdate(reg) {
  const offer = (worker) => {
    showBanner('update', '新しい版があります。', {
      label: '更新',
      run: () => {
        hideBanner()
        wantsReload = true
        worker.postMessage('skip-waiting')
      },
    })
  }

  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting)

  reg.addEventListener('updatefound', () => {
    const sw = reg.installing
    if (!sw) return
    sw.addEventListener('statechange', () => {
      if (sw.state === 'installed' && navigator.serviceWorker.controller) offer(sw)
    })
  })
}

/** アーカイブから今日の5枠へ戻す */
async function backToToday() {
  hideBanner('past')
  viewingArchive = false
  today = null
  if (!(await refresh({ quiet: false }))) toast('今日の分を取りにいけませんでした')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/* ---------- boot ---------- */

/** current.json を見にいって、日が変わっていれば入れ替える */
async function refresh({ quiet = true } = {}) {
  // 古い日を開いているときは、勝手に今日へ戻さない
  if (viewingArchive) return true
  try {
    const day = await getJSON('data/current.json')
    if (!today || day.date !== today.date) {
      const changed = Boolean(today)
      render(day)
      if (changed) toast('5個とも入れ替わりました')
    }
    return true
  } catch {
    if (!quiet) toast('いまは取りにいけませんでした')
    return false
  }
}

async function boot() {
  skeletons()
  try {
    render(await getJSON('data/current.json'))
    viewingArchive = false
  } catch {
    cards.innerHTML =
      '<p class="error">今日の分をまだ読めていません。オンラインで一度開けば、そのあとはオフラインでも見られます。</p>'
    cards.setAttribute('aria-busy', 'false')
    dateLabel.textContent = '未取得'
  }
  tickNext()
  setInterval(tickNext, 30000)

  // ショートカットの「アーカイブ」から立ち上げたとき
  if (new URLSearchParams(location.search).get('view') === 'archive') openArchive()

  iosHint()
}

document.getElementById('viewer-close').addEventListener('click', () => viewer.close())
document.getElementById('archive-btn').addEventListener('click', openArchive)
document.getElementById('archive-close').addEventListener('click', () => archive.close())

for (const dlg of [viewer, archive]) {
  // 板の外側を押したら閉じる
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close()
  })
  // 閉じたら、開く前に触っていたところへ戻す
  dlg.addEventListener('close', () => {
    if (dlg === viewer) openSlot = null
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus()
    lastFocus = null
  })
}

// 巻き上げたら見出しの下に線を出す
const onScroll = () => header.classList.toggle('stuck', window.scrollY > 4)
addEventListener('scroll', onScroll, { passive: true })
onScroll()

// 表に戻ってきたら、日付が変わっていないか確かめる
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  tickNext()
  refresh()
})

addEventListener('online', () => {
  hideBanner('offline')
  refresh()
})

addEventListener('offline', () => {
  showBanner('offline', 'オフラインです。前に開いた分を表示しています。')
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js')
      watchForUpdate(reg)
      // 表に戻るたび、新しい殻が出ていないか確かめる
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {})
      })
    } catch {
      /* SW が動かない環境でも、中身は普通に読める */
    }
  })

  // 「更新」を押したときだけ、入れ替わったところで一度読み直す。
  // 初回は SW が引き受けたところでも controllerchange が来るが、
  // 中身は同じなので読み直さない（開いたそばから点滅させない）
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wantsReload || reloading) return
    reloading = true
    location.reload()
  })
}

boot()
