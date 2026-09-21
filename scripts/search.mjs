// 今日の題材を探す。1日1回、Cron から呼ばれる。
//
//   node scripts/search.mjs             # 今日（MYT）の分を探す
//   node scripts/search.mjs 2026-10-01  # 日付を指定して探す
//   node scripts/search.mjs --dry-run   # 何も叩かず、投げる指示書だけ出す
//   node scripts/search.mjs --harvest   # 候補集めだけ試す（AIは呼ばない）
//
// 使うのは無料のものだけ。
//   集める = 鍵の要らない公開の口（HN / Reddit / HF / GitHub / arXiv / RSS）
//   選ぶ   = 無料枠のLLM（GitHub Models など。src/llm.mjs 参照）
//
// 結果は docs/data/topics/YYYY-MM-DD.json に出る。
// ここが失敗しても generate は動く。その日は「角度だけ配って、探すのは書き手」に戻るだけ。

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mytDate, planDay } from '../src/build.mjs'
import { judgeSystem, shortlistTask, decideTask } from '../src/brief.mjs'
import { harvest, excerpt } from '../src/harvest.mjs'
import { pickProvider, chat, parseJSON } from '../src/llm.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', 'data', 'topics')

const HOURS = Number(process.env.IDEAZ_WINDOW_HOURS || 72)
const SHORTLIST = Number(process.env.IDEAZ_SHORTLIST || 14)
const CANDIDATES = Number(process.env.IDEAZ_CANDIDATES || 70)

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const harvestOnly = args.includes('--harvest')
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || mytDate()

const bad = args.find((a) => a.startsWith('-') && !['--dry-run', '--harvest'].includes(a))
if (bad) {
  console.error(`知らない引数: ${bad}`)
  process.exit(1)
}

/* ---------- 何も叩かずに中身だけ見る ---------- */

if (dryRun) {
  const sample = [
    { source: 'Hacker News', title: '（候補の見出しがここに並ぶ）', url: 'https://example.com/1', summary: '', score: 120 }
  ]
  console.log('===== system =====')
  console.log(judgeSystem())
  console.log('\n===== 1段目: 候補をふるいにかける =====')
  console.log(shortlistTask(date, sample, SHORTLIST))
  console.log('\n===== 2段目: 5枠に配る =====')
  console.log(decideTask(date, [{ ...sample[0], excerpt: '（読めた分の本文）' }]))
  let who = '（使える無料の口が無い）'
  try {
    const p = pickProvider()
    who = `${p.label} / ${p.model}`
  } catch (e) {
    who = e.message.split('\n')[0]
  }
  console.log(`\n(${date} / 相手: ${who} / 直近${HOURS}時間 / 候補${CANDIDATES}件 → ${SHORTLIST}件)`)
  console.log('何も叩いていない')
  process.exit(0)
}

/* ---------- 候補を集める ---------- */

const harvested = await harvest({ hours: HOURS })

if (!harvested.length) {
  console.error('候補が1件も取れなかった。書き出さない（generate は角度だけで組み立てる）')
  process.exit(1)
}

const pool = harvested.slice(0, CANDIDATES)

if (harvestOnly) {
  console.log(`\n上位20件:`)
  for (const c of pool.slice(0, 20)) console.log(`  [${String(c.score).padStart(5)}] ${c.source} — ${c.title}`)
  console.log(`\n(AIは呼んでいない。全${pool.length}件)`)
  process.exit(0)
}

/* ---------- 選ぶ ---------- */

const provider = pickProvider()
console.log(`選ぶ相手: ${provider.label} / ${provider.model}`)

const system = judgeSystem()

// 1段目。見出しだけを見て、軸に合いそうなものを残す
console.log(`1段目: ${pool.length}件を最大${Math.min(SHORTLIST, pool.length)}件に落とす…`)
const picked = parseJSON(
  await chat(provider, { system, user: shortlistTask(date, pool, SHORTLIST), json: true, maxTokens: 4000 })
)
const keep = (picked.keep || [])
  .map((i) => pool[Number(i) - 1])
  .filter(Boolean)
  .slice(0, SHORTLIST)

if (!keep.length) {
  console.error('1段目で何も残らなかった。書き出さない')
  process.exit(1)
}
console.log(`  → ${keep.length}件残った`)

// 残ったものは、実際にページを開いて本文を少し取る（これも無料）
console.log('  残った候補の本文を読む…')
const withText = await Promise.all(
  keep.map(async (c) => ({ ...c, excerpt: await excerpt(c.url) }))
)
console.log(`  → ${withText.filter((c) => c.excerpt).length}/${withText.length}件は本文も取れた`)

// 2段目。関門とシグナルで見て、5枠に配る
console.log('2段目: 関門とシグナルで見て、5枠に配る…')
const raw = parseJSON(
  await chat(provider, { system, user: decideTask(date, withText), json: true, maxTokens: 12000 })
)

/* ---------- 検算して書き出す ---------- */

function normalise(raw) {
  const { slots } = planDay(date)
  const known = new Set(slots.map((s) => s.id))
  const out = {}
  const dropped = []
  const urls = new Map(withText.map((c) => [c.url, c]))

  for (const entry of raw.slots || []) {
    const id = String(entry.slotId || '').padStart(2, '0')
    if (!known.has(id)) {
      dropped.push(`知らない枠id: ${entry.slotId}`)
      continue
    }
    if (!entry.found) {
      dropped.push(`${id} は題材なし: ${entry.skipReason || '理由なし'}`)
      continue
    }
    if (!entry.title || !entry.whatChanged || !entry.gate) {
      dropped.push(`${id} は中身が足りない（題材・変化・関門のどれかが空）`)
      continue
    }

    // 根拠は、こちらが実際に集めたURLの中から選ばれたものだけ通す。作り話のURLを弾く
    const sources = (entry.sources || [])
      .filter((s) => s?.url && urls.has(s.url))
      .map((s) => ({ title: urls.get(s.url).title, url: s.url, via: urls.get(s.url).source }))
    if (!sources.length) {
      dropped.push(`${id} は根拠が候補一覧の外を指している（作り話の可能性）`)
      continue
    }

    out[id] = {
      title: entry.title,
      whatChanged: entry.whatChanged,
      gate: entry.gate,
      whyItPasses: entry.whyItPasses || '',
      check: entry.check || '',
      family: entry.family || '',
      sources,
      backups: (entry.backups || []).filter((b) => b?.title)
    }
  }

  return { slots: out, dropped }
}

const { slots, dropped } = normalise(raw)
for (const line of dropped) console.warn(`  落とした: ${line}`)

if (!Object.keys(slots).length) {
  console.error('どの枠も題材が決まらなかった。書き出さない（generate は角度だけで組み立てる）')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, `${date}.json`),
  JSON.stringify(
    {
      date,
      generatedAt: new Date().toISOString(),
      provider: provider.name,
      model: provider.model,
      harvested: harvested.length,
      shortlisted: keep.length,
      slots
    },
    null,
    2
  ) + '\n'
)

const { slots: defs } = planDay(date)
console.log(`\n${date} の題材（${Object.keys(slots).length}/${defs.length}枠、候補 ${harvested.length}件から）`)
for (const s of defs) {
  const t = slots[s.id]
  console.log(`  ${s.time}  ${t ? `${t.title}（根拠 ${t.sources.length}件）` : '— 決まらず'}`)
}
