// 今日の題材を探す。1日1回、Cron から呼ばれる。
//
//   node scripts/search.mjs             # 今日（MYT）の分を探す
//   node scripts/search.mjs 2026-10-01  # 日付を指定して探す
//   node scripts/search.mjs --dry-run   # APIを叩かず、渡す指示書だけ出す
//
// 結果は docs/data/topics/YYYY-MM-DD.json に出る。
// scripts/generate.mjs がそれを読んで、題材を埋め込んだ5枠を組み立てる。
// ここが失敗しても generate は動く。その日は「角度だけ配って、探すのは書き手」に戻るだけ。

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mytDate, planDay } from '../src/build.mjs'
import { searchSystem, searchTask, TOPIC_SCHEMA } from '../src/brief.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', 'data', 'topics')

const MODEL = process.env.IDEAZ_SEARCH_MODEL || 'claude-opus-5'
const EFFORT = process.env.IDEAZ_SEARCH_EFFORT || 'high'
const MAX_SEARCHES = Number(process.env.IDEAZ_MAX_SEARCHES || 40)
const MAX_CONTINUATIONS = 6

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || mytDate()

if (args.some((a) => a.startsWith('-') && a !== '--dry-run')) {
  console.error(`知らない引数: ${args.find((a) => a.startsWith('-') && a !== '--dry-run')}`)
  process.exit(1)
}

const system = searchSystem()
const task = searchTask(date)

if (dryRun) {
  console.log('===== system =====')
  console.log(system)
  console.log('\n===== task =====')
  console.log(task)
  console.log(`\n(${date} / ${MODEL} / effort=${EFFORT} / web_search 最大${MAX_SEARCHES}回)`)
  console.log(`system ${system.length}字、task ${task.length}字。APIは叩いていない`)
  process.exit(0)
}

const { default: Anthropic } = await import('@anthropic-ai/sdk')
const client = new Anthropic()

/** 探索役に投げる。web_search が10往復で止まったら、そのまま続きを頼む */
async function runSearch() {
  const messages = [{ role: 'user', content: task }]

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES }],
      messages
    })

    const res = await stream.finalMessage()

    if (res.stop_reason === 'refusal') {
      throw new Error(`探索を断られた: ${res.stop_details?.category || 'category不明'}`)
    }

    // server_tool_use の往復が上限に当たっただけ。そのまま積んで続きを頼む
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content })
      console.log(`  …web_search の往復が上限に当たったので続ける（${i + 1}回目）`)
      continue
    }

    return { res, messages }
  }

  throw new Error(`続きを${MAX_CONTINUATIONS}回頼んでも終わらなかった`)
}

/** 探した結果を、決まった形に直させる。ここでは道具を持たせない */
async function structure({ res, messages }) {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: TOPIC_SCHEMA }
    },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [
      ...messages,
      { role: 'assistant', content: res.content },
      {
        role: 'user',
        content:
          'いま決めた内容を、指定された形でそのまま出してください。新しく探し直さないこと。' +
          '題材が決まらなかった枠は found を false にして、skipReason にその理由を書いてください。'
      }
    ]
  })

  const out = await stream.finalMessage()
  const text = out.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

  if (!text.trim()) throw new Error('形に直した結果が空だった')
  return JSON.parse(text)
}

/** 返ってきたものを、こちらの都合の形に均して確かめる */
function normalise(raw) {
  const { slots } = planDay(date)
  const known = new Set(slots.map((s) => s.id))
  const out = {}
  const dropped = []

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
    const sources = (entry.sources || []).filter((s) => s?.url && /^https?:\/\//.test(s.url))
    if (!sources.length) {
      dropped.push(`${id} は根拠のURLが無い`)
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

console.log(`${date} の題材を探す（${MODEL} / effort=${EFFORT}）…`)

const found = await runSearch()
console.log('  探し終わり。形に直す…')
const raw = await structure(found)
const { slots, dropped } = normalise(raw)

for (const line of dropped) console.warn(`  落とした: ${line}`)

if (!Object.keys(slots).length) {
  console.error('どの枠も題材が決まらなかった。書き出さない（generate は角度だけで組み立てる）')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const doc = {
  date,
  generatedAt: new Date().toISOString(),
  model: MODEL,
  searchedCount: raw.searchedCount ?? null,
  slots
}
writeFileSync(join(OUT, `${date}.json`), JSON.stringify(doc, null, 2) + '\n')

const { slots: defs } = planDay(date)
console.log(`\n${date} の題材（${Object.keys(slots).length}/${defs.length}枠、候補 ${raw.searchedCount ?? '?'} 件から）`)
for (const s of defs) {
  const t = slots[s.id]
  console.log(`  ${s.time}  ${t ? `${t.title}（根拠 ${t.sources.length} 件）` : '— 決まらず'}`)
}
