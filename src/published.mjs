// すでに公開した記事との被りを、機械的に落とす。
//
// 「もうあるテーマは絶対に取り上げない」を、AIの判断だけに任せない。
// 見出しから固有名詞らしい語を抜いて、当たったものは候補の段階で捨てる。
// AI側にも見出しの一覧を渡すが、それは二重の網であって、一枚目はここ。

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(ROOT, 'memory', 'published.json')

// どの記事にも出てくる語。これで当てると全部消えるので、固有名詞から外す
const STOP = new Set([
  'ai', 'llm', 'llms', 'gpt', 'model', 'models', 'open', 'source', 'opensource', 'new', 'now',
  'the', 'and', 'for', 'with', 'you', 'your', 'how', 'why', 'what', 'when', 'from', 'this',
  'that', 'can', 'not', 'are', 'has', 'have', 'was', '其の', 'using', 'use', 'used', 'via',
  'data', 'code', 'api', 'app', 'apps', 'web', 'run', 'runs', 'running', 'build', 'built',
  'free', 'fast', 'best', 'more', 'less', 'than', 'into', 'out', 'off', 'all', 'one', 'two',
  'release', 'released', 'version', 'update', 'updated', 'support', 'guide', 'intro',
  'local', 'cloud', 'server', 'client', 'tool', 'tools', 'test', 'tests', 'benchmark',
  'train', 'training', 'inference', 'prompt', 'prompts', 'token', 'tokens', 'context',
  'agent', 'agents', 'chat', 'text', 'image', 'video', 'audio', 'speech', 'vision',
  'laptop', 'desktop', 'mobile', 'phone', 'gpu', 'gpus', 'cpu', 'ram', 'memory', 'disk',
  'adds', 'add', 'added', 'backend', 'frontend', 'without', 'anyone', 'everything',
  'first', 'still', 'just', 'now', 'here', 'there', 'about', 'after', 'before', 'because',
  'モデル', 'データ', 'ツール', 'コード', 'テスト', 'ローカル', 'クラウド', 'サーバ', 'サーバー',
  'エージェント', 'プロンプト', 'トークン', 'リリース', 'アップデート', 'バージョン',
  'オープン', 'ソース', 'ファイル', 'パソコン', 'スマホ', 'ブラウザ', 'アプリ'
])

/**
 * 見出しから固有名詞らしい語を抜く。
 * 英数字の並び（Qwen3、llama.cpp、gpt-4o など）と、長めのカタカナ。
 */
export function terms(title) {
  const out = new Set()
  const s = String(title || '')

  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9.+-]{2,}/g)) {
    const t = m[0].toLowerCase().replace(/[.+-]+$/, '')
    if (t.length >= 3 && !STOP.has(t)) out.add(t)
  }
  for (const m of s.matchAll(/[ァ-ヴー]{4,}/g)) {
    const t = m[0]
    if (!STOP.has(t)) out.add(t)
  }
  return out
}

/** memory/published.json を読む。無ければ空 */
export function loadPublished() {
  if (!existsSync(FILE)) return { accounts: [], titles: [], count: 0, syncedAt: null }
  try {
    const db = JSON.parse(readFileSync(FILE, 'utf8'))
    return { accounts: db.accounts || [], titles: db.titles || [], count: db.count || 0, syncedAt: db.syncedAt || null }
  } catch {
    return { accounts: [], titles: [], count: 0, syncedAt: null }
  }
}

/**
 * 既出の語 → その語を含む見出し、の対応を作る。
 *
 * ここで大事なのは「珍しい語だけを残す」こと。
 * laptop や backend のような、どの記事にも出てくる語で当てると、候補が全部消える。
 * 何本の記事に出てくるか（＝ありふれ度）を数えて、広く出てくる語は固有名詞とみなさない。
 * 手で書いた除外語は小さい本数のときの下支えで、本数が増えればこの数え方が効く。
 */
export function buildIndex(published, { maxShare = 0.02, floor = 2 } = {}) {
  const titles = published.titles || []
  const df = new Map()

  for (const t of titles) {
    for (const term of terms(t.title)) df.set(term, (df.get(term) || 0) + 1)
  }

  // 全体の maxShare を超えて出てくる語は、ありふれているので使わない（最低でも floor 本までは許す）
  const cutoff = Math.max(floor, Math.ceil(titles.length * maxShare))

  const index = new Map()
  const generic = []
  for (const [term, n] of df) {
    if (n > cutoff) {
      generic.push(term)
      continue
    }
    index.set(term, [])
  }

  for (const t of titles) {
    for (const term of terms(t.title)) {
      const list = index.get(term)
      if (list && list.length < 3) list.push(t.title)
    }
  }

  return { index, cutoff, generic, terms: index.size }
}

/**
 * 候補を、既出と当たるものと残るものに分ける。
 * 固有名詞が1つでも当たったら落とす。「絶対に取り上げない」を機械の側で担保する。
 */
export function filterCandidates(candidates, index) {
  const kept = []
  const blocked = []

  for (const c of candidates) {
    let hit = null
    for (const term of terms(c.title)) {
      if (index.has(term)) {
        hit = { term, titles: index.get(term) }
        break
      }
    }
    if (hit) blocked.push({ ...c, hit })
    else kept.push(c)
  }

  return { kept, blocked }
}

/** AI に見せる既出の一覧。全部は多すぎるので、新しい順に詰める */
export function recentTitles(published, max = 400) {
  return (published.titles || []).slice(0, max).map((t) => t.title)
}
