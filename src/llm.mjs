// 無料で使えるものだけを相手にする、ごく薄い口。
//
// どれも OpenAI 互換の /chat/completions を喋るので、中身は1つで足りる。
// 鍵が要らない順・追加登録が要らない順に並べてあり、上から見て最初に使えるものを取る。
//
// 有料の課金口はここに置かない。置くと、うっかり課金される日が来る。

const PROVIDERS = [
  {
    name: 'github',
    label: 'GitHub Models（無料枠）',
    base: 'https://models.github.ai/inference',
    keyEnv: ['GITHUB_TOKEN', 'GH_TOKEN'],
    model: 'openai/gpt-4o-mini',
    // 入口が変わることがある。上から順に試して、通ったところを使う。
    // モデル名の付け方も入口ごとに違う（publisher/ が要る所と要らない所がある）
    alternates: [
      { base: 'https://models.inference.ai.azure.com', model: 'gpt-4o-mini' },
      { base: 'https://models.github.ai/inference', model: 'gpt-4o-mini' },
      { base: 'https://models.inference.ai.azure.com', model: 'openai/gpt-4o-mini' }
    ],
    // Actions の中なら GITHUB_TOKEN が最初からある（workflow に models: read が要る）
    note: 'ワークフローに models: read を足すだけで動く。追加の登録は要らない'
  },
  {
    name: 'gemini',
    label: 'Google AI Studio（無料枠）',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    model: 'gemini-2.0-flash',
    note: 'aistudio.google.com で無料の鍵が取れる'
  },
  {
    name: 'groq',
    label: 'Groq（無料枠）',
    base: 'https://api.groq.com/openai/v1',
    keyEnv: ['GROQ_API_KEY'],
    model: 'llama-3.3-70b-versatile',
    note: 'console.groq.com で無料の鍵が取れる'
  },
  {
    name: 'openrouter',
    label: 'OpenRouter（:free のモデルのみ）',
    base: 'https://openrouter.ai/api/v1',
    keyEnv: ['OPENROUTER_API_KEY'],
    model: 'deepseek/deepseek-chat-v3.1:free',
    note: 'モデル名の末尾が :free でないと課金される。既定は :free のまま使う',
    mustBeFree: true
  },
  {
    name: 'local',
    label: '手元のもの（Ollama / llama.cpp など）',
    base: 'http://127.0.0.1:11434/v1',
    keyEnv: [],
    model: 'qwen2.5:7b',
    note: '鍵は要らない。IDEAZ_LLM_BASE で場所を変えられる'
  }
]

function envKey(names) {
  for (const n of names) {
    const v = process.env[n]
    if (v && v.trim()) return v.trim()
  }
  return null
}

/** 使える口を1つ決める。IDEAZ_LLM_PROVIDER で名指しもできる */
export function pickProvider() {
  const wanted = process.env.IDEAZ_LLM_PROVIDER
  const list = wanted ? PROVIDERS.filter((p) => p.name === wanted) : PROVIDERS

  if (wanted && !list.length) {
    throw new Error(`知らない相手: ${wanted}（使えるのは ${PROVIDERS.map((p) => p.name).join(', ')}）`)
  }

  for (const p of list) {
    const key = envKey(p.keyEnv)
    // local は鍵が要らないので、名指しされたときだけ使う
    if (!key && p.keyEnv.length) continue
    if (!key && !wanted) continue

    const model = process.env.IDEAZ_LLM_MODEL || p.model
    if (p.mustBeFree && !model.endsWith(':free') && !process.env.IDEAZ_ALLOW_PAID) {
      throw new Error(
        `${p.label} で :free 以外のモデル（${model}）を指定している。課金される。` +
          ':free のものを選ぶか、どうしてもなら IDEAZ_ALLOW_PAID=1 を立てる'
      )
    }

    return {
      ...p,
      key,
      model,
      base: process.env.IDEAZ_LLM_BASE || p.base
    }
  }

  throw new Error(
    '使える無料の口が1つも無い。どれか1つ用意する:\n' +
      PROVIDERS.map((p) => `  ${p.name.padEnd(11)} ${p.keyEnv.join(' / ') || '鍵不要'} — ${p.note}`).join('\n')
  )
}

/** 返事からJSONを取り出す。素の中括弧でも ```json 囲みでも拾う */
export function parseJSON(text) {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    /* 前後に喋りが付いている場合に備えて、いちばん外側の {...} を拾う */
  }
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error(`JSONが見つからない: ${text.slice(0, 200)}`)
  return JSON.parse(cleaned.slice(start, end + 1))
}

/**
 * 1往復だけ投げる。
 * json を true にすると、返事をJSONに寄せる（対応していない相手でも、指示と取り出しで吸収する）
 */
/** 試す入口の一覧。既定 → 予備の順。モデルを明示されていればそれを全部に使う */
function attempts(provider) {
  const forced = process.env.IDEAZ_LLM_MODEL
  const list = [{ base: provider.base, model: provider.model }]

  // IDEAZ_LLM_BASE で場所を指定されているなら、そこだけを使う
  if (process.env.IDEAZ_LLM_BASE) return list

  for (const alt of provider.alternates || []) {
    list.push({ base: alt.base, model: forced || alt.model })
  }
  return list
}

/** 1回投げて、返ってきた本文を文字列で受ける。JSONでなくてもここでは落とさない */
async function post(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000)
  })
  const text = await res.text().catch(() => '')
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    /* JSON でない返事。status と中身は呼び出し側で見る */
  }
  return { status: res.status, ok: res.ok, text, payload, type: res.headers.get('content-type') || '' }
}

/** 返事の形を見て、使えるかどうかを言う */
function verdict(r) {
  if (!r.payload) {
    // ここが今まで SyntaxError で落ちていたところ。
    // 200 で "OK" のような本文が返る入口がある（API の口ではないという意味）
    return { ok: false, why: `JSONが返らなかった（HTTP ${r.status} ${r.type}）: ${r.text.slice(0, 120).replace(/\s+/g, ' ')}` }
  }
  if (!r.ok) {
    const msg = r.payload?.error?.message || r.payload?.message || r.text.slice(0, 200)
    return { ok: false, why: `HTTP ${r.status}: ${String(msg).slice(0, 200)}` }
  }
  const content = r.payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, why: `choices が空: ${JSON.stringify(r.payload).slice(0, 200)}` }
  }
  return { ok: true, content }
}

/**
 * 1往復だけ投げる。
 * json を true にすると、返事をJSONに寄せる（対応していない相手でも、指示と取り出しで吸収する）
 *
 * 入口が複数あるときは順に試す。どれも駄目なら、それぞれが何を返したかを並べて投げる。
 */
export async function chat(provider, { system, user, json = false, maxTokens = 8000, temperature = 0.3 }) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (provider.key) headers.Authorization = `Bearer ${provider.key}`

  const failures = []

  for (const attempt of attempts(provider)) {
    const url = `${attempt.base.replace(/\/$/, '')}/chat/completions`
    const body = {
      model: attempt.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: maxTokens,
      temperature
    }
    if (json) body.response_format = { type: 'json_object' }

    let r = await post(url, headers, body).catch((e) => ({ status: 0, ok: false, text: String(e.message), payload: null, type: '' }))
    let v = verdict(r)

    // response_format を知らない相手がいる。外してもう一度だけ試す
    if (!v.ok && json && (r.status === 400 || r.status === 422)) {
      delete body.response_format
      r = await post(url, headers, body).catch((e) => ({ status: 0, ok: false, text: String(e.message), payload: null, type: '' }))
      v = verdict(r)
    }

    if (v.ok) {
      // 予備の入口で通ったなら、以降もそこを使う
      if (attempt.base !== provider.base || attempt.model !== provider.model) {
        provider.base = attempt.base
        provider.model = attempt.model
        console.log(`  （${attempt.base} / ${attempt.model} に切り替えた）`)
      }
      return v.content
    }

    failures.push(`  ${attempt.base} (${attempt.model})\n    ${v.why}`)
  }

  throw new Error(`${provider.label} のどの入口も使えなかった:\n${failures.join('\n')}`)
}

export const providerList = PROVIDERS
