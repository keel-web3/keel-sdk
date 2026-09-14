import {getAddress,isAddress,zeroAddress,zeroHash,encodeAbiParameters,keccak256,concatHex} from 'viem';
const gates=['public','wallets','merkle','token','achievement'];
const MAX_RECIPIENTS=4096;
function integer(value,name,max=0xffffffff,min=1){
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`Invalid ${name}`);
  return value;
}
function pair(a,b){return keccak256(concatHex(a.toLowerCase()<b.toLowerCase()?[a,b]:[b,a]));}
export function rewardMerkle(chainId,claims,campaign,wallets){
  if(wallets.length>MAX_RECIPIENTS)throw new Error(`Recipient lists cannot exceed ${MAX_RECIPIENTS} wallets`);
  const accounts=[...new Set(wallets.map(a=>getAddress(a)))].sort();
  if(accounts.some(a=>a===zeroAddress))throw new Error('Zero wallet is not claimable');
  if(!accounts.length||accounts.length>MAX_RECIPIENTS)throw new Error(`Merkle campaign requires 1..${MAX_RECIPIENTS} unique wallets`);
  const leaves=accounts.map(account=>keccak256(keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'uint32'},{type:'address'}],[BigInt(chainId),claims,campaign,account]))));
  const levels=[leaves];while(levels.at(-1).length>1){const previous=levels.at(-1),next=[];for(let i=0;i<previous.length;i+=2)next.push(pair(previous[i],previous[i+1]??previous[i]));levels.push(next);}
  const proofs=Object.fromEntries(accounts.map((account,index)=>{const proof=[];for(const level of levels.slice(0,-1)){proof.push(level[index^1]??level[index]);index=Math.floor(index/2);}return [account,proof];}));
  return {root:levels.at(-1)[0],proofs};
}
/** Pure, unsigned plan. Benefits must already exist; createAt pins the ID
 * used in Merkle leaves. Wallet-list campaigns remain owner-mutable and must
 * be created paused while their bounded setup batches are applied. */
export function rewardPlan(input,{chainId,claims,nextId}){
  integer(chainId,'chain ID',Number.MAX_SAFE_INTEGER);integer(nextId,'campaign ID');
  if(!isAddress(claims))throw new Error('Invalid claims contract');
  const gate=gates.indexOf(input.gate);if(gate<0)throw new Error('Unknown eligibility gate');
  const source=input.source===undefined?zeroAddress:getAddress(input.source);
  if(gate<=2&&source!==zeroAddress)throw new Error('Source does not apply to this eligibility gate');
  if((gate===3||gate===4)&&source===zeroAddress)throw new Error('A token or achievement registry is required');
  const start=integer(input.start,'start',2**48-1,0),end=integer(input.end,'end',2**48-1);
  if(end<=start)throw new Error('End must follow start');
  if(!Array.isArray(input.pool)||input.pool.length<1||input.pool.length>64)throw new Error('Reward pool requires 1..64 benefits');
  const pool=input.pool.map(p=>integer(p.benefit,'benefit')),weights=input.pool.map(p=>integer(p.weight??100,'weight',0xffffffff,0)||100);
  if(new Set(pool).size!==pool.length)throw new Error('Duplicate benefit');
  const random=input.random??false,noDuplicates=input.noDuplicates??false,paused=input.paused??false;
  if([random,noDuplicates,paused].some(v=>typeof v!=='boolean'))throw new Error('Invalid campaign switches');
  if(!random&&pool.length!==1)throw new Error('Multiple rewards require a random draw');
  const walletClaims=integer(input.walletClaims,'wallet claims');
  if(noDuplicates&&walletClaims>pool.length)throw new Error('No-duplicate campaigns cannot exceed the reward-pool size per wallet');
  const wallets=(input.wallets??[]).map(a=>getAddress(a));
  if(wallets.some(a=>a===zeroAddress))throw new Error('Zero wallet is not claimable');
  if(wallets.length>MAX_RECIPIENTS)throw new Error(`Recipient lists cannot exceed ${MAX_RECIPIENTS} wallets`);
  if((gate===1||gate===2)&&wallets.length===0)throw new Error('Wallets are required');
  if(gate!==1&&gate!==2&&wallets.length)throw new Error('Wallets do not apply to this gate');
  if(new Set(wallets).size!==wallets.length)throw new Error('Duplicate wallet');
  if(gate===1&&!paused)throw new Error('Wallet-list campaigns must start paused while owner batches are loaded');
  const merkle=gate===2?rewardMerkle(chainId,claims,nextId,wallets):{root:zeroHash,proofs:{}};
  const terms={gate,source,root:merkle.root,start,end,achievement:gate===4?integer(input.achievement,'achievement'):0,
    walletClaims,supply:integer(input.supply,'supply'),issued:0,random,noDuplicates,paused};
  const walletBatches=gate===1?Array.from({length:Math.ceil(wallets.length/256)},(_,i)=>wallets.slice(i*256,(i+1)*256)):[];
  return {chainId,claims,campaignId:nextId,terms,pool,weights,proofs:merkle.proofs,
    walletBatches,
    walletListPolicy:gate===1?{mutable:true,initialPaused:true}:null};
}
