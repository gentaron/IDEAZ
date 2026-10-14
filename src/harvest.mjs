// 候補を集めるところ。鍵の要らない公開の口だけを叩く。
//
// どの口を回すかは memory/feeds.json に書いてある（memory/sources.md の網を、機械で回れる形にしたもの）。
// どれか1つが落ちても止めない。落ちた分は減るだけで、他から拾えていれば探索は続く。

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'ideaz-bot/1.0 (+https://github.com/gentaron/IDEAZ)'
// ブラウザの顔をしないと門前払いする口がある（Reddit の RSS など）
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const TIMEOUT = 20000

export function loadFeeds(path = join(ROOT, 'memory', 'feeds.json')) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function get(url, { headers = {}, as = 'json', ua = UA } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': ua, Accept: as === 'json' ? 'application/json' : '*/*', ...headers },
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return as === 'json' ? res.json() : res.text()
}

/** 落ちても全体を止めない包み */
async function soft(name, fn, log) {
  try {
    const items = await fn()
    log(`  ${name}: ${items.length}件`)
    return items
  } catch (e) {
    log(`  ${name}: 取れなかった（${e.message}）`)
    return []
  }
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const strip = (s) => clean(String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '))
const decode = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")

/* ---------- 個々のソース ---------- */

/** Hacker News。技術者の評価と批判。Algolia は OR を解さないので、語ごとに投げる */
async function hackerNews(sinceSec, cfg) {
  const batches = await Promise.all(
    cfg.queries.map(async (q) => {
      const url =
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}` +
        `&tags=story&numericFilters=created_at_i>${sinceSec},points>${cfg.minPoints}&hitsPerPage=30`
      return (await get(url).catch(() => ({ hits: [] }))).hits || []
    })
  )
  return batches.flat().map((h) => ({
    source: 'Hacker News',
    title: clean(h.title),
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    summary: clean(h.story_text).slice(0, 400),
    score: h.points || 0,
    discussion: `https://news.ycombinator.com/item?id=${h.objectID}`
  }))
}

/** Reddit。JSON が 403 になる日は、同じものを RSS（Atom）で取り直す */
async function reddit(sub, minScore) {
  try {
    const data = await get(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=25`, { ua: BROWSER_UA })
    return (data.data?.children || [])
      .map((c) => c.data)
      .filter((p) => p && !p.stickied && (p.score || 0) >= minScore)
      .map((p) => ({
        source: `r/${sub}`,
        title: clean(p.title),
        url: p.url_overridden_by_dest || `https://www.reddit.com${p.permalink}`,
        summary: clean(p.selftext).slice(0, 400),
        score: p.score || 0,
        discussion: `https://www.reddit.com${p.permalink}`
      }))
  } catch {
    // RSS には点数が無い。top の並び順が点数の代わり
    const xml = await get(`https://www.reddit.com/r/${sub}/top/.rss?t=day&limit=15`, { as: 'text', ua: BROWSER_UA })
    return parseFeed(xml, `r/${sub}`).map((it, i) => ({ ...it, score: Math.max(1, 15 - i) }))
  }
}

/** Hugging Face。モデルのトレンド / Daily Papers / トレンドの Spaces */
async function huggingFaceModels() {
  const data = await get('https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=30')
  return (data || []).map((m) => ({
    source: 'Hugging Face',
    title: clean(m.id),
    url: `https://huggingface.co/${m.id}`,
    summary: clean(
      [m.pipeline_tag, (m.tags || []).filter((t) => !t.includes(':')).slice(0, 8).join(', ')]
        .filter(Boolean)
        .join(' / ')
    ),
    score: Math.round(m.trendingScore || m.likes || 0)
  }))
}

async function huggingFacePapers() {
  const data = await get('https://huggingface.co/api/daily_papers?limit=30')
  return (data || []).map((d) => {
    const p = d.paper || d
    return {
      source: 'HF Daily Papers',
      title: clean(p.title || d.title),
      url: `https://huggingface.co/papers/${p.id}`,
      summary: clean(p.summary || p.ai_summary).slice(0, 500),
      score: p.upvotes || d.upvotes || 0
    }
  })
}

async function huggingFaceSpaces() {
  const data = await get('https://huggingface.co/api/spaces?sort=trendingScore&direction=-1&limit=20')
  return (data || []).map((s) => ({
    source: 'HF Spaces',
    title: clean(s.id),
    url: `https://huggingface.co/spaces/${s.id}`,
    summary: clean([s.sdk, (s.tags || []).filter((t) => !t.includes(':')).slice(0, 6).join(', ')].filter(Boolean).join(' / ')),
    score: Math.round(s.trendingScore || s.likes || 0)
  }))
}

/** GitHub。新しいリポジトリ。GITHUB_TOKEN があれば上限が緩む（無くても動く） */
async function github(sinceISO, cfg) {
  const headers = { Accept: 'application/vnd.github+json' }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  const batches = await Promise.all(
    cfg.queries.map(async (topic) => {
      const q = encodeURIComponent(`created:>${sinceISO.slice(0, 10)} stars:>${cfg.minStars} ${topic}`)
      const data = await get(`https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=20`, { headers }).catch(
        () => ({ items: [] })
      )
      return data.items || []
    })
  )
  return batches.flat().map((r) => ({
    source: 'GitHub',
    title: clean(r.full_name),
    url: r.html_url,
    summary: clean(r.description).slice(0, 400),
    score: r.stargazers_count || 0
  }))
}

/** arXiv。原論文。RSS が先、駄目なら API（API は Actions から 429 になりやすい） */
async function arxiv(cats) {
  try {
    const xml = await get(`https://rss.arxiv.org/rss/${cats.join('+')}`, { as: 'text' })
    const items = parseFeed(xml, 'arXiv')
    if (items.length) return items.slice(0, 40)
  } catch {
    /* API に回す */
  }
  const q = encodeURIComponent(cats.map((c) => `cat:${c}`).join(' OR '))
  const xml = await get(
    `https://export.arxiv.org/api/query?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=30`,
    { as: 'text' }
  )
  return parseFeed(xml, 'arXiv')
}

/** RSS 2.0 / Atom / RDF をまとめて読む。日付が読めて古すぎるものは落とす */
export function parseFeed(xml, name, sinceMs = 0) {
  const chunks = [...String(xml).matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)]
  return chunks
    .map((m) => {
      const e = m[2]
      const pick = (tag) => (e.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`)) || [])[1] || ''
      const link =
        clean(strip(pick('link'))) ||
        (e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || [])[1] ||
        (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] ||
        clean(strip(pick('guid')))
      const when = Date.parse(strip(pick('pubDate') || pick('published') || pick('updated') || pick('dc:date')))
      return {
        source: name,
        title: decode(strip(pick('title'))),
        url: decode(link),
        summary: decode(strip(pick('description') || pick('summary') || pick('content'))).slice(0, 400),
        score: 0,
        publishedAt: Number.isFinite(when) ? new Date(when).toISOString() : undefined
      }
    })
    .filter((it) => !sinceMs || !it.publishedAt || Date.parse(it.publishedAt) >= sinceMs)
    .slice(0, 15)
}

async function feed(name, url, sinceMs) {
  return parseFeed(await get(url, { as: 'text' }), name, sinceMs)
}

/** RSS を出していない公式。一覧ページの内部リンクから記事を拾う */
export function parseListPage(html, { name, url, pattern }) {
  const base = new URL(url)
  const re = new RegExp(pattern)
  const seen = new Set()
  const out = []
  for (const m of String(html).matchAll(/<a\b[^>]*href="([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = m[1]
    const path = href.startsWith('http') ? (() => { try { const u = new URL(href); return u.host === base.host ? u.pathname : '' } catch { return '' } })() : href
    if (!path || !re.test(path) || seen.has(path)) continue
    seen.add(path)
    // リンクの中に見出しがあればそれを題名にする（日付やカテゴリの札が混ざらないように）
    const heading =
      (m[2].match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/) || [])[1] ||
      (m[2].match(/<[a-z]+[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i) || [])[1]
    const title = decode(strip(heading || m[2]))
    if (!title || title.length < 6) continue
    out.push({ source: name, title: title.slice(0, 160), url: new URL(path, base).href, summary: '', score: 0 })
  }
  return out.slice(0, 12)
}

async function listPage(p) {
  return parseListPage(await get(p.url, { as: 'text', ua: BROWSER_UA }), p)
}

/** note の他の書き手。検索は非公式の口なので、形が変わっていたら空で返す */
async function noteSearch(q) {
  const data = await get(
    `https://note.com/api/v3/searches?context=note&q=${encodeURIComponent(q)}&size=20&start=0&sort=new`
  )
  const notes = data?.data?.notes?.contents || data?.data?.notes || []
  return (Array.isArray(notes) ? notes : []).map((n) => ({
    source: 'note',
    title: clean(n.name),
    url: n.noteUrl || (n.user?.urlname && n.key ? `https://note.com/${n.user.urlname}/n/${n.key}` : ''),
    summary: clean(n.description || n.body).slice(0, 300),
    score: n.likeCount || 0
  }))
}

/* ---------- 偏らせずに並べる ---------- */

/**
 * 点数の高い口（HF・GitHub・HN）だけで候補が埋まらないように、group ごとに順番に1件ずつ取る。
 * RSS は点数が 0 なので、点数順に切ると公式ブログや日本語の解説が毎回落ちていた。
 */
export function balance(items, limit) {
  const groups = new Map()
  for (const it of items) {
    const g = it.group || it.source
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(it)
  }
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        (b.score || 0) - (a.score || 0) || Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)
    )
  }
  const queues = [...groups.values()]
  const out = []
  while (out.length < limit && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (q.length && out.length < limit) out.push(q.shift())
    }
  }
  return out
}

/* ---------- まとめて回す ---------- */

/** 直近 hours 時間ぶんの候補を、鍵の要らない口から集める */
export async function harvest({ hours = 72, log = console.log, feeds = loadFeeds() } = {}) {
  const sinceSec = Math.floor(Date.now() / 1000) - hours * 3600
  const sinceMs = sinceSec * 1000
  const sinceISO = new Date(sinceMs).toISOString()
  const tag = (group) => (items) => items.map((it) => ({ ...it, group }))

  log('候補を集める（鍵の要らない公開の口だけ）…')

  const jobs = [
    soft('Hacker News', () => hackerNews(sinceSec, feeds.hackerNews).then(tag('Hacker News')), log),
    ...feeds.reddit.subs.map((sub) =>
      soft(`r/${sub}`, () => reddit(sub, feeds.reddit.minScore).then(tag('Reddit')), log)
    ),
    soft('GitHub', () => github(sinceISO, feeds.github).then(tag('GitHub')), log),
    soft('arXiv', () => arxiv(feeds.arxiv.categories).then(tag('arXiv')), log),
    ...feeds.feeds.map((f) => soft(f.name, () => feed(f.name, f.url, sinceMs).then(tag(f.group)), log)),
    ...feeds.pages.list.map((p) => soft(p.name, () => listPage(p).then(tag(p.group)), log)),
    ...feeds.youtube.channels.map((c) =>
      soft(
        `YouTube: ${c.name}`,
        () =>
          feed(`YouTube: ${c.name}`, `https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}`, sinceMs).then(
            tag('YouTube')
          ),
        log
      )
    ),
    ...feeds.noteCom.queries.map((q) => soft(`note「${q}」`, () => noteSearch(q).then(tag('note')), log)),
    ...feeds.noteCom.creators.map((u) =>
      soft(`note: ${u}`, () => feed(`note: ${u}`, `https://note.com/${u}/rss`, sinceMs).then(tag('note')), log)
    ),
    ...feeds.x.rss.map((url, i) => soft(`X (${i + 1})`, () => feed('X', url, sinceMs).then(tag('X')), log))
  ]
  if (feeds.huggingFace.models) jobs.push(soft('Hugging Face', () => huggingFaceModels().then(tag('Hugging Face')), log))
  if (feeds.huggingFace.dailyPapers) jobs.push(soft('HF Daily Papers', () => huggingFacePapers().then(tag('HF Daily Papers')), log))
  if (feeds.huggingFace.spaces) jobs.push(soft('HF Spaces', () => huggingFaceSpaces().then(tag('HF Spaces')), log))

  const batches = await Promise.all(jobs)

  // URLで重複を落とす。点の高い方を残す
  const byUrl = new Map()
  for (const item of batches.flat()) {
    if (!item.title || !item.url || !/^https?:\/\//.test(item.url)) continue
    const key = item.url.replace(/[#?].*$/, '').replace(/\/$/, '')
    const prev = byUrl.get(key)
    if (!prev || (item.score || 0) > (prev.score || 0)) byUrl.set(key, item)
  }

  const all = [...byUrl.values()].sort((a, b) => (b.score || 0) - (a.score || 0))
  const groups = new Set(all.map((it) => it.group))
  log(`  → 重複を落として ${all.length}件（${groups.size}系統）`)
  return all
}

/** 短く読めた分だけ本文を取る。取れなくても構わない */
export async function excerpt(url, chars = 2500) {
  try {
    const html = await get(url, { as: 'text' })
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return text.slice(0, chars)
  } catch {
    return ''
  }
}
