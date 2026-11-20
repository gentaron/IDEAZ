import assert from 'node:assert/strict';
import test from 'node:test';
import { anglePrompt, questionPrompt, researchAngle } from '../src/re-search.mjs';

const seed = {
  title: 'Qwen3-4B を 8GB のノートで動かす',
  problem: '小さいGPUでも実用的な日本語生成を回したい',
  audience: '手元のノートで試したい個人',
};

test('5つのはい/いいえ質問を順に出し、最後にブログ角度を返す', () => {
  const prompts = [];
  const answers = [true, 'はい', false, true, 'いいえ'];
  const result = researchAngle(seed, (prompt, context) => {
    prompts.push(prompt);
    assert.equal(context.step, prompts.length - 1);
    return answers[context.step];
  });

  assert.deepEqual(
    result.questions.map((q) => q.id),
    ['reader', 'focus', 'proof', 'stance', 'promise'],
  );
  assert.equal(result.questions.length, 5);
  assert.equal(prompts.length, 5);
  assert.match(prompts[0], /質問 1\/5/);
  assert.doesNotMatch(prompts[0], /ここまでの答え/);
  assert.match(prompts[1], /ここまでの答え/);
  assert.match(prompts[1], /答え: はい/);

  assert.equal(result.angle.reader, '一人の個人');
  assert.equal(result.angle.focus, '制約が外れたこと');
  assert.equal(result.angle.proof, '一次資料の突き合わせ');
  assert.equal(result.angle.stance, '限界や失敗しやすい点から');
  assert.equal(result.angle.promise, '何が変わるか');
  assert.equal(
    result.angle.text,
    'Qwen3-4B を 8GB のノートで動かすは、一人の個人に向けて「制約が外れたこと」を主役にする。根拠は一次資料の突き合わせ。読者には何が変わるかを残し、限界や失敗しやすい点から書く。',
  );
  assert.match(result.prompt, /【角度を1つに絞る】/);
  assert.match(result.prompt, /答え: いいえ/);
});

test('質問プロンプトは種記事と直前までの答えだけを含む', () => {
  const history = [{ id: 'reader', question: '個人ですか', answer: false }];
  const prompt = questionPrompt(seed, 1, history);
  assert.match(prompt, /Qwen3-4B/);
  assert.match(prompt, /解きたい問題: 小さいGPU/);
  assert.match(prompt, /答え: いいえ/);
  assert.match(prompt, /質問 2\/5/);
  assert.throws(() => questionPrompt(seed, 5), /質問がありません/);
});

test('はい/いいえ以外の回答とコールバック欠落を拒否する', () => {
  assert.throws(() => researchAngle(seed, () => 'たぶん'), /はい\/いいえ/);
  assert.throws(() => researchAngle(seed), /ask コールバック/);
});

test('anglePrompt は答えを全部並べる', () => {
  const prompt = anglePrompt(seed, [
    { id: 'reader', question: 'Q1', answer: true },
    { id: 'focus', question: 'Q2', answer: false },
  ]);
  assert.match(prompt, /Q1/);
  assert.match(prompt, /答え: いいえ/);
  assert.match(prompt, /【角度を1つに絞る】/);
});
