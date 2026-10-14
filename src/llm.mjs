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
    // 本来の口が JSON 以外（"OK" の2文字だけ等）を返す日があった。そのときは旧来の口で取り直す
    altBases: [{ base: 'https://models.inference.ai.azure.com', model: 'gpt-4o-mini' }],
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

/** 使える口を全部、上から順に返す。1つが落ちたら次に回すため */
export function pickProviders() {
  const wanted = process.env.IDEAZ_LLM_PROVIDER
  if (wanted) return [pickProvider()]
  const out = []
  for (const p of PROVIDERS) {
    const key = envKey(p.keyEnv)
    if (!key) continue
    const model = process.env.IDEAZ_LLM_MODEL && !out.length ? process.env.IDEAZ_LLM_MODEL : p.model
    if (p.mustBeFree && !model.endsWith(':free') && !process.env.IDEAZ_ALLOW_PAID) continue
    out.push({ ...p, key, model, base: process.env.IDEAZ_LLM_BASE || p.base })
  }
  if (!out.length) pickProvider() // 使える口が無いときの説明はこちらが持っている
  return out
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
export async function chat(provider, { system, user, json = false, maxTokens = 8000, temperature = 0.3 }) {
  const headers = { 'Content-Type': 'application/json' }
  if (provider.key) headers.Authorization = `Bearer ${provider.key}`

  const body = {
    model: provider.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    max_tokens: maxTokens,
    temperature
  }
  if (json) body.response_format = { type: 'json_object' }

  const res = await fetch(`${provider.base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000)
  })

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400)
    // response_format を知らない相手がいる。その場合は外してもう一度だけ試す
    if (json && (res.status === 400 || res.status === 422)) {
      delete body.response_format
      const retry = await fetch(`${provider.base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000)
      })
      if (retry.ok) return pickText(await readJSON(retry, provider))
      throw new Error(`${provider.label} が ${retry.status}: ${detail}`)
    }
    throw new Error(`${provider.label} が ${res.status}: ${detail}`)
  }

  return pickText(await readJSON(res, provider))
}

/** 200 でも JSON とは限らない（"OK" だけ返ってきた日がある）。読めなければ中身つきで投げる */
async function readJSON(res, provider) {
  const raw = await res.text()
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`${provider.label} の返事が JSON ではなかった（${res.status}）: ${raw.slice(0, 120)}`)
  }
}

/**
 * 使える口を順に試す。同じ口の別の入口（altBases）も試す。
 * 全部だめなら、最後の失敗の理由をつけて投げる
 */
/** 最後に返事をくれた口。記録に残すため */
export const lastUsed = { name: null, model: null }

export async function chatAny(providers, opts, log = console.log) {
  let last = null
  for (const p of providers) {
    const routes = [{ base: p.base, model: p.model }, ...(process.env.IDEAZ_LLM_BASE ? [] : p.altBases || [])]
    for (const r of routes) {
      try {
        const text = await chat({ ...p, ...r }, opts)
        lastUsed.name = p.name
        lastUsed.model = r.model
        return text
      } catch (e) {
        last = e
        log(`  ${p.label}（${r.base}）が使えなかった: ${e.message.split('\n')[0].slice(0, 160)}`)
      }
    }
  }
  throw last || new Error('使える口が無い')
}

function pickText(payload) {
  const text = payload?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(`返事が空だった: ${JSON.stringify(payload).slice(0, 300)}`)
  }
  return text
}

export const providerList = PROVIDERS
