// IDEAZ — Re-Search 型の角度づくり
//
// 種記事の「問題」だけを渡し、はい/いいえの質問で核心へ絞る。
// 外部APIは呼ばない。回答は ask コールバックで注入する純粋関数。
// 5問の答えから、ブログを書くときの角度を1つ返す。
//
// 参考: Re-Search: Dissecting LLM Ideation Through a Two-Player Questioning Game

const STEPS = [
  {
    id: 'reader',
    question: (seed) =>
      `この核心は、まず一人の個人が無料の道具で試せる変化ですか。種記事の問題「${seed.problem}」に照らして答えてください。`,
    yes: '一人の個人',
    no: '小さなチーム'
  },
  {
    id: 'focus',
    question: () =>
      '核心は「新しくできるようになったこと」より「これまで諦めていた制約が外れたこと」にありますか。',
    yes: '制約が外れたこと',
    no: '新しくできるようになったこと'
  },
  {
    id: 'proof',
    question: () => '読者は今日、自分の環境で結果を測って確かめられますか。',
    yes: '自分の環境で測った結果',
    no: '一次資料の突き合わせ'
  },
  {
    id: 'stance',
    question: () => '記事は、期待できる変化より先に、限界や失敗しやすい点を書くべきですか。',
    yes: '限界や失敗しやすい点から',
    no: '期待できる変化から'
  },
  {
    id: 'promise',
    question: () => '読者に残すのは「何が変わるか」より「次に何を試すか」ですか。',
    yes: '次に試す一歩',
    no: '何が変わるか'
  }
]

function seedBlock(seed) {
  return [
    '【種記事】',
    `タイトル: ${seed.title}`,
    `解きたい問題: ${seed.problem}`,
    seed.audience ? `読者: ${seed.audience}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

function historyBlock(history) {
  if (!history.length) return ''
  return [
    '【ここまでの答え】',
    ...history.map(
      (h, i) => `${i + 1}. ${h.question}\n   答え: ${h.answer ? 'はい' : 'いいえ'}`
    )
  ].join('\n')
}

export function questionPrompt(seed, step, history = []) {
  const item = STEPS[step]
  if (!item) throw new Error(`質問がありません: ${step}`)
  return [
    seedBlock(seed),
    historyBlock(history),
    `【質問 ${step + 1}/${STEPS.length}】`,
    item.question(seed),
    '「はい」か「いいえ」だけで答えてください。'
  ]
    .filter(Boolean)
    .join('\n\n')
}

function normalizeAnswer(value) {
  if (value === true || value === false) return value
  const text = String(value).trim().toLowerCase()
  if (['はい', 'yes', 'true', '1'].includes(text)) return true
  if (['いいえ', 'no', 'false', '0'].includes(text)) return false
  throw new Error(`はい/いいえで答えられない値: ${value}`)
}

export function buildAngle(seed, history) {
  const answers = new Map(history.map((h) => [h.id, h.answer]))
  const choose = (id) => {
    const item = STEPS.find((s) => s.id === id)
    return answers.get(id) ? item.yes : item.no
  }
  const reader = choose('reader')
  const focus = choose('focus')
  const proof = choose('proof')
  const stance = choose('stance')
  const promise = choose('promise')
  return {
    title: `${seed.title} — ${focus}`,
    reader,
    focus,
    proof,
    stance,
    promise,
    text: `${seed.title}は、${reader}に向けて「${focus}」を主役にする。根拠は${proof}。読者には${promise}を残し、${stance}書く。`
  }
}

export function anglePrompt(seed, history) {
  return [
    seedBlock(seed),
    historyBlock(history),
    '【角度を1つに絞る】',
    '上の答えをすべて満たすように、ブログの角度を1つだけ決めてください。',
    '読者、主役、根拠、書き出し、読者に残すものを、それぞれ一行で返してください。',
    '種記事のタイトルや問題に無い事実を足さないでください。'
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function researchAngle(seed, ask) {
  if (typeof ask !== 'function') throw new Error('ask コールバックが必要です')
  const history = []
  for (let step = 0; step < STEPS.length; step += 1) {
    const prompt = questionPrompt(seed, step, history)
    const question = STEPS[step].question(seed)
    const answer = normalizeAnswer(ask(prompt, { step, id: STEPS[step].id, question }))
    history.push({ id: STEPS[step].id, question, answer })
  }
  return {
    seed: { title: seed.title, problem: seed.problem },
    questions: history.map(({ id, question, answer }) => ({ id, question, answer })),
    angle: buildAngle(seed, history),
    prompt: anglePrompt(seed, history)
  }
}
