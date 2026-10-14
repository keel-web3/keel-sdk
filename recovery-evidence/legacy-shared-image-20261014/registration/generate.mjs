import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {sharedFixture} from '../../../tests/support/legacy-shared-image-fixture.mjs';
import {decodeKeelInlineGraphFragment} from '../../../packages/sdk/dist/inline-viewer-graph.js';
import {prepareKeelDenseCopyFragment} from '../../../packages/sdk/dist/dense-transport.js';
const directory=new URL('./',import.meta.url);
await mkdir(directory,{recursive:true});
const sha=value=>'0x'+createHash('sha256').update(value).digest('hex');
const f=await sharedFixture(),s=f.built.shellRegistration;
const descriptor={profile:s.profile,shellId:s.shellId,chainId:11155111,bodySchema:s.bodySchema,contextSchema:s.contextSchema,payloadMode:2,
 requiredRegistry:'Distinct shell identity; existing canonical follow-latest head unchanged',
 requiredProgramBuilder:'KeelLegacySharedImageTokenURIBuilder or independently authenticated compatible capability',programProfile:f.program.profile,programMediaType:f.program.mediaType,
 builderSourceSHA256:sha(await readFile(new URL('../../../packages/sdk/contracts/KeelLegacySharedImageTokenURIBuilder.sol',import.meta.url))),
 builderRuntimeCodeHash:null,constructorBindings:null,selectedChainRegistrationVerified:false,registrationTransactions:'not-created',signing:'not-performed',submission:'not-performed',
 storePolicy:'Standard builder requires modern Hold requireHarness and seal policy APIs; recorded historical Hold runtime0x077e7511ef8deb6d2c1d56041ee230a1f6ffac4b861bf264c37346835653e0e5 requires a separately authenticated compatible adapter. Missing APIs never authorize it.',
 decoderIntegrity:s.decoderIntegrity,transportDecoderIntegrity:s.transportDecoderIntegrity,canonicalPrefixIntegrity:s.canonicalPrefixIntegrity,canonicalSuffixIntegrity:s.canonicalSuffixIntegrity,
 fragments:{}};
for(const side of ['prefix','suffix']){
 const raw=Buffer.from(s[side]),paddingBytes=(9-raw.length%9)%9,padded=Buffer.concat([raw,Buffer.alloc(paddingBytes,32)]);
 const prepared=Buffer.from(Buffer.from(padded).toString('base64')).toString('base64');
 assert.ok(!prepared.includes('='));assert.deepEqual(Buffer.from(decodeKeelInlineGraphFragment(Buffer.from(prepared),'application/vnd.keel.token-uri-base64-fragment')),padded);
 const compact=prepareKeelDenseCopyFragment(raw.toString());assert.deepEqual(Buffer.from(decodeKeelInlineGraphFragment(compact,'application/vnd.keel.token-uri-raw-percent-fragment')),raw);
 await writeFile(new URL(side+'.raw.html.txt',directory),raw);await writeFile(new URL(side+'.mode2.preencoded.txt',directory),prepared);await writeFile(new URL(side+'.compact.raw-percent.fragment',directory),compact);
 descriptor.fragments[side]={rawPath:side+'.raw.html.txt',rawByteLength:raw.length,rawSHA256:sha(raw),paddingBytes,paddedRawSHA256:sha(padded),preparedPath:side+'.mode2.preencoded.txt',preparedByteLength:prepared.length,preparedSHA256:sha(prepared),compactPath:side+'.compact.raw-percent.fragment',compactByteLength:compact.length,compactSHA256:sha(compact)};
}
await writeFile(new URL('descriptor.json',directory),JSON.stringify(descriptor,null,2)+'\n');console.log(JSON.stringify(descriptor));
