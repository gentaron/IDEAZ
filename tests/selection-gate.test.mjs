import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSelection } from '../src/selection-gate.mjs';

const evidence = [{ url: 'https://example.org/study', title: 'Study' }];
function check(overrides = {}) {
  return checkSelection({
    title: '新しい研究分野',
    sources: evidence,
    publishedIndex: new Map(),
    usedTitles: new Set(),
    usedUrls: new Set(),
    ...overrides,
  });
}
test('accepts a fresh grounded idea and exposes a stable signature', () => {
  const result = check();
  assert.equal(result.ok, true);
  assert.equal(result.urls[0], 'https://example.org/study');
  assert.ok(result.signature);
});
test('blocks repeated titles independent of punctuation and casing', () => {
  const signature = check({ title: 'GPT-6? Model' }).signature;
  assert.equal(check({ title: 'GPT 6 model', usedTitles: new Set([signature]) }).ok, false);
});
test('blocks recycling the same evidence URL across editorial slots', () => {
  assert.match(check({ usedUrls: new Set(['https://example.org/study']) }).reason, /別の枠/);
});
test('blocks already-published named topics', () => {
  const result = check({ title: 'Qwen3 新機能', publishedIndex: new Map([['qwen3', ['既出']]]) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /公開済み/);
});
test('blocks missing and duplicate sources', () => {
  assert.equal(check({ sources: [] }).ok, false);
  assert.equal(check({ sources: [...evidence, ...evidence] }).ok, false);
});
