import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {sha256} from 'viem';
import {openSession} from './gator-sepolia-session.mjs';
const root='apps/desktop/artifacts/sepolia-web3-16x16-test';
try{
 const p=JSON.parse(await readFile(root+'/preparation.json')),a=JSON.parse(await readFile(root+'/compiled.json'));
 assert.equal(p.localTestsPassed,true);assert.equal(p.targetChainId,11155111);
 assert.equal(sha256((await readFile(root+'/deployment-data.txt','utf8')).trim()),p.initDataDigest);
 const session=await openSession(root,{execute:true,budget:1_000_000_000_000_000n});
 const address=await session.deploy('tiny-blue-metadata', {abi:a.abi,bytecode:{object:'0x'+a.evm.bytecode.object}},[]);
 assert.equal(await session.c.getCode({address}),'0x'+a.evm.deployedBytecode.object);
 const metadata=await session.c.readContract({address,abi:a.abi,functionName:'tokenJSON',args:[0n]});
 assert.equal(metadata,await readFile('apps/desktop/artifacts/base-web3-16x16-test/metadata.json','utf8'));
 const journal=JSON.parse(await readFile(root+'/transactions.json'));
 const report={...p,checkedAt:new Date().toISOString(),publicChainPublished:true,address,tokenURI:`web3://${address.toLowerCase()}:11155111/tokenJSON/0`,metadataDigest:sha256(Buffer.from(metadata)),exactWorkingBaseMetadata:true,transactions:journal.steps};
 await writeFile(root+'/publication.json',JSON.stringify(report,null,2));console.log(report);
}catch(e){console.error(e.shortMessage??e.message);process.exitCode=1;}
