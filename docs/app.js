const cards = document.getElementById('cards')
const dateLabel = document.getElementById('date-label')
const nextLabel = document.getElementById('next-label')
const toastEl = document.getElementById('toast')

const viewer = document.getElementById('viewer')
const viewerTitle = document.getElementById('viewer-title')
const viewerBody = document.getElementById('viewer-body')
const viewerCopy = document.getElementById('viewer-copy')

const archive = document.getElementById('archive')
const archiveList = document.getElementById('archive-list')

let today = null

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

/* ---------- rendering ---------- */

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
}

function openViewer(slot) {
  viewerTitle.textContent = `${slot.time} ${slot.label}`
  viewerBody.textContent = slot.prompt
  viewerCopy.onclick = () => copy(slot.prompt, 'コピーしました')
  viewer.showModal()
  viewerBody.scrollTop = 0
}

/* ---------- archive ---------- */

async function openArchive() {
  archive.showModal()
  archiveList.innerHTML = '<p class="archive-lenses">読み込み中…</p>'
  try {
    const index = await fetch('data/index.json', { cache: 'no-cache' }).then((r) => r.json())
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
        const doc = await fetch(`data/archive/${day.date}.json`, { cache: 'no-cache' }).then((r) => r.json())
        archive.close()
        render(doc)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        if (doc.date !== index.latest) toast(`${doc.date} の分を表示しています`)
      })

      wrap.append(d, l, btn)
      archiveList.append(wrap)
    }
    if (!index.days.length) archiveList.innerHTML = '<p class="archive-lenses">まだ何もありません。</p>'
  } catch {
    archiveList.innerHTML = '<p class="archive-lenses">アーカイブを読めませんでした。オフラインかもしれません。</p>'
  }
}

/* ---------- boot ---------- */

async function boot() {
  try {
    const day = await fetch('data/current.json', { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(String(r.status))
      return r.json()
    })
    render(day)
  } catch {
    cards.innerHTML =
      '<p class="error">今日の分をまだ読めていません。オンラインで一度開けば、そのあとはオフラインでも見られます。</p>'
    dateLabel.textContent = '未取得'
  }
  tickNext()
  setInterval(tickNext, 30000)
}

document.getElementById('viewer-close').addEventListener('click', () => viewer.close())
document.getElementById('archive-btn').addEventListener('click', openArchive)
document.getElementById('archive-close').addEventListener('click', () => archive.close())

for (const dlg of [viewer, archive]) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close()
  })
}

// 表に戻ってきたら、日付が変わっていないか確かめる
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  tickNext()
  fetch('data/current.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .then((day) => {
      if (today && day.date !== today.date) {
        render(day)
        toast('5個とも入れ替わりました')
      }
    })
    .catch(() => {})
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}))
}

boot()
