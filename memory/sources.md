# ソースの網

各社の公式ブログ・ドキュメント・モデルカード（Anthropic、OpenAI、Google、xAI、Meta、Mistral、DeepSeek、Qwen、Moonshot、Zhipu／Z.ai、ByteDance、MiniMax、Tencent、ハイパースケーラー）
GitHub（新しいリポジトリ、Releases、README）
Hugging Face（モデル配布とトレンド、GGUFや量子化版）
OpenRouter（無料枠と新モデルの出現）
Artificial Analysis 等の第三者ベンチ
Reddit（ローカル実行と量子化の現場。ここは特に効く）
Hacker News（技術者の評価と批判）
X（速報・初出）／YouTube（デモと実機レビュー）／arXiv（原論文）
中国圏（Bilibili、知乎、小紅書。日本語圏に届く前の情報）
startupcorners の devtools-digest／zeli.app の日次／RSSHub と FreshRSS

取得の実務メモ
- api.github.com は403で使えないことがある。git clone --depth 1 で実物を取って中を読む。github.com/trending も取れないので digest 系から拾う。
- WebFetchが弾かれたら先に検索して、結果に出たURLを踏むと通ることが多い。
- arxiv.org/html/{id}v1 が本文の数値を拾いやすい。science.org は403、phys.org は429になりやすい。
- ひとつのソースだけで書かない。最低3つ突き合わせて、話題が本物か・どこが誇張されているかを見極める。
