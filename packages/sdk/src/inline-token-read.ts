import { keelRpcReaderTransport } from "./rpc.js";
import { auditKeelInlineTokenURI } from "./inline-transport-audit.js";
import { keelInlineReadGasLimit } from "./presentation.js";

const MAX_URI = 2_000_000;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const quantity = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/iu.test(value)) throw new TypeError("Invalid RPC quantity.");
  return BigInt(value);
};
/** Read-only, bounded, block-pinned user-facing audit. Never signs or submits. */
export async function readKeelInlineTokenAudit(input: {
  readonly rpcUrl?: string; readonly chainId: number; readonly collection: string; readonly tokenId: string;
}, fetcher: typeof fetch = fetch) {
  const {chainId, collection, tokenId} = input;
  const transport = keelRpcReaderTransport(input.rpcUrl, chainId);
  const rpcUrl = transport.rpcUrl;
  if (fetcher === fetch) fetcher = transport.fetchImpl;
  const endpoint = new URL(rpcUrl);
  if (rpcUrl.length > 2048 || endpoint.username || endpoint.password || endpoint.hash
      || !(endpoint.protocol === "https:" || endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))) throw new TypeError("Use HTTPS RPC or loopback HTTP without URL credentials.");
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !/^0x[0-9a-f]{40}$/iu.test(collection)
      || /^0x0{40}$/iu.test(collection) || !/^(?:0|[1-9][0-9]{0,77})$/u.test(tokenId) || BigInt(tokenId) >= 1n << 256n) throw new TypeError("Invalid exact token target.");
  let id = 0;
  async function rpc(method: string, params: readonly unknown[], maximum = 128_000): Promise<unknown> {
    const callId = ++id;
    const response = await fetcher(endpoint.href, {method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:callId,method,params}), redirect:"error",signal:AbortSignal.timeout(45_000)});
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Token read HTTP ${response.status}.`); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; total += next.value.length;
        if (total > maximum) throw new RangeError("Token RPC response exceeds the byte limit."); chunks.push(next.value); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    const reply = JSON.parse(decoder.decode(bytes)) as Record<string,unknown>;
    if (reply.jsonrpc !== "2.0" || reply.id !== callId || reply.error || !Object.hasOwn(reply,"result")) throw new Error(`Token RPC ${method} failed or returned a mismatched response.`);
    return reply.result;
  }
  if (quantity(await rpc("eth_chainId",[])) !== BigInt(chainId)) throw new Error("Token RPC returned a different chain.");
  const block = await rpc("eth_getBlockByNumber",["latest",false]) as Record<string,unknown>;
  const blockNumber = quantity(block.number), blockHash = block.hash;
  if (typeof blockHash !== "string" || !/^0x[0-9a-f]{64}$/iu.test(blockHash)) throw new TypeError("Token RPC returned an invalid block hash.");
  const tag = `0x${blockNumber.toString(16)}`, gasLimit = keelInlineReadGasLimit(quantity(block.gasLimit));
  const code = await rpc("eth_getCode",[collection,tag]);
  if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/iu.test(code)) throw new Error("The selected collection has no code at the pinned block.");
  const result = await rpc("eth_call",[{to:collection,data:`0xc87b56dd${BigInt(tokenId).toString(16).padStart(64,"0")}`,gas:`0x${gasLimit.toString(16)}`},tag],MAX_URI * 2 + 4096);
  if (typeof result !== "string" || !/^0x(?:[0-9a-f]{2})+$/iu.test(result)) throw new TypeError("Invalid tokenURI ABI return.");
  const bytes = new Uint8Array(Buffer.from(result.slice(2),"hex"));
  const word = (offset:number) => BigInt("0x" + Buffer.from(bytes.slice(offset,offset+32)).toString("hex"));
  if (bytes.length < 64 || word(0) !== 32n) throw new TypeError("TokenURI is not a canonical ABI string return.");
  const length = word(32);
  if (length > BigInt(MAX_URI) || bytes.length !== 64 + Math.ceil(Number(length)/32)*32
      || bytes.slice(64+Number(length)).some(byte=>byte!==0)) throw new RangeError("TokenURI ABI length/padding is invalid or oversized.");
  const tokenURI = decoder.decode(bytes.slice(64,64+Number(length)));
  const audit = await auditKeelInlineTokenURI(tokenURI);
  const after = await rpc("eth_getBlockByNumber",[tag,false]) as Record<string,unknown>;
  if (after.hash !== blockHash || quantity(await rpc("eth_chainId",[])) !== BigInt(chainId)) throw new Error("Token chain/block changed during the audit.");
  return {schema:"keel-public-token-audit@1" as const,chainId,collection:collection.toLowerCase(),tokenId,
    blockNumber:blockNumber.toString(),blockHash,callGasLimit:gasLimit.toString(),rpcChainAndBlockConsistent:true,
    selectedChainReadAuthenticated:false as const,
    authenticationCaveat:"Chain and block consistency from the selected RPC; independent provider, receipt, binding and registry authentication remain separate.",
    audit, publicationReady:false as const, browserVerified:false as const,
    signing:"not-performed" as const, submission:"not-performed" as const};
}
