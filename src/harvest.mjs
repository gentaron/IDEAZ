// 候補を集めるところ。鍵の要らない公開の口だけを叩く。
//
// memory/sources.md に書いてある網を、そのまま機械で回れる形にしてある。
// どれか1つが落ちても止めない。落ちた分は減るだけで、他から拾えていれば探索は続く。

const UA = 'ideaz-bot/1.0 (+https://github.com/gentaron/IDEAZ)'
const TIMEOUT = 20000

async function get(url, { headers = {}, as = 'json' } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : '*/*', ...headers },
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

/* ---------- 個々のソース ---------- */

/** Hacker News。技術者の評価と批判。Algolia の公開APIは鍵が要らない */
async function hackerNews(sinceSec) {
  const q = encodeURIComponent('AI OR LLM OR model OR inference OR GPU OR open-source')
  const url =
    `https://hn.algolia.com/api/v1/search?query=${q}` +
    `&tags=story&numericFilters=created_at_i>${sinceSec},points>30&hitsPerPage=40`
  const data = await get(url)
  return (data.hits || []).map((h) => ({
    source: 'Hacker News',
    title: clean(h.title),
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    summary: clean(h.story_text).slice(0, 400),
    score: h.points || 0,
    discussion: `https://news.ycombinator.com/item?id=${h.objectID}`
  }))
}

/** Reddit。ローカル実行と量子化の現場。ここは特に効く、と正本にある */
async function reddit(sub) {
  const data = await get(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=25`)
  return (data.data?.children || [])
    .map((c) => c.data)
    .filter((p) => p && !p.stickied && (p.score || 0) >= 40)
    .map((p) => ({
      source: `r/${sub}`,
      title: clean(p.title),
      url: p.url_overridden_by_dest || `https://www.reddit.com${p.permalink}`,
      summary: clean(p.selftext).slice(0, 400),
      score: p.score || 0,
      discussion: `https://www.reddit.com${p.permalink}`
    }))
}

/** Hugging Face。モデル配布とトレンド */
async function huggingFace() {
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

/** GitHub。新しいリポジトリ。GITHUB_TOKEN があれば上限が緩む（無くても動く） */
async function github(sinceISO) {
  const q = encodeURIComponent(`created:>${sinceISO.slice(0, 10)} stars:>80 topic:ai`)
  const headers = { Accept: 'application/vnd.github+json' }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  const data = await get(`https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=25`, { headers })
  return (data.items || []).map((r) => ({
    source: 'GitHub',
    title: clean(r.full_name),
    url: r.html_url,
    summary: clean(r.description).slice(0, 400),
    score: r.stargazers_count || 0
  }))
}

/** arXiv。原論文。Atom が返ってくる */
async function arxiv(cats) {
  const q = encodeURIComponent(cats.map((c) => `cat:${c}`).join(' OR '))
  const xml = await get(
    `http://export.arxiv.org/api/query?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=30`,
    { as: 'text' }
  )
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1]
    const pick = (tag) => clean((e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1])
    return {
      source: 'arXiv',
      title: pick('title'),
      url: pick('id'),
      summary: pick('summary').slice(0, 500),
      score: 0
    }
  })
}

/** 各社の公式ブログ・リリース。RSS / Atom をそのまま読む */
async function feed(name, url) {
  const xml = await get(url, { as: 'text' })
  const chunks = [...xml.matchAll(/<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g)].slice(0, 12)
  return chunks.map((m) => {
    const e = m[1]
    const pick = (tag) => clean((e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1])
    const strip = (s) => clean(s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ''))
    const link = pick('link') || (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || ''
    return {
      source: name,
      title: strip(pick('title')),
      url: link,
      summary: strip(pick('description') || pick('summary')).slice(0, 400),
      score: 0
    }
  })
}

/* ---------- まとめて回す ---------- */

const FEEDS = [
  ['Hugging Face Blog', 'https://huggingface.co/blog/feed.xml'],
  ['Google Research', 'https://blog.google/technology/ai/rss/'],
  ['Meta AI', 'https://ai.meta.com/blog/rss/'],
  ['Simon Willison', 'https://simonwillison.net/atom/everything/'],
  ['Ollama', 'https://github.com/ollama/ollama/releases.atom'],
  ['llama.cpp', 'https://github.com/ggml-org/llama.cpp/releases.atom'],
  ['vLLM', 'https://github.com/vllm-project/vllm/releases.atom']
]

/** 直近 hours 時間ぶんの候補を、鍵の要らない口から集める */
export async function harvest({ hours = 72, log = console.log } = {}) {
  const sinceSec = Math.floor(Date.now() / 1000) - hours * 3600
  const sinceISO = new Date(Date.now() - hours * 3600 * 1000).toISOString()

  log('候補を集める（鍵の要らない公開の口だけ）…')

  const batches = await Promise.all([
    soft('Hacker News', () => hackerNews(sinceSec), log),
    soft('r/LocalLLaMA', () => reddit('LocalLLaMA'), log),
    soft('r/MachineLearning', () => reddit('MachineLearning'), log),
    soft('Hugging Face', () => huggingFace(), log),
    soft('GitHub', () => github(sinceISO), log),
    soft('arXiv', () => arxiv(['cs.CL', 'cs.LG', 'cs.AI']), log),
    ...FEEDS.map(([name, url]) => soft(name, () => feed(name, url), log))
  ])

  // URLで重複を落とす。点の高い方を残す
  const byUrl = new Map()
  for (const item of batches.flat()) {
    if (!item.title || !item.url || !/^https?:\/\//.test(item.url)) continue
    const key = item.url.replace(/[#?].*$/, '').replace(/\/$/, '')
    const prev = byUrl.get(key)
    if (!prev || (item.score || 0) > (prev.score || 0)) byUrl.set(key, item)
  }

  const all = [...byUrl.values()].sort((a, b) => (b.score || 0) - (a.score || 0))
  log(`  → 重複を落として ${all.length}件`)
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
