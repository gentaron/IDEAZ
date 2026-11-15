// Final offline evidence gate for IDEAZ's five independent editorial slots.
// The model may propose ideas, but it cannot authorize repeated or untraceable selections.
import { terms } from './published.mjs';

export function checkSelection({ title, sources, publishedIndex, usedTitles, usedUrls }) {
  const signature = String(title || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (!signature) return { ok: false, reason: '題材名が空' };
  if (usedTitles.has(signature)) return { ok: false, reason: '同じ題材名が別の枠で採用済み' };
  if (!Array.isArray(sources) || !sources.length) return { ok: false, reason: '検証済みの出典がない' };
  const urls = sources.map((source) => source.url);
  if (new Set(urls).size !== urls.length) return { ok: false, reason: '出典が重複している' };
  if (urls.some((url) => usedUrls.has(url))) {
    return { ok: false, reason: '別の枠で使った出典URLを再利用している' };
  }
  const repeated = [...terms(title)].find((term) => publishedIndex.has(term));
  if (repeated) return { ok: false, reason: `公開済み記事と固有名詞が重複: ${repeated}` };
  return { ok: true, signature, urls };
}
