import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { KeelPublicationSimulationError, keelSimulationTransportFailure } from '../../packages/sdk/dist/publication-preflight.js';
import { KeelRpcResponseError } from '../../packages/sdk/dist/rpc.js';

const GETH_COMMIT = 'a579077007b98217c3e253a66e4b452ca0c32b96';
const HASH = /^0x[\da-f]{64}$/i, ADDRESS = /^0x[\da-f]{40}$/i;
const fail = message => new KeelPublicationSimulationError('rpc-unavailable', message);

/** Candidate Node adapter. No production registration or recipient default.
 * The caller must supply its explicitly approved state reader and a bounded,
 * network-isolated native process. It receives neither an RPC URL nor credentials.
 */
export async function createProofBackedSimulationTransport({ binaryPath, binarySha256, spawnExecutor, stateReader, block, signal, onEvidence,
  now = Date.now, limits = { gasBudget: 1_000_000_000, requests: 5000, witnessBytes: 32 * 1024 * 1024, responseBytes: 128 * 1024 * 1024, wallTimeMs: 90000 } }) {
  block=Object.freeze({...block});limits=Object.freeze({...limits});
  if (!HASH.test(block.hash) || typeof block.number !== 'bigint' || block.number < 0n || typeof spawnExecutor !== 'function' || !/^[\da-f]{64}$/.test(binarySha256)) throw new TypeError('Exact executor identity, pinned block and isolated runner required.');
  const digest = createHash('sha256').update(await readFile(binaryPath)).digest('hex');
  if (digest !== binarySha256) throw new TypeError('Native executor checksum mismatch.');
  for (const [key,max] of Object.entries({ gasBudget:10_000_000_000, requests:10000, witnessBytes:64*1024*1024, responseBytes:256*1024*1024, wallTimeMs:180000 }))
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > max) throw new TypeError('Invalid local resource limit.');
  const blockTag = `0x${block.number.toString(16)}`, abort = new AbortController();
  const combined = signal ? AbortSignal.any([signal,abort.signal]) : abort.signal;
  let busy = false;
  const ask = async (method, params, executionSignal = combined) => {
    const readSignal = AbortSignal.any([executionSignal, AbortSignal.timeout(limits.wallTimeMs)]);
    readSignal.throwIfAborted();
    // A source may ignore AbortSignal. Still settle locally and ignore its late result.
    return new Promise((resolve,reject) => {
      const cancelled = () => reject(readSignal.reason instanceof KeelPublicationSimulationError ? readSignal.reason : fail('Local state read cancelled or timed out.'));
      readSignal.addEventListener('abort',cancelled,{once:true});
      Promise.resolve().then(()=>{readSignal.throwIfAborted();return stateReader.request({method,params,signal:readSignal});}).then(resolve,reject).finally(()=>readSignal.removeEventListener('abort',cancelled));
    });
  };
  async function simulate(payload) {
    if (busy) throw fail('A native simulation is already in progress.');busy=true;
    const executionAbort = new AbortController(), executionSignal = AbortSignal.any([combined,executionAbort.signal]);
    const deadline = setTimeout(()=>executionAbort.abort(fail('Local simulation deadline exceeded.')),limits.wallTimeMs);
    const read = (method,params) => ask(method,params,executionSignal);
    try {
      if (BigInt(await read('eth_chainId', [])) !== 11155111n) throw fail('State source returned another chain.');
      const header = structuredClone(await read('eth_getBlockByNumber',[blockTag,false]));
      const fresh=()=>{const age=BigInt(Math.floor(now()/1000))-BigInt(header.timestamp);if(age>180n||age< -30n)throw fail('Pinned simulation snapshot is stale or in the future.');};
      if (header?.hash?.toLowerCase() !== block.hash.toLowerCase() || BigInt(header.number) !== block.number) throw fail('Pinned simulation block changed.');
      fresh();
      const request = {schema:'keel-proof-executor@1',chainId:11155111,blockHash:block.hash,header,payload,limits};
      const encoded = JSON.stringify(request)+'\n', requestSha256=createHash('sha256').update(encoded.slice(0,-1)).digest('hex');if (Buffer.byteLength(encoded)>34*1024*1024) throw fail('Native simulation input exceeds its byte budget.');
      const ancestorHashes = new Set([header.parentHash?.toLowerCase()]);
      const result = await new Promise((resolve,reject) => {
        const child=spawnExecutor();
        let stopped=false,finished=false,buffer=Buffer.alloc(0),outputBytes=0,stderrBytes=0,count=0,responseBytes=0,pendingResult,tail=Promise.resolve();
        const cancel=()=>finish(executionSignal.reason instanceof KeelPublicationSimulationError ? executionSignal.reason : fail('Local simulation cancelled.'));
        const finish=(error,value)=>{if(stopped)return;stopped=true;executionSignal.removeEventListener('abort',cancel);child.kill('SIGKILL');error?reject(error):resolve(value);};
        executionSignal.addEventListener('abort',cancel,{once:true});if(executionSignal.aborted){cancel();return;}
        child.once('error',()=>finish(fail('Native executor could not start.')));
        child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>64*1024)finish(fail('Native diagnostic limit exceeded.'));});
        child.once('close',code=>{tail.then(()=>{if(stopped)return;if(code!==0 || !finished || !pendingResult || buffer.length)finish(fail('Native simulation did not complete.'));else finish(undefined,pendingResult);}).catch(()=>finish(fail('Native simulation did not complete.')));});
        async function frame(message) {
          if(stopped)return;if(finished)throw fail('Native output followed a final result.');
          if(message.type==='error') {if(Number.isInteger(message.rpcCode)&&message.rpcCode<0)throw new KeelRpcResponseError(message.rpcCode);throw fail('Authenticated local execution could not be completed.');}
          if(message.type==='result') {
            const e=message.evidence;
            if(!Array.isArray(message.result)||message.result.length!==payload.blockStateCalls.length||e?.schema!=='keel-proof-executor-evidence@1'||e.gethCommit!==GETH_COMMIT||e.requestSha256!==requestSha256||e.chainId!==11155111||e.gasBudget!==limits.gasBudget||e.blockHash?.toLowerCase()!==block.hash.toLowerCase()||e.baseStateRoot!==header.stateRoot||e.signing!=='not-performed'||e.submission!=='not-performed'||e.readRequests!==count)throw fail('Native execution provenance mismatch.');
            for(const b of message.result)if(!HASH.test(b.stateRoot)||/^0x0+$/.test(b.stateRoot))throw fail('Native execution omitted an authenticated state root.');
            finished=true;pendingResult=message;return;
          }
          if(message.type!=='read'||message.id!==++count||count>limits.requests||!Array.isArray(message.params))throw fail('Unexpected native state request.');
          const p=message.params;
          if(message.method==='eth_getProof'||message.method==='eth_getCode') {
            const proof=message.method==='eth_getProof',anchor=p[proof?2:1];
            if(p.length!==(proof?3:2)||!ADDRESS.test(p[0])||!anchor||Object.keys(anchor).length!==2||anchor.blockHash?.toLowerCase()!==block.hash.toLowerCase()||anchor.requireCanonical!==true||proof&&(!Array.isArray(p[1])||p[1].length>1||p[1].some(k=>!HASH.test(k))))throw fail('Native state read escaped its pinned block.');
          } else if(message.method==='eth_getBlockByHash') {
            if(p.length!==2||!HASH.test(p[0])||p[1]!==false||!ancestorHashes.has(p[0].toLowerCase()))throw fail('Native ancestor read escaped its pinned chain.');
          } else throw fail('Native executor requested a disallowed upstream method.');
          const value=await read(message.method,p);if(stopped)return;
          if(message.method==='eth_getBlockByHash') {
            if(value?.hash?.toLowerCase()!==p[0].toLowerCase()||!HASH.test(value.parentHash))throw fail('Pinned ancestor response mismatch.');
            ancestorHashes.add(value.parentHash.toLowerCase());
          }
          const response=JSON.stringify({id:message.id,result:value})+'\n';responseBytes+=Buffer.byteLength(response);
          if(responseBytes>limits.responseBytes||Buffer.byteLength(response)>32*1024*1024)throw fail('Native state response budget exceeded.');
          if(!child.stdin.destroyed)child.stdin.write(response);
        }
        child.stdout.on('data',chunk=>{
          outputBytes+=chunk.length;if(outputBytes>64*1024*1024){finish(fail('Native output byte budget exceeded.'));return;}
          buffer=Buffer.concat([buffer,chunk]);let index;
          while((index=buffer.indexOf(10))>=0){const line=buffer.subarray(0,index);buffer=buffer.subarray(index+1);tail=tail.then(()=>frame(JSON.parse(line.toString('utf8')))).catch(error=>finish(error instanceof KeelPublicationSimulationError?error:keelSimulationTransportFailure(error)));}
          if(buffer.length>34*1024*1024)finish(fail('Native output frame budget exceeded.'));
        });
        child.stdin.on('error',()=>finish(fail('Native simulation input closed.')));child.stdin.write(encoded);
      });
      fresh();
      const canonical=await read('eth_getBlockByNumber',[blockTag,false]);
      if(canonical?.hash?.toLowerCase()!==block.hash.toLowerCase())throw new KeelPublicationSimulationError('chain-reorganized','Pinned block changed during local simulation.');
      try{onEvidence?.({...result.evidence,binarySha256});}catch{/* Observers cannot change proof. */}
      return result.result;
    } catch(error) { throw error instanceof KeelPublicationSimulationError ? error : keelSimulationTransportFailure(error); }
    finally {clearTimeout(deadline);executionAbort.abort();busy=false;}
  }
  return {async request(input) {
    combined.throwIfAborted();const exact=structuredClone(input);
    if(exact.method==='eth_simulateV1') {
      if(exact.params.length!==2||exact.params[1]!==blockTag)throw fail('Native simulation requires the exact selected block.');
      return simulate(exact.params[0]);
    }
    if(exact.method==='eth_chainId'&&exact.params.length===0)return ask(exact.method,exact.params);
    if(exact.method==='eth_getBlockByNumber'&&exact.params[0]===blockTag&&exact.params[1]===false&&exact.params.length===2)return ask(exact.method,exact.params);
    if(exact.method==='eth_getCode'&&ADDRESS.test(exact.params[0])&&exact.params[1]===blockTag&&exact.params.length===2)return ask(exact.method,[exact.params[0],{blockHash:block.hash,requireCanonical:true}]);
    throw fail('Native proof transport refuses this method or block.');
  },async close(){abort.abort();}};
}
