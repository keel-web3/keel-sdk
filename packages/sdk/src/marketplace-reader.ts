import { createKeelRpcClient, type KeelRpcClientOptions, type KeelRpcDisclosure } from "@keel/protocol";
import type { KeelMarketplaceDirectory, KeelShellClient } from "./verification-shell-client.js";

export interface KeelMarketplaceTarget {
  readonly id: string;
  readonly label: string;
  readonly protocol: "keel-market@1" | "seaport@1";
  readonly contract: string;
  /** Seaport conduit (or the exchange itself when no conduit is used). */
  readonly operator?: string;
  readonly href: string;
  readonly currency: string;
}
export interface KeelMarketplaceToken {
  readonly chainId: number;
  readonly collection: string;
  readonly tokenId: string;
}
/** Obtained from the marketplace's order feed. RPC cannot discover unsigned/offchain orders. */
export interface KeelMarketplaceOrder {
  readonly marketId: string;
  readonly chainId: number;
  readonly collection: string;
  readonly tokenId: string;
  readonly orderHash: string;
  readonly seller: string;
  readonly counter: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly price: string;
  readonly currency: string;
  readonly href: string;
  readonly sourceURI: string;
  readonly observedAt: string;
  readonly status: "active" | "cancelled" | "filled";
}
export interface KeelMarketplaceReadResult {
  readonly directory: KeelMarketplaceDirectory;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly rpc: KeelRpcDisclosure;
  readonly unavailable: readonly string[];
}
export interface KeelMarketplaceReaderOptions {
  readonly rpc: KeelRpcClientOptions;
  readonly markets: readonly KeelMarketplaceTarget[];
  readonly cacheMs?: number;
}
export interface KeelShellMarketplaceConfig {
  readonly chainId: number;
  readonly rpcUrls: readonly string[];
  readonly rpcHosts?: readonly string[];
  readonly markets: readonly KeelMarketplaceTarget[];
}

const ADDRESS = /^0x[0-9a-f]{40}$/iu, WORD = /^0x[0-9a-f]{64}$/iu, UINT = /^(?:0|[1-9][0-9]*)$/u;
const address = (v: string) => { if (!ADDRESS.test(v) || /^0x0{40}$/iu.test(v)) throw new TypeError("Invalid marketplace address."); return v.toLowerCase(); };
const uint = (v: string) => { if (typeof v !== "string" || !UINT.test(v) || v.length > 78 || BigInt(v) >= 1n << 256n) throw new TypeError("Invalid marketplace integer."); return BigInt(v); };
const word = (v: string) => uint(v).toString(16).padStart(64, "0");
const addrWord = (v: string) => address(v).slice(2).padStart(64, "0");
const url = (v: string) => { if (typeof v !== "string" || v.length > 2048) throw new TypeError("Invalid marketplace URL."); const u = new URL(v); if (u.protocol !== "https:" || u.username || u.password) throw new TypeError("Marketplace links must be HTTPS without credentials."); return u.href; };
const words = (v: string, count: number) => { if (!/^0x(?:[0-9a-f]{64})+$/iu.test(v) || v.length !== 2 + 64 * count) throw new Error("Invalid marketplace ABI response."); return v.slice(2).match(/.{64}/gu)!; };
const abiAddress = (v: string) => { if (!/^0{24}[0-9a-f]{40}$/iu.test(v)) throw new Error("Invalid address word."); return "0x" + v.slice(24).toLowerCase(); };
const abiBool = (v: string) => { const n = BigInt("0x" + v); if (n > 1n) throw new Error("Invalid boolean word."); return n === 1n; };
const price18 = (n: bigint) => { const d = 10n ** 18n, f = (n % d).toString().padStart(18, "0").replace(/0+$/u, ""); return (n / d).toString() + (f ? "." + f : ""); };

/**
 * The normal KEEL hybrid RPC transport owns host policy, timeouts, failover and
 * disclosure. This reader adds bounded market reads at one canonical block.
 * It never loads art, asks for a wallet or changes the file-verification verdict.
 */
export function createKeelMarketplaceReader(options: KeelMarketplaceReaderOptions) {
  if (options.rpc.family !== "ethereum" || !Number.isSafeInteger(options.rpc.chainId) || options.rpc.chainId! <= 0) throw new TypeError("Marketplace reads require the selected EVM chain.");
  if (!Array.isArray(options.markets) || options.markets.length > 8) throw new RangeError("At most eight marketplace adapters are allowed.");
  const cacheMs = options.cacheMs ?? 30_000;
  if (!Number.isInteger(cacheMs) || cacheMs < 0 || cacheMs > 30_000) throw new RangeError("Marketplace cache must be at most 30 seconds.");
  const ids = new Set<string>();
  const markets = options.markets.map(m => {
    if (!/^[a-z0-9-]{1,32}$/u.test(m.id) || ids.has(m.id) || m.id === "onkeel"
      || typeof m.label !== "string" || m.label.length < 1 || m.label.length > 40
      || !["keel-market@1", "seaport@1"].includes(m.protocol) || !/^[A-Za-z0-9]{1,16}$/u.test(m.currency)) throw new TypeError("Invalid marketplace adapter.");
    ids.add(m.id);
    return Object.freeze({...m,contract:address(m.contract),href:url(m.href),...(m.operator ? {operator:address(m.operator)} : {})});
  });
  const rpcOptions = {...options.rpc, verifyChainId:true,
    timeoutMs:Math.min(options.rpc.timeoutMs ?? 8_000, 8_000), maxResponseBytes:16_384};
  let lastRpc = createKeelRpcClient(rpcOptions);
  const cache = new Map<string, {until: number; promise: Promise<KeelMarketplaceReadResult>}>();
  let revision = 0;

  async function read(token: KeelMarketplaceToken, orders: readonly KeelMarketplaceOrder[] = []): Promise<KeelMarketplaceReadResult> {
    if (token.chainId !== options.rpc.chainId) throw new TypeError("Marketplace token belongs to another chain.");
    const collection = address(token.collection), tokenId = uint(token.tokenId).toString();
    if (!Array.isArray(orders) || orders.length > 8) throw new RangeError("At most eight discovered orders are allowed.");
    const key = JSON.stringify([collection, tokenId, orders]);
    if (key.length > 32768) throw new RangeError("Marketplace order data exceeds 32 KiB.");
    const existing = cache.get(key);
    if (existing && existing.until > Date.now()) return existing.promise;
    if (cache.size >= 16) {
      const oldest=[...cache].find(([,item])=>item.until!==Infinity)?.[0];
      if(oldest!==undefined)cache.delete(oldest);
      else throw new RangeError("Too many pending marketplace reads.");
    }
    const promise = load({...token,collection,tokenId}, orders);
    // Coalesce callers while a request is pending, even if normal caching is off.
    const entry = {until:Infinity,promise}; cache.set(key,entry);
    void promise.then(() => { entry.until = Date.now() + cacheMs; }, () => { if (cache.get(key) === entry) cache.delete(key); });
    return promise;
  }

  async function load(token: KeelMarketplaceToken, orders: readonly KeelMarketplaceOrder[]): Promise<KeelMarketplaceReadResult> {
    const deadline=AbortSignal.timeout(20_000);
    const rpc=lastRpc=createKeelRpcClient({...rpcOptions,signal:options.rpc.signal?AbortSignal.any([options.rpc.signal,deadline]):deadline});
    const snapshot = await rpc.snapshot(), block = {blockHash:snapshot.blockHash,requireCanonical:true as const};
    const now = Date.now(), chainTime = BigInt(snapshot.timestamp), unavailable: string[] = [];
    const reads = new Map<string, Promise<string>>();
    const call = (to: string, data: string) => {
      const key = to + data; let value = reads.get(key);
      if (!value) { if (reads.size >= 64) throw new RangeError("Marketplace read budget exceeded."); value = rpc.call({to,data,block}); reads.set(key,value); }
      return value;
    };
    const owner = abiAddress(words(await call(token.collection, "0x6352211e" + word(token.tokenId)), 1)[0]!);
    const approved = async (operator: string, seller: string) => {
      const [single, all] = await Promise.all([
        call(token.collection,"0x081812fc" + word(token.tokenId)),
        call(token.collection,"0xe985e9c5" + addrWord(seller) + addrWord(operator)),
      ]);
      return abiAddress(words(single,1)[0]!) === operator || abiBool(words(all,1)[0]!);
    };
    const listing = (m: KeelMarketplaceTarget, values: {price:string;currency:string;sourceURI:string;expires:bigint;basis:"onchain-sale"|"marketplace-order";href?:string;observedAt?:string}) => ({
      id:m.id,label:m.label,href:url(values.href ?? m.href),kind:"asset" as const,
      listing:{status:"listed" as const,price:values.price,currency:values.currency,sourceURI:url(values.sourceURI),
        observedAt:values.observedAt ?? new Date(now).toISOString(),
        chainId:token.chainId,collection:token.collection,tokenId:token.tokenId,blockNumber:snapshot.blockNumber,
        expiresAt:new Date(Math.min(now+60_000,values.observedAt ? Date.parse(values.observedAt)+60_000 : now+60_000,values.expires===0n ? now+60_000 : Number(values.expires)*1000)).toISOString(),
        check:values.basis,rpcEndpoint:rpc.disclosure().servedBy ?? "Unavailable"},
    });
    const links: KeelMarketplaceDirectory["links"][number][] = [];
    // A maximum of eight adapters, each with a bounded number of reads. Do not
    // let a slow provider prevent other markets from returning their results.
    for (let offset=0;offset<markets.length;offset+=4) {
      await Promise.all(markets.slice(offset,offset+4).map(async m => {
        try {
          if (m.protocol === "keel-market@1") {
            const raw = await call(m.contract,"0x8de820f6"+addrWord(token.collection)+word(token.tokenId));
            // Eight words are the published original ABI; nine add escrowed.
            const values = words(raw,raw.length===2+9*64 ? 9 : 8), seller=abiAddress(values[0]!), price=BigInt("0x"+values[2]!), expires=BigInt("0x"+values[6]!);
            if (/^0x0{40}$/u.test(seller) || price===0n || expires!==0n && expires<=chainTime) return;
            const escrowed = values.length===9 && abiBool(values[8]!);
            if (escrowed ? owner!==m.contract : owner!==seller || !await approved(m.contract,seller)) return;
            links.push(listing(m,{price:price18(price),currency:m.currency,sourceURI:m.href,expires,basis:"onchain-sale"}));
            return;
          }
          for (const order of orders.filter(o=>o.marketId===m.id)) {
            if (order.status!=="active" || order.chainId!==token.chainId || address(order.collection)!==token.collection
              || uint(order.tokenId).toString()!==token.tokenId || !WORD.test(order.orderHash) || address(order.seller)!==owner
              || !Number.isFinite(Date.parse(order.observedAt)) || Date.parse(order.observedAt)<now-60_000 || Date.parse(order.observedAt)>now+5_000) continue;
            const start=uint(order.startTime),end=uint(order.endTime);
            if (start>chainTime || end<=chainTime || !/^\d+(?:\.\d+)?$/u.test(order.price) || order.price.length>80 || order.currency!==m.currency) continue;
            const [status, counter] = await Promise.all([
              call(m.contract,"0x46423aa7"+order.orderHash.slice(2)),
              call(m.contract,"0xf07ec373"+addrWord(owner)),
            ]);
            const state=words(status,4), totalFilled=BigInt("0x"+state[2]!), totalSize=BigInt("0x"+state[3]!);
            abiBool(state[0]!); // Reject malformed ABI even though validation alone does not discover an order.
            if (abiBool(state[1]!) || totalSize!==0n && totalFilled>=totalSize || totalFilled>totalSize
              || BigInt("0x"+words(counter,1)[0]!)!==uint(order.counter) || !await approved(m.operator ?? m.contract,owner)) continue;
            links.push(listing(m,{price:order.price,currency:order.currency,sourceURI:order.sourceURI,href:order.href,
              expires:end,basis:"marketplace-order",observedAt:order.observedAt}));
            break;
          }
        } catch { unavailable.push(m.id); }
      }));
    }
    links.sort((a,b)=>markets.findIndex(m=>m.id===a.id)-markets.findIndex(m=>m.id===b.id));
    return Object.freeze({directory:Object.freeze({protocol:"keel-marketplaces@1",revision:++revision,links:Object.freeze(links)}),
      blockNumber:snapshot.blockNumber,blockHash:snapshot.blockHash,rpc:rpc.disclosure(),unavailable:Object.freeze(unavailable)});
  }
  return Object.freeze({read,clear:()=>cache.clear(),disclosure:()=>lastRpc.disclosure()});
}

/** Optional host integration. Failure cannot invoke the verifier's fail path. */
export async function refreshKeelShellMarketplaceInfo(input: {
  readonly reader: ReturnType<typeof createKeelMarketplaceReader>;
  readonly client: Pick<KeelShellClient,"setMarketplaces">;
  readonly token: KeelMarketplaceToken;
  readonly orders?: readonly KeelMarketplaceOrder[];
}): Promise<{readonly available:boolean;readonly error?:string}> {
  try {
    const result=await input.reader.read(input.token,input.orders);
    await input.client.setMarketplaces(result.directory);
    return {available:true};
  } catch {
    // Do not forward provider messages or credential-bearing URLs to artwork.
    return {available:false,error:"Optional marketplace lookup unavailable"};
  }
}

/** Optional background enrichment for the inline shell. Returns immediately. */
export function startKeelShellMarketplaceInfo(
  config: KeelShellMarketplaceConfig,
  token: KeelMarketplaceToken,
  client: Pick<KeelShellClient,"setMarketplaces">,
) {
  let reader:ReturnType<typeof createKeelMarketplaceReader>;
  try {
    if(config.chainId!==token.chainId)throw new Error("Wrong chain");
    reader=createKeelMarketplaceReader({rpc:{family:"ethereum",chainId:config.chainId,endpoints:config.rpcUrls,
      ...(config.rpcHosts?{hostList:config.rpcHosts}:{})},markets:config.markets});
  } catch {return Object.freeze({dispose(){}});}
  let running=false,stopped=false;
  const refresh=async()=>{
    if(stopped||running||document.visibilityState==="hidden")return;
    running=true;
    try{await refreshKeelShellMarketplaceInfo({reader,client,token});}
    finally{running=false;}
  };
  void refresh();
  const timer=setInterval(()=>{if(document.body.classList.contains("verify-open"))void refresh();},60_000);
  const onVisible=()=>{if(document.body.classList.contains("verify-open"))void refresh();};
  document.addEventListener("visibilitychange",onVisible);
  return Object.freeze({dispose(){stopped=true;clearInterval(timer);document.removeEventListener("visibilitychange",onVisible);}});
}
