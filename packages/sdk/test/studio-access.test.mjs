import assert from 'node:assert/strict';
import test from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyTypedData } from 'viem';
import { createKeelStudioAccessClient, signKeelStudioAccessRequest } from '../dist/studio-access.js';
const id = '10000000-0000-4000-8000-000000000001';
test('access operations use the scoped grant, exact release path and optimistic revision', async () => {
 const seen = [], token = `keel_agent_${'A'.repeat(48)}`;
 const client = createKeelStudioAccessClient({ grantToken: token, studioUrl: 'https://studio.example', fetchImplementation: async (url, init) => { seen.push({ url: String(url), init }); return Response.json({ list: null }); } });
 await client.read(id); await client.update(id, { wallets: [], expectedRevision: 2 }); await client.test(id, '0x0000000000000000000000000000000000000001', ['0']); await client.requests(id);
 assert.equal(seen[0].url, `https://studio.example/api/agent/access/${id}`); assert.equal(seen[3].url.endsWith('?view=requests'), true);
 assert.ok(seen.every(item => new Headers(item.init.headers).get('authorization') === `Bearer ${token}` && item.init.redirect === 'error'));
 assert.equal(JSON.parse(seen[1].init.body).expectedRevision, 2); assert.deepEqual(JSON.parse(seen[2].init.body).claimIds, ['0']);
 await assert.rejects(client.read('../other'), /UUID/);
});
test('caller-owned signer produces the expected mint signature and rejects another signer or changed field types', async () => {
 const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`);
 const packet = { domain: { name: 'Keel OneMint', version: '2', chainId: 11155111, verifyingContract: '0x0000000000000000000000000000000000000001' }, types: { OneMintAuthorization: [['dropId','bytes32'],['stageIndex','uint16'],['account','address'],['quantity','uint32'],['nonce','uint256'],['deadline','uint64'],['contextHash','bytes32']].map(([name,type]) => ({name,type})) }, primaryType: 'OneMintAuthorization', message: { dropId: `0x${'22'.repeat(32)}`, stageIndex: 0, account: signer.address, quantity: 1, nonce: '0', deadline: String(Math.floor(Date.now()/1000)+300), contextHash: `0x${'33'.repeat(32)}` }, claimIds: [] };
 const request = { id, signer: signer.address, deadline: new Date(Date.now()+300000).toISOString(), packet };
 const signature = await signKeelStudioAccessRequest(request, signer);
 assert.equal(await verifyTypedData({ ...packet, address: signer.address, signature, message: { ...packet.message, nonce: 0n, deadline: BigInt(packet.message.deadline) } }), true);
 await assert.rejects(signKeelStudioAccessRequest({ ...request, signer: packet.domain.verifyingContract }, signer), /not the configured/);
 await assert.rejects(signKeelStudioAccessRequest({ ...request, packet: { ...packet, types: { OneMintAuthorization: [{ name: 'spender', type: 'address' }] } } }, signer), /Unsupported/);
});
