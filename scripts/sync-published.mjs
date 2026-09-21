// すでに公開した記事の見出しを取ってきて memory/published.json に貯める。
//
//   node scripts/sync-published.mjs          # 差分だけ取る（既にある分は触らない）
//   node scripts/sync-published.mjs --full   # 最初から全部取り直す
//
// note.com の公開APIは鍵が要らない。取れなければRSSに落とす。
// 取れた分だけ足して、取れなかったときは前の内容を壊さない。

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(ROOT, 'memory', 'published.json')

const UA = 'ideaz-bot/1.0 (+https://github.com/gentaron/IDEAZ)'
const MAX_PAGES = Number(process.env.IDEAZ_PUBLISHED_MAX_PAGES || 60)
const full = process.argv.includes('--full')

const db = JSON.parse(readFileSync(FILE, 'utf8'))
const known = new Map((db.titles || []).map((t) => [t.url || t.title, t]))
const before = known.size

async function get(url, as = 'json') {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : '*/*' },
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return as === 'json' ? res.json() : res.text()
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()

/** note.com の返す形は揺れることがあるので、それらしい所から拾う */
function pickContents(payload) {
  const c = payload?.data?.contents || payload?.contents || payload?.data?.notes
  return Array.isArray(c) ? c : []
}

function pickTitle(item) {
  return clean(item?.name || item?.title || item?.displayName)
}

function pickUrl(item, account) {
  const u = item?.noteUrl || item?.url
  if (u) return u
  if (item?.key) return `https://${account}/n/${item.key}`
  return ''
}

function isLast(payload, got) {
  const d = payload?.data || payload
  if (typeof d?.isLastPage === 'boolean') return d.isLastPage
  return got === 0
}

/** 公開APIを順に辿る */
async function viaApi(account) {
  const urlname = account.split('/').pop()
  const out = []

  for (let page = 1; page <= MAX_PAGES; page++) {
    const payload = await get(
      `https://note.com/api/v2/creators/${urlname}/contents?kind=note&page=${page}`
    )
    const items = pickContents(payload)

    for (const item of items) {
      const title = pickTitle(item)
      if (!title) continue
      out.push({
        title,
        url: pickUrl(item, account),
        publishedAt: clean(item?.publishAt || item?.publishedAt || item?.createdAt) || null,
        account
      })
    }

    if (isLast(payload, items.length)) break

    // 差分だけでいいなら、既に知っている見出しに当たった時点で止める
    if (!full && out.some((t) => known.has(t.url || t.title))) break

    await new Promise((r) => setTimeout(r, 400)) // 続けて叩きすぎない
  }

  return out
}

/** APIが駄目なときの保険。直近ぶんしか取れない */
async function viaRss(account) {
  const xml = await get(`https://${account}/rss`, 'text')
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const e = m[1]
    const pick = (tag) => clean((e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1])
    const strip = (s) => clean(s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ''))
    return {
      title: strip(pick('title')),
      url: pick('link'),
      publishedAt: clean(pick('pubDate')) || null,
      account
    }
  })
}

let failures = 0

for (const account of db.accounts || []) {
  let got = []
  try {
    got = await viaApi(account)
    console.log(`${account}: APIから ${got.length}本`)
  } catch (e) {
    console.warn(`${account}: APIが駄目だった（${e.message}）。RSSを試す`)
    try {
      got = await viaRss(account)
      console.log(`${account}: RSSから ${got.length}本（直近ぶんだけ）`)
    } catch (e2) {
      console.error(`${account}: RSSも駄目だった（${e2.message}）`)
      failures++
      continue
    }
  }

  for (const t of got) {
    if (!t.title) continue
    known.set(t.url || t.title, t)
  }
}

if (failures && failures === (db.accounts || []).length) {
  console.error('どのアカウントからも取れなかった。前の内容を残して終わる')
  process.exit(1)
}

const titles = [...known.values()].sort((a, b) =>
  String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))
)

writeFileSync(
  FILE,
  JSON.stringify({ ...db, syncedAt: new Date().toISOString(), count: titles.length, titles }, null, 2) + '\n'
)

console.log(`\nすでに公開した記事: ${titles.length}本（前回から +${titles.length - before}）`)
