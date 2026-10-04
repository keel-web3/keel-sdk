import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer as httpsServer } from 'node:https';
import { createServer as tcpServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync, deflateSync } from 'node:zlib';
import { createPublicClient, createWalletClient, http, keccak256, sha256, toHex, zeroHash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ABIS } from '../packages/sdk/dist/abis/keel-artifacts.generated.js';
import { buildKeelInlineShellFragments, buildKeelInlineModuleFragment, keelAssetDisplayModuleBytes, buildKeelLinkPresentationCall, KEEL_INLINE_PROTECTION_SHELL_ID, KeelFidelity, KeelLocatorScheme, KeelLinkCompression, KeelCompression, validateKeelFidelityLinks, KEEL_ASSET_DISPLAY_MODULE_VERSION } from '../packages/sdk/dist/index.js';

// Local EVM + real browser integration. The three fixture contracts supply
// deterministic Hold/authority records; registry and URI builder are production bytecode.
const contracts = resolve(process.env.KEEL_CONTRACTS_ROOT ?? '../keel-contracts');
async function artifact(file, name = file) {
  return JSON.parse(await readFile(join(contracts, 'out', `${file}.sol`, `${name}.json`), 'utf8'));
}
async function freePort() {
  const server = tcpServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(r => server.close(r)); return port;
}
async function chromePath() {
  if (process.env.KEEL_CHROME_HEADLESS_SHELL) return process.env.KEEL_CHROME_HEADLESS_SHELL;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const names = (await readdir(cache)).filter(n => n.startsWith('chromium_headless_shell-')).sort().reverse();
  assert.ok(names.length, 'Install Chrome headless shell or set KEEL_CHROME_HEADLESS_SHELL');
  return join(cache, names[0], 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
}
async function render(chrome, uri) {
  return new Promise((resolve, reject) => {
    // Only this fixture exempts loopback TLS and private-network address space.
    // Browser CORS remains enabled and is tested; production flags are unchanged.
    const child = spawn(chrome, ['--headless', '--ignore-certificate-errors', '--disable-features=BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks', '--virtual-time-budget=5000', '--dump-dom', uri]);
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('Browser timed out')); }, 20000);
    child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({out, err}) : reject(Error(err)); });
  });
}
function verified(result) {
  assert.ok(result.out.includes('data-vault-verification="verified"'), result.out.slice(-5500) + '\n' + result.err);
  assert.match(result.out, /id="verify-title">KEEL verified/);
  assert.match(result.out, /<iframe/);
  assert.match(result.out, /sandbox="allow-scripts allow-pointer-lock"/);
}
function rejected(result, reason) {
  assert.match(result.out, /data-vault-verification="failed"/);
  assert.doesNotMatch(result.out, /<iframe/, 'unverified bytes never receive an artwork frame');
  if (reason) assert.match([...result.out.matchAll(/id="verify-alert-message">([^<]*)</g)].at(-1)?.[1] ?? '', reason);
}

test('contract-returned canonical link URI verifies each HTTPS fetch before mounting artwork', { timeout: 180000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-link-browser-'));
  let anvil, server;
  try {
    const chrome = await chromePath();
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir,'key.pem'), '-out', join(dir,'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'], {stdio:'ignore'});
    const original = Buffer.from('<!doctype html><html><head></head><body><div id="art">ORIGINAL</div></body></html>');
    let body = original, mode = 'ok', hits = 0;
    t.beforeEach(() => { body = original; mode = 'ok'; });
    server = httpsServer({key: await readFile(join(dir,'key.pem')), cert: await readFile(join(dir,'cert.pem'))}, (_req, res) => {
      hits++;
      if (mode !== 'cors') res.setHeader('access-control-allow-origin', '*');
      res.setHeader('cache-control', 'no-store');
      if (mode === 'redirect') { res.writeHead(302, {location: '/redirect-target'}); res.end(); return; }
      res.setHeader('content-type', 'application/octet-stream'); res.end(body);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `https://127.0.0.1:${server.address().port}`;
    const port = await freePort();
    anvil = spawn('anvil', ['--port',String(port),'--gas-limit','1000000000','--silent','--prune-history'], {stdio:'ignore'});
    const transport = http(`http://127.0.0.1:${port}`, {retryCount:0});
    const client = createPublicClient({transport, pollingInterval:20});
    // Anvil's documented disposable account; never a user key or live RPC.
    const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
    const wallet = createWalletClient({account, transport});
    let ready = false;
    for (let i=0;i<100;i++) { try { await client.getChainId(); ready=true; break; } catch { await new Promise(r => setTimeout(r,50)); } }
    assert.ok(ready, 'local Anvil started');
    const deploy = async (file,name,args=[]) => {
      const a = await artifact(file,name);
      const abi = name === 'KeelLinkURIBuilder' ? ABIS.KeelLinkURIBuilder : a.abi;
      assert.deepEqual(abi, a.abi, 'SDK deployment ABI matches compiled contract');
      const hash = await wallet.deployContract({chain:null, abi, bytecode:a.bytecode.object, args, gas:100000000n});
      const receipt = await client.waitForTransactionReceipt({hash}); assert.equal(receipt.status,'success');
      return {address:receipt.contractAddress, abi:a.abi};
    };
    const write = async (contract, functionName, args) => {
      const hash = await wallet.writeContract({...contract,chain:null,functionName,args,gas:100000000n});
      assert.equal((await client.waitForTransactionReceipt({hash})).status, 'success', functionName);
    };
    const probe = await deploy('KeelLinkURIBuilder.t','LinkEnumProbe');
    await t.test('SDK enum meanings match Solidity, including distinct Hold and link compression', async () => {
      const actual = await client.readContract({...probe,functionName:'tags'});
      assert.deepEqual(actual, [
        [KeelFidelity.Preview,KeelFidelity.HybridMirror,KeelFidelity.HighResolution],
        [KeelLocatorScheme.Ipfs,KeelLocatorScheme.Ipns,KeelLocatorScheme.Https,KeelLocatorScheme.Arweave],
        [KeelLinkCompression.None,KeelLinkCompression.Gzip,KeelLinkCompression.Brotli,KeelLinkCompression.Deflate],
        [KeelCompression.None,KeelCompression.Gzip,KeelCompression.Deflate,KeelCompression.Brotli],
      ]);
    });
    const store = await deploy('KeelLinkURIBuilder.t','LinkAssemblyStore');
    const manager = await deploy('KeelLinkURIBuilder.t','LinkAssemblyManager');
    const registry = await deploy('KeelLinkURIBuilder.t','LinkAssemblyRegistry',[store.address,manager.address]);
    const links = await deploy('KeelLinkRegistry','KeelLinkRegistry',[registry.address]);
    const shell = await buildKeelInlineShellFragments({repositoryRoot:process.cwd()});
    const prefix = keccak256(toHex('prefix')), suffix = keccak256(toHex('suffix')), asset = keccak256(toHex('asset'));
    const assetSlot = await buildKeelInlineModuleFragment({moduleId:'keel.asset-display',version:KEEL_ASSET_DISPLAY_MODULE_VERSION,mediaType:'text/javascript',decodedBytes:keelAssetDisplayModuleBytes(),execution:'classic'});
    await write(store,'put',[prefix,toHex(shell.prefix.bytes)]);
    await write(store,'put',[suffix,toHex(shell.suffix.bytes)]);
    await write(store,'put',[asset,toHex(assetSlot.bytes)]);
    const builder = await deploy('KeelLinkURIBuilder','KeelLinkURIBuilder',[links.address,KEEL_INLINE_PROTECTION_SHELL_ID,{
      prefixObjectId:prefix,suffixObjectId:suffix,assetDisplayObjectId:asset,maxResponseBytes:65536n,ipfsGateway:origin+'/',arweaveGateway:origin+'/',
    }]);
    await write(manager,'register',[links.address,KEEL_INLINE_PROTECTION_SHELL_ID,builder.address]);
    links.abi = [...links.abi, ...builder.abi.filter(item => item.type === 'error')];
    const objectId = keccak256(toHex('link-browser-object'));
    let revision=0n;
    const publish = async ({scheme=KeelLocatorScheme.Https, uri=origin+'/art', compression=KeelLinkCompression.None, algorithm=0, bytes=original, mediaType='text/html'}={}) => {
      revision++;
      const input = validateKeelFidelityLinks([{fidelity:KeelFidelity.Preview,scheme,digestAlgorithm:algorithm,compression,uri,mediaType,decodedDigest:algorithm===0?sha256(toHex(bytes)):keccak256(toHex(bytes)),provenanceDigest:keccak256(toHex('provenance')),byteLength:BigInt(bytes.length)}]);
      const digest = await client.readContract({...links,functionName:'computeLinkSetDigest',args:[objectId,revision,input]});
      await write(registry,'commit',[objectId,revision,digest]); await write(links,'publishFidelityLinks',[objectId,revision,input]);
      const id = await client.readContract({...links,functionName:'predictLinkId',args:[objectId,revision,KeelFidelity.Preview]});
      const request = buildKeelLinkPresentationCall({linkRegistry:links.address,linkId:id});
      assert.equal(request.functionName,'presentationURI');
      const uriResult = await client.readContract({...links,functionName:request.functionName,args:request.arguments,gas:100000000n});
      assert.match(uriResult,/^data:text\/html;base64,/);
      return {id,uri:uriResult};
    };
    const main = await publish();
    await writeFile(join(dir,'contract-returned-uri.txt'),main.uri);
    await t.test('valid original, same-length tampering, restoration at the same HTTPS URL', async () => {
      verified(await render(chrome,main.uri));
      body=Buffer.from(original.toString().replace('ORIGINAL','MODIFIED')); assert.equal(body.length,original.length);
      rejected(await render(chrome,main.uri), /SHA-256 mismatch/);
      body=original; verified(await render(chrome,main.uri)); assert.ok(hits>=3);
    });
    await t.test('Keccak commitments verify and detect changed bytes', async () => {
      const link=await publish({algorithm:1}); verified(await render(chrome,link.uri));
      body=Buffer.from(original.toString().replace('ORIGINAL','MODIFIED')); rejected(await render(chrome,link.uri), /Keccak-256 mismatch/); body=original;
    });
    await t.test('gzip and deflate verify decoded content; decompression overruns fail', async () => {
      for (const [compression,compress] of [[KeelLinkCompression.Gzip,gzipSync],[KeelLinkCompression.Deflate,deflateSync]]) {
        const link=await publish({compression}); body=compress(original); verified(await render(chrome,link.uri));
        body=compress(Buffer.alloc(65537,65)); rejected(await render(chrome,link.uri), /response limit exceeded/);
      }
      body=original;
    });
    await t.test('redirects, CORS rejection and oversized streams do not create frames', async () => {
      mode='redirect'; rejected(await render(chrome,main.uri));
      mode='cors'; rejected(await render(chrome,main.uri));
      mode='ok'; body=Buffer.alloc(65537,65); rejected(await render(chrome,main.uri), /response limit exceeded/); body=original;
    });
    await t.test('locator text stays data and cannot terminate the shell script', async () => {
      const link=await publish({uri:origin+'/art?x=</script><script>alert(1)</script>'});
      const html=Buffer.from(link.uri.split(',')[1],'base64').toString();
      assert.ok(html.startsWith(Buffer.from(shell.prefix.bytes).toString()));
      assert.ok(html.endsWith(Buffer.from(shell.suffix.bytes).toString()));
      assert.ok(!html.includes('alert(1)')); verified(await render(chrome,link.uri));
    });
    await t.test('direct image bytes use the pinned canonical asset-display module', async () => {
      const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
      const link=await publish({bytes:png,mediaType:'image/png'}); body=png;
      verified(await render(chrome,link.uri)); body=original;
    });
    await t.test('unsupported decoder and entry media fail at the contract', async () => {
      await assert.rejects(publish({compression:KeelLinkCompression.Brotli}), /UnsupportedLink/);
      await assert.rejects(publish({mediaType:'application/octet-stream'}), /UnsupportedLink/);
      await assert.rejects(publish({bytes:Buffer.alloc(65537,65)}), /ResponseTooLarge/);
    });
    await t.test('IPNS uses its gateway through the canonical shell and rejects raw/custom delivery', async () => {
      const link = await publish({scheme:KeelLocatorScheme.Ipns,uri:'ipns://mutable-key'});
      verified(await render(chrome,link.uri));
      for (const shellId of [zeroHash,keccak256(toHex('custom'))]) {
        await assert.rejects(client.readContract({...links,functionName:'presentationURI',args:[link.id,shellId]}),/VerificationShellRequired/);
      }
    });
    await t.test('bare/custom HTTPS denied; bare immutable locators returned unchanged', async () => {
      for (const shellId of [zeroHash,keccak256(toHex('custom'))]) await assert.rejects(client.readContract({...links,functionName:'presentationURI',args:[main.id,shellId]}),/VerificationShellRequired/);
      for (const [scheme,uri] of [[KeelLocatorScheme.Ipfs,'ipfs://bafy-work'],[KeelLocatorScheme.Arweave,'ar://transaction']]) {
        const link=await publish({scheme,uri});
        assert.equal(await client.readContract({...links,functionName:'presentationURI',args:[link.id,zeroHash]}),uri);
      }
    });
    if (process.env.KEEL_LINK_EVIDENCE_DIR) {
      await writeFile(join(process.env.KEEL_LINK_EVIDENCE_DIR,'assembled-shell.html'),Buffer.from(main.uri.split(',')[1],'base64'));
      await writeFile(join(process.env.KEEL_LINK_EVIDENCE_DIR,'browser-summary.json'),JSON.stringify({localOnly:true,realRegistryAndBuilder:true,fixtureHoldAndManager:true,httpsFetches:hits,prefixBytes:shell.prefix.bytes.length,suffixBytes:shell.suffix.bytes.length,uriBytes:main.uri.length},null,2)+'\n');
    }
  } finally {
    if(server) await new Promise(r=>server.close(r));
    if(anvil && anvil.exitCode===null) { anvil.kill('SIGTERM'); await once(anvil,'close'); }
    await rm(dir,{recursive:true,force:true});
  }
});
