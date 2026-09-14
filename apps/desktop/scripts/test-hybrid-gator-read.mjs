/** Isolated EVM measurement; no public chain, private keys, or collection transactions. */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, http, toHex, keccak256, hexToBytes, encodeFunctionData, decodeAbiParameters } from 'viem';
import { decodeRasterPNG, verifyStripPNG } from '../../../packages/sdk/dist/raster-strips.js';
const size = Number(process.env.KEEL_RASTER_SIZE || 1080), count = Number(process.env.KEEL_REGION_COUNT || 128), base = 'apps/desktop/artifacts/gator-raster-study', root = process.env.KEEL_RASTER_REPORT_ROOT || `${base}/adaptive-${size}/hybrid-${count}-v2`, json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const report = await json(`${root}/report.json`), catalog = await json(`${root}/catalog.json`), build = await json(`${base}/region-solc-output.json`), contract = build.contracts['KeelRasterRegionReader.sol'].KeelRasterRegionReader, holdBuild = await json('/Users/ravonus/dev/keel-contracts/out/KeelHold.sol/KeelHold.json');
const largest = report.results.reduce((a, b) => a.pngBytes > b.pngBytes ? a : b), mostRefs = report.results.reduce((a, b) => a.references > b.references ? a : b), ids = [...new Set([report.results[0].tokenId, largest.tokenId, mostRefs.tokenId])], maps = new Map(), needed = new Set();
for (const id of ids) {
    const bytes = await readFile(`${root}/token-${id}.map`);
    maps.set(id, bytes);
    for (let i = 0; i < bytes.length; i += 4)
        needed.add(bytes.readUInt32BE(i));
}
const dataPages = [...new Set([...needed].map(id => catalog[id][0]))].sort((a, b) => a - b), catalogPages = [...new Set([...needed].map(id => Math.floor(id / 958)))].sort((a, b) => a - b);
const child = spawn('/Users/ravonus/.foundry/bin/anvil', ['--port', '0', '--chain-id', '31337', '--gas-limit', '60000000'], { stdio: ['ignore', 'pipe', 'pipe'] });
try {
    const url = await new Promise((resolve, reject) => { let s = ''; const timer = setTimeout(() => reject(Error('Local EVM startup timed out')), 20000); child.once('error', reject); child.stdout.on('data', c => { s += c; const m = s.match(/Listening on (127\.0\.0\.1:\d+)/); if (m) {
        clearTimeout(timer);
        resolve('http://' + m[1]);
    } }); });
    const client = createPublicClient({ transport: http(url, { timeout: 60000 }) }), wallet = createWalletClient({ transport: http(url, { timeout: 60000 }) }), [account, other] = await wallet.getAddresses();
    assert.equal(await client.getChainId(), 31337);
    async function receipt(hash) { const r = await client.waitForTransactionReceipt({ hash }); assert.equal(r.status, 'success'); return r; }
    async function deploy(abi, bytecode, args = []) { return (await receipt(await wallet.deployContract({ account, chain: null, abi, bytecode, args }))).contractAddress; }
    async function write(address, abi, functionName, args) { return receipt(await wallet.writeContract({ account, chain: null, address, abi, functionName, args })); }
    const hold = await deploy(holdBuild.abi, holdBuild.bytecode.object), renderer = await deploy(contract.abi, '0x' + contract.evm.bytecode.object, [hold]);
    const pointers = new Map();
    async function upload(buffers) { for (let i = 0; i < buffers.length; i += 3)
        await write(hold, holdBuild.abi, 'castSlugs', [buffers.slice(i, i + 3).map(toHex)]); const slugs = []; for (const b of buffers) {
        const slug = keccak256(b);
        if (!pointers.has(slug))
            pointers.set(slug, await client.readContract({ address: hold, abi: holdBuild.abi, functionName: 'slugPointer', args: [slug] }));
        slugs.push(slug);
    } return slugs; }
    const pageBuffers = await Promise.all(dataPages.map(p => readFile(`${root}/pages/${p}.bin`))), dataSlugs = await upload(pageBuffers), pagePointers = new Map(dataPages.map((p, i) => [p, pointers.get(dataSlugs[i])]));
    const records = catalogPages.map(page => { const n = Math.min(958, catalog.length - page * 958), buffer = Buffer.alloc(n * 24); for (let slot = 0; slot < n; slot++) {
        const id = page * 958 + slot;
        if (!needed.has(id))
            continue;
        const [dataPage, offset, length] = catalog[id];
        buffer.set(hexToBytes(pagePointers.get(dataPage)), slot * 24);
        buffer.writeUInt16BE(offset, slot * 24 + 20);
        buffer.writeUInt16BE(length, slot * 24 + 22);
    } return buffer; });
    const catalogSlugs = await upload(records);
    for (let i = 0; i < catalogPages.length; i += 100)
        await write(renderer, contract.abi, 'registerCatalog', [catalogPages.slice(i, i + 100).map(BigInt), catalogSlugs.slice(i, i + 100)]);
    for (const id of ids) {
        const map = maps.get(id), parts = [];
        for (let p = 0; p < map.length; p += 23000)
            parts.push(map.subarray(p, p + 23000));
        await write(renderer, contract.abi, 'registerToken', [BigInt(id), await upload(parts), BigInt(map.length / 4), BigInt(report.results.find(r => r.tokenId === id).pngBytes)]);
    }
    await assert.rejects(() => client.simulateContract({ address: renderer, abi: contract.abi, functionName: 'registerToken', account: other, args: [0n, [], 1n, 1n] }));
    const measurements = [];
    for (const id of ids) {
        const reference = process.env.KEEL_RASTER_REPORT_ROOT ? `${root}/references/${id}.png` : `${base}/adaptive-${size}/references/${id}.png`;
        const expected = await decodeRasterPNG(await readFile(reference));
        let singleCall;
        try {
            const data = encodeFunctionData({ abi: contract.abi, functionName: 'image', args: [BigInt(id), 0n, 1000000n] }), gas = await client.estimateGas({ to: renderer, data, gas: 60000000n }), response = await client.call({ to: renderer, data, gas: 60000000n });
            const [body, next] = decodeAbiParameters([{ type: 'bytes' }, { type: 'uint256' }], response.data);
            assert.equal(next, 0n);
            verifyStripPNG(hexToBytes(body), expected);
            singleCall = { gas: Number(gas), under60Million: true, exactRGBA: true };
        }
        catch (e) {
            singleCall = { under60Million: false, error: e.shortMessage ?? e.message };
        }
        let path = ['image', String(id)], bodies = [], gas = [];
        while (path) {
            const data = encodeFunctionData({ abi: contract.abi, functionName: 'request', args: [path, []] }), response = await client.call({ to: renderer, data, gas: 60000000n });
            const [status, body, headers] = decodeAbiParameters([{ type: 'uint16' }, { type: 'bytes' }, { type: 'tuple[]', components: [{ name: 'key', type: 'string' }, { name: 'value', type: 'string' }] }], response.data);
            assert.equal(status, 200);
            assert.equal(headers[0].value, 'image/png');
            bodies.push(hexToBytes(body));
            gas.push(Number(await client.estimateGas({ to: renderer, data, gas: 60000000n })));
            const next = headers.find(h => h.key === 'web3-next-chunk')?.value;
            path = next ? next.split('/').filter(Boolean) : null;
            if (gas.length > 500)
                throw Error('Too many image reads');
        }
        const png = Buffer.concat(bodies);
        verifyStripPNG(png, expected);
        await writeFile(`${root}/onchain-local-${id}.png`, png);
        const totalGas = gas.reduce((a, b) => a + b, 0);
        const record = { tokenId: id, pngBytes: png.length, singleCall, rpcCalls: gas.length, maxGasPerCall: Math.max(...gas), totalGas, under60MillionTotal: totalGas < 60_000_000, exactRGBA: true };
        measurements.push(record);
        console.log(JSON.stringify(record));
    }
    await writeFile(`${root}/read-cost.json`, JSON.stringify({ localOnly: true, publicChainPublished: false, selected: 'first token, largest PNG, most references in this sample', size, measurements, readerBytecodeHash: keccak256('0x' + contract.evm.bytecode.object), realKeelHold: true, unauthorizedMutationRejected: true, publicRPCAndMarketplace: 'not-tested' }, null, 2));
}
finally {
    child.kill('SIGTERM');
}
