// 選ぶ係にわたす指示書を、memory/ の正本から組み立てる。
//
// 書き手にわたすプロンプト（src/build.mjs）とは役割が違う。
// あちらは「この題材でどう書くか」、こちらは「集めた候補のどれを今日の題材にするか」。
// 軸・関門・シグナル・ノイズ・重複禁止は同じ正本から引いているので、二重管理にならない。
//
// 候補集めは src/harvest.mjs が先に済ませている（鍵の要らない公開の口だけ）。
// ここに来るのは「もう手元にある候補の一覧」で、選ぶ係は自分で検索はしない。

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planDay } from './build.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MEM = (name) => readFileSync(join(ROOT, 'memory', name), 'utf8')

function section(md, heading) {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`)
  if (start === -1) throw new Error(`section not found: ${heading}`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

function body(md) {
  return md
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 選ぶ係に渡す system 指示。毎日同じ文字列になるようにしてある */
export function judgeSystem() {
  const canon = MEM('canon.md')
  const win = MEM('winning-patterns.md')
  const forbidden = MEM('forbidden.md')

  return [
    'あなたは、ブログの題材を選ぶ係です。記事は書きません。渡された候補の一覧から、今日の題材を決めるところまでが仕事です。',
    `【軸。意識するのはこれだけ】\n${section(canon, '軸。意識するのはこれだけ')}`,
    `【採否の関門。ここが埋まらない候補は落とす】\n${section(canon, '書く前に必ず埋める一文。ここが関門')}`,
    `【必ず入れるシグナル5つ。候補がこれに当たるかで絞る】\n${section(canon, '必ず入れるシグナル5つ')}`,
    `【採用理由にしないノイズ6つ。これしか無い候補は落とす】\n${section(canon, '採用理由にもタイトルの主役にもしないノイズ6つ')}`,
    `【いちばん強い型】\n${section(win, 'いちばん強い型')}`,
    `【永久禁止と安全条件】\n${body(forbidden)}`,
    [
      '【守ること】',
      '- 候補一覧の外から題材を持ってこない。あなたは検索できません。一覧にあるものだけで決めます。',
      '- URLは一覧に書いてあるものをそのまま写す。組み立てない、思い出さない。写せないなら、その候補は使わない。',
      '- 本文が付いている候補は、そこに実際に書いてあることだけを根拠にする。見出しから想像で補わない。',
      '- 数字・日付・モデル名は、一覧か本文にあるものだけ。無いなら書かない。',
      '- 迷ったら落とす。弱いものを1つ混ぜるより、その枠を空にする方がいい。',
      '- 返事はJSONだけ。説明も前置きも付けない。'
    ].join('\n')
  ].join('\n\n')
}

/** 候補を1行ずつ並べる。番号で選ばせるので、番号は1始まりで固定 */
function listCandidates(items, { withText = false } = {}) {
  return items
    .map((c, i) => {
      const head = `${i + 1}. [${c.source}] ${c.title}`
      const lines = [head, `   URL: ${c.url}`]
      if (c.score) lines.push(`   反応: ${c.score}`)
      if (c.summary) lines.push(`   概要: ${c.summary}`)
      if (withText && c.excerpt) lines.push(`   本文（読めた分）: ${c.excerpt}`)
      else if (withText) lines.push('   本文: 読めなかった。見出しと概要だけで判断すること')
      return lines.join('\n')
    })
    .join('\n\n')
}

/** 1段目。見出しを見て、軸に合いそうなものだけ残す */
export function shortlistTask(dateStr, candidates, keepN) {
  return [
    `今日は ${dateStr}（マレーシア時間）。下は、今朝の時点で集まった候補です。`,
    '',
    `この中から、軸に合いそうなものを最大${keepN}件まで残してください。ここではまだ絞りきらなくていい。`,
    '「読者が越えられる制約が1つ見えそうか」だけで見ます。見えないもの、ノイズ6つしか無いものを落としてください。',
    '',
    '同じ話題が複数ある場合は、いちばん一次情報に近いものを1つだけ残してください。',
    '',
    listCandidates(candidates),
    '',
    '返事はこの形のJSONだけ:',
    '{"keep": [番号, 番号, ...]}',
    '番号は上の一覧のものをそのまま使ってください。'
  ].join('\n')
}

/** 2段目。本文つきの候補を、関門とシグナルで見て5枠に配る */
export function decideTask(dateStr, candidates, { published = null, titles = [] } = {}) {
  const exclusions = MEM('exclusions.md')
  const { slots, judgement, dealt } = planDay(dateStr)

  const slotLines = slots.map((s) => {
    const isJudge = s.kind === 'judgement'
    return [
      `■ 枠 ${s.id}（${s.time}）${isJudge ? ' — 判断AI枠。題材の縛りあり' : ' — 題材の縛りなし'}`,
      `今日の角度: ${dealt.get(s.id)}`,
      isJudge ? `この枠だけの題材の縛り:\n${judgement.territory}` : '',
      isJudge ? `関門の当て方: ${judgement.gateExample}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  })

  return [
    `今日は ${dateStr}（マレーシア時間）。1段目を通った候補を、本文つきで並べます。`,
    '',
    '下の5枠それぞれに、この中から題材を1つずつ当ててください。',
    '',
    '進め方:',
    '1. 各候補について、関門の一文が埋まるかを見る。埋まらないものは落とす。',
    '2. 残ったものをシグナル5つで見る。ノイズ6つしか無いものを落とす。',
    '3. 残ったものを、角度がいちばん合う枠に当てる。5枠ぶん、互いに重ならないように配る。',
    '4. 埋まらない枠は、無理に埋めない。found を false にして理由を書く。',
    '',
    '角度は「探す切り口」であって、題材そのものではありません。',
    'その角度に合う候補が無ければ、角度を外してもかまいません。関門の一文が埋まることだけは必ず守ってください。',
    '',
    slotLines.join('\n\n'),
    '',
    '【枠どうしの重複禁止】',
    '5枠が同じ話題・同じモデル・同じ道具・同じ会社の発表に寄らないこと。読む人には5本が別々の話に見える必要があります。',
    '',
    '【過去との重複禁止。ここがいちばん固い】',
    'すでに公開した記事と同じテーマは、絶対に取り上げないでください。',
    published?.accounts?.length ? `公開先: ${published.accounts.join(' / ')}（${published.count}本）` : '',
    '同じ題材はもちろん、同じ道具・同じモデルの別バージョン・言い方を変えただけのもの、すべて対象です。',
    '候補の見出しに出てくる固有名詞は、すでに機械側でも照合して落としてありますが、',
    '機械で拾えない言い換え（同じ話を別の名前で書いたもの）は、あなたが見て落としてください。',
    '迷ったら選ばない。その枠を空にする方がいい。',
    titles.length
      ? ['', `すでに公開した記事の見出し（新しい順に${titles.length}本）:`, titles.map((t) => `- ${t}`).join('\n')].join('\n')
      : '',
    '',
    '下はすでに書いた題材の家族です。ここに当たるものも選ばないでください。',
    '',
    body(exclusions),
    '',
    '【候補】',
    '',
    listCandidates(candidates, { withText: true }),
    '',
    '返事はこの形のJSONだけ。説明も前置きも付けない:',
    JSON.stringify(
      {
        slots: [
          {
            slotId: '07',
            found: true,
            title: '題材の名前。モデル名・道具名・変化の名前',
            whatChanged: '何がどう変わったのか。2〜4文。読者のできることに寄せて書く',
            gate: 'これまで【制約】で【できなかったこと】が、【新しい変化】によって、【普通の個人の環境】でもできる。その根拠は【確認した事実】。の形で実際に埋めたもの',
            whyItPasses: 'シグナル5つのどれに当たるか。1〜3文',
            check: '書き手が自分の環境で測るべきこと。1〜3文',
            family: '題材の家族を一行で',
            sources: [{ title: '候補一覧にあった見出し', url: '候補一覧にあったURLをそのまま' }],
            backups: [{ title: '控えの候補', why: 'なぜ控えとして成立するか。1文' }]
          },
          { slotId: '11', found: false, skipReason: '関門の一文が埋まる候補が無かった' }
        ]
      },
      null,
      1
    ),
    '',
    `slotId は ${slots.map((s) => s.id).join(' / ')} の5つ。5つとも必ず入れてください（found が false でも）。`,
    'sources のURLは、上の候補一覧に書いてあるものをそのまま写すこと。一覧に無いURLを書いた枠は捨てられます。'
  ]
    .filter((line) => line !== '')
    .join('\n')
}
