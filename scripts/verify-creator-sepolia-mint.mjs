#!/usr/bin/env node
// Public-chain read-only smoke proof. No wallet, key, signature or transaction.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSepoliaReadClient,reportRpcFailure} from './sepolia-rpc.mjs';
import {parseAbi} from 'viem';
import {decodeKeelInlineDataURI,inspectKeelInlinePayloadCarriage} from '../packages/sdk/dist/index.js';
import {checkCreatorSepolia} from './check-sepolia.mjs';
const abi=parseAbi(['function ownerOf(uint256 tokenId) view returns(address)','function tokenURI(uint256 tokenId) view returns(string)']);
try {
  const manifest=JSON.parse(await readFile(new URL('../deployments/creator-inline-20261005/manifest.json',import.meta.url),'utf8'));
  const {client,pool,configuration}=await createSepoliaReadClient();
  const infrastructure=await checkCreatorSepolia(client);
  const blockNumber=BigInt(infrastructure.verification.blockNumber);
  const receipt=await client.getTransactionReceipt({hash:manifest.smoke.mintTransaction});
  assert.equal(receipt.status,'success');assert.ok(receipt.blockNumber<=blockNumber);
  const collection=manifest.smoke.collection,tokenId=BigInt(manifest.smoke.tokenId);
  const owner=await client.readContract({address:collection,abi,functionName:'ownerOf',args:[tokenId],blockNumber});
  assert.equal(owner.toLowerCase(),manifest.smoke.owner.toLowerCase());
  const uri=await client.readContract({address:collection,abi,functionName:'tokenURI',args:[tokenId],gas:50000000n,blockNumber});
  assert.equal(Buffer.byteLength(uri),manifest.smoke.tokenURIIntegrity.byteLength);
  assert.equal('0x'+createHash('sha256').update(uri).digest('hex'),manifest.smoke.tokenURIIntegrity.digest);
  const metadata=JSON.parse(Buffer.from(decodeKeelInlineDataURI(uri,'application/json')).toString());
  const viewer=decodeKeelInlineDataURI(metadata.animation_url,'text/html');
  const audit=inspectKeelInlinePayloadCarriage(viewer);
  assert.equal(audit.payloadCount,1);assert.equal(audit.preparedDenseCopy.contractOperation,'verified-copy');
  console.log(JSON.stringify({schema:'keel-public-sepolia-verification@1',checkedAt:new Date().toISOString(),status:'mint-receipt-and-exact-public-readback-verified',chainId:11155111,blockNumber:String(blockNumber),collection,tokenId:String(tokenId),owner,tokenURIBytes:Buffer.byteLength(uri),recordedBrowserProof:'deployments/creator-inline-20261005/browser-proof.json',browserRun:'not-performed-by-this-read-only-check',rpcSource:configuration.source,rpcProviders:pool.status(),verifiedInfrastructureContracts:infrastructure.contracts.length,tokenURIIntegrity:{byteLength:Buffer.byteLength(uri),sha256:'0x'+createHash('sha256').update(uri).digest('hex')},writes:0},null,2));
} catch (error) {
  reportRpcFailure(error,'Creator Sepolia smoke verification failed. Check required history access, current owner and exact recorded byte commitments. No transaction was sent.');
  process.exitCode=1;
}
