// IDEAZ — 1日5枠のブログ・フォーマットを日付から決定的に組み立てる
//
// ここは組み立てだけを担当する。中身の正本はすべて memory/ にある。
// 文言を変えたいときは memory/*.md を直せば、翌朝から反映される。

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MEM = (name) => readFileSync(join(ROOT, 'memory', name), 'utf8')
const JSONMEM = (name) => JSON.parse(MEM(name))

/** マレーシア時間（UTC+8）の YYYY-MM-DD を返す */
export function mytDate(now = new Date()) {
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return t.toISOString().slice(0, 10)
}

/** 1970-01-01 からの日数。角度を配るための回転カウンタ */
function dayIndex(dateStr) {
  return Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 86400000)
}

/** マークダウンから `## 見出し` のブロックだけ抜く */
function section(md, heading) {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`)
  if (start === -1) throw new Error(`section not found: ${heading}`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

/** 見出し行（# で始まる行）を落として本文だけにする */
function body(md) {
  return md
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function bullets(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .join('\n')
}

export function buildDay(dateStr) {
  const canon = MEM('canon.md')
  const win = MEM('winning-patterns.md')
  const title = MEM('title.md')
  const voice = MEM('voice.md')
  const env = MEM('environment.md')
  const sources = MEM('sources.md')
  const forbidden = MEM('forbidden.md')
  const exclusions = MEM('exclusions.md')
  const { slots, judgement, openTitleExample, openGateExample } = JSONMEM('slots.json')
  const lenses = JSONMEM('lenses.json')

  const di = dayIndex(dateStr)
  const openSlots = slots.filter((s) => s.kind === 'open')

  // 角度を配る。open は4枠ぶん、judgement は1枚。素数枚なので一巡するまで同じ札は戻らない
  const dealt = new Map()
  openSlots.forEach((s, i) => {
    dealt.set(s.id, lenses.open[(di * openSlots.length + i) % lenses.open.length])
  })
  slots
    .filter((s) => s.kind === 'judgement')
    .forEach((s) => {
      dealt.set(s.id, lenses.judgement[di % lenses.judgement.length])
    })

  const built = slots.map((slot) => {
    const isJudge = slot.kind === 'judgement'
    const lens = dealt.get(slot.id)
    const others = slots
      .filter((s) => s.id !== slot.id)
      .map((s) => `${s.time} ${dealt.get(s.id)}`)

    const parts = []

    parts.push(
      isJudge
        ? '「判断するAI」の世界最先端をひとつ見つけて、それについてのブログを1本書いてください。'
        : '強いAIが、ふつうの個人にも使えるようになった変化を1つ見つけて、それについてのブログを1本書いてください。'
    )

    parts.push(`【今日の角度。${dateStr} の ${slot.time} 枠】\n${lens}\nこの角度で探して、見つからなければ角度を外してもいい。外すときは、下の関門の一文が埋まることだけは必ず守る。`)

    if (isJudge) parts.push(`【この枠だけの題材の縛り】\n${judgement.territory}`)

    parts.push(`【軸。意識するのはこれだけ】\n${section(canon, '軸。意識するのはこれだけ')}`)

    parts.push(
      `【書く前に必ず埋める一文。ここが関門】\n${section(canon, '書く前に必ず埋める一文。ここが関門')}\n${
        isJudge ? judgement.gateExample : openGateExample
      }`
    )

    parts.push(`【必ず入れるシグナル5つ】\n${section(canon, '必ず入れるシグナル5つ')}`)
    parts.push(`【採用理由にもタイトルの主役にもしないノイズ6つ】\n${bullets(section(canon, '採用理由にもタイトルの主役にもしないノイズ6つ'))}`)
    parts.push(`【実績の裏付け（記事には書かない）】\n${section(win, '実績の裏付け')}`)
    parts.push(`【いちばん強い型】\n${section(win, 'いちばん強い型')}`)
    parts.push(`【候補の絞り方】\n${section(canon, '候補の絞り方')}`)
    parts.push(`【タイトル】\n${body(title)}\n${isJudge ? judgement.titleExample : openTitleExample}`)
    parts.push(`【自分の計算環境】\n${section(env, '自分の計算環境')}`)
    parts.push(
      `【実際に動かす】\n${section(env, '実際に動かす')}${isJudge ? `\n${judgement.extraCheck}` : ''}`
    )
    parts.push(`【出力の形。ここ絶対】\n${section(voice, '出力の形。ここ絶対')}`)
    parts.push(`【文体】\n${section(voice, '文体')}`)
    parts.push(`【中身】\n${section(voice, '中身')}${isJudge ? `\n${judgement.extraContent}` : ''}`)
    parts.push(`【冒頭】\n${section(voice, '冒頭')}`)
    parts.push(`【底に流れる思考の型（記事の中で語らない）】\n${section(voice, '底に流れる思考の型（記事の中で語らない）')}`)
    parts.push(`【ちょっとだけ入れるもの】\n${section(voice, 'ちょっとだけ入れるもの')}`)
    parts.push(`【ソースの網】\n${body(sources)}${isJudge ? `\nこの枠で特に効くソース＝${judgement.extraSources}` : ''}`)
    parts.push(`【今日、他の枠が担当している角度。ここと被らせない】\n${others.join('\n')}`)
    parts.push(
      `【重複の絶対禁止】\n過去に主役にした題材・モデル・道具は二度使わない。名前を変えた量産もしない。同じ日の他の枠が扱ったものも避ける。迷ったら選ばない。\n以下はすでに使った題材の家族。ここに当たるものは選ばない。\n\n${body(exclusions)}`
    )
    parts.push(`【永久禁止と安全条件】\n${body(forbidden)}`)
    parts.push(`【分量】\n${section(voice, '分量')}`)
    parts.push(`【判定】\n${section(canon, '判定')}`)
    parts.push(
      '【書いたあと】\n書き終えたら、いま主役にした題材の「家族」を一行にまとめて教えてください。同じ家族を二度書かないための記録に足します。'
    )

    return {
      id: slot.id,
      time: slot.time,
      label: isJudge ? `${slot.label}・${judgement.title}` : `${slot.label}・題材の縛りなし`,
      kind: slot.kind,
      lens,
      prompt: parts.join('\n\n')
    }
  })

  return {
    date: dateStr,
    timezone: 'Asia/Kuala_Lumpur',
    generatedAt: new Date().toISOString(),
    dayIndex: di,
    slots: built
  }
}
