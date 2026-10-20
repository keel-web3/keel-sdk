import{build}from'/tmp/keel-private-gif-fresh-forward-bundle-20261020-01/node_modules/esbuild/lib/main.js';
import{writeFile}from'node:fs/promises';
const source='/private/tmp/keel-qa-gif-reviewed14-20261020/candidate-400/apps/studio/src/server/security/credential-policy.ts';
const result=await build({entryPoints:['/tmp/keel-qa-receipt-activation-20261020/keel-site/docs/tools/gif-fresh-forward-capture/diagnostic-signer-context.test.ts'],outfile:'/private/tmp/keel-independent-gif-native95-wave-20261020/context-test.mjs',platform:'node',target:'node22',format:'esm',bundle:true,packages:'external',metafile:true,plugins:[{name:'actual400-security-only',setup(b){b.onResolve({filter:/apps\/studio\/src\/server\/security\/credential-policy$/},()=>({path:source}));}}]});
await writeFile('/private/tmp/keel-independent-gif-native95-wave-20261020/context-test-metafile.json',JSON.stringify(result.metafile,null,2)+'\n',{flag:'wx'});
