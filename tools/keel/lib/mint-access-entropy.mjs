import {encodeAbiParameters,keccak256,isAddressEqual,zeroAddress,zeroHash} from 'viem';
import {ABIS} from '../../../packages/sdk/dist/abis/keel-mint-access.generated.js';
import {ABIS as SEED_ABIS} from '../../../packages/sdk/dist/abis/keel-die.generated.js';

/** Resume one committed seed. Funding belongs to the transact caller's shared
 * seed program; failed delivery never requests a replacement word or block. */
export async function processMintAccessEntropy({client,source,consumer,id,reward,transact}){
  const abi=ABIS.KeelMintRewardEntropy;
  const key=keccak256(encodeAbiParameters([{type:'address'},{type:'uint64'},{type:'bool'}],[consumer,BigInt(id),reward]));
  const request=await client.readContract({address:source,abi,functionName:'requested',args:[key]});
  if(request===0n){
    if(reward){
      const draw=await client.readContract({address:consumer,abi:ABIS.KeelRewardClaims,functionName:'draws',args:[BigInt(id)]});
      if(!draw[2])return {done:true,status:'no-pending-draw'};
    }
    if(!await client.readContract({address:source,abi,functionName:'allowed',args:[consumer]}))return {done:false,status:'awaiting-authorization'};
    await transact(source,abi,'request',[consumer,BigInt(id),reward]);
    return {done:false,status:'requested'};
  }
  const delivery=await client.readContract({address:source,abi,functionName:'deliveries',args:[request]});
  if(!isAddressEqual(delivery[0],consumer)||BigInt(delivery[1])!==BigInt(id)||delivery[2]!==reward)throw new Error('Entropy adapter request binding mismatch');
  if(delivery[4])return {done:true,status:'delivered'};
  if(!delivery[3]){
    const provider=await client.readContract({address:source,abi,functionName:'seedProvider'});
    if(!isAddressEqual(provider,zeroAddress)){
      const seedAbi=SEED_ABIS.KeelSeedVrfAdapter;
      const providerRequest=await client.readContract({address:provider,abi:seedAbi,functionName:'requests',args:[source,request]});
      if(providerRequest===0n){
        // The seed provider checks this caller's credits or creator-funded access.
        await transact(provider,seedAbi,'request',[source,request]);
        return {done:false,status:'seed-requested',provider,request};
      }
      const [ready]=await client.readContract({address:provider,abi:seedAbi,functionName:'batchEntropy',args:[source,request]});
      if(!ready)return {done:false,status:'awaiting-randomness',provider,request};
      await transact(source,abi,'deliver',[request]);
      return {done:true,status:'delivered'};
    }else{
      const target=request>>32n;
      if(await client.getBlockNumber()<=target+1n)return {done:false,status:'awaiting-blocks',target};
      const archive=await client.readContract({address:source,abi,functionName:'blockArchive'});
      const hashes=await Promise.all([target,target+1n].map(number=>client.readContract({address:archive,abi:SEED_ABIS.KeelSeedBlockArchive,functionName:'hashOf',args:[number]})));
      if(hashes.some(hash=>hash===zeroHash))return {done:false,status:'awaiting-block-proof',target,archive};
    }
    await transact(source,abi,'deliver',[request]);
    return {done:true,status:'delivered',request};
  }
  await transact(source,abi,'deliver',[request]);
  return {done:true,status:'delivered'};
}
