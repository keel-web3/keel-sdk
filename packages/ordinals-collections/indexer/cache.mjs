import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseBlock} from './block.mjs';
const hashPattern=/^[0-9a-f]{64}$/;
export function blockCache(directory) {
 if(typeof directory!=='string'||!directory)throw Error('cache directory required');
 const root=join(directory,'koc1-blocks-v1');
 async function read(path){try{return await readFile(path)}catch(e){if(e.code==='ENOENT')return null;throw e}}
 async function put(path,contents){await mkdir(root,{recursive:true,mode:0o700});const temp=join(root,`.${randomUUID()}.tmp`);try{await writeFile(temp,contents,{flag:'wx',mode:0o600});await rename(temp,path)}finally{await unlink(temp).catch(()=>{})}}
 return {
  async getBlock(hash){if(!hashPattern.test(hash))throw Error('invalid block hash');const raw=await read(join(root,`${hash}.blk`));if(raw && parseBlock(raw).hash!==hash)throw Error('cached block hash mismatch');return raw},
  async putBlock(hash,raw){if(!hashPattern.test(hash)||parseBlock(raw).hash!==hash)throw Error('invalid cache block');await put(join(root,`${hash}.blk`),raw)},
  async getRange(network,from,to){if(!['testnet4','regtest'].includes(network)||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from)throw Error('invalid range');const raw=await read(join(root,`${network}-${from}-${to}.json`));if(!raw)return null;let value;try{value=JSON.parse(raw)}catch{throw Error('invalid cached range')}if(value.version!==1||value.network!==network||value.from!==from||value.to!==to||!Array.isArray(value.hashes)||value.hashes.length!==to-from+1||!value.hashes.every(h=>hashPattern.test(h)))throw Error('invalid cached range');return value.hashes},
  async putRange(network,from,to,hashes){if(!['testnet4','regtest'].includes(network)||hashes.length!==to-from+1||!hashes.every(h=>hashPattern.test(h)))throw Error('invalid range');await put(join(root,`${network}-${from}-${to}.json`),JSON.stringify({version:1,network,from,to,hashes}))}
 };
}
