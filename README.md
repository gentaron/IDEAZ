# IDEAZ

1日5枠のブログ・フォーマットを置いておくPWA。
カードの「コピー」を押して、そのままAIに投げれば記事が1本立ち上がる、というところまで書いてある。

毎朝**マレーシア時間 5:00**（21:00 UTC）に、**AIが題材を探しにいく**。
探し終わったら、見つけた題材を埋め込んだ5個のプロンプトが並ぶ。前日の分はアーカイブに残る。

## 毎朝なにが起きるか

```
21:00 UTC（MYT 5:00）  Cron
  ↓
src/harvest.mjs        鍵の要らない公開の口から候補を集める
                       HN / Reddit / Hugging Face / GitHub / arXiv / 各社のRSS
  ↓
scripts/search.mjs     1段目: 見出しを見て、軸に合いそうなものを14件に落とす
                       残ったものは実際にページを開いて本文を少し読む
                       2段目: 関門の一文とシグナル5つで見て、5枠に1つずつ配る
                       → docs/data/topics/YYYY-MM-DD.json
  ↓
scripts/generate.mjs   題材を土台のフォーマットに埋め込んで5個のプロンプトにする
                       → docs/data/current.json
  ↓
コミット → Netlify が建て直す → カードの「コピー」で、その題材で書けるプロンプトが手に入る
```

## 全部タダで回る

**課金される口は1つも使っていない。npm の依存もゼロ。**

| 何を | どこで | いくら |
| --- | --- | --- |
| 候補を集める | HN / Reddit / Hugging Face / GitHub / arXiv / 各社のRSS | 鍵すら要らない |
| 本文を読む | ふつうの HTTP GET | 無料 |
| 題材を選ぶ | **GitHub Models の無料枠** | 無料。`GITHUB_TOKEN` が最初からあるので登録するものも無い |
| 生成・公開 | GitHub Actions + Netlify | 無料枠 |

選ぶところは、無料枠のあるものなら他にも乗り換えられる。上から順に見て、最初に使えるものを取る。

| 名前 | 要る鍵 | 既定のモデル | 備考 |
| --- | --- | --- | --- |
| `github` | `GITHUB_TOKEN` | `openai/gpt-4o-mini` | Actions 内なら**何も登録しなくていい**。`models: read` だけ要る |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.0-flash` | aistudio.google.com で無料の鍵が取れる |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | console.groq.com で無料の鍵が取れる |
| `openrouter` | `OPENROUTER_API_KEY` | `deepseek/deepseek-chat-v3.1:free` | **`:free` 以外を指定すると止まる**（うっかり課金しないため） |
| `local` | 不要 | `qwen2.5:7b` | 手元の Ollama など。`IDEAZ_LLM_PROVIDER=local` で名指しする |

どれも OpenAI 互換の `/chat/completions` を喋るので、中身は `src/llm.mjs` 1枚で足りている。
`IDEAZ_LLM_PROVIDER` で名指し、`IDEAZ_LLM_MODEL` でモデルだけ差し替えられる。

**フォーマットは土台**。軸・関門・シグナル5つ・ノイズ6つ・タイトル規格・文体・重複禁止は毎日同じ。
毎日変わるのは、その土台に載る**今日の題材**と、それを探した**角度**。

題材が決まらなかった枠は、無理に埋めない。その枠は角度だけを渡して、探すところから書き手（コピー先のAI）にやってもらう。
探索そのものが落ちた日も同じで、5枠は必ず出る。

## 枠

| 時刻 | 題材 |
| --- | --- |
| 07:00 / 11:00 / 14:00 / 18:00 | 縛りなし。軸は「強いAIを、ふつうの個人が使えるようになる変化」だけ |
| 09:00 | 判断AI（TypeSafe AI の Jev 的なもの）の世界最先端 |

5枠とも、採否の関門・シグナル5つ・ノイズ6つ・タイトル規格・文体・重複禁止は同一。
毎日変わるのは **今日の角度**（探す切り口）で、素数枚の札を順に配っているので、一巡するまで同じ札は戻ってこない。
探索は5枠ぶんを1回で見るので、5つの題材が互いに被らない。過去に書いた題材（`memory/exclusions.md`）も避ける。

## 中身を直したいとき

文面の正本は `memory/` にある。ここを直せば翌朝の生成から反映される。

| ファイル | 何が書いてあるか |
| --- | --- |
| `memory/canon.md` | 軸、書く前に埋める一文（関門）、シグナル5つ、ノイズ6つ、候補の絞り方、判定 |
| `memory/winning-patterns.md` | 360本のインプレッション分析、実績の裏付け、いちばん強い型 |
| `memory/title.md` | タイトル規格と書き換え例 |
| `memory/voice.md` | 出力の形、文体、中身、冒頭、思考の型、分量 |
| `memory/environment.md` | 自分の計算環境、実際に動かして確かめること |
| `memory/sources.md` | ソースの網と、取得まわりの実務メモ |
| `memory/forbidden.md` | 永久禁止と安全条件 |
| `memory/exclusions.md` | すでに使った題材の家族。**1本書いたらここに1行足す** |
| `memory/slots.json` | 5枠の定義と、9時枠の題材の縛り |
| `memory/lenses.json` | 日替わりで配る「今日の角度」の札 |

選ぶ係にわたす指示書も、同じ `memory/` から組み立てている（`src/brief.mjs`）。
軸も関門もシグナルも、選ぶ側と書く側で同じ正本を見ているので、二重に管理する場所はない。
候補を集める先（`src/harvest.mjs`）も `memory/sources.md` の網をそのまま機械で回れる形にしたもの。

記事を1本出したら、`memory/exclusions.md` にその題材の家族を1行足すこと。
ここが薄いと同じ話を二度書く。プロンプトの末尾で、書いたあとに家族を一行返すよう指示してある。

## 動かし方

依存は無いので `npm install` は要らない。Node 22 だけあればいい。

```bash
node scripts/search.mjs --harvest     # 候補集めだけ試す（AIは呼ばない。鍵も要らない）
node scripts/search.mjs --dry-run     # 何も叩かず、投げる指示書だけ見る

export GITHUB_TOKEN=ghp_...           # または GEMINI_API_KEY / GROQ_API_KEY など
node scripts/search.mjs               # 今日の題材を探す
node scripts/search.mjs 2026-10-01    # 日付を指定して探す

node scripts/generate.mjs             # 題材を埋め込んで5枠を作る
node scripts/generate.mjs 2026-10-01  # 日付を指定して作る

npx serve docs                        # ローカルで開く（何でもいい静的サーバでOK）
```

`search.mjs` を回さずに `generate.mjs` だけ回してもいい。その日は題材なしの、角度だけを配った5枠になる。

生成物は `docs/data/` に出る。

- `docs/data/topics/YYYY-MM-DD.json` — **その朝の探索で見つけた題材**（根拠のURL、関門の一文、控えの候補つき）
- `docs/data/current.json` — いま表示している日の5個
- `docs/data/archive/YYYY-MM-DD.json` — 日ごとの控え
- `docs/data/index.json` — アーカイブの目次

### 探索のつまみ

環境変数で変えられる。ふだんは触らなくていい。

| 変数 | 既定 | 何が変わるか |
| --- | --- | --- |
| `IDEAZ_LLM_PROVIDER` | 自動 | 選ぶ係を名指しする。`github` / `gemini` / `groq` / `openrouter` / `local` |
| `IDEAZ_LLM_MODEL` | 相手による | モデルだけ差し替える |
| `IDEAZ_LLM_BASE` | 相手による | 別の場所に向ける（手元のものなど） |
| `IDEAZ_WINDOW_HOURS` | `72` | 何時間ぶんさかのぼって集めるか |
| `IDEAZ_CANDIDATES` | `70` | 1段目に渡す候補の上限 |
| `IDEAZ_SHORTLIST` | `14` | 1段目を通す件数。本文を読みにいく件数でもある |

## 公開（Netlify）

`netlify.toml` が入っているので、リポジトリを繋げばそれだけで建つ。

1. Netlify で **Add new site → Import an existing project** から、このリポジトリを選ぶ
2. ビルド設定は `netlify.toml` が持っているので、触らなくていい

| 項目 | 値 | どこで決まっているか |
| --- | --- | --- |
| Build command | `node scripts/generate.mjs` | `netlify.toml` |
| Publish directory | `docs` | `netlify.toml` |
| Node | 22 | `netlify.toml` |

ビルドのたびにその日の5枠を作り直す。`src/build.mjs` は日付から決定的に組み立てるので、
いつデプロイしても「その時点のマレーシア時間の日付」の分が出る。アーカイブはリポジトリに
コミットされている分がそのまま載る。

`main` に push が入るたび Netlify が建て直す。毎朝のワークフローも `docs/data` をコミットするので、
そこで自動的に新しい5枠が公開される。繋いでいない経路から叩きたいときは、Netlify の
**Build hooks** で URL を作って、GitHub の Secrets に `NETLIFY_BUILD_HOOK` として入れる。
入っていればワークフローが最後に叩く。入れなければ何もしない。

### ヘッダ

`netlify.toml` で決めてある。要点だけ:

- `sw.js` と `manifest.webmanifest`、`index.html` / `app.js` / `styles.css` は毎回確かめさせる
  （ファイル名にハッシュを付けていないので、ここを長く持たせると更新が届かなくなる）
- `data/*` も毎回確かめさせる。毎朝入れ替わるので
- `icons/*` だけ1週間持たせる

### GitHub Pages でも出したいとき

`docs/` をそのまま publish しているだけなので、両方同時に出せる。
**Settings → Pages → Source: Deploy from a branch → `main` / `docs`**。
パスはすべて相対で書いてあるので、サブパスに置かれても壊れない。

## アプリとして入れる

スマホで開いて「ホーム画面に追加」すると、アプリとして立ち上がる。

- Android / デスクトップの Chrome 系は、条件が揃うと右上に **インストール** が出る。押すだけ
- iPhone は共有ボタンから「ホーム画面に追加」。初回だけその旨を帯で出す
- 長押しのショートカットから「今日の5枠」と「アーカイブ」に直接入れる
- 一度開けばオフラインでも読める。前に取った分を出す
- 新しい版が出ていれば「更新」の帯が出る。押すと入れ替わる

## 自動更新

`.github/workflows/daily.yml` が毎日 21:00 UTC に走る。**題材を探して**、5枠を生成して、コミットする。
手で回したいときは Actions タブから **Run workflow**（日付を入れれば任意の日で作り直せる）。

探索に**登録するものは無い**。ワークフローに `models: read` が入っているので、
最初から入っている `GITHUB_TOKEN` で GitHub Models の無料枠が使える。

他の無料枠に乗り換えたいときだけ、**Settings → Secrets and variables → Actions** に
`GEMINI_API_KEY` などを入れる（`Variables` 側に `IDEAZ_LLM_PROVIDER` を置けば名指しできる）。
探索が落ちた日は警告が出るが、公開は続く。その日は角度だけの5枠になる。

GitHub の cron は混み具合で数十分ずれることがある。5時ちょうどに出ていなくても壊れてはいない。
