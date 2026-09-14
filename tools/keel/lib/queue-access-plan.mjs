import {encodeAbiParameters,encodeFunctionData,getAddress,keccak256,parseAbi,concatHex,zeroAddress,zeroHash} from 'viem';

const gates=['wallet','merkle','signature','erc721-balance','erc721-token','erc721-exact-token'];
const tuple='(uint8 gate,bool skip,uint16 weight,uint32 maxQuantity,uint32 walletUses,uint32 tokenUses,uint48 start,uint48 end,address source,bytes32 root,uint256 minimumBalance,uint256 requiredTokenId)';
export const queueAccessPlanAbi=parseAbi([`function createAt(uint32 expectedId,${tuple} policy) returns(uint32)`, 'function setWallets(uint32 policy,address[] accounts,uint16[] weights)','function setPaused(uint32 policy,bool value)']);
function integer(value,name,max,minimum=0){const n=Number(value);if(!Number.isSafeInteger(n)||n<minimum||n>max)throw new Error(`Invalid ${name}`);return n;}
function uint(value,name){try{const n=BigInt(value??0);if(n<0n||n>=1n<<256n)throw new Error();return n;}catch{throw new Error(`Invalid ${name}`);}}
export function queueAccessLeaf({chainId,access,queue,policy,account,weight,tokenId=0n}){
  return keccak256(concatHex([keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'address'},{type:'uint32'},{type:'address'},{type:'uint16'},{type:'uint256'}],[BigInt(chainId),access,queue,policy,account,weight,BigInt(tokenId)]))]));
}
function pair(a,b){return keccak256(concatHex(a.toLowerCase()<b.toLowerCase()?[a,b]:[b,a]));}
function merkle(leaves){
  if(leaves.length===0)throw new Error('Merkle list cannot be empty');
  const levels=[leaves];while(levels.at(-1).length>1){const previous=levels.at(-1),next=[];for(let i=0;i<previous.length;i+=2)next.push(previous[i+1]?pair(previous[i],previous[i+1]):previous[i]);levels.push(next);}
  return {root:levels.at(-1)[0],proofs:leaves.map((_,position)=>{const proof=[];for(const level of levels.slice(0,-1)){const sibling=position^1;if(level[sibling])proof.push(level[sibling]);position=Math.floor(position/2);}return proof;})};
}
/** Unsigned preparation only. Exact campaign ID is checked by createAt and
 * starts paused; activation remains separate until membership is read back. */
export function planQueueAccess(input){
  if(input.skip!==undefined&&typeof input.skip!=='boolean')throw new Error('skip must be boolean');
  const chainId=integer(input.chainId,'chainId',Number.MAX_SAFE_INTEGER,1),access=getAddress(input.access),queue=getAddress(input.queue);
  if(access===zeroAddress||queue===zeroAddress)throw new Error('Queue and access module must be nonzero');
  const id=integer(input.policyId,'policyId',0xffffffff,1),gate=gates.indexOf(input.gate);if(gate<0)throw new Error('Unknown gate');
  const weight=integer(input.weight??10,'weight',100,1);
  const policy={gate,skip:input.skip===true,weight,maxQuantity:integer(input.maxQuantity??1,'maxQuantity',0xffffffff,1),walletUses:integer(input.walletUses??1,'walletUses',0xffffffff),tokenUses:integer(input.tokenUses??0,'tokenUses',0xffffffff),start:integer(input.start??0,'start',2**48-1),end:integer(input.end,'end',2**48-1,1),source:getAddress(input.source??zeroAddress),root:input.root??zeroHash,minimumBalance:uint(input.minimumBalance??(gate===3?1:0),'minimumBalance'),requiredTokenId:uint(input.requiredTokenId,'requiredTokenId')};
  if(policy.end<=policy.start)throw new Error('Policy window must be nonempty');
  if(policy.tokenUses&&gate!==4&&gate!==5)throw new Error('Token usage requires token ownership gate');
  if(gate>=2&&policy.source===zeroAddress)throw new Error('Source signer or NFT collection required');
  if(gate===3&&policy.minimumBalance===0n)throw new Error('Minimum NFT balance must be positive');
  if(!/^0x[0-9a-f]{64}$/i.test(policy.root))throw new Error('Invalid Merkle root');
  if(input.recipients?.length>4096)throw new Error('Recipient limit is 4096');
  const seen=new Set();const recipients=(input.recipients??[]).map(row=>{const account=getAddress(row.account);if(account===zeroAddress||seen.has(account))throw new Error('Duplicate or zero recipient');seen.add(account);return {account,weight:integer(row.weight??weight,'recipient weight',100,1),tokenId:uint(row.tokenId,'tokenId')};});
  if(recipients.some(r=>r.tokenId!==0n&&gate!==4&&gate!==5))throw new Error('Token IDs require a token ownership gate');
  if(gate>=3&&recipients.some(r=>r.weight!==weight))throw new Error('NFT campaign weight is fixed; use separate policies for different NFT weights');
  if(gate===5&&recipients.some(r=>r.tokenId!==policy.requiredTokenId))throw new Error('Recipient token differs from required token');
  let proofs=[];
  if(gate===1||(recipients.length&&(gate!==0||policy.root!==zeroHash))){const tree=merkle(recipients.map(r=>queueAccessLeaf({chainId,access,queue,policy:id,...r})));if(policy.root!==zeroHash&&policy.root!==tree.root)throw new Error('Root differs from supplied recipients');policy.root=tree.root;proofs=recipients.map((r,i)=>({...r,proof:tree.proofs[i]}));}
  if(gate===0&&recipients.length===0)throw new Error('Wallet list cannot be empty');
  const calls=[{to:access,value:'0',data:encodeFunctionData({abi:queueAccessPlanAbi,functionName:'createAt',args:[id,policy]})}];
  if(gate===0)for(let i=0;i<recipients.length;i+=128){const batch=recipients.slice(i,i+128);calls.push({to:access,value:'0',data:encodeFunctionData({abi:queueAccessPlanAbi,functionName:'setWallets',args:[id,batch.map(r=>r.account),batch.map(r=>r.weight)]})});}
  return {schema:'keel-queue-access-plan/v1',chainId,queue,access,policyId:id,policy,calls,proofs,
    activationAfterReadback:{to:access,value:'0',data:encodeFunctionData({abi:queueAccessPlanAbi,functionName:'setPaused',args:[id,false]})},
    signatureDomain:{name:'KeelQueueAccess',version:'1',chainId,verifyingContract:access},signatureType:'QueueAccess(uint32 policy,address account,uint16 weight,uint256 tokenId)',
    requiredReads:['queue controller, scope and owner','access queue and owner','current count + 1 equals policyId','NFT source code and supported ownership read','policy/list read-back before unpause'],
    usage:'One use is one successful accelerated mint transaction up to maxQuantity. Ordinary admission does not spend a perk. Zero usage limits are unlimited.',
    signed:false,submitted:false};
}
