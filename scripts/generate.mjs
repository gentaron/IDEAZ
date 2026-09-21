// その日の5枠を生成して docs/data に書き出す。
// 使い方:  node scripts/generate.mjs [YYYY-MM-DD]
// 日付を省略すると、実行時点のマレーシア時間の日付になる。

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDay, mytDate } from '../src/build.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'docs', 'data')
const ARCHIVE = join(DATA, 'archive')

const date = process.argv[2] || mytDate()
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`日付の形がおかしい: ${date}`)
  process.exit(1)
}

mkdirSync(ARCHIVE, { recursive: true })

// いまの current をアーカイブへ逃がす（同じ日付の作り直しなら上書きするだけ）
const currentPath = join(DATA, 'current.json')
if (existsSync(currentPath)) {
  const prev = JSON.parse(readFileSync(currentPath, 'utf8'))
  if (prev.date && prev.date !== date) {
    writeFileSync(join(ARCHIVE, `${prev.date}.json`), JSON.stringify(prev, null, 2) + '\n')
  }
}

const day = buildDay(date)
writeFileSync(currentPath, JSON.stringify(day, null, 2) + '\n')
writeFileSync(join(ARCHIVE, `${date}.json`), JSON.stringify(day, null, 2) + '\n')

// アーカイブの目次を作り直す
const entries = readdirSync(ARCHIVE)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort()
  .reverse()
  .map((d) => {
    const doc = JSON.parse(readFileSync(join(ARCHIVE, `${d}.json`), 'utf8'))
    return { date: d, lenses: doc.slots.map((s) => ({ id: s.id, time: s.time, lens: s.lens })) }
  })

writeFileSync(
  join(DATA, 'index.json'),
  JSON.stringify({ latest: date, count: entries.length, days: entries }, null, 2) + '\n'
)

console.log(`${date} の5枠を書き出しました（アーカイブ ${entries.length} 日分）`)
for (const s of day.slots) {
  console.log(`  ${s.time}  ${s.lens}  [${s.prompt.length}字]`)
}
