import {prepareKeelPreReveal,type KeelPreRevealMode,type KeelPreRevealToken} from '@keel/sdk/pre-reveal';
import path from 'node:path';
import type {ToolDefinition} from './types.js';

export const PREREVEAL_TOOL_DEFINITIONS:readonly ToolDefinition[]=[{
  descriptor:{name:'keel-prereveal-prepare',description:'Optional hidden-art/trait/seed-rule commitment. Prepare one salted root over the token allocation and owner-only local proof files. Publish only the public manifest. Does not publish, reveal, sign or generate/log encryption keys. Uses existing KEEL Merkle commitments; known raster/asset hashes and compact attribute assignments are supported.',
    inputSchema:{type:'object',additionalProperties:false,required:['manifestPath','outputDirectory','privateOutputDirectory'],properties:{
      manifestPath:{type:'string',maxLength:4096,description:'Workspace JSON: {chainId,collection,mode,tokens:[{tokenId,assetHash?|assetPath?,attributes?,recipe?,seed?}]}. Seeded recipe binds generatorDigest,parametersDigest,seedRuleDigest and optional rasterProfileDigest/burnRuleDigest. Never send a secret reveal key.'},
      outputDirectory:{type:'string',maxLength:4096,description:'Existing workspace directory for the public commitment manifest.'},
      privateOutputDirectory:{type:'string',maxLength:4096,description:'A separate existing private workspace directory, excluded from publication. Salt-bearing proofs are written with owner-only permissions.'},
    }}},
  async run(context,input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Invalid prereveal request');
    const args=input as Record<string,unknown>;
    if(Object.keys(args).some(k=>!['manifestPath','outputDirectory','privateOutputDirectory'].includes(k))||typeof args.manifestPath!=='string'||typeof args.outputDirectory!=='string'||typeof args.privateOutputDirectory!=='string')throw new TypeError('Invalid prereveal paths');
    const dir=await context.workspace.resolveExistingDirectory(args.outputDirectory);
    const privateDir=await context.workspace.resolveExistingDirectory(args.privateOutputDirectory);
    if(privateDir===dir)throw new TypeError('Public and private prereveal outputs require separate directories');
    const source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode((await context.workspace.readFile(args.manifestPath,16_000_000)).bytes));
    if(!source||typeof source!=='object'||Object.keys(source).some(k=>!['chainId','collection','mode','tokens'].includes(k))||!Array.isArray(source.tokens)||source.tokens.length>65_535)throw new TypeError('Invalid prereveal allocation');
    const tokens:KeelPreRevealToken[]=[];
    for(const entry of source.tokens){
      if(!entry||typeof entry!=='object'||Object.keys(entry).some(k=>!['tokenId','assetHash','assetPath','attributes','recipe','seed'].includes(k)))throw new TypeError('Invalid prereveal token');
      const {assetPath,...token}=entry;
      if(assetPath!==undefined){if(typeof assetPath!=='string')throw new TypeError('Invalid asset path');token.assetBytes=(await context.workspace.readFile(assetPath,16*1024*1024)).bytes;}
      tokens.push(token);
    }
    const prepared=await prepareKeelPreReveal({chainId:source.chainId,collection:source.collection,mode:source.mode as KeelPreRevealMode,tokens});
    const name='prereveal-'+prepared.manifest.root.slice(2);
    const privateProofsPath=await context.workspace.writeBytes(path.join(privateDir,name+'.private-proofs.json'),new TextEncoder().encode(JSON.stringify(prepared.privateProofs)),{private:true});
    const publicManifestPath=await context.workspace.writeJson(path.join(dir,name+'.manifest.json'),prepared.manifest);
    return {protocol:prepared.manifest.protocol,root:prepared.manifest.root,count:prepared.manifest.count,mode:prepared.manifest.mode,publicManifestPath,privateProofsPath,
      published:false,signing:'not-performed',storage:'One root; native ciphertext and compact assignment rows remain separate optional modules.',
      next:'Anchor the public root at a fixed registered KEEL commitment revision, keep proofs/salts private until reveal, then check exact bytes/assignments against that original revision. Future mint seed and generator replay are separate checks. Encryption uses the local SDK sealed/layered helpers; do not put keys in MCP arguments or output.'};
  },
}];
