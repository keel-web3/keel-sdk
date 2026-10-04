import test from 'node:test';
import assert from 'node:assert/strict';
import { planKeelAssetPresentation } from '../packages/sdk/dist/presentation.js';

test('presentation shell defaults remain canonical and explicit creator ownership is truthful', () => {
  const input = { originalByteLength: 123, compressedByteLength: 123, graphByteLength: 150 };
  const canonical = planKeelAssetPresentation(input);
  assert.equal(canonical.viewer, 'keel-verification-shell');
  assert.equal(canonical.shell, 'registered-canonical-shell');
  assert.equal(canonical.canonicalProtection, true);
  assert.ok(canonical.remainingChecks.some(check => /registered shell/.test(check)));
  const custom = planKeelAssetPresentation({ ...input, viewer: 'none', mode: 'inline' });
  assert.equal(custom.viewer, 'none');
  assert.equal(custom.shell, 'creator-owned-shell');
  assert.equal(custom.canonicalProtection, false);
  assert.equal(custom.mode, 'inline');
  assert.equal(custom.publicationReady, false);
  assert.ok(custom.remainingChecks.some(check => /creator-owned source bytes/.test(check)));
  assert.equal(custom.remainingChecks.some(check => /registered shell/.test(check)), false);
  assert.throws(() => planKeelAssetPresentation({ ...input, viewer: 'unregistered-fallback' }), /viewer|shell/);
});

test('absent optional graph/URI measurements stay unknown while invalid counts fail', () => {
  const input = { originalByteLength: 123, compressedByteLength: 123, viewer: 'none' };
  const unmeasured = planKeelAssetPresentation({ ...input, graphByteLength: undefined, tokenUriByteLength: undefined });
  assert.equal(unmeasured.graphByteLength, undefined);
  assert.equal('graphByteLength' in unmeasured, false);
  assert.equal(unmeasured.publicationReady, false);
  for (const key of ['graphByteLength', 'tokenUriByteLength']) {
    for (const value of [null, NaN, -1, '123']) {
      assert.throws(() => planKeelAssetPresentation({ ...input, [key]: value }), /byte count/);
    }
  }
  assert.throws(() => planKeelAssetPresentation({ ...input, originalByteLength: undefined }), /measurements are required/);
  assert.throws(() => planKeelAssetPresentation({ ...input, compressedByteLength: undefined }), /measurements are required/);
});
