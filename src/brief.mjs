// 探索にわたす指示書を、memory/ の正本から組み立てる。
//
// 書き手にわたすプロンプト（src/build.mjs）とは役割が違う。
// あちらは「この題材でどう書くか」、こちらは「今日は何を題材にするか」。
// 軸・関門・シグナル・ノイズ・重複禁止は同じ正本から引いているので、二重管理にならない。

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

/** 探索役に渡す system 指示。毎日同じ文字列になるようにして、キャッシュに乗せる */
export function searchSystem() {
  const canon = MEM('canon.md')
  const win = MEM('winning-patterns.md')
  const sources = MEM('sources.md')
  const forbidden = MEM('forbidden.md')

  return [
    'あなたは、ブログの題材を探す係です。記事は書きません。探して、確かめて、今日の題材を決めるところまでが仕事です。',
    `【軸。意識するのはこれだけ】\n${section(canon, '軸。意識するのはこれだけ')}`,
    `【採否の関門。ここが埋まらない候補は落とす】\n${section(canon, '書く前に必ず埋める一文。ここが関門')}`,
    `【必ず入れるシグナル5つ。候補がこれに当たるかで絞る】\n${section(canon, '必ず入れるシグナル5つ')}`,
    `【採用理由にしないノイズ6つ。これしか無い候補は落とす】\n${section(canon, '採用理由にもタイトルの主役にもしないノイズ6つ')}`,
    `【候補の絞り方。この順で落とす】\n${section(canon, '候補の絞り方')}`,
    `【いちばん強い型】\n${section(win, 'いちばん強い型')}`,
    `【ソースの網。ここを回る】\n${body(sources)}`,
    `【永久禁止と安全条件】\n${body(forbidden)}`,
    [
      '【探し方の決まり】',
      '- web_search を惜しまず使う。ひとつのソースだけで決めない。最低3つ突き合わせて、本物か・どこが誇張されているかを見極める。',
      '- 一次情報を優先する。公式ブログ、モデルカード、リポジトリ、論文。まとめ記事だけで決めない。',
      '- 実在を確かめる。名前・数字・日付・URLを、自分が開いたページから取る。思い出しで書かない。',
      '- 見つからない枠があるなら、無理に埋めない。弱い題材を1つ混ぜるより、その枠は空にして理由を書く方がいい。',
      '- 古い話を今日の話として出さない。目新しさだけで採らないが、すでに行き渡った話も採らない。'
    ].join('\n')
  ].join('\n\n')
}

/** その日ぶんの指示。枠・角度・重複禁止がここに入る */
export function searchTask(dateStr) {
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
    `今日は ${dateStr}（マレーシア時間）。下の5枠それぞれに、題材を1つずつ決めてください。`,
    '',
    '進め方:',
    '1. まず広く探す。枠のことは一旦忘れて、軸に合う候補を50個ほど集める。',
    '2. 関門の一文が埋まりそうなものだけ10個ほどに落とす。',
    '3. シグナル5つで見て、ノイズ6つしか無いものを捨てる。',
    '4. 残ったものを、角度がいちばん合う枠に当てる。5枠ぶん、互いに重ならないように配る。',
    '5. 各枠について、関門の一文を実際に埋める。埋まらなければその枠は空にする。',
    '',
    '枠ごとの角度は下のとおり。角度は「探す切り口」であって、題材そのものではありません。',
    'その角度で探して合うものが無ければ、角度を外してもかまいません。関門の一文が埋まることだけは必ず守ってください。',
    '',
    slotLines.join('\n\n'),
    '',
    '【枠どうしの重複禁止】',
    '5枠が同じ話題・同じモデル・同じ道具・同じ会社の発表に寄らないこと。読む人には5本が別々の話に見える必要があります。',
    '',
    '【過去との重複禁止】',
    '下はすでに書いた題材の家族です。ここに当たるものは選ばないでください。名前を変えただけの量産も同じ扱いです。迷ったら選ばない。',
    '',
    body(exclusions)
  ].join('\n')
}

/** 構造化して返させる形 */
export const TOPIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['searchedCount', 'slots'],
  properties: {
    searchedCount: {
      type: 'integer',
      description: '最初に目を通した候補のおおよその数'
    },
    slots: {
      type: 'array',
      description: '枠ごとの結果。題材が決まらなかった枠は found を false にする',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slotId', 'found'],
        properties: {
          slotId: { type: 'string', description: '枠のid。07 / 09 / 11 / 14 / 18 のいずれか' },
          found: { type: 'boolean', description: '題材が決まったか' },
          skipReason: { type: 'string', description: 'found が false のとき、決まらなかった理由' },
          title: { type: 'string', description: '題材の名前。モデル名・道具名・変化の名前' },
          whatChanged: {
            type: 'string',
            description: '何がどう変わったのか。2〜4文。読者のできることに寄せて書く'
          },
          gate: {
            type: 'string',
            description:
              '関門の一文を実際に埋めたもの。「これまで【制約】で【できなかったこと】が、【新しい変化】によって、【普通の個人の環境】でもできる。その根拠は【確認した事実】。」の形'
          },
          whyItPasses: { type: 'string', description: 'シグナル5つのどれに当たるか。1〜3文' },
          check: { type: 'string', description: '書き手が自分の環境で測るべきこと。1〜3文' },
          family: { type: 'string', description: '題材の家族を一行で。exclusions.md に足せる形' },
          sources: {
            type: 'array',
            description: '実際に開いて確かめたページ。3つ以上',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'url'],
              properties: {
                title: { type: 'string' },
                url: { type: 'string' }
              }
            }
          },
          backups: {
            type: 'array',
            description: '本命が持たなかったときの控え。1〜2個',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'why'],
              properties: {
                title: { type: 'string' },
                why: { type: 'string', description: 'なぜ控えとして成立するか。1文' }
              }
            }
          }
        }
      }
    }
  }
}
