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

const templatesDlg = document.getElementById('templates')
const tplThemes = document.getElementById('tpl-themes')
const tplList = document.getElementById('tpl-list')

let today = null
let openDoc = null
// 閉じたときに戻すフォーカス。ダイアログを重ねて開くので、板ごとに覚えておく
const returnFocus = new Map()
let templates = null
let tplTheme = 'all'
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
  const searched = day.slots.filter((s) => s.topic).length
  dateLabel.textContent =
    `${day.date}（マレーシア時間）` + (searched ? ` · 題材 ${searched}/${day.slots.length}` : '')
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

    if (slot.topic) {
      // 今朝の探索で題材まで決まっている日。カードの主役は題材
      lensLabel.textContent = '今日の題材'
      const title = document.createElement('strong')
      title.className = 'topic-title'
      title.textContent = slot.topic.title
      lens.append(lensLabel, title)

      if (slot.topic.whatChanged) {
        const what = document.createElement('span')
        what.className = 'topic-what'
        what.textContent = slot.topic.whatChanged
        lens.append(what)
      }

      const angle = document.createElement('span')
      angle.className = 'topic-angle'
      angle.textContent = `角度: ${slot.lens}`
      lens.append(angle)

      if (slot.topic.sources?.length) {
        const src = document.createElement('span')
        src.className = 'topic-sources'
        src.textContent = `根拠 ${slot.topic.sources.length} 件`
        lens.append(src)
      }
    } else {
      // 題材が決まらなかった枠。角度だけ渡して、探すところから書き手にやってもらう
      lensLabel.textContent = '今日の角度'
      lens.append(lensLabel, document.createTextNode(slot.lens))
    }

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
    openBtn.addEventListener('click', () =>
      openViewer({ title: `${slot.time} ${slot.label}`, prompt: slot.prompt, shareTitle: `IDEAZ ${slot.time}` })
    )

    actions.append(copyBtn, openBtn)
    card.append(head, lens, actions)
    cards.append(card)
  }

  cards.setAttribute('aria-busy', 'false')
}

/** ダイアログを開く。閉じたら、開く前に触っていたところへ戻す */
function openDialog(dlg) {
  if (dlg.open) return
  returnFocus.set(dlg, document.activeElement)
  dlg.showModal()
}

/** 全文の板。毎朝の枠でもテンプレでも同じものを使う */
function openViewer({ title, prompt, shareTitle }) {
  openDoc = { prompt, shareTitle }
  viewerTitle.textContent = title
  viewerBody.textContent = prompt
  viewerCopy.onclick = () => copy(prompt, 'コピーしました')
  viewerShare.hidden = typeof navigator.share !== 'function'
  openDialog(viewer)
  viewerBody.scrollTop = 0
}

viewerShare.addEventListener('click', async () => {
  if (!openDoc) return
  try {
    await navigator.share({ title: openDoc.shareTitle, text: openDoc.prompt })
  } catch {
    /* 取り消しただけ。何も言わない */
  }
})

/* ---------- archive ---------- */

async function openArchive() {
  if (archive.open) return
  openDialog(archive)
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
      l.textContent = day.lenses.map((x) => `${x.time} ${x.title || x.lens}`).join(' / ')

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

/* ---------- テーマ別テンプレ ---------- */

const TPL_KEY = 'ideaz-tpl-theme'

/** テンプレの全文。土台は1回だけ配られているので、ここでつなぐ */
function tplPrompt(item) {
  return `${item.head}\n\n${templates.common}`
}

function tplItem(item) {
  const row = document.createElement('article')
  row.className = 'tpl'

  const no = document.createElement('span')
  no.className = 'tpl-no'
  no.textContent = `No.${item.no}`

  const title = document.createElement('strong')
  title.className = 'tpl-title'
  title.textContent = item.title

  const promise = document.createElement('p')
  promise.className = 'tpl-promise'
  promise.textContent = `約束: ${item.promise}`

  const actions = document.createElement('div')
  actions.className = 'actions'

  const copyBtn = document.createElement('button')
  copyBtn.className = 'primary'
  copyBtn.type = 'button'
  copyBtn.textContent = 'コピー'
  copyBtn.addEventListener('click', () => copy(tplPrompt(item), `No.${item.no} をコピーしました`))

  const openBtn = document.createElement('button')
  openBtn.className = 'ghost'
  openBtn.type = 'button'
  openBtn.textContent = '全文'
  openBtn.addEventListener('click', () =>
    openViewer({ title: `No.${item.no} ${item.title}`, prompt: tplPrompt(item), shareTitle: `IDEAZ No.${item.no}` })
  )

  actions.append(copyBtn, openBtn)
  row.append(no, title, promise, actions)
  return row
}

function renderTemplates() {
  if (!templates) return
  const known = templates.themes.some((t) => t.id === tplTheme)
  if (!known) tplTheme = 'all'

  tplThemes.innerHTML = ''
  const chips = [{ id: 'all', name: `すべて ${templates.count}` }, ...templates.themes]
  for (const t of chips) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip'
    chip.textContent = t.name
    chip.setAttribute('aria-pressed', String(t.id === tplTheme))
    chip.addEventListener('click', () => {
      tplTheme = t.id
      try {
        localStorage.setItem(TPL_KEY, t.id)
      } catch {
        /* 覚えられなくても困らない */
      }
      renderTemplates()
      tplList.scrollTop = 0
    })
    tplThemes.append(chip)
  }

  tplList.innerHTML = ''
  const shown = tplTheme === 'all' ? templates.themes : templates.themes.filter((t) => t.id === tplTheme)
  for (const theme of shown) {
    const section = document.createElement('section')
    section.className = 'tpl-theme'
    const h = document.createElement('h2')
    h.textContent = theme.name
    const blurb = document.createElement('p')
    blurb.className = 'tpl-blurb'
    blurb.textContent = theme.blurb
    section.append(h, blurb)
    for (const item of theme.items) section.append(tplItem(item))
    tplList.append(section)
  }

  // 選んだテーマの札が見えるところまで送る
  tplThemes.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

async function openTemplates() {
  if (templatesDlg.open) return
  openDialog(templatesDlg)
  if (templates) return
  try {
    tplTheme = localStorage.getItem(TPL_KEY) || 'all'
  } catch {
    tplTheme = 'all'
  }
  tplList.innerHTML = '<p class="archive-lenses">読み込み中…</p>'
  try {
    templates = await getJSON('data/templates.json')
    renderTemplates()
  } catch {
    tplList.innerHTML = '<p class="archive-lenses">テンプレを読めませんでした。オフラインかもしれません。</p>'
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

  // ショートカットの「アーカイブ」「テンプレ」から立ち上げたとき
  const view = new URLSearchParams(location.search).get('view')
  if (view === 'archive') openArchive()
  if (view === 'templates') openTemplates()

  iosHint()
}

document.getElementById('viewer-close').addEventListener('click', () => viewer.close())
document.getElementById('archive-btn').addEventListener('click', openArchive)
document.getElementById('archive-close').addEventListener('click', () => archive.close())
document.getElementById('templates-btn').addEventListener('click', openTemplates)
document.getElementById('templates-close').addEventListener('click', () => templatesDlg.close())

for (const dlg of [viewer, archive, templatesDlg]) {
  // 板の外側を押したら閉じる
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close()
  })
  // 閉じたら、開く前に触っていたところへ戻す
  dlg.addEventListener('close', () => {
    if (dlg === viewer) openDoc = null
    const back = returnFocus.get(dlg)
    returnFocus.delete(dlg)
    if (back && document.contains(back)) back.focus()
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
