import { checkLayeredArt, sampleLayeredArt } from '@keel/sdk/layered-art';
import { createHash } from 'node:crypto';
import { encodeFunctionData, decodeFunctionResult } from 'viem';
import { rpcUrl } from './contract-rpc.mjs';
import { metadataDocument, metadataChecks, parseMetadata, referenceKind } from './metadata.mjs';
export const projectFingerprint = (project) => createHash('sha256').update(JSON.stringify({ layered:project.layered, metadata: metadataDocument(project), objectIds: project.objectIds, files: project.files, presentation: project.presentation, publication: project.publication, contractIds: project.contractIds, targetNetworkId: project.targetNetworkId, intent: project.intent })).digest('hex');
export async function boundedResponse(response, limit) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`The server returned HTTP ${response.status}.`); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('The server returned no data.');
  const chunks = []; let bytes = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > limit) { await reader.cancel(); throw new Error(`Response exceeds this check’s ${limit / 1_000_000} MB budget. The file is still kept; use paged contract retrieval for larger works.`); } chunks.push(part.value); }
  return Buffer.concat(chunks);
}
export function mediaEndpoint(reference) {
  const expanded = reference.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${reference.slice(7).replace(/^ipfs\//, '')}` : reference.startsWith('ar://') ? `https://arweave.net/${reference.slice(5)}` : reference;
  const url = new URL(expanded);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Remote metadata needs an HTTPS address or an IPFS / Arweave URI. You can also import a local image.');
  // Metadata never grants access to local services or file URLs.
  if (url.hostname === 'localhost' || /(?:^|\.)localhost$|\.local$/.test(url.hostname) || /^(?:\[|\d+\.)/.test(url.hostname)) throw new Error('Local network addresses cannot be loaded from metadata. Import the file instead.');
  return url.href;
}
export async function remoteBytes(reference, limit, fetcher = fetch) {
  const response = await fetcher(mediaEndpoint(reference), { redirect: 'error', signal: AbortSignal.timeout(12_000), credentials: 'omit' });
  return { bytes: await boundedResponse(response, limit), type: response.headers.get('content-type')?.split(';')[0].toLowerCase() ?? '' };
}
export function decodeMetadataUri(uri) {
  const match = /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(uri);
  if (!match) return null;
  return parseMetadata(match[1] ? Buffer.from(match[2], 'base64').toString('utf8') : decodeURIComponent(match[2]));
}
export async function checkPublishedMetadata(profile, publication, fetcher = fetch) {
  if (profile.family !== 'ethereum') throw new Error('Token metadata read-back currently supports EVM collections. Tezos still needs its metadata adapter; keep the selected network.');
  if (profile.chainId !== publication.chainId) throw new Error('The saved token belongs to another network. Choose its network before checking.');
  let requestId = 0;
  async function rpc(method, params = []) {
    const response = await fetcher(rpcUrl(profile.rpcUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }), signal: AbortSignal.timeout(15_000), redirect: 'error' });
    const data = JSON.parse((await boundedResponse(response, 8_500_000)).toString('utf8'));
    if (data.error) throw new Error(data.error.message ?? 'The contract read failed.');
    if (data.result === undefined) throw new Error('RPC returned no result.');
    return data.result;
  }
  if (Number(BigInt(await rpc('eth_chainId'))) !== publication.chainId) throw new Error('RPC chain changed. Reconnect the expected network.');
  const block = await rpc('eth_blockNumber');
  if (!/^0x[\da-f]+$/i.test(block)) throw new Error('RPC returned an invalid block.');
  const name = publication.standard === 'erc1155' ? 'uri' : 'tokenURI';
  const abi = [{ type: 'function', name, stateMutability: 'view', inputs: [{ type: 'uint256', name: 'id' }], outputs: [{ type: 'string' }] }];
  const [code, result] = await Promise.all([
    rpc('eth_getCode', [publication.contractAddress, block]),
    rpc('eth_call', [{ to: publication.contractAddress, data: encodeFunctionData({ abi, functionName: name, args: [BigInt(publication.tokenId)] }) }, block]),
  ]);
  if (!code || code === '0x') throw new Error('No contract code was found for this token at the observed block.');
  let uri = decodeFunctionResult({ abi, functionName: name, data: result });
  if (typeof uri !== 'string') throw new Error('The metadata method did not return a URI.');
  if (publication.standard === 'erc1155') uri = uri.replaceAll('{id}', BigInt(publication.tokenId).toString(16).padStart(64, '0'));
  const location = referenceKind(uri);
  let document = decodeMetadataUri(uri);
  let retrievalError;
  if (!document && ['web', 'distributed'].includes(location)) {
    try { document = parseMetadata((await remoteBytes(uri, 2_000_000, fetcher)).bytes.toString('utf8')); } catch (error) { retrievalError = error.message; }
  }
  return {
    chainId: publication.chainId, contractAddress: publication.contractAddress, tokenId: publication.tokenId, block: BigInt(block).toString(), checkedAt: new Date().toISOString(), metadataLocation: location,
    uri: uri.length < 4096 ? uri : `${uri.slice(0, 100)}… (${Buffer.byteLength(uri)} bytes)`, document, retrievalError,
    checks: [
      { id: 'contract', title: 'Contract on the selected network', status: 'pass', detail: `Code and ${name} read at block ${BigInt(block)}.` },
      { id: 'chain-metadata', title: 'Metadata returned by the contract', status: location === 'embedded' && document ? 'pass' : 'attention', detail: location === 'embedded' && document ? 'JSON was embedded in the contract response.' : `The contract returns a ${location} reference. ${retrievalError ?? 'The referenced bytes have separate availability requirements.'}` },
      { id: 'metadata-readable', title: 'Published metadata is readable', status: document ? 'pass' : 'unknown', detail: document ? 'A JSON document was decoded.' : retrievalError ?? 'This URI needs another retrieval adapter.' },
      { id: 'full-artwork', title: 'Complete artwork preservation', status: 'unknown', detail: 'Nested files, runtime dependencies, mutability and contract authority need a separate audit. A successful token URI read alone does not prove the full work is onchain.' },
    ],
  };
}
export async function checkLocalProject(project, objects, verifyObject) {
  const checks = metadataChecks(project, objects);
  if(project.layered){const report=checkLayeredArt(project.layered,project.objectIds);const sample=await sampleLayeredArt(project.layered,100,project.layered.seed);checks.push({id:'layers',title:'Layer combinations and reuse choices',status:report.issues.length||sample.failures.length?'attention':'pass',detail:[...report.issues.map(i=>i.message),`${sample.failures.length} broken samples; ${sample.duplicates} duplicates in 100 trials.`].join(' ')});checks.push({id:'layer-publication',title:'Layer publication and reveal setup',status:'attention',detail:'Local rendering only. Verify selected-network module bindings and the collection token/reveal adapter before publication.'});}
  const failures = [];
  for (const id of project.objectIds) { try { await verifyObject(id); } catch (error) { failures.push({ id, message: error.message }); } }
  checks.push({ id: 'originals', title: 'Saved originals match their fingerprints', status: failures.length ? 'attention' : project.objectIds.length ? 'pass' : 'info', detail: failures.length ? `${failures.length} files need recovery.` : `${project.objectIds.length} original files checked using SHA-256.` });
  return { checkedAt: new Date().toISOString(), fingerprint: projectFingerprint(project), checks, failures };
}
