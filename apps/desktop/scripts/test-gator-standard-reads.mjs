/** Local regression fixture for the shipped KEEL contracts. No custom reader,
 * public RPC, wallet key, or publication. This measures reads, not catalog readiness.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, http, toHex, encodeFunctionData, decodeAbiParameters } from 'viem';
import { createKeelManagedObjectPlan } from '../../../packages/sdk/dist/native-publication.js';

const root = 'apps/desktop/artifacts/gator-inline-sepolia/3750-balanced';
const artifact = async name => JSON.parse(await readFile(`/Users/ravonus/dev/keel-contracts/out/${name}.sol/${name}.json`, 'utf8'));
const holdBuild = await artifact('KeelHold');
const builderBuild = await artifact('KeelHarnessBuilder');
const mcp = JSON.parse(await readFile(root + '/mcp-prepare.json', 'utf8')).result;
assert.ok(!mcp.isError, 'MCP preparation must pass before contract measurement');
assert.equal(mcp.structuredContent.resolvedCarriage, 'raw-percent');
const fixtures = await Promise.all([
  ['metadata-candidate.json', 'application/json'],
  ['image.svg', 'image/svg+xml'],
  ['viewer.html', 'text/html'],
].map(async ([file, mediaType]) => ({ file, mediaType, bytes: await readFile(root + '/' + file) })));
const metadata = JSON.parse(fixtures[0].bytes.toString());
const decode = uri => Buffer.from(decodeURIComponent(uri.slice(uri.indexOf(',') + 1)));
assert.deepEqual(decode(metadata.image), fixtures[1].bytes);
assert.deepEqual(decode(metadata.animation_url), fixtures[2].bytes);

const child = spawn('/Users/ravonus/.foundry/bin/anvil', ['--port', '0', '--chain-id', '31337', '--gas-limit', '60000000'], { stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Local EVM startup timeout')), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/Listening on (127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve('http://' + match[1]); }
    });
  });
  const client = createPublicClient({ transport: http(url, { timeout: 60000 }) });
  const wallet = createWalletClient({ transport: http(url, { timeout: 60000 }) });
  assert.equal(await client.getChainId(), 31337);
  const [account] = await wallet.getAddresses();
  const receipt = async hash => {
    const result = await client.waitForTransactionReceipt({ hash });
    assert.equal(result.status, 'success');
    return result;
  };
  const hold = (await receipt(await wallet.deployContract({ account, chain: null, abi: holdBuild.abi, bytecode: holdBuild.bytecode.object }))).contractAddress;
  const builder = (await receipt(await wallet.deployContract({ account, chain: null, abi: builderBuild.abi, bytecode: builderBuild.bytecode.object, args: [hold] }))).contractAddress;
  const reads = [];
  for (const fixture of fixtures) {
    const plan = await createKeelManagedObjectPlan(fixture.bytes, { hold, mediaType: fixture.mediaType, compression: 'none' });
    for (let i = 0; i < plan.chunks.length; i += 3) {
      await receipt(await wallet.writeContract({ account, chain: null, address: hold, abi: holdBuild.abi, functionName: 'castSlugs', args: [plan.chunks.slice(i, i + 3).map(chunk => toHex(chunk.bytes))] }));
    }
    for (const operation of plan.operations) await receipt(await wallet.sendTransaction({ account, chain: null, to: operation.target, data: operation.data, value: operation.value }));
    const calls = [{ to: hold, abi: holdBuild.abi, functionName: 'haulObject', args: [plan.objectId] }];
    if (fixture.mediaType === 'text/html') calls.push({ to: builder, abi: builderBuild.abi, functionName: 'harnessHTML', args: [plan.objectId, plan.digest] });
    for (const call of calls) {
      const data = encodeFunctionData(call);
      const response = await client.call({ to: call.to, data, gas: 60_000_000n });
      const [bytes] = decodeAbiParameters([{ type: 'bytes' }], response.data);
      assert.equal(bytes, toHex(fixture.bytes), `${call.functionName}: exact ${fixture.file}`);
      const gas = await client.estimateGas({ to: call.to, data, gas: 60_000_000n });
      assert.ok(gas < 60_000_000n);
      const result = { file: fixture.file, contract: call.to === hold ? 'KeelHold' : 'KeelHarnessBuilder', function: call.functionName, bytes: fixture.bytes.length, gas: String(gas), exactBytes: true, under60Million: true };
      reads.push(result);
      console.log(JSON.stringify(result));
    }
  }
  const report = { schema: 'gator-standard-contract-read-proof@1', localOnly: true, published: false, experimentalReaderUsed: false, metadataContainsExactSVGAndHTML: true, selectedChainCatalogVerified: false, note: 'Existing contract read regression only. Full documents are local fixtures; this does not approve duplicated publication, a Gator token mapping, or registry bindings.', reads };
  await writeFile(root + '/standard-contract-read-proof.json', JSON.stringify(report, null, 2));
} finally {
  child.kill('SIGTERM');
}
