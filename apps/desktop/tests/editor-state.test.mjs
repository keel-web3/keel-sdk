import test from 'node:test';
import assert from 'node:assert/strict';
import { sameState, latestRequest } from '../src/editor-state.mjs';

test('dirty comparison handles normalized fields, reordered keys and undo without serializing source', () => {
  const source = 'A'.repeat(4 * 1024 * 1024);
  const saved = { presentation: { shell: 'canonical', delivery: 'auto' }, files: [{ content: source }] };
  const restored = { files: [{ content: source }], presentation: { entryObjectId: undefined, delivery: 'auto', shell: 'canonical' } };
  assert.equal(sameState(saved, restored), true);
  const edited = { ...restored, files: [{ content: source + 'B' }] };
  assert.equal(sameState(saved, edited), false);
  assert.equal(sameState(saved, { ...edited, files: saved.files }), true);
  assert.equal(sameState({ a: 1 }, { b: 1 }), false);
  assert.equal(sameState([1, 2], [2, 1]), false);
});

test('changing inputs or leaving a view rejects stale success and failure results', async () => {
  const request = latestRequest();
  const results = [];
  let finish;
  const old = request.run(() => new Promise((resolve) => { finish = resolve; }), (value) => results.push(value));
  request.invalidate();
  await request.run(async () => 'new quote', (value) => results.push(value));
  finish('old quote');
  await old;
  assert.deepEqual(results, ['new quote']);
  let fail;
  const staleError = request.run(() => new Promise((_resolve, reject) => { fail = reject; }), () => assert.fail());
  request.invalidate();
  fail(new Error('stale failure'));
  await staleError;
  await assert.rejects(request.run(async () => { throw new Error('current failure'); }, () => assert.fail()), /current failure/);
});
