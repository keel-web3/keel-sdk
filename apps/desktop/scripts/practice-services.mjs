import { createServer } from 'node:http';
import { encodeAbiParameters } from 'viem';

export const PRACTICE_CHAIN = 31337;
export const PRACTICE_CONTRACT = '0x1111111111111111111111111111111111111111';
export const PRACTICE_ACCOUNT = '0x2222222222222222222222222222222222222222';
export const PRACTICE_METADATA = { name: 'Practice / Signal Garden', description: 'A simulated token for trying KEEL metadata checks. This is local fixture data, not a published collectible.', image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#101a2b"/><circle cx="400" cy="270" r="160" fill="none" stroke="#a5afff" stroke-width="3"/><circle cx="400" cy="270" r="80" fill="#dfb07c"/><text x="65" y="525" fill="#a5afff" font-family="serif" font-size="28">Signal Garden / practice token</text></svg>'), attributes: [{ trait_type: 'Environment', value: 'Local practice' }] };
const metadataResponse = encodeAbiParameters([{ type: 'string' }], ['data:application/json;base64,' + Buffer.from(JSON.stringify(PRACTICE_METADATA)).toString('base64')]);
export const PRACTICE_ABI = [
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'setValue', stateMutability: 'nonpayable', inputs: [{ name: 'value', type: 'uint256' }], outputs: [] },
];

// A loopback-only practice service. It never contacts a chain or handles signed transactions.
export async function startPracticeServices() {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.headers.host !== `127.0.0.1:${server.address().port}`) { response.statusCode = 403; response.end('{}'); return; }
    if (request.method === 'GET') {
      if (request.url === '/.well-known/keel-capabilities') response.end(JSON.stringify({ schema: 'keel-studio-capabilities@2', generatedAt: new Date().toISOString(), chainId: PRACTICE_CHAIN, staging: { endpoint: '/api/agent/staging', transport: 'multipart-form-data', authentication: 'bearer', maxSourceBytes: 1000000, maximumRetentionSeconds: 3600, resumable: false, oneUseHandoff: false }, wallet: { signing: false, submission: false }, publication: { readiness: 'requires-project-verification', canonicalShellRequired: true } }));
      else if (request.url.startsWith('/api/library')) response.end(JSON.stringify({ assets: [{ name: 'Practice / Signal palette', description: 'Local fixture for testing discovery. This record is not published onchain.', chainId: PRACTICE_CHAIN, assetId: '0x'+'a'.repeat(64), license: 'Practice fixture only', byteLength: 128 }] }));
      else if (request.url.startsWith('/api/modules')) response.end(JSON.stringify({ modules: [{ name: 'Practice / Garden helpers', summary: 'Local catalog fixture; no carrier bytes or deployment.', version: '1.0.0', chainId: PRACTICE_CHAIN, source: 'local-test-fixture' }] }));
      else { response.statusCode = 404; response.end('{}'); }
      return;
    }
    if (request.method !== 'POST' || request.url !== '/') { response.statusCode = 405; response.end('{}'); return; }
    let body = ''; let size = 0;
    request.on('data', (bytes) => { size += bytes.length; if (size > 64_000) request.destroy(); else body += bytes.toString(); });
    request.on('end', () => {
      try {
        const rpc = JSON.parse(body); let result;
        if (rpc.method === 'eth_chainId') result = '0x7a69';
        else if (rpc.method === 'eth_blockNumber') result = '0x2a';
        else if (rpc.method === 'eth_getBlockByNumber') result = { number: '0x2a', gasLimit: '0x2aea540', timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, baseFeePerGas: '0x3b9aca00' };
        else if (rpc.method === 'eth_gasPrice') result = '0x77359400';
        else if (rpc.method === 'eth_maxPriorityFeePerGas') result = '0x3b9aca00';
        else if (rpc.method === 'eth_estimateGas') result = '0x5208';
        else if (rpc.method === 'eth_getCode') result = rpc.params?.[0]?.toLowerCase() === PRACTICE_CONTRACT ? '0x6000' : '0x';
        else if (rpc.method === 'eth_getStorageAt') result = '0x'+'0'.repeat(64);
        else if (rpc.method === 'eth_call' && rpc.params?.[0]?.to?.toLowerCase() === PRACTICE_CONTRACT) result = rpc.params[0].data?.startsWith('0xc87b56dd') ? metadataResponse : rpc.params[0].data === '0x8da5cb5b' ? `0x${PRACTICE_ACCOUNT.slice(2).padStart(64, '0')}` : '0x';
        else { response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: 'Practice service supports inspection and simulation only.' } })); return; }
        response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
      } catch { response.statusCode = 400; response.end('{}'); }
    });
  });
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}
