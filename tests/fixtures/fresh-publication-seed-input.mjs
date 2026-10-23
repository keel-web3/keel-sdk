// Synthetic program and header. Only runtime bytecode is taken from matched
// public contracts; no creator calldata, historical state or private URI.
import { readFileSync } from 'node:fs';
import { concatHex, encodeAbiParameters, encodeFunctionData, getContractAddress, keccak256, parseAbi, toHex, toRlp } from 'viem';
import { keelPublicationJobAbi, keelHoldAbi, keelFactoryAbi } from '../../packages/sdk/dist/abi.js';
import { REQUIRED_CASES, sha256 } from '../../scripts/lib/captured-publication-fixture.mjs';

export const jobAbi = parseAbi(keelPublicationJobAbi), holdAbi = parseAbi(keelHoldAbi), factoryAbi = parseAbi(keelFactoryAbi);
export const JOB = '0x93f8bb414f22d5df29db6d67b78224d69453a094';
export const HOLD = '0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267';
export const FACTORY = '0xe7f47a76d2887d0a54f7c40dcf7ffcc69e6f22be';
export const DEPLOYER = '0x74476ea0dc3d74e6a5fcd9544018ccd253e3f6cf';
export const OWNER = `0x${'11'.repeat(20)}`, EXECUTOR = `0x${'22'.repeat(20)}`;
export const runtimes = JSON.parse(readFileSync(new URL('./publication-witness-layout-runtimes.json', import.meta.url))).runtimes;
const hash = byte => `0x${byte.repeat(32)}`;
export const slot = value => toHex(value, { size: 32 });
const scalar = value => BigInt(value) === 0n ? '0x' : toHex(BigInt(value));
export function sealHeader(stateRoot = hash('03')) {
  const h = { parentHash: hash('01'), sha3Uncles: keccak256(toRlp([])), miner: OWNER, stateRoot,
    transactionsRoot: keccak256('0x80'), receiptsRoot: keccak256('0x80'), logsBloom: `0x${'00'.repeat(256)}`,
    difficulty: '0x0', number: '0x2a', gasLimit: '0xbebc200', gasUsed: '0x0', timestamp: '0x6acc0140',
    extraData: '0x', mixHash: hash('04'), nonce: '0x0000000000000000', baseFeePerGas: '0x1' };
  h.hash = keccak256(toRlp([h.parentHash,h.sha3Uncles,h.miner,h.stateRoot,h.transactionsRoot,h.receiptsRoot,h.logsBloom,
    ...[h.difficulty,h.number,h.gasLimit,h.gasUsed,h.timestamp].map(scalar),h.extraData,h.mixHash,h.nonce,scalar(h.baseFeePerGas)]));
  return h;
}
export function syntheticHoldProof(nonce = 7n) {
  const code = runtimes[HOLD], codeHash = keccak256(code), storageHash = keccak256('0x80');
  const leaf = toRlp([`0x20${keccak256(HOLD).slice(2)}`, toRlp([scalar(nonce),'0x',storageHash,codeHash])]);
  return { stateRoot: keccak256(leaf), witness: { accounts: [{ address: HOLD, code, codeHash, storageHash,
    nonce: toHex(nonce), balance: '0x0', accountProof: [leaf], storageProof: [] }] } };
}
export function syntheticCapture({ nextJobId = 17n, creatorNonce = 3n, stateRoot, includeCreationCode = true, chunkCount = 29 } = {}) {
  if (![29,85].includes(chunkCount)) throw Error('Synthetic fixture supports explicit small or saved-Retro-shaped chunk counts');
  const header = sealHeader(stateRoot), config = { name: 'Synthetic seed arithmetic', symbol: 'SYNTH', admin: OWNER,
    royaltyReceiver: OWNER, royaltyBps: 0, maxSupply: 1n, mintManager: `0x${'33'.repeat(20)}`, keelIndex: `0x${'44'.repeat(20)}` };
  const deployerBytes = Buffer.from(runtimes[DEPLOYER].slice(2), 'hex');
  const carrierAddresses = [1093,1130].map(offset => '0x' + deployerBytes.subarray(offset + 12,offset + 32).toString('hex'));
  const creation = concatHex(carrierAddresses.map(address => runtimes[address]));
  const constructor = encodeAbiParameters(['string','string','address','address','address','address','uint96','uint256'].map(type => ({type})),
    [config.name,config.symbol,config.admin,config.mintManager,config.keelIndex,config.royaltyReceiver,config.royaltyBps,config.maxSupply]);
  const salt = keccak256(encodeAbiParameters(['address','uint256','string','string'].map(type => ({type})), [OWNER,creatorNonce,config.name,config.symbol]));
  const scopedSalt = keccak256(encodeAbiParameters([{type:'address'},{type:'bytes32'}], [FACTORY,salt]));
  const predicted = getContractAddress({opcode:'CREATE2',from:DEPLOYER,salt:scopedSalt,bytecode:concatHex([creation,constructor])}).toLowerCase();
  const chunks = Array.from({length:chunkCount}, (_, index) => toHex(index + 1, {size:1}));
  const perBatch = chunkCount === 85 ? 3 : 1;
  const batches = Array.from({length:29}, (_, index) => chunks.slice(index * perBatch, (index + 1) * perBatch));
  const operations = chunks.slice(0,8).map(bytes => encodeFunctionData({abi:holdAbi,functionName:'weldObject',args:[[keccak256(bytes)],keccak256(bytes),1n,0,'text/plain']}));
  const call = (to,data,from = OWNER) => ({from,to,data,value:'0x0',gas:'0x2625a00'});
  const preparationCalls = [call(JOB, encodeFunctionData({abi:jobAbi,functionName:'openJob',args:[hash('05'),EXECUTOR,1_700_000_000n,chunks.map(keccak256),operations.map(keccak256),[HOLD]]})),
    call(JOB,encodeFunctionData({abi:jobAbi,functionName:'fundExecutor',args:[nextJobId,123n]})),
    ...batches.map(bytes => call(JOB,encodeFunctionData({abi:jobAbi,functionName:'executeCarrier',args:[nextJobId,bytes]}),EXECUTOR)),
    ...operations.map(data => call(JOB,encodeFunctionData({abi:jobAbi,functionName:'executeOperation',args:[nextJobId,HOLD,0n,data]}),EXECUTOR)),
    call(JOB,encodeFunctionData({abi:jobAbi,functionName:'completeJob',args:[nextJobId]}),EXECUTOR),
    call(FACTORY,encodeFunctionData({abi:factoryAbi,functionName:'castDie',args:[config]})),
    ...Array.from({length:4},()=>call(predicted,'0x12345678'))];
  const expectedTokenURI = 'data:application/json,{"name":"synthetic proof-seed test"}';
  const input = {chainId:11155111,blockNumber:{$keelDiagnosticBigInt:BigInt(header.number).toString()},preparationCalls,
    assertions:[{callIndex:0,returnData:slot(nextJobId)}],observationCalls:[call(predicted,'0x12345678')],metadataCall:call(predicted,'0xabcdef01'),
    expectedTokenURI,reader:predicted,readerRuntimeCodeHash:hash('07')};
  const evidence = (method,params,result) => ({request:{method,params},rawResponse:JSON.stringify({jsonrpc:'2.0',id:1,result})});
  const readEvidence = Object.entries(runtimes).filter(([address]) => includeCreationCode || [JOB,HOLD,FACTORY].includes(address))
    .map(([address,code])=>evidence('eth_getCode',[address,header.number],code));
  readEvidence.push(evidence('eth_call',[{to:JOB,data:encodeFunctionData({abi:jobAbi,functionName:'nextJobId'})},header.number],slot(nextJobId)),
    evidence('eth_call',[{to:FACTORY,data:encodeFunctionData({abi:factoryAbi,functionName:'creatorNonces',args:[OWNER]})},header.number],slot(creatorNonce)),
    evidence('eth_call',[{to:FACTORY,data:encodeFunctionData({abi:factoryAbi,functionName:'predictDieAddress',args:[config,OWNER,creatorNonce]})},header.number],encodeAbiParameters([{type:'address'}],[predicted])));
  return {schema:'keel-private-full-plan-diagnostic@1',status:'exact-input-captured-no-simulation',assemblyOnly:true,databaseReadOnlyVerified:true,
    approval:false,signing:'not-performed',submission:'not-performed',expectedCaptureHalt:true,synthetic:true,
    source:{siteCommit:'1'.repeat(40),sdkCommit:'2'.repeat(40)},scope:{...REQUIRED_CASES['retro-45'],artifactRevision:2,blockNumber:header.number,blockHash:header.hash},
    canonicalBefore:header,canonicalAfterAssembly:structuredClone(header),exactSimulationInput:input,completeInputSHA256:sha256(JSON.stringify(input)),
    preparationCallCount:45,completeUnallocatedCallCount:47,completeExpectedTokenURI:expectedTokenURI,completeTokenURIBytes:Buffer.byteLength(expectedTokenURI),
    completeTokenURIKeccak256:keccak256(toHex(expectedTokenURI)),readEvidence};
}
