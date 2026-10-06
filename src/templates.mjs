// IDEAZ — テーマ別のコピーテンプレを組み立てる
//
// 毎朝の5枠とは別に、いつでも使える100本の型。テーマの正本は memory/templates.json。
// 土台（関門・シグナル・文体・重複禁止など）は毎朝の5枠と同じ memory/ を見ている。
//
// 100本とも土台は同じなので、土台は1回だけ書き出して、各テンプレには頭の部分だけを持たせる。
// 表（docs/app.js）がコピーするときに「頭 + 土台」をつなぐ。100本ぶん同じ文を配らないため。

import { MEM, JSONMEM, published, section, body, bullets } from './build.mjs'

/** 1本ぶんの頭。テーマと、探す方向と、読者への約束 */
function head(theme, item, no) {
  return [
    `下の【テーマ】で、ブログを1本書いてください。題材（具体的な道具・モデル・サービス）は、このテーマの中からあなたが探して決めます。`,
    `【テーマ。${theme.name} No.${no}】\n${item.title}`,
    `【探す方向】\n${item.look}`,
    `【読者への約束（タイトルの芯。言い回しは変えていい）】\n${item.promise}`,
    [
      '【題材の決め方】',
      'このテーマの中で、いま個人が実際に触れるもののうち、いちばん新しくて強いものを1つ選ぶ。',
      '根拠は公式ドキュメント、リリースノート、モデルカード、原論文などの一次情報で、最低3つ突き合わせる。',
      '下の関門の一文が埋まらなければ、同じテーマの中で別の題材に替える。それでも埋まらなければ、その旨だけ返して書かない。空振りを1本として出さない。'
    ].join('\n')
  ].join('\n\n')
}

/** 100本で共通の土台 */
function common() {
  const canon = MEM('canon.md')
  const win = MEM('winning-patterns.md')
  const title = MEM('title.md')
  const voice = MEM('voice.md')
  const env = MEM('environment.md')
  const sources = MEM('sources.md')
  const forbidden = MEM('forbidden.md')
  const exclusions = MEM('exclusions.md')
  const { openGateExample, openTitleExample } = JSONMEM('slots.json')
  const pub = published()

  const parts = []
  parts.push(`【軸。意識するのはこれだけ】\n${section(canon, '軸。意識するのはこれだけ')}`)
  parts.push(`【書く前に必ず埋める一文。ここが関門】\n${section(canon, '書く前に必ず埋める一文。ここが関門')}\n${openGateExample}`)
  parts.push(`【必ず入れるシグナル5つ】\n${section(canon, '必ず入れるシグナル5つ')}`)
  parts.push(`【採用理由にもタイトルの主役にもしないノイズ6つ】\n${bullets(section(canon, '採用理由にもタイトルの主役にもしないノイズ6つ'))}`)
  parts.push(`【いちばん強い型】\n${section(win, 'いちばん強い型')}`)
  parts.push(`【タイトル】\n${body(title)}\n${openTitleExample}`)
  parts.push(`【自分の計算環境】\n${section(env, '自分の計算環境')}`)
  parts.push(`【実際に動かす】\n${section(env, '実際に動かす')}`)
  parts.push(`【出力の形。ここ絶対】\n${section(voice, '出力の形。ここ絶対')}`)
  parts.push(`【文体】\n${section(voice, '文体')}`)
  parts.push(`【読みやすさ】\n${section(voice, '読みやすさ。読者がスマホで最後まで読めること')}`)
  parts.push(`【中身】\n${section(voice, '中身')}`)
  parts.push(`【冒頭】\n${section(voice, '冒頭')}`)
  parts.push(`【底に流れる思考の型（記事の中で語らない）】\n${section(voice, '底に流れる思考の型（記事の中で語らない）')}`)
  parts.push(`【ちょっとだけ入れるもの】\n${section(voice, 'ちょっとだけ入れるもの')}`)
  parts.push(`【ソースの網】\n${body(sources)}`)
  parts.push(
    [
      '【重複の絶対禁止】',
      '過去に主役にした題材・モデル・道具は二度使わない。名前を変えた量産もしない。迷ったら選ばない。',
      pub.accounts.length
        ? `すでに公開した記事（${pub.accounts.join(' / ')} の${pub.count}本）と同じテーマは、絶対に取り上げない。題材を決めたら、書く前に自分の過去記事と被っていないか必ず確かめる。被るなら同じテーマの中で別の題材に替える。`
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
    '【書いたあと】\n書き終えたら、いま主役にした題材の「家族」を一行にまとめて教えてください。同じ家族を二度書かないための記録に足します。'
  )
  return parts.join('\n\n')
}

/** テーマ別テンプレを全部組み立てる */
export function buildTemplates() {
  const { themes } = JSONMEM('templates.json')
  let n = 0
  const out = themes.map((theme) => ({
    id: theme.id,
    name: theme.name,
    blurb: theme.blurb,
    items: theme.items.map((item, i) => {
      n += 1
      const no = String(n).padStart(3, '0')
      return {
        id: `${theme.id}-${String(i + 1).padStart(2, '0')}`,
        no,
        title: item.title,
        promise: item.promise,
        head: head(theme, item, no)
      }
    })
  }))

  // 生成時刻は入れない。中身が変わらない日にコミットの差分を出さないため
  return {
    count: n,
    // 各テンプレの全文は head + "\n\n" + common
    common: common(),
    themes: out
  }
}
