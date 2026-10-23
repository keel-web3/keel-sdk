import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertMoviePresentationSemantics } from '../packages/builder/dist/movie-presentation-semantics.js';

// Synthetic frames and unmodified report from the SHA-pinned Linux adapter.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/linux-avif-technical-item.json', import.meta.url), 'utf8'));
const bytes = Buffer.from(fixture.bytesBase64, 'base64');
const stream = fixture.report.split('\n').find(line => /Stream #0:1.*Video:/u.test(line));
const inspect = (input = bytes, report = fixture.report, purpose = 'fidelity') =>
  assertMoviePresentationSemantics(input, report, stream, 16, 16, purpose);

test('Linux AVIF technical Color title is bound to its exact parsed primary item', () => {
  assert.equal(inspect().videoTimeline.samples, 3n);
  assert.equal(inspect(bytes, fixture.report, 'native-inspection').nativeCreatorTitle, false);
});

test('technical item exception rejects renamed, duplicated and wrong-stream titles', () => {
  assert.throws(() => inspect(bytes, fixture.report.replace('title           : Color', 'title           : My art')), /metadata/u);
  assert.throws(() => inspect(bytes, fixture.report.replace('title           : Color', 'title           : Color\n        title           : Color')), /technical item/u);
  const changed = Buffer.from(bytes);
  const name = changed.indexOf(Buffer.from('Color\0'));
  assert.ok(name > 0);
  changed[name] = 'X'.charCodeAt(0);
  assert.throws(() => inspect(changed), /item-name/u);
  const wrongStream = fixture.report.replace('Stream #0:0[', 'Stream #0:2[');
  assert.throws(() => inspect(bytes, wrongStream), /metadata/u);
  assert.throws(() => inspect(bytes, wrongStream, 'native-inspection'), /creator title bytes/u);
});
