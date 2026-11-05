import { gzipSync } from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as candidate from '../packages/sdk/dist/link-gate.js';
const bytes = s => Buffer.from(s), nest = (s, n) => {
    let b = bytes(s);
    for (let i = 0; i < n; i++)
        b = gzipSync(b);
    return b;
};
const scan = (api, b, id = 'control') => api.scanKeelLinkGate({ route: 'local-security-control', references: [], resources: [{ id, bytes: b }] });
const duplicate = s => bytes(JSON.stringify({ compression: 'gzip', storedBase64: nest(s, 1).toString('base64'), payload: 'data:application/octet-stream;base64,' + nest(s, 6).toString('base64') }));
test('already inspected digest at deeper path does not consume depth again', () => {
    const b = duplicate('safe fixture with enough text to inspect');
    const after = scan(candidate, b);
    assert.equal(after.status, 'clear');
    assert.equal(after.coverage.uninspected.length, 0);
    assert.ok(after.coverage.expandedBytes > b.length, 'decoded duplicate work remains charged');
});
for (const [label, b] of [
    ['plain locator', bytes('https://unregistered.invalid/payload')],
    ['gzip locator', nest('https://unregistered.invalid/payload', 1)],
    ['duplicate locator', duplicate('https://unregistered.invalid/payload')],
    ['unknown seven-layer payload', nest('https://unregistered.invalid/payload', 7)],
    ['safe but uninspected seven-layer payload', nest('safe fixture with enough text to inspect', 7)],
    ['one-byte altered sibling', bytes(JSON.stringify({ compression: 'gzip', storedBase64: nest('safe fixture with enough text to inspect', 1).toString('base64'), payload: 'data:application/octet-stream;base64,' + nest('Safe fixture with enough text to inspect', 6).toString('base64') }))],
    ['memory expansion', gzipSync(Buffer.alloc(65 * 1024 * 1024, 65))],
])
    test(label + ' remains blocked', () => {
        const result = scan(candidate, b);
        assert.equal(result.status, 'blocked');
        if (label.includes('locator'))
            assert.ok(result.hitCount > 0);
        else
            assert.ok(result.coverage.uninspected.length > 0);
    });
test('same bytes in a different resource do not inherit depth clearance', () => {
    const result = candidate.scanKeelLinkGate({ route: 'resource-isolation', references: [], resources: [{ id: 'shallow', bytes: bytes('safe fixture with enough text to inspect') }, { id: 'deep', bytes: nest('safe fixture with enough text to inspect', 7) }] });
    assert.equal(result.status, 'blocked');
    assert.match(result.coverage.uninspected.join(), /nesting bound/);
});
test('repeated identical gzip outputs retain cumulative decode-work bound', () => {
    const payload = bytes('safe '.repeat(200000));
    const encoded = gzipSync(payload).toString('base64');
    const input = bytes(JSON.stringify(Array.from({ length: 80 }, () => ({ compression: 'gzip', storedBase64: encoded }))));
    const after = scan(candidate, input);
    assert.equal(after.status, 'blocked');
    assert.match(after.coverage.uninspected.join(), /67108864-byte scan bound/);
    assert.ok(after.coverage.expandedBytes > 63 * 1024 * 1024 && after.coverage.expandedBytes <= 64 * 1024 * 1024);
    assert.equal(payload.length * 80, 80000000);
});
