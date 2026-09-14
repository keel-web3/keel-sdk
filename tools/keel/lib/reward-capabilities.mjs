import {parseAbi,keccak256,zeroAddress,getAddress} from 'viem';
const addressAbi=parseAbi(['function owner() view returns(address)','function rewardClaims() view returns(address)']);
async function optionalRead(client,address,blockNumber,abi,functionName,args=[]){
  try{return {status:'read',value:await client.readContract({address,blockNumber,abi,functionName,args})};}
  catch{return {status:'unavailable',value:null};}
}
async function identity(client,address,blockNumber){
  const [code,owner]=await Promise.all([client.getCode({address,blockNumber}),optionalRead(client,address,blockNumber,addressAbi,'owner')]);
  return {address,codeHash:code&&code!=='0x'?keccak256(code):null,owner};
}
/** Evidence only: generic receivers have no mandatory introspection interface.
 * A successful getter is not proof that redemption/entropy will succeed. */
export async function rewardCapabilities(client,{plan,benefits,entropySource,blockNumber,probeTokenId,probeAccount}){
  const receivers=await Promise.all(benefits.map(async(b,i)=>{
    const [contract,binding]=await Promise.all([identity(client,b[0],blockNumber),optionalRead(client,b[0],blockNumber,addressAbi,'rewardClaims')]);
    const authorization=binding.status==='read'?(binding.value.toLowerCase()===plan.claims.toLowerCase()?'bound':'wrong-claims-contract'):'unknown';
    if(authorization==='wrong-claims-contract')throw new Error(`Benefit ${plan.pool[i]} receiver authorizes another claims contract`);
    return {benefit:plan.pool[i],...contract,authorization,redemption:'Not exercised; validate this receiver with a local claim and redemption'};
  }));
  let eligibility={status:'not-required'};
  if(plan.terms.gate===4){
    const account=probeAccount===undefined?zeroAddress:getAddress(probeAccount);
    const probe=await optionalRead(client,plan.terms.source,blockNumber,parseAbi(['function unlocked(address,uint32) view returns(bool)']),'unlocked',[account,plan.terms.achievement]);
    if(probe.status!=='read')throw new Error('Achievement interface probe failed');
    eligibility=probeAccount===undefined
      ?{status:'unverified',interface:'read',reason:'Provide probeAccount to check a player achievement; interface callability alone does not establish eligibility'}
      :{...probe,account,scope:'Achievement unlocked at the reviewed block only; campaign limits and redemption are not exercised'};
  }
  if(plan.terms.gate===3){
    eligibility=probeTokenId===undefined?{status:'unverified',reason:'Provide probeTokenId for an existing eligible collection token'}:
      await optionalRead(client,plan.terms.source,blockNumber,parseAbi(['function ownerOf(uint256) view returns(address)']),'ownerOf',[BigInt(probeTokenId)]);
    if(eligibility.status==='unavailable')throw new Error('Token ownership probe failed');
  }
  return {
    claims:await identity(client,plan.claims,blockNumber),
    source:plan.terms.source===zeroAddress?null:await identity(client,plan.terms.source,blockNumber),
    eligibility,receivers,
    entropy:entropySource===zeroAddress?{address:entropySource,status:'disabled'}:{...await identity(client,entropySource,blockNumber),status:'fulfillment not exercised'},
    readiness:'Creation simulation only; claim, redemption and random fulfillment require separate integration evidence',
  };
}
