import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAbi, encodeFunctionData, decodeFunctionData, keccak256, stringToHex } from 'viem';
import { buildKeelLinkPresentationCall, buildKeelLinkURICall } from '../packages/sdk/dist/link-presentation.js';
import { KEEL_INLINE_PROTECTION_SHELL_ID } from '../packages/sdk/dist/shell-registry.js';
import { keelLinkRegistryAbi } from '../packages/sdk/dist/abi.js';
import { ABIS } from '../packages/sdk/dist/abis/keel-artifacts.generated.js';

const input = { linkRegistry: '0x1111111111111111111111111111111111111111', linkId: `0x${'22'.repeat(32)}` };
const zero = `0x${'00'.repeat(32)}`;
const abi = parseAbi(keelLinkRegistryAbi);

test('link presentation defaults to the registered canonical Inline shell', () => {
  const request = buildKeelLinkPresentationCall(input);
  assert.equal(request.to, input.linkRegistry);
  assert.equal(request.functionName, 'presentationURI');
  assert.deepEqual(request.arguments, [input.linkId, KEEL_INLINE_PROTECTION_SHELL_ID]);
  assert.equal(request.arguments[1], keccak256(stringToHex('keel.shell.inline-protection@1')));
  assert.ok(Object.isFrozen(request.arguments));
});

test('custom and no-viewer choices remain explicit and reach the contract gate', () => {
  for (const shellId of [zero, `0x${'33'.repeat(32)}`]) {
    const request = buildKeelLinkPresentationCall({ ...input, shellId });
    const data = encodeFunctionData({ abi, functionName: request.functionName, args: request.arguments });
    const decoded = decodeFunctionData({ abi: ABIS.KeelLinkRegistry, data });
    assert.equal(decoded.functionName, 'presentationURI');
    assert.deepEqual(decoded.args, [input.linkId, shellId]);
  }
});

test('raw delivery uses the checked linkURI call, not the metadata getter', () => {
  const request = buildKeelLinkURICall(input);
  assert.equal(request.functionName, 'linkURI');
  const data = encodeFunctionData({ abi, functionName: request.functionName, args: request.arguments });
  const decoded = decodeFunctionData({ abi: ABIS.KeelLinkRegistry, data });
  assert.equal(decoded.functionName, 'linkURI');
  assert.deepEqual(decoded.args, [input.linkId]);
});

test('malformed identities and shell selectors fail before preparing a read', () => {
  for (const build of [buildKeelLinkPresentationCall, buildKeelLinkURICall]) {
    assert.throws(() => build({ ...input, linkRegistry: `0x${'00'.repeat(20)}` }), /nonzero/);
    assert.throws(() => build({ ...input, linkId: zero }), /nonzero/);
    assert.throws(() => build({ ...input, linkId: '0x01' }));
  }
  assert.throws(() => buildKeelLinkPresentationCall({ ...input, shellId: '0x01' }));
});

test('presentation ABI and errors agree with generated contract declarations', () => {
  const parameter = p => ({ type: p.type, ...(p.components ? { components: p.components.map(parameter) } : {}) });
  for (const name of ['linkURI', 'presentationURI', 'REQUIRED_SHELL_ID', 'VerificationShellRequired', 'LinkMissing']) {
    const browser = abi.find(e => e.name === name);
    const contract = ABIS.KeelLinkRegistry.find(e => e.name === name);
    assert.ok(browser && contract, name);
    assert.deepEqual(browser.inputs.map(parameter), contract.inputs.map(parameter), name);
    if (browser.outputs) assert.deepEqual(browser.outputs.map(parameter), contract.outputs.map(parameter), name);
    assert.equal(browser.stateMutability, contract.stateMutability, name);
  }
});


test('presentation callers can decode errors bubbled from the registered builder', () => {
  for (const name of ['FragmentMismatch', 'UnsupportedLink', 'ResponseTooLarge']) {
    const browser = abi.find(e => e.type === 'error' && e.name === name);
    const contract = ABIS.KeelLinkURIBuilder.find(e => e.type === 'error' && e.name === name);
    assert.ok(browser && contract, name);
    assert.deepEqual(browser.inputs, contract.inputs);
  }
});
