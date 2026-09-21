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

/** すでに公開した記事。無くても組み立ては続ける */
function published() {
  try {
    const db = JSONMEM('published.json')
    return { accounts: db.accounts || [], count: db.count || 0 }
  } catch {
    return { accounts: [], count: 0 }
  }
}

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

/** 探索が見つけてきた題材を、プロンプトに貼る一塊にする */
function topicBlock(topic) {
  const lines = [`題材: ${topic.title}`, '', `何が変わったのか:\n${topic.whatChanged}`]

  if (topic.gate) lines.push('', `関門の一文（探索時点で埋めたもの。自分で検算すること）:\n${topic.gate}`)
  if (topic.whyItPasses) lines.push('', `シグナルのどこに当たるか:\n${topic.whyItPasses}`)

  if (topic.sources?.length) {
    // 探索は見出しと、読めた分の本文までしか見ていない。数を盛らない
    lines.push(
      '',
      `根拠（探索が拾った${topic.sources.length}件。裏取りは済んでいない。必ず自分で開いて確かめる）:`
    )
    for (const src of topic.sources) {
      lines.push(`- ${src.title} ${src.url}${src.via ? `（${src.via} 経由）` : ''}`)
    }
    if (topic.sources.length < 3) {
      lines.push(
        '根拠がまだ3つに届いていない。書く前に、別のソースで最低3つまで突き合わせること。埋まらなければこの題材は捨てる。'
      )
    }
  }

  if (topic.check) lines.push('', `この題材で自分で測ること:\n${topic.check}`)

  if (topic.backups?.length) {
    lines.push('', 'この題材が持たなかったときの控え（関門が埋まらない、裏が取れない、既出だった場合のみ使う）:')
    for (const b of topic.backups) lines.push(`- ${b.title} — ${b.why}`)
  }

  return lines.join('\n')
}

/**
 * その日の枠と「今日の角度」を決める。
 * 探索（scripts/search.mjs）と組み立て（buildDay）で同じ配り方を使うために外に出してある。
 */
export function planDay(dateStr) {
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

  return { slots, judgement, openTitleExample, openGateExample, dealt, dayIndex: di }
}

/**
 * その日の5枠を組み立てる。
 * topics に探索の結果（scripts/search.mjs が書いたもの）を渡すと、
 * 「探してください」ではなく「この題材で書いてください」の形になる。
 */
export function buildDay(dateStr, topics = null) {
  const canon = MEM('canon.md')
  const win = MEM('winning-patterns.md')
  const title = MEM('title.md')
  const voice = MEM('voice.md')
  const env = MEM('environment.md')
  const sources = MEM('sources.md')
  const forbidden = MEM('forbidden.md')
  const exclusions = MEM('exclusions.md')
  const { slots, judgement, openTitleExample, openGateExample, dealt, dayIndex: di } = planDay(dateStr)

  const built = slots.map((slot) => {
    const isJudge = slot.kind === 'judgement'
    const lens = dealt.get(slot.id)
    const others = slots
      .filter((s) => s.id !== slot.id)
      .map((s) => `${s.time} ${dealt.get(s.id)}`)

    const topic = topics?.slots?.[slot.id] || null
    const parts = []

    if (topic) {
      // 題材は今朝の探索で決まっている。書き手は探すところからやり直さない
      parts.push(
        isJudge
          ? '今日の題材はもう決めてあります。下の【今日の題材】について、ブログを1本書いてください。判断AIの枠です。'
          : '今日の題材はもう決めてあります。下の【今日の題材】について、ブログを1本書いてください。'
      )
      parts.push(`【今日の題材。${dateStr} の ${slot.time} 枠】\n${topicBlock(topic)}`)
      parts.push(
        `【この題材を選んだ角度】\n${lens}\nこの角度から探して、上の題材に行き着いた。記事の軸はこの角度に寄せる。`
      )
      parts.push(
        '【題材を捨てていい場合】\n根拠のURLを開いて裏が取れない、関門の一文が自分の言葉で埋め直せない、すでに書いた題材の家族に当たる。このどれかなら控えに移る。控えも持たないなら、その旨だけ返して書かない。空振りを1本として出さない。'
      )
    } else {
      parts.push(
        isJudge
          ? '「判断するAI」の世界最先端をひとつ見つけて、それについてのブログを1本書いてください。'
          : '強いAIが、ふつうの個人にも使えるようになった変化を1つ見つけて、それについてのブログを1本書いてください。'
      )
      parts.push(`【今日の角度。${dateStr} の ${slot.time} 枠】\n${lens}\nこの角度で探して、見つからなければ角度を外してもいい。外すときは、下の関門の一文が埋まることだけは必ず守る。`)
    }

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
    parts.push(
      topic
        ? `【候補の絞り方（今朝すでに通してある。検算用に置いておく）】\n${section(canon, '候補の絞り方')}`
        : `【候補の絞り方】\n${section(canon, '候補の絞り方')}`
    )
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
    const pub = published()
    parts.push(
      [
        '【重複の絶対禁止】',
        '過去に主役にした題材・モデル・道具は二度使わない。名前を変えた量産もしない。同じ日の他の枠が扱ったものも避ける。迷ったら選ばない。',
        pub.accounts.length
          ? `すでに公開した記事（${pub.accounts.join(' / ')} の${pub.count}本）と同じテーマは、絶対に取り上げない。\n` +
            (topic
              ? '今朝の探索で、見出しの固有名詞による照合は済ませてある。それでも書く前に、自分の過去記事と被っていないか必ず確かめること。'
              : '題材を探すときは、まず自分の過去記事と被っていないかを確かめること。被るなら別の候補を探す。')
          : '',
        '以下はすでに使った題材の家族。ここに当たるものは選ばない。',
        '',
        body(exclusions)
      ]
        .filter((l) => l !== '')
        .join('\n')
    )
    parts.push(`【永久禁止と安全条件】\n${body(forbidden)}`)
    parts.push(`【分量】\n${section(voice, '分量')}`)
    parts.push(`【判定】\n${section(canon, '判定')}`)
    parts.push(
      topic?.family
        ? `【書いたあと】\n書き終えたら、いま主役にした題材の「家族」を一行にまとめて教えてください。同じ家族を二度書かないための記録に足します。\n探索時点の案はこれ。ずれていれば直してください。\n${topic.family}`
        : '【書いたあと】\n書き終えたら、いま主役にした題材の「家族」を一行にまとめて教えてください。同じ家族を二度書かないための記録に足します。'
    )

    return {
      id: slot.id,
      time: slot.time,
      label: isJudge ? `${slot.label}・${judgement.title}` : `${slot.label}・題材の縛りなし`,
      kind: slot.kind,
      lens,
      topic: topic
        ? {
            title: topic.title,
            whatChanged: topic.whatChanged,
            gate: topic.gate || '',
            sources: topic.sources || []
          }
        : null,
      prompt: parts.join('\n\n')
    }
  })

  return {
    date: dateStr,
    timezone: 'Asia/Kuala_Lumpur',
    generatedAt: new Date().toISOString(),
    dayIndex: di,
    // searched = 今朝の探索で題材まで決まっている / lens-only = 角度だけ配って、探すのは書き手
    topicSource: topics ? 'searched' : 'lens-only',
    searchedAt: topics?.generatedAt || null,
    slots: built
  }
}
